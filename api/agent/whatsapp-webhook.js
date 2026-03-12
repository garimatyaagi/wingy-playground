import {
  createTaskStep,
  fetchLastAgentMessage,
  fetchLastUserCapture,
  findCaptureByMessageSid,
  findOrCreateGoal,
  getAgentProfileByUserId,
  logAgentMessage,
  logMessageCapture,
  logParsedAction,
  logTaskEvent,
  resolveInboundUser,
  saveAgentNote,
  saveTaskOccurrence,
  updateMessageCapture,
  updateTaskStep,
} from "./_store.js";
import {
  buildMessageContext,
  buildRichResponse,
  parseEveningResponse,
  parseMessageIntentWithLLM,
  resolveTaskMatch,
} from "./_engine.js";
import {
  bodyToForm,
  twimlMessage,
  validateTwilioSignature,
} from "./_twilio.js";
import { getUpcomingEvents } from "./_calendar.js";

function formatErrorReply() {
  return "I had trouble processing that. Please resend in one line, e.g. 'Finish pitch deck by Friday'.";
}

function formatClarification(options = []) {
  if (!Array.isArray(options) || options.length === 0) {
    return "Which task did you mean? Reply with the exact task title.";
  }
  const names = options.map((task) => task.title).slice(0, 3);
  return `Which one did you finish: ${names.join(", ")}?`;
}

