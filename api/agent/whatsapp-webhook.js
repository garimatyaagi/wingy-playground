import crypto from "crypto";
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
  acquireMessageLock,
  releaseMessageLock,
  getBotPauseStatus,
  setBotPause,
  getRecentUnprocessedMessages,
  markBatchProcessed,
  updateMessageCaptureBatch,
  getOrCreateSessionId,
  updateMessageCaptureMedia,
  createLongTermGoal,
  createGoalMilestone,
  listActiveLongTermGoals,
  getPendingPulsesForUser,
  markPulseFired,
  getCoreMemory,
  upsertCoreMemory,
  deleteCoreMemory,
  updateLongTermGoal,
  createPulse,
} from "./_store.js";
import {
  buildMessageContext,
  buildEveningCheckin,
  buildMorningBrief,
  buildMorningBriefContext,
  buildRichResponse,
  generateNudge,
  parseEveningResponse,
  parseMessageIntentWithLLM,
  recomputeDailyPlan,
  resolveTaskMatch,
} from "./_engine.js";
import { llmNudge, llmEveningCheckin, llmMorningBrief, llmGoalRefinement, llmExtractGoalContext } from "./_llm.js";
import {
  bodyToForm,
  twimlMessage,
  validateTwilioSignature,
  sendWhatsAppMessage,
} from "./_twilio.js";
import { getUpcomingEvents, getTodayEvents } from "./_calendar.js";
import { llmDecomposeGoal } from "./_llm.js";
import { downloadTwilioMedia, transcribeAudio } from "./_transcription.js";
import { handleOnboardingChat } from "./_onboarding-chat.js";

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

