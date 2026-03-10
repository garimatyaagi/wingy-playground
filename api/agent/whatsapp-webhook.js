import {
  createTaskStep,
  fetchRecentContext,
  findOrCreateGoal,
  listOpenTasks,
  logAgentMessage,
  logMessageCapture,
  logTaskEvent,
  resolveInboundUser,
  saveAgentNote,
  saveTaskOccurrence,
  updateMessageCapture,
  updateTaskStep,
} from "./store.js";
import {
  parseMessageIntent,
  recomputeDailyPlan,
  resolveTaskMatch,
} from "./engine.js";
import {
  bodyToForm,
  twimlMessage,
  validateTwilioSignature,
} from "./twilio.js";

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

function buildPreferredTaskIds(recentContext, planState) {
  const ids = [];
  const pushUnique = (value) => {
    if (!value || ids.includes(value)) return;
    ids.push(value);
  };
  const plan = planState?.plan || null;
  if (plan?.next_best_task_id) pushUnique(plan.next_best_task_id);
  (plan?.top_priority_task_ids || []).forEach(pushUnique);
  (recentContext?.recentMessages || []).forEach((message) => {
    (message.related_task_ids || []).forEach(pushUnique);
  });
  return ids;
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
      parsedIntent: "received",
      parseConfidence: 0,
      processed: false,
      createdTaskIds: [],
      updatedTaskIds: [],
      clarificationRequested: false,
      processingResult: "received",
    });

    const intent = parseMessageIntent(rawText, new Date());
    const openTasks = await listOpenTasks(userId);
    const planState = await recomputeDailyPlan({
      userId,
      dailyCapacityMinutes: 180,
    });
    const context = await fetchRecentContext(userId, 10);
    const preferredTaskIds = buildPreferredTaskIds(context, planState);

    const createdTaskIds = [];
    const updatedTaskIds = [];
    let clarificationRequested = false;
    let result = "noop";
    let reply = "Captured.";

    if (intent.intent === "create_task" || intent.intent === "create_recurring_task") {
      for (const draft of intent.tasks || []) {
        const created = await createTaskStep(userId, draft);
        if (!created?.id) continue;
        createdTaskIds.push(created.id);
        await logTaskEvent(created.id, "created", {
          source: "whatsapp",
          rawText,
          parseConfidence: intent.confidence,
          recurring: Boolean(draft.isRecurring),
        });
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
      if (goal?.id) {
        reply = `Captured goal: ${goal.title}.`;
      } else {
        clarificationRequested = true;
        reply = "I could not save that goal yet. Please try a shorter goal title.";
      }
    } else if (intent.intent === "note") {
      await saveAgentNote({
        userId,
        text: intent.noteText || rawText,
        rawText,
      });
      result = "note_saved";
      reply = "Saved as note. It will not clutter your active priorities.";
    } else if (intent.intent === "complete_task") {
      const match = resolveTaskMatch({
        targetText: intent.completionTarget || rawText,
        openTasks,
        preferredTaskIds,
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
      } else if (match.status === "ambiguous") {
        clarificationRequested = true;
        result = "completion_ambiguous";
        reply = formatClarification(match.options);
      } else {
        clarificationRequested = true;
        result = "completion_not_found";
        reply = "I could not find the task you completed. Reply with the task name.";
      }
    } else if (intent.intent === "reschedule_task") {
      const match = resolveTaskMatch({
        targetText: intent.completionTarget || rawText,
        openTasks,
        preferredTaskIds,
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
      } else if (match.status === "ambiguous") {
        clarificationRequested = true;
        result = "reschedule_ambiguous";
        reply = formatClarification(match.options);
      } else {
        clarificationRequested = true;
        result = "reschedule_not_found";
        reply = "Which task should I reschedule?";
      }
    } else if (intent.intent === "archive_task") {
      const match = resolveTaskMatch({
        targetText: intent.completionTarget || rawText,
        openTasks,
        preferredTaskIds,
      });
      if (match.status === "matched" && match.task) {
        await updateTaskStep(match.task.id, match.task.goalId, {
          ...match.task,
          done: false,
          status: "archived",
        });
        updatedTaskIds.push(match.task.id);
        await logTaskEvent(match.task.id, "archived", {
          source: "whatsapp",
          rawText,
        });
        const nextPlan = await recomputeDailyPlan({
          userId,
          dailyCapacityMinutes: 180,
        });
        result = "task_archived";
        reply = `Archived "${match.task.title}".${planNextLine(nextPlan)}`;
      } else {
        clarificationRequested = true;
        result = "archive_needs_target";
        reply = "Which task should I archive?";
      }
    } else {
      clarificationRequested = true;
      result = "clarification_requested";
      reply =
        intent.clarificationQuestion ||
        "I need one detail: what exact action should I create or update?";
    }

    if (captureId) {
      await updateMessageCapture(captureId, {
        parsedIntent: intent.intent,
        parseConfidence: intent.confidence,
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