// Fetch calendar events for response context (returns [] if unavailable)
async function fetchCalendarContext(userId) {
  try {
    const profile = await getAgentProfileByUserId(userId);
    if (!profile?.google_refresh_token) return [];
    return await getUpcomingEvents(profile.google_refresh_token, profile.timezone || "Asia/Kolkata", 4);
  } catch {
    return [];
  }
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, endpoint: "whatsapp-webhook" });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let captureId = null;
  let userId = null;
  try {
    const form = bodyToForm(req);
    const signature = validateTwilioSignature(req, form);
    if (!signature.valid) {
      return res.status(403).json({ error: "Invalid Twilio signature" });
    }

    const rawText = String(form.Body || form.body || "").trim();
    const from = String(form.From || form.from || "").trim();
    const messageSid = String(form.MessageSid || form.messageSid || form.SmsSid || "").trim() || null;

    // Twilio MessageSid dedup: prevent duplicate processing on retries
    if (messageSid) {
      const existing = await findCaptureByMessageSid(messageSid);
      if (existing) {
        console.log("whatsapp dedup: already seen MessageSid", { messageSid, captureId: existing.id, processed: existing.processed });
        res.setHeader("Content-Type", "text/xml");
        if (existing.processed) {
          return res.status(200).send(twimlMessage(""));
        }
        return res.status(200).send(twimlMessage("Still processing your message..."));
      }
    }

    const inbound = await resolveInboundUser(from);
    if (!inbound?.userId) {
      const onboardingReply =
        "I could not map this number to a 365 Tasks account yet. Open Agent Settings in the app and save this WhatsApp number first.";
      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(twimlMessage(onboardingReply));
    }

    userId = inbound.userId;
    captureId = await logMessageCapture({
      userId,
      rawText,
      messageSid,
      fromNumber: from,
      normalizedText: rawText.toLowerCase().trim(),
      parsedIntent: "received",
      parseConfidence: 0,
      processed: false,
      createdTaskIds: [],
      updatedTaskIds: [],
      clarificationRequested: false,
      processingResult: "received",
    });

    // Handle greeting / activation messages — opens the 24h session window
    const greeting = rawText.toLowerCase().replace(/[^a-z]/g, "");
    if (["start", "hi", "hello", "hey"].includes(greeting)) {
      await updateMessageCapture(captureId, {
        parsedIntent: "greeting",
        parseConfidence: 1,
        parseMethod: "keyword",
        parseDurationMs: 0,
        processed: true,
        createdTaskIds: [],
        updatedTaskIds: [],
        clarificationRequested: false,
        processingResult: "greeting_ack",
      });
      await logAgentMessage({ userId, type: "ack", body: "Welcome!", relatedTaskIds: [], metadata: { source: "whatsapp-webhook", intent: "greeting", result: "greeting_ack" } });
      const welcomeReply = "Hey! I'm your 365 Tasks agent. I'll send you morning briefs, nudges, and evening check-ins on WhatsApp. Just text me tasks like 'Finish pitch deck by Friday' and I'll track them for you.";
      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(twimlMessage(welcomeReply));
    }

    // ─── Pre-LLM keyword shortcuts for common patterns ───
    const lower = rawText.toLowerCase().trim();

    // "Add a task" / "Yes add a task" without specifying WHAT — ask for the task
    if (/^(?:yes\s*,?\s*)?(?:add|create)\s+(?:a\s+)?tasks?\s*[.!]?$/i.test(lower)) {
      const askReply = "What task would you like me to add?";
      await updateMessageCapture(captureId, {
        parsedIntent: "ambiguous", parseConfidence: 1, parseMethod: "keyword",
        parseDurationMs: 0, processed: true,
        createdTaskIds: [], updatedTaskIds: [],
        clarificationRequested: true, processingResult: "clarification_requested",
      });
      await logAgentMessage({ userId, type: "clarification", body: askReply, relatedTaskIds: [], metadata: { source: "whatsapp-webhook", intent: "ambiguous", result: "meta_add_task" } });
      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(twimlMessage(askReply));
    }

    // "Add task: X" — skip LLM, create directly
    const addTaskMatch = rawText.match(/^add\s+task\s*[:!-]\s*(.+)/i);
    if (addTaskMatch) {
      const title = addTaskMatch[1].trim();
      const created = await createTaskStep(userId, {
        title,
        normalizedTitle: title.toLowerCase(),
        rawSourceText: rawText,
        estimatedMinutes: 30,
        urgency: 3,
        importance: 3,
        effortType: "deep_work",
        source: "whatsapp",
        aiConfidence: 1,
        goalName: "General",
        status: "open",
      });
      const ctx = await buildMessageContext(userId, new Date());
      const calendarEvents = await fetchCalendarContext(userId);
      const replyText = created?.id
        ? buildRichResponse([{ type: "task_created", task: { title, id: created.id } }], ctx, calendarEvents)
        : "Could not save that task. Please try again.";
      await updateMessageCapture(captureId, {
        parsedIntent: "create_task", parseConfidence: 1, parseMethod: "keyword",
        parseDurationMs: 0, processed: true,
        createdTaskIds: created?.id ? [created.id] : [], updatedTaskIds: [],
        clarificationRequested: false, processingResult: created?.id ? "task_created" : "create_failed",
      });
      await logAgentMessage({ userId, type: "ack", body: replyText, relatedTaskIds: created?.id ? [created.id] : [], metadata: { source: "whatsapp-webhook", intent: "create_task", result: created?.id ? "task_created" : "create_failed" } });
      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(twimlMessage(replyText));
    }

    // "Done" / "Done with X" / "Completed X" / "Finished X" — quick completion
    const doneMatch = rawText.match(/^(?:done|finished|completed|✅)\s*(?:with\s+)?[:!-]?\s*(.+)?/i);
    if (doneMatch) {
      const target = (doneMatch[1] || "").trim();
      const ctx = await buildMessageContext(userId, new Date());
      const match = resolveTaskMatch({
        targetText: target || (ctx.openTasks[0]?.title || ""),
        openTasks: ctx.openTasks,
        preferredTaskIds: ctx.preferredTaskIds,
        lastNudgedTaskId: ctx.lastNudgedTaskId,
      });
      if (match.status === "matched" && match.task) {
        const nowIso = new Date().toISOString();
        await updateTaskStep(match.task.id, match.task.goalId, {
          ...match.task, done: true, status: "done", completedAt: nowIso, completionConfidence: 1,
        });
        await logTaskEvent(match.task.id, "completed", { source: "whatsapp", rawText });
        // Rebuild context after completion for accurate state
        const freshCtx = await buildMessageContext(userId, new Date());
        const calendarEvents = await fetchCalendarContext(userId);
        const replyText = buildRichResponse([{ type: "task_completed", task: match.task }], freshCtx, calendarEvents);
        await updateMessageCapture(captureId, {
          parsedIntent: "complete_task", parseConfidence: 1, parseMethod: "keyword",
          parseDurationMs: 0, processed: true,
          createdTaskIds: [], updatedTaskIds: [match.task.id],
          clarificationRequested: false, processingResult: "task_completed",
        });
        await logAgentMessage({ userId, type: "ack", body: replyText, relatedTaskIds: [match.task.id], metadata: { source: "whatsapp-webhook", intent: "complete_task", result: "task_completed" } });
        res.setHeader("Content-Type", "text/xml");
        return res.status(200).send(twimlMessage(replyText));
      }
      // Fall through to LLM if no match
    }

    // ─── Clarification follow-up: if bot just asked a question, user's reply answers it ───
    const lastBotMsg = await fetchLastAgentMessage(userId);
    const botJustAskedClarification = lastBotMsg?.type === "clarification";
    const botAskedWhatTask = botJustAskedClarification && /what\s+task/i.test(lastBotMsg.body || "");
    const botAskedClarifyOrConfirm = botJustAskedClarification && /clarify|do you want|would you like/i.test(lastBotMsg.body || "");

    // ─── Evening checkin response detection ───
    // If the last bot message was an evening_checkin, treat user reply as evening feedback
    if (lastBotMsg?.type === "evening_checkin") {
      const ctx = await buildMessageContext(userId, new Date());
      const topTitles = (ctx.dueTodayTasks || ctx.openTasks || []).slice(0, 5).map((t) => t.title);
      const eveningResults = parseEveningResponse(rawText, topTitles);

      if (eveningResults) {
        const topTasks = (ctx.dueTodayTasks || ctx.openTasks || []).slice(0, 5);
        const actionsTaken = [];
        const updatedIds = [];

        for (const result of eveningResults) {
          const task = topTasks[result.index];
          if (!task) continue;

          if (result.status === "done") {
            const nowIso = new Date().toISOString();
            if (task.isRecurring) {
              await saveTaskOccurrence({
                parentTaskId: task.id,
                date: new Date().toISOString().slice(0, 10),
                status: "completed",
                actualMinutes: Number(task.estimatedMinutes || 20),
                skipped: false,
                completedAt: nowIso,
              });
            } else {
              await updateTaskStep(task.id, task.goalId, {
                ...task, done: true, status: "done", completedAt: nowIso, completionConfidence: 0.9,
              });
            }
            await logTaskEvent(task.id, "completed", { source: "whatsapp", rawText, via: "evening_checkin" });
            actionsTaken.push({ type: "task_completed", task });
            updatedIds.push(task.id);
          } else if (result.status === "skipped") {
            // Auto-reschedule to tomorrow
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            const tomorrowIso = tomorrow.toISOString();
            if (!task.isRecurring) {
              await updateTaskStep(task.id, task.goalId, {
                ...task, dueDate: tomorrowIso, scheduledDate: tomorrowIso,
                rescheduleCount: Number(task.rescheduleCount || 0) + 1,
              });
            }
            await logTaskEvent(task.id, "snoozed", { source: "whatsapp", via: "evening_checkin", reason: "skipped" });
            actionsTaken.push({ type: "task_rescheduled", task, newDate: tomorrowIso });
            updatedIds.push(task.id);
          }
          // "partial" — keep as-is, just acknowledge
          if (result.status === "partial") {
            actionsTaken.push({ type: "update_noted" });
          }
        }

        const doneCount = actionsTaken.filter((a) => a.type === "task_completed").length;
        const skippedCount = actionsTaken.filter((a) => a.type === "task_rescheduled").length;
        const partialCount = actionsTaken.filter((a) => a.type === "update_noted").length;

        const replyLines = [];
        if (doneCount > 0) replyLines.push(`${doneCount} task${doneCount > 1 ? "s" : ""} completed.`);
        if (skippedCount > 0) replyLines.push(`${skippedCount} carried over to tomorrow.`);
        if (partialCount > 0) replyLines.push(`${partialCount} in progress.`);
        replyLines.push("What's your #1 priority for tomorrow?");
        const reply = replyLines.join("\n");

        await updateMessageCapture(captureId, {
          parsedIntent: "evening_response", parseConfidence: 0.9, parseMethod: "evening_parser",
          parseDurationMs: 0, processed: true,
          createdTaskIds: [], updatedTaskIds: updatedIds,
          clarificationRequested: false, processingResult: "evening_processed",
        });
        await logAgentMessage({ userId, type: "ack", body: reply, relatedTaskIds: updatedIds, metadata: { source: "whatsapp-webhook", intent: "evening_response", result: "evening_processed" } });
        res.setHeader("Content-Type", "text/xml");
        return res.status(200).send(twimlMessage(reply));
      }
      // If parseEveningResponse returned null, fall through to LLM
    }

    // If bot asked "what task?" and user responds with something actionable, create it directly
    if (botAskedWhatTask) {
      const yesMatch = rawText.match(/^(?:yes|yeah|yep|yup|ya|sure|ok)\s*,?\s*(.+)?$/i);
      const afterYes = yesMatch ? (yesMatch[1] || "").trim() : "";
      if (yesMatch && (!afterYes || /^add\s+a?\s*tasks?$/i.test(afterYes))) {
        const prevCapture = await fetchLastUserCapture(userId);
        const prevText = (prevCapture?.raw_text || "").trim();
        if (prevText && !/^(?:yes|add\s+a?\s*tasks?|task)$/i.test(prevText.toLowerCase())) {
          const title = prevText;
          const created = await createTaskStep(userId, {
            title, normalizedTitle: title.toLowerCase(), rawSourceText: rawText,
            estimatedMinutes: 30, urgency: 3, importance: 3, effortType: "deep_work",
            source: "whatsapp", aiConfidence: 0.9, goalName: "General", status: "open",
          });
          const ctx = await buildMessageContext(userId, new Date());
          const calendarEvents = await fetchCalendarContext(userId);
          const replyText = created?.id
            ? buildRichResponse([{ type: "task_created", task: { title, id: created.id } }], ctx, calendarEvents)
            : "Could not save that task. Please try again.";
          await updateMessageCapture(captureId, {
            parsedIntent: "create_task", parseConfidence: 0.9, parseMethod: "clarification_followup",
            parseDurationMs: 0, processed: true,
            createdTaskIds: created?.id ? [created.id] : [], updatedTaskIds: [],
            clarificationRequested: false, processingResult: created?.id ? "task_created" : "create_failed",
          });
          await logAgentMessage({ userId, type: "ack", body: replyText, relatedTaskIds: created?.id ? [created.id] : [], metadata: { source: "whatsapp-webhook", intent: "create_task", result: "clarification_followup" } });
          res.setHeader("Content-Type", "text/xml");
          return res.status(200).send(twimlMessage(replyText));
        }
      } else if (!yesMatch) {
        const title = rawText.trim();
        if (title.length > 2 && title.length < 200) {
          const created = await createTaskStep(userId, {
            title, normalizedTitle: title.toLowerCase(), rawSourceText: rawText,
            estimatedMinutes: 30, urgency: 3, importance: 3, effortType: "deep_work",
            source: "whatsapp", aiConfidence: 0.9, goalName: "General", status: "open",
          });
          const ctx = await buildMessageContext(userId, new Date());
          const calendarEvents = await fetchCalendarContext(userId);
          const replyText = created?.id
            ? buildRichResponse([{ type: "task_created", task: { title, id: created.id } }], ctx, calendarEvents)
            : "Could not save that task. Please try again.";
          await updateMessageCapture(captureId, {
            parsedIntent: "create_task", parseConfidence: 0.9, parseMethod: "clarification_followup",
            parseDurationMs: 0, processed: true,
            createdTaskIds: created?.id ? [created.id] : [], updatedTaskIds: [],
            clarificationRequested: false, processingResult: created?.id ? "task_created" : "create_failed",
          });
          await logAgentMessage({ userId, type: "ack", body: replyText, relatedTaskIds: created?.id ? [created.id] : [], metadata: { source: "whatsapp-webhook", intent: "create_task", result: "clarification_followup" } });
          res.setHeader("Content-Type", "text/xml");
          return res.status(200).send(twimlMessage(replyText));
        }
      }
    }

    // If bot asked "do you want to create a task?" and user says "yes" — create it from context
    if (botAskedClarifyOrConfirm && /^(?:yes|yeah|yep|yup|ya|sure|ok)/i.test(lower)) {
      const aboutMatch = (lastBotMsg.body || "").match(/(?:create a task (?:for|related to|about) |mean by ')(.+?)(?:'|\?|,|$)/i);
      const taskFromContext = aboutMatch ? aboutMatch[1].trim() : null;
      if (taskFromContext) {
        const title = taskFromContext;
        const created = await createTaskStep(userId, {
          title, normalizedTitle: title.toLowerCase(), rawSourceText: rawText,
          estimatedMinutes: 30, urgency: 3, importance: 3, effortType: "deep_work",
          source: "whatsapp", aiConfidence: 0.85, goalName: "General", status: "open",
        });
        const ctx = await buildMessageContext(userId, new Date());
        const calendarEvents = await fetchCalendarContext(userId);
        const replyText = created?.id
          ? buildRichResponse([{ type: "task_created", task: { title, id: created.id } }], ctx, calendarEvents)
          : "Could not save that task. Please try again.";
        await updateMessageCapture(captureId, {
          parsedIntent: "create_task", parseConfidence: 0.85, parseMethod: "clarification_followup",
          parseDurationMs: 0, processed: true,
          createdTaskIds: created?.id ? [created.id] : [], updatedTaskIds: [],
          clarificationRequested: false, processingResult: created?.id ? "task_created" : "create_failed",
        });
        await logAgentMessage({ userId, type: "ack", body: replyText, relatedTaskIds: created?.id ? [created.id] : [], metadata: { source: "whatsapp-webhook", intent: "create_task", result: "clarification_followup" } });
        res.setHeader("Content-Type", "text/xml");
        return res.status(200).send(twimlMessage(replyText));
      }
    }

    // ─── LLM Parse + Multi-Action Loop ───

    const parseStart = Date.now();
    const parsedResult = await parseMessageIntentWithLLM(rawText, userId, new Date());
    const parseDurationMs = Date.now() - parseStart;
    const ctx = await buildMessageContext(userId, new Date());
    const calendarEvents = await fetchCalendarContext(userId);
    const openTasks = ctx.openTasks;
    const preferredTaskIds = ctx.preferredTaskIds;
    const lastNudgedTaskId = ctx.lastNudgedTaskId;

    const createdTaskIds = [];
    const updatedTaskIds = [];
    const actionsTaken = [];
    let clarificationRequested = false;
    let result = "noop";
    let primaryIntent = "ambiguous";

    // Process each action from the LLM result
    const actions = parsedResult.actions || [];

    for (const action of actions) {
      primaryIntent = action.intent; // track last intent for logging

      if (action.intent === "create_task" || action.intent === "create_recurring_task") {
        for (const draft of action.tasks || []) {
          const created = await createTaskStep(userId, draft);
          if (!created?.id) {
            await logParsedAction({ captureId, userId, actionType: "create_task", actionPayload: draft, result: "failed", errorDetail: "createTaskStep returned null", confidence: parsedResult.confidence });
            continue;
          }
          createdTaskIds.push(created.id);
          await logTaskEvent(created.id, "created", {
            source: "whatsapp",
            rawText,
            parseConfidence: parsedResult.confidence,
            recurring: Boolean(draft.isRecurring),
          });
          await logParsedAction({ captureId, userId, actionType: "create_task", actionPayload: { title: draft.title }, targetTaskId: created.id, result: "created", confidence: parsedResult.confidence });
          actionsTaken.push({ type: "task_created", task: { title: draft.title, id: created.id } });
        }
        if (createdTaskIds.length === 0 && actionsTaken.length === 0) {
          clarificationRequested = true;
          result = "create_failed";
          actionsTaken.push({ type: "error", message: "I understood this as a task, but could not save it. Please resend with a shorter action line." });
        }

      } else if (action.intent === "goal") {
        const goal = await findOrCreateGoal(userId, action.goalTitle || "General");
        const goalResult = goal?.id ? "goal_created" : "goal_failed";
        await logParsedAction({ captureId, userId, actionType: "create_goal", actionPayload: { goalTitle: action.goalTitle }, targetTaskId: goal?.id, result: goalResult, confidence: parsedResult.confidence });
        if (goal?.id) {
          actionsTaken.push({ type: "goal_created", goal: { title: goal.title, id: goal.id } });
        } else {
          clarificationRequested = true;
          actionsTaken.push({ type: "error", message: "I could not save that goal yet. Please try a shorter goal title." });
        }

      } else if (action.intent === "note" || action.intent === "informational_update") {
        await saveAgentNote({ userId, text: action.noteText || rawText, rawText });
        const noteResult = action.intent === "informational_update" ? "update_noted" : "note_saved";
        await logParsedAction({ captureId, userId, actionType: action.intent, actionPayload: { text: (action.noteText || rawText).slice(0, 200) }, result: noteResult, confidence: parsedResult.confidence });
        actionsTaken.push({ type: noteResult });

      } else if (action.intent === "complete_task") {
        let completionTarget = action.completionTarget || rawText;
        if (/^\d{4}-\d{2}-\d{2}/.test(completionTarget) || completionTarget.length < 3) {
          completionTarget = rawText;
        }
        const match = resolveTaskMatch({
          targetText: completionTarget,
          openTasks,
          preferredTaskIds,
          lastNudgedTaskId,
        });
        if (match.status === "matched" && match.task) {
          const nowIso = new Date().toISOString();
          if (match.task.isRecurring) {
            await saveTaskOccurrence({
              parentTaskId: match.task.id,
              date: new Date().toISOString().slice(0, 10),
              status: "completed",
              actualMinutes: Number(match.task.estimatedMinutes || 20),
              skipped: false,
              completedAt: nowIso,
            });
            await logTaskEvent(match.task.id, "completed", {
              source: "whatsapp", kind: "recurring_occurrence", rawText, confidence: parsedResult.confidence,
            });
          } else {
            const update = await updateTaskStep(match.task.id, match.task.goalId, {
              ...match.task, done: true, status: "done", completedAt: nowIso, completionConfidence: parsedResult.confidence,
            });
            if (!update.ok) {
              clarificationRequested = true;
              actionsTaken.push({ type: "error", message: "I found the task but could not mark it complete. Please retry." });
              await logParsedAction({ captureId, userId, actionType: "complete_task", actionPayload: { matchStrategy: match.strategy }, targetTaskId: match.task.id, result: "complete_failed", confidence: parsedResult.confidence });
              continue;
            }
            await logTaskEvent(match.task.id, "completed", {
              source: "whatsapp", rawText, confidence: parsedResult.confidence,
            });
          }
          updatedTaskIds.push(match.task.id);
          actionsTaken.push({ type: "task_completed", task: match.task });
          await logParsedAction({ captureId, userId, actionType: "complete_task", actionPayload: { matchStrategy: match.strategy }, targetTaskId: match.task.id, result: "task_completed", confidence: parsedResult.confidence });
        } else if (match.status === "ambiguous") {
          clarificationRequested = true;
          actionsTaken.push({ type: "clarification", question: formatClarification(match.options) });
          await logParsedAction({ captureId, userId, actionType: "complete_task", actionPayload: { target: action.completionTarget, ambiguousOptions: (match.options || []).map((t) => t.id) }, result: "completion_ambiguous", confidence: parsedResult.confidence });
        } else {
          clarificationRequested = true;
          actionsTaken.push({ type: "clarification", question: "I could not find the task you completed. Reply with the task name." });
          await logParsedAction({ captureId, userId, actionType: "complete_task", actionPayload: { target: action.completionTarget }, result: "completion_not_found", confidence: parsedResult.confidence });
        }

      } else if (action.intent === "reschedule_task") {
        const match = resolveTaskMatch({
          targetText: action.completionTarget || rawText,
          openTasks,
          preferredTaskIds,
          lastNudgedTaskId,
        });
        if (match.status === "matched" && match.task) {
          const nextDate = new Date();
          nextDate.setDate(nextDate.getDate() + Math.max(1, Number(action.rescheduleDays || 1)));
          const nextIso = nextDate.toISOString();
          if (match.task.isRecurring) {
            await saveTaskOccurrence({
              parentTaskId: match.task.id,
              date: new Date().toISOString().slice(0, 10),
              status: "pending",
              skipped: true,
              rescheduledTo: nextIso.slice(0, 10),
            });
          } else {
            await updateTaskStep(match.task.id, match.task.goalId, {
              ...match.task, done: false, status: "active",
              dueDate: nextIso, scheduledDate: nextIso,
              rescheduleCount: Number(match.task.rescheduleCount || 0) + 1,
            });
          }
          updatedTaskIds.push(match.task.id);
          await logTaskEvent(match.task.id, "snoozed", {
            source: "whatsapp", rawText, rescheduleDays: action.rescheduleDays || 1,
          });
          actionsTaken.push({ type: "task_rescheduled", task: match.task, newDate: nextIso });
          await logParsedAction({ captureId, userId, actionType: "reschedule_task", actionPayload: { days: action.rescheduleDays }, targetTaskId: match.task.id, result: "task_rescheduled", confidence: parsedResult.confidence });
        } else if (match.status === "ambiguous") {
          clarificationRequested = true;
          actionsTaken.push({ type: "clarification", question: formatClarification(match.options) });
          await logParsedAction({ captureId, userId, actionType: "reschedule_task", actionPayload: { target: action.completionTarget }, result: "reschedule_ambiguous", confidence: parsedResult.confidence });
        } else {
          clarificationRequested = true;
          actionsTaken.push({ type: "clarification", question: "Which task should I reschedule?" });
          await logParsedAction({ captureId, userId, actionType: "reschedule_task", actionPayload: { target: action.completionTarget }, result: "reschedule_not_found", confidence: parsedResult.confidence });
        }

      } else if (action.intent === "archive_task" || action.intent === "cancel_task") {
        const match = resolveTaskMatch({
          targetText: action.completionTarget || rawText,
          openTasks,
          preferredTaskIds,
          lastNudgedTaskId,
        });
        const isCancellation = action.intent === "cancel_task";
        const targetStatus = isCancellation ? "cancelled" : "archived";
        if (match.status === "matched" && match.task) {
          await updateTaskStep(match.task.id, match.task.goalId, {
            ...match.task, done: false, status: targetStatus,
          });
          updatedTaskIds.push(match.task.id);
          await logTaskEvent(match.task.id, targetStatus, { source: "whatsapp", rawText });
          actionsTaken.push({ type: isCancellation ? "task_cancelled" : "task_archived", task: match.task });
          await logParsedAction({ captureId, userId, actionType: action.intent, targetTaskId: match.task.id, result: isCancellation ? "task_cancelled" : "task_archived", confidence: parsedResult.confidence });
        } else {
          clarificationRequested = true;
          const q = isCancellation ? "Which task should I cancel?" : "Which task should I archive?";
          actionsTaken.push({ type: "clarification", question: q });
          await logParsedAction({ captureId, userId, actionType: action.intent, actionPayload: { target: action.completionTarget }, result: isCancellation ? "cancel_needs_target" : "archive_needs_target", confidence: parsedResult.confidence });
        }

      } else {
        // ambiguous or unknown intent
        clarificationRequested = true;
        const question = action.clarificationQuestion || parsedResult.followUpQuestion ||
          "I'm not sure what to do with that. Try:\n• 'Add task: <your task>'\n• 'Done with <task name>'\n• Or just tell me what you need to get done.";
        actionsTaken.push({ type: "clarification", question });
        await logParsedAction({ captureId, userId, actionType: "ambiguous", actionPayload: { question }, result: "clarification_requested", confidence: parsedResult.confidence });
      }
    }

    // Determine processing result from actionsTaken
    if (createdTaskIds.length > 0 && updatedTaskIds.length > 0) {
      result = "multi_action";
    } else if (createdTaskIds.length > 0) {
      result = "task_created";
    } else if (updatedTaskIds.length > 0) {
      result = actionsTaken.some((a) => a.type === "task_completed") ? "task_completed"
        : actionsTaken.some((a) => a.type === "task_rescheduled") ? "task_rescheduled"
        : actionsTaken.some((a) => a.type === "task_cancelled") ? "task_cancelled"
        : actionsTaken.some((a) => a.type === "task_archived") ? "task_archived"
        : "task_updated";
    } else if (actionsTaken.some((a) => a.type === "note_saved" || a.type === "update_noted")) {
      result = actionsTaken.some((a) => a.type === "update_noted") ? "update_noted" : "note_saved";
    } else if (actionsTaken.some((a) => a.type === "goal_created")) {
      result = "goal_created";
    } else if (clarificationRequested) {
      result = "clarification_requested";
    }

    // Rebuild context after mutations for accurate rich response
    const freshCtx = (createdTaskIds.length > 0 || updatedTaskIds.length > 0)
      ? await buildMessageContext(userId, new Date())
      : ctx;

    const reply = buildRichResponse(actionsTaken, freshCtx, calendarEvents);

    if (captureId) {
      await updateMessageCapture(captureId, {
        parsedIntent: actions.length === 1 ? primaryIntent : `multi:${actions.map((a) => a.intent).join("+")}`,
        parseConfidence: parsedResult.confidence,
        parseMethod: parsedResult.parseMethod || "llm",
        parseDurationMs,
        processed: true,
        createdTaskIds,
        updatedTaskIds,
        clarificationRequested,
        processingResult: result,
      });
    }

    await logAgentMessage({
      userId,
      type: clarificationRequested ? "clarification" : "ack",
      body: reply,
      relatedTaskIds: [...createdTaskIds, ...updatedTaskIds],
      metadata: {
        source: "whatsapp-webhook",
        intent: actions.length === 1 ? primaryIntent : `multi:${actions.map((a) => a.intent).join("+")}`,
        actionCount: actions.length,
        result,
      },
    });

    console.log("whatsapp inbound processed", {
      userId,
      from,
      rawText,
      actions: actions.map((a) => a.intent),
      createdTaskIds,
      updatedTaskIds,
      clarificationRequested,
      result,
    });

    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(twimlMessage(reply));
  } catch (error) {
    console.error("whatsapp webhook processing failed", {
      error,
      captureId,
      userId,
    });
    if (captureId) {
      await updateMessageCapture(captureId, {
        parsedIntent: "error",
        parseConfidence: 0,
        processed: true,
        createdTaskIds: [],
        updatedTaskIds: [],
        clarificationRequested: true,
        processingResult: "error",
      });
    }
    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(twimlMessage(formatErrorReply()));
  }
}