// Fire any pending scheduled nudge pulses for this user.
// Called after processing the user's message so nudges piggyback on user activity.
async function firePendingNudgePulses(userId, whatsAppNumber) {
  if (!userId || !whatsAppNumber) return;
  try {
    const pendingPulses = await getPendingPulsesForUser(userId);
    if (pendingPulses.length === 0) return;

    const profile = await getAgentProfileByUserId(userId);
    if (!profile) return;

    const { getUpcomingEvents } = await import("./_calendar.js");

    for (const pulse of pendingPulses) {
      const context = pulse.context || "";
      const pulseType = pulse.pulse_type || "";

      // Handle scheduled nudge pulses (created by morning scheduler)
      if (context.startsWith("scheduled_nudge:")) {
        const messageType = context.replace("scheduled_nudge:", "");
        try {
          const calendarEvents = profile.google_refresh_token
            ? await getUpcomingEvents(profile.google_refresh_token, profile.timezone || "Asia/Kolkata", 3).catch(() => [])
            : [];
          const planState = await recomputeDailyPlan({ userId, date: new Date(), calendarEvents, profile });

          let body = null;
          if (messageType === "morning_brief") {
            const todayEvents = profile.google_refresh_token
              ? await getTodayEvents(profile.google_refresh_token, profile.timezone || "Asia/Kolkata").catch(() => [])
              : [];
            const briefPlanState = await recomputeDailyPlan({ userId, date: new Date(), calendarEvents: todayEvents, profile });
            if (briefPlanState.goalTasks?.length > 0) {
              briefPlanState.goalTaskContext = briefPlanState.goalTasks.map((gt) =>
                `[${gt.goalTitle || "Goal"}] ${gt.milestoneTitle || gt.text || ""}`
              );
            }
            const briefContext = await buildMorningBriefContext({
              userId, date: new Date(), planState: briefPlanState, calendarEvents: todayEvents, profile,
            }).catch(() => null);
            body = await llmMorningBrief(briefPlanState, todayEvents, profile, briefContext).catch(() => null);
            if (!body) body = buildMorningBrief({ planState: briefPlanState, tone: profile.tone || "firm" });
          } else if (messageType === "midday_nudge" || messageType === "afternoon_followup") {
            body = await llmNudge(planState, messageType, profile, calendarEvents).catch(() => null);
            if (!body) {
              const nudge = await generateNudge({ userId, tone: profile.tone || "firm", now: new Date() });
              body = nudge.body;
            }
          } else if (messageType === "evening_checkin") {
            const completedToday = (planState.scoredTasks || []).filter(
              (t) => t.done && t.completedAt && t.completedAt.startsWith(new Date().toISOString().slice(0, 10))
            );
            body = await llmEveningCheckin(planState, completedToday, profile, calendarEvents).catch(() => null);
            if (!body) body = buildEveningCheckin({ planState });
          }

          if (body) {
            await sendWhatsAppMessage({ to: whatsAppNumber, text: body });
            await logAgentMessage({
              userId,
              type: messageType,
              body,
              relatedTaskIds: planState.topPriorities.map((t) => t.id).slice(0, 5),
              metadata: { reason: `pulse_fired:${messageType}`, pulseId: pulse.id },
            });
          }
        } catch (err) {
          console.error("firePendingNudgePulses generate failed", { userId, messageType, error: err.message });
        }
      }

      await markPulseFired(pulse.id);
    }
  } catch (err) {
    console.error("firePendingNudgePulses failed", { userId, error: err.message });
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
    // Clean up any stale message locks on every request
    try {
      const { getSupabaseAdmin } = await import("./_store.js");
      const sb = getSupabaseAdmin();
      if (sb) await sb.from("agent_message_locks").delete().lt("locked_at", new Date(Date.now() - 30000).toISOString());
    } catch (_) {}

    const form = bodyToForm(req);
    const signature = validateTwilioSignature(req, form);
    if (!signature.valid) {
      return res.status(403).json({ error: "Invalid Twilio signature" });
    }

    let rawText = String(form.Body || form.body || "").trim();
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

    // ─── Onboarding Conversation Intercept ───
    if (rawText.trim()) {
      try {
        const onboardProfile = await getAgentProfileByUserId(userId);
        if (onboardProfile && !onboardProfile.onboardingCompleted && onboardProfile.onboardingStep > 0) {
          return handleOnboardingChat(userId, rawText, onboardProfile, res);
        }
      } catch (err) {
        console.error("onboarding intercept check failed (continuing)", err.message);
      }
    }

    // ─── Goal Refinement Conversation Intercept ───
    if (rawText.trim()) {
      try {
        const memories = await getCoreMemory(userId);
        const draftingGoalMemory = memories.find((m) => m.key === "drafting_goal_id");
        if (draftingGoalMemory) {
          const goalId = draftingGoalMemory.value;
          // Extract context from user's answers
          const draftingTitleMemory = memories.find((m) => m.key === "drafting_goal_title");
          const goalTitle = draftingTitleMemory?.value || "their goal";
          const goalContext = await llmExtractGoalContext(goalTitle, rawText);

          // Update goal with enriched description and activate it
          const enrichedDesc = goalContext?.enrichedDescription || rawText;
          await updateLongTermGoal(goalId, {
            description: enrichedDesc,
            status: "active",
          });

          // Store useful context in core memory for future use
          if (goalContext?.preferredTime) {
            await upsertCoreMemory(userId, `goal_${goalTitle.replace(/\s+/g, "_").toLowerCase().slice(0, 30)}_time`, goalContext.preferredTime);
          }
          if (goalContext?.currentBaseline) {
            await upsertCoreMemory(userId, `goal_${goalTitle.replace(/\s+/g, "_").toLowerCase().slice(0, 30)}_baseline`, goalContext.currentBaseline);
          }

          // Clean up drafting state
          await deleteCoreMemory(userId, "drafting_goal_id");
          await deleteCoreMemory(userId, "drafting_goal_title");

          // Now decompose with the enriched context
          const decomposition = await llmDecomposeGoal(goalTitle, enrichedDesc, null, userId);

          let milestonesSaved = [];
          if (decomposition?.milestones) {
            for (let i = 0; i < decomposition.milestones.length; i++) {
              const m = decomposition.milestones[i];
              const saved = await createGoalMilestone(goalId, userId, {
                title: m.title,
                description: m.description || "",
                orderIndex: i,
                targetDate: m.targetWeek
                  ? new Date(Date.now() + m.targetWeek * 7 * 86400000).toISOString().split("T")[0]
                  : null,
                tasks: m.tasks || [],
              });
              if (saved) milestonesSaved.push(saved);
            }
          }

          // Build response
          let reply = `Got it! I've refined your goal "${goalTitle}" with your input.\n`;
          if (milestonesSaved.length > 0) {
            reply += `\nBroken down into ${milestonesSaved.length} milestones:\n`;
            for (const m of milestonesSaved.slice(0, 6)) {
              reply += `  ${m.order_index + 1}. ${m.title}\n`;
            }
          }
          if (decomposition?.dailyHabitSuggestion) {
            reply += `\nDaily habit: ${decomposition.dailyHabitSuggestion}`;
          }
          reply += `\n\nI'll start weaving daily tasks from this goal into your morning plan.`;

          await sendWhatsAppMessage({ to: from, text: reply });
          await logAgentMessage(userId, "goal_refinement_complete", reply, [], { goalId });
          res.setHeader("Content-Type", "text/xml");
          return res.status(200).send(twimlMessage(""));
        }
      } catch (err) {
        console.error("goal refinement intercept failed (continuing)", err.message);
      }
    }

    // ─── Voice Message Transcription ───
    const numMedia = parseInt(form.NumMedia || form.numMedia || "0", 10);
    const mediaType = String(form.MediaContentType0 || form.mediaContentType0 || "").trim();
    const mediaUrl = String(form.MediaUrl0 || form.mediaUrl0 || "").trim();
    let transcription = null;
    const isVoiceMessage = numMedia > 0 && mediaType.startsWith("audio/") && mediaUrl;
    if (isVoiceMessage) {
      console.log("voice message detected", { userId, mediaType, mediaUrl: mediaUrl.slice(0, 80), numMedia });
      try {
        const audioBuffer = await downloadTwilioMedia(mediaUrl);
        if (audioBuffer) {
          transcription = await transcribeAudio(audioBuffer, mediaType);
          if (transcription) {
            rawText = transcription;
          } else {
            console.error("voice transcription returned null", { userId, mediaType, bufferSize: audioBuffer.length });
          }
        } else {
          console.error("downloadTwilioMedia returned null", { userId, mediaUrl: mediaUrl.slice(0, 80) });
        }
      } catch (err) {
        console.error("voice transcription failed", { userId, error: err.message, stack: err.stack?.slice(0, 300) });
      }
      // If transcription failed, tell the user
      if (!rawText && !transcription) {
        res.setHeader("Content-Type", "text/xml");
        return res.status(200).send(twimlMessage("I couldn't process that voice note. Please try again or send a text message."));
      }
    }

    // ─── Bot Pause Check (non-blocking) ───
    const isResumeCommand = /^(resume|start)\s*(bot)?\s*$/i.test(rawText.trim());
    if (!isResumeCommand) {
      try {
        const pausedUntil = await getBotPauseStatus(userId);
        if (pausedUntil) {
          await logMessageCapture({
            userId, rawText, messageSid, fromNumber: from,
            normalizedText: rawText.toLowerCase().trim(),
            parsedIntent: "bot_paused", parseConfidence: 1, processed: true,
            createdTaskIds: [], updatedTaskIds: [],
            clarificationRequested: false, processingResult: "bot_paused",
          });
          res.setHeader("Content-Type", "text/xml");
          return res.status(200).send(twimlMessage(""));
        }
      } catch (e) {
        console.error("bot pause check failed (continuing)", e.message);
      }
    }

    // ─── Per-User Message Lock (disabled — caused stale locks blocking all messages) ───
    const lockAcquired = false;

    // ─── Session Tracking (non-blocking) ───
    const profile = inbound.profile || await getAgentProfileByUserId(userId);
    let sessionId = null;
    try {
      const sessionTimeoutMinutes = profile?.session_timeout_minutes || 30;
      sessionId = await getOrCreateSessionId(userId, sessionTimeoutMinutes);
    } catch (e) {
      console.error("session tracking failed (continuing)", e.message);
    }

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

    // Store session, media info (non-blocking)
    try {
      if (captureId && sessionId) {
        await updateMessageCaptureBatch(captureId, null, sessionId);
      }
      if (captureId && transcription) {
        await updateMessageCaptureMedia(captureId, { mediaUrl, transcription, mediaType });
      }
    } catch (e) {
      console.error("capture metadata update failed (continuing)", e.message);
    }

    // ─── Message Debounce (disabled for now — sleep was consuming timeout budget) ───
    const batchId = null;

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

    // ─── Bot Pause / Resume Commands ───
    const pauseMatch = rawText.match(/^pause\s*(bot)?\s*(?:for\s+(\d+)\s*(hour|hr|hours|min|mins|minutes))?\s*$/i);
    if (pauseMatch) {
      let durationMs = 60 * 60 * 1000; // default 1 hour
      if (pauseMatch[2]) {
        const amount = parseInt(pauseMatch[2], 10);
        const unit = (pauseMatch[3] || "").toLowerCase();
        durationMs = unit.startsWith("min") ? amount * 60 * 1000 : amount * 60 * 60 * 1000;
      }
      const pauseUntil = new Date(Date.now() + durationMs);
      await setBotPause(userId, pauseUntil);
      const resumeTime = pauseUntil.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: profile?.timezone || "Asia/Kolkata" });
      const reply = `Bot paused until ${resumeTime}. Send "resume bot" to reactivate.`;
      await updateMessageCapture(captureId, { parsedIntent: "pause_bot", parseConfidence: 1, parseMethod: "keyword", processed: true, processingResult: "bot_paused" });
      await logAgentMessage({ userId, type: "ack", body: reply, relatedTaskIds: [], metadata: { intent: "pause_bot" } });
      if (lockAcquired) await releaseMessageLock(userId).catch(() => {});
      if (batchId) await markBatchProcessed(batchId).catch(() => {});
      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(twimlMessage(reply));
    }
    if (isResumeCommand) {
      await setBotPause(userId, null);
      const reply = "Bot resumed. I'm back and listening.";
      await updateMessageCapture(captureId, { parsedIntent: "resume_bot", parseConfidence: 1, parseMethod: "keyword", processed: true, processingResult: "bot_resumed" });
      await logAgentMessage({ userId, type: "ack", body: reply, relatedTaskIds: [], metadata: { intent: "resume_bot" } });
      if (lockAcquired) await releaseMessageLock(userId).catch(() => {});
      if (batchId) await markBatchProcessed(batchId).catch(() => {});
      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(twimlMessage(reply));
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
        await logTaskEvent(match.task.id, "completed", { source: "whatsapp", rawText }, userId);
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
                userId,
              });
            } else {
              await updateTaskStep(task.id, task.goalId, {
                ...task, done: true, status: "done", completedAt: nowIso, completionConfidence: 0.9,
              });
            }
            await logTaskEvent(task.id, "completed", { source: "whatsapp", rawText, via: "evening_checkin" }, userId);
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
            await logTaskEvent(task.id, "snoozed", { source: "whatsapp", via: "evening_checkin", reason: "skipped" }, userId);
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
          }, userId);
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

      } else if (action.intent === "create_long_term_goal") {
        // Check active goal count (cap at 5, excluding drafting)
        const existingGoals = await listActiveLongTermGoals(userId);
        if (existingGoals.length >= 5) {
          actionsTaken.push({
            type: "long_term_goal_limit",
            message: `You have ${existingGoals.length} active long-term goals. Consider pausing or archiving one before adding another. Active goals: ${existingGoals.map((g) => g.title).join(", ")}`,
          });
        } else {
          const goalTitle = action.longTermGoalTitle || action.taskTitle || rawText;
          const goalData = await createLongTermGoal(userId, {
            title: goalTitle,
            description: action.longTermGoalDescription || "",
            scope: action.longTermGoalScope || "yearly",
            targetDate: action.longTermGoalTargetDate || null,
            priority: existingGoals.filter((g) => g.priority === 1).length >= 2 ? 2 : (existingGoals.length === 0 ? 1 : 2),
          });

          if (goalData?.id) {
            await logParsedAction({ captureId, userId, actionType: "create_long_term_goal", actionPayload: { title: goalData.title, scope: goalData.scope }, targetTaskId: goalData.id, result: "long_term_goal_created", confidence: parsedResult.confidence });

            // Start goal refinement conversation instead of immediate decomposition
            // Store drafting state in core memory
            await upsertCoreMemory(userId, "drafting_goal_id", goalData.id);
            await upsertCoreMemory(userId, "drafting_goal_title", goalTitle);

            // Set goal to drafting status
            await updateLongTermGoal(goalData.id, { status: "drafting" });

            // Generate clarifying questions
            let memoryContext = "";
            try {
              const memories = await getCoreMemory(userId);
              const relevant = memories.filter((m) => !/^drafting_goal/.test(m.key));
              if (relevant.length > 0) {
                memoryContext = relevant.map((m) => `- ${m.key}: ${m.value}`).join("\n");
              }
            } catch { /* ignore */ }

            const questions = await llmGoalRefinement(goalTitle, memoryContext);

            if (questions) {
              // Schedule a timeout pulse: if user doesn't reply in 30 min, auto-decompose
              const fireAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
              await createPulse(userId, fireAt, JSON.stringify({ type: "goal_refinement_timeout", goalId: goalData.id, goalTitle }), "goal_refinement_timeout");

              const reply = `Great goal! Before I break this down, a few quick questions:\n\n${questions}\n\nJust reply with your answers and I'll build a personalized plan.`;
              await sendWhatsAppMessage({ to: from, text: reply });
              await logAgentMessage(userId, "goal_refinement_ask", reply, [], { goalId: goalData.id });
              // Don't add to actionsTaken — we already sent the reply directly
              res.setHeader("Content-Type", "text/xml");
              return res.status(200).send(twimlMessage(""));
            }

            // Fallback: if LLM refinement fails, decompose immediately (old behavior)
            await deleteCoreMemory(userId, "drafting_goal_id");
            await deleteCoreMemory(userId, "drafting_goal_title");
            await updateLongTermGoal(goalData.id, { status: "active" });

            const decomposition = await llmDecomposeGoal(
              goalData.title,
              goalData.description,
              goalData.target_date,
              userId
            );

            let milestonesSaved = [];
            if (decomposition?.milestones) {
              for (let i = 0; i < decomposition.milestones.length; i++) {
                const m = decomposition.milestones[i];
                const saved = await createGoalMilestone(goalData.id, userId, {
                  title: m.title,
                  description: m.description || "",
                  orderIndex: i,
                  targetDate: m.targetWeek
                    ? new Date(Date.now() + m.targetWeek * 7 * 86400000).toISOString().split("T")[0]
                    : null,
                  tasks: m.tasks || [],
                });
                if (saved) milestonesSaved.push(saved);
              }
            }

            actionsTaken.push({
              type: "long_term_goal_created",
              goal: goalData,
              milestones: milestonesSaved,
              decomposition,
            });
          } else {
            actionsTaken.push({ type: "error", message: "Could not save that long-term goal. Please try again." });
          }
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
              userId,
            });
            await logTaskEvent(match.task.id, "completed", {
              source: "whatsapp", kind: "recurring_occurrence", rawText, confidence: parsedResult.confidence,
            }, userId);
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
            }, userId);
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
              userId,
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
          }, userId);
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
          await logTaskEvent(match.task.id, targetStatus, { source: "whatsapp", rawText }, userId);
          actionsTaken.push({ type: isCancellation ? "task_cancelled" : "task_archived", task: match.task });
          await logParsedAction({ captureId, userId, actionType: action.intent, targetTaskId: match.task.id, result: isCancellation ? "task_cancelled" : "task_archived", confidence: parsedResult.confidence });
        } else {
          clarificationRequested = true;
          const q = isCancellation ? "Which task should I cancel?" : "Which task should I archive?";
          actionsTaken.push({ type: "clarification", question: q });
          await logParsedAction({ captureId, userId, actionType: action.intent, actionPayload: { target: action.completionTarget }, result: isCancellation ? "cancel_needs_target" : "archive_needs_target", confidence: parsedResult.confidence });
        }

      } else if (action.intent === "pause_bot") {
        const durationMs = (action.pauseDurationMinutes || 60) * 60 * 1000;
        const pauseUntil = new Date(Date.now() + durationMs);
        await setBotPause(userId, pauseUntil);
        const resumeTime = pauseUntil.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: profile?.timezone || "Asia/Kolkata" });
        actionsTaken.push({ type: "bot_paused", resumeTime });
        await logParsedAction({ captureId, userId, actionType: "pause_bot", result: "bot_paused", confidence: parsedResult.confidence });

      } else if (action.intent === "resume_bot") {
        await setBotPause(userId, null);
        actionsTaken.push({ type: "bot_resumed" });
        await logParsedAction({ captureId, userId, actionType: "resume_bot", result: "bot_resumed", confidence: parsedResult.confidence });

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
      rawText: rawText.slice(0, 100),
      actions: actions.map((a) => a.intent),
      createdTaskIds,
      updatedTaskIds,
      clarificationRequested,
      result,
    });

    // Fire any pending scheduled nudges (midday/afternoon/evening) for this user.
    // These are created by the morning cron since Vercel Hobby only runs cron once/day.
    try {
      await firePendingNudgePulses(userId, profile?.whatsAppNumber || inbound?.profile?.whatsAppNumber);
    } catch (err) {
      console.error("pulse firing failed", { userId, error: err.message });
    }

    if (lockAcquired) await releaseMessageLock(userId).catch(() => {});
    if (batchId) await markBatchProcessed(batchId).catch(() => {});
    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(twimlMessage(reply));
  } catch (error) {
    console.error("whatsapp webhook processing failed", {
      error: error.message,
      stack: error.stack?.slice(0, 500),
      captureId,
      userId,
    });
    // Always release lock on error
    if (userId) await releaseMessageLock(userId).catch(() => {});
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
