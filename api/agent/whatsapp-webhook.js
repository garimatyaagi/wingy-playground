import {
  createTaskStep,
  findCaptureByMessageSid,
  findOrCreateGoal,
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
  parseMessageIntent,
  parseMessageIntentWithLLM,
  recomputeDailyPlan,
  resolveTaskMatch,
} from "./_engine.js";
import {
  bodyToForm,
  twimlMessage,
  validateTwilioSignature,
} from "./_twilio.js";

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

function planNextLine(planState) {
  const next = planState?.nextBest;
  if (!next) return "";
  return ` Next priority: ${next.title}.`;
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

    const parseStart = Date.now();
    const intent = await parseMessageIntentWithLLM(rawText, userId, new Date());
    const parseDurationMs = Date.now() - parseStart;
    const ctx = await buildMessageContext(userId, new Date());
    const openTasks = ctx.openTasks;
    const preferredTaskIds = ctx.preferredTaskIds;
    const lastNudgedTaskId = ctx.lastNudgedTaskId;

    const createdTaskIds = [];
    const updatedTaskIds = [];
    let clarificationRequested = false;
    let result = "noop";
    let reply = "Captured.";

    if (intent.intent === "create_task" || intent.intent === "create_recurring_task") {
      for (const draft of intent.tasks || []) {
        const created = await createTaskStep(userId, draft);
        if (!created?.id) {
          await logParsedAction({ captureId, userId, actionType: "create_task", actionPayload: draft, result: "failed", errorDetail: "createTaskStep returned null", confidence: intent.confidence });
          continue;
        }
        createdTaskIds.push(created.id);
        await logTaskEvent(created.id, "created", {
          source: "whatsapp",
          rawText,
          parseConfidence: intent.confidence,
          recurring: Boolean(draft.isRecurring),
        });
        await logParsedAction({ captureId, userId, actionType: "create_task", actionPayload: { title: draft.title }, targetTaskId: created.id, result: "created", confidence: intent.confidence });
      }
      if (createdTaskIds.length === 0) {
        clarificationRequested = true;
        result = "create_failed";
        reply = "I understood this as a task, but could not save it. Please resend with a shorter action line.";
      } else {
        const nextPlan = await recomputeDailyPlan({
          userId,
          dailyCapacityMinutes: 180,
        });
        result = "task_created";
        reply = `Added ${createdTaskIds.length} task${createdTaskIds.length === 1 ? "" : "s"}.${planNextLine(nextPlan)}`;
      }
    } else if (intent.intent === "goal") {
      const goal = await findOrCreateGoal(userId, intent.goalTitle || "General");
      result = goal?.id ? "goal_created" : "goal_failed";
      await logParsedAction({ captureId, userId, actionType: "create_goal", actionPayload: { goalTitle: intent.goalTitle }, targetTaskId: goal?.id, result, confidence: intent.confidence });
      if (goal?.id) {
        reply = `Captured goal: ${goal.title}.`;
      } else {
        clarificationRequested = true;
        reply = "I could not save that goal yet. Please try a shorter goal title.";
      }
    } else if (intent.intent === "note" || intent.intent === "informational_update") {
      await saveAgentNote({
        userId,
        text: intent.noteText || rawText,
        rawText,
      });
      result = intent.intent === "informational_update" ? "update_noted" : "note_saved";
      reply = intent.intent === "informational_update"
        ? "Noted."
        : "Saved as note. It will not clutter your active priorities.";
      await logParsedAction({ captureId, userId, actionType: intent.intent, actionPayload: { text: (intent.noteText || rawText).slice(0, 200) }, result, confidence: intent.confidence });
    } else if (intent.intent === "complete_task") {
      const match = resolveTaskMatch({
        targetText: intent.completionTarget || rawText,
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
            source: "whatsapp",
            kind: "recurring_occurrence",
            rawText,
            confidence: intent.confidence,
          });
        } else {
          const update = await updateTaskStep(match.task.id, match.task.goalId, {
            ...match.task,
            done: true,
            status: "done",
            completedAt: nowIso,
            completionConfidence: intent.confidence,
          });
          if (!update.ok) {
            clarificationRequested = true;
            result = "complete_failed";
            reply = "I found the task but could not mark it complete. Please retry.";
          } else {
            await logTaskEvent(match.task.id, "completed", {
              source: "whatsapp",
              rawText,
              confidence: intent.confidence,
            });
          }
        }
        updatedTaskIds.push(match.task.id);
        if (!clarificationRequested) {
          const nextPlan = await recomputeDailyPlan({
            userId,
            dailyCapacityMinutes: 180,
          });
          result = "task_completed";
          reply = `Marked "${match.task.title}" as done.${planNextLine(nextPlan)}`;
        }
        await logParsedAction({ captureId, userId, actionType: "complete_task", actionPayload: { matchStrategy: match.strategy }, targetTaskId: match.task.id, result, confidence: intent.confidence });
      } else if (match.status === "ambiguous") {
        clarificationRequested = true;
        result = "completion_ambiguous";
        reply = formatClarification(match.options);
        await logParsedAction({ captureId, userId, actionType: "complete_task", actionPayload: { target: intent.completionTarget, ambiguousOptions: (match.options || []).map((t) => t.id) }, result, confidence: intent.confidence });
      } else {
        clarificationRequested = true;
        result = "completion_not_found";
        reply = "I could not find the task you completed. Reply with the task name.";
        await logParsedAction({ captureId, userId, actionType: "complete_task", actionPayload: { target: intent.completionTarget }, result, confidence: intent.confidence });
      }
    } else if (intent.intent === "reschedule_task") {
      const match = resolveTaskMatch({
        targetText: intent.completionTarget || rawText,
        openTasks,
        preferredTaskIds,
        lastNudgedTaskId,
      });
      if (match.status === "matched" && match.task) {
        const nextDate = new Date();
        nextDate.setDate(nextDate.getDate() + Math.max(1, Number(intent.rescheduleDays || 1)));
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
            ...match.task,
            done: false,
            status: "active",
            dueDate: nextIso,
            scheduledDate: nextIso,
            rescheduleCount: Number(match.task.rescheduleCount || 0) + 1,
          });
        }
        updatedTaskIds.push(match.task.id);
        await logTaskEvent(match.task.id, "snoozed", {
          source: "whatsapp",
          rawText,
          rescheduleDays: intent.rescheduleDays || 1,
        });
        const nextPlan = await recomputeDailyPlan({
          userId,
          dailyCapacityMinutes: 180,
        });
        result = "task_rescheduled";
        reply = `Rescheduled "${match.task.title}" to ${nextIso.slice(0, 10)}.${planNextLine(nextPlan)}`;
        await logParsedAction({ captureId, userId, actionType: "reschedule_task", actionPayload: { days: intent.rescheduleDays }, targetTaskId: match.task.id, result, confidence: intent.confidence });
      } else if (match.status === "ambiguous") {
        clarificationRequested = true;
        result = "reschedule_ambiguous";
        reply = formatClarification(match.options);
        await logParsedAction({ captureId, userId, actionType: "reschedule_task", actionPayload: { target: intent.completionTarget }, result, confidence: intent.confidence });
      } else {
        clarificationRequested = true;
        result = "reschedule_not_found";
        reply = "Which task should I reschedule?";
        await logParsedAction({ captureId, userId, actionType: "reschedule_task", actionPayload: { target: intent.completionTarget }, result, confidence: intent.confidence });
      }
    } else if (intent.intent === "archive_task" || intent.intent === "cancel_task") {
      const match = resolveTaskMatch({
        targetText: intent.completionTarget || rawText,
        openTasks,
        preferredTaskIds,
        lastNudgedTaskId,
      });
      const isCancellation = intent.intent === "cancel_task";
      const targetStatus = isCancellation ? "cancelled" : "archived";
      if (match.status === "matched" && match.task) {
        await updateTaskStep(match.task.id, match.task.goalId, {
          ...match.task,
          done: false,
          status: targetStatus,
        });
        updatedTaskIds.push(match.task.id);
        await logTaskEvent(match.task.id, targetStatus, {
          source: "whatsapp",
          rawText,
        });
        const nextPlan = await recomputeDailyPlan({
          userId,
          dailyCapacityMinutes: 180,
        });
        result = isCancellation ? "task_cancelled" : "task_archived";
        reply = isCancellation
          ? `Cancelled "${match.task.title}".${planNextLine(nextPlan)}`
          : `Archived "${match.task.title}".${planNextLine(nextPlan)}`;
        await logParsedAction({ captureId, userId, actionType: intent.intent, targetTaskId: match.task.id, result, confidence: intent.confidence });
      } else {
        clarificationRequested = true;
        result = isCancellation ? "cancel_needs_target" : "archive_needs_target";
        reply = isCancellation ? "Which task should I cancel?" : "Which task should I archive?";
        await logParsedAction({ captureId, userId, actionType: intent.intent, actionPayload: { target: intent.completionTarget }, result, confidence: intent.confidence });
      }
    } else {
      clarificationRequested = true;
      result = "clarification_requested";
      reply =
        intent.clarificationQuestion ||
        "I need one detail: what exact action should I create or update?";
      await logParsedAction({ captureId, userId, actionType: "ambiguous", actionPayload: { question: reply }, result, confidence: intent.confidence });
    }

    if (captureId) {
      await updateMessageCapture(captureId, {
        parsedIntent: intent.intent,
        parseConfidence: intent.confidence,
        parseMethod: intent.parseMethod || "llm",
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
        intent: intent.intent,
        result,
      },
    });

    console.log("whatsapp inbound processed", {
      userId,
      from,
      rawText,
      intent: intent.intent,
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
