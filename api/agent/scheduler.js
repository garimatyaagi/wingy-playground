import crypto from "crypto";
import {
  listActiveProfiles,
  listAgentMessagesForDate,
  logAgentMessage,
  fetchOverdueTasks,
  getPendingPulses,
  markPulseFired,
  createPulse,
  getAgentProfileByUserId,
  getBotPauseStatus,
  listActiveLongTermGoals,
  listMilestonesForGoal,
  countGoalTaskCompletions,
  getCoreMemory,
  deleteCoreMemory,
  updateLongTermGoal,
  createGoalMilestone,
} from "./_store.js";
import {
  buildEveningCheckin,
  buildMorningBrief,
  detectBehaviorPatterns,
  generateNudge,
  recomputeDailyPlan,
  computeDailyScorecard,
  analyzeDay,
  buildMorningBriefContext,
} from "./_engine.js";
import { sendWhatsAppMessage } from "./_twilio.js";
import { llmMorningBrief, llmEveningCheckin, llmNudge, llmFollowUp, llmPulseMessage, llmWeeklyGoalReview, llmDecomposeGoal } from "./_llm.js";
import { getTodayEvents, getUpcomingEvents } from "./_calendar.js";
import { authenticateRequest } from "./_auth.js";
import { computeEscalationLevel } from "./_proactive.js";

function parseTimeToMinutes(value, fallback) {
  const source = String(value || fallback || "00:00");
  const match = source.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 0;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return Math.max(0, Math.min(23, hours)) * 60 + Math.max(0, Math.min(59, minutes));
}

function localTimeParts(date, timezone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || "";
  const year = pick("year");
  const month = pick("month");
  const day = pick("day");
  const hour = Number(pick("hour") || 0);
  const minute = Number(pick("minute") || 0);
  const weekday = String(pick("weekday") || "").toLowerCase();
  return {
    dateKey: `${year}-${month}-${day}`,
    minuteOfDay: hour * 60 + minute,
    weekday,
  };
}

function withinWindow(minuteOfDay, targetMinutes, windowMinutes = 15) {
  return minuteOfDay >= targetMinutes && minuteOfDay < targetMinutes + windowMinutes;
}

function shouldSend(profile, type, local, sentTypes) {
  if (!profile.whatsAppNumber) return false;
  if (sentTypes.has(type)) return false;
  if (!profile.weekendsEnabled && (local.weekday === "sat" || local.weekday === "sun")) return false;

  const targetMinutes = parseTimeToMinutes(
    { morning_brief: profile.morningBriefTime,
      midday_nudge: profile.middayNudgeTime,
      afternoon_followup: profile.afternoonFollowupTime,
      evening_checkin: profile.eveningCheckinTime,
    }[type],
    { morning_brief: "08:00", midday_nudge: "12:30", afternoon_followup: "16:00", evening_checkin: "20:30" }[type]
  );

  // Simple: if the scheduled time has passed and it hasn't been sent today, send it.
  // sentTypes (line 77) prevents duplicates. No windows, no snapping, no missed sends.
  return local.minuteOfDay >= targetMinutes;
}

// Convert a local time string (e.g. "12:30") in the user's timezone to a UTC Date for today.
// Uses the timezone offset derived from formatting the current date.
function localTimeToUtcToday(timeStr, timezone, now = new Date()) {
  const [hours, minutes] = String(timeStr || "00:00").split(":").map(Number);
  // Get current local date parts in user's timezone
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const pick = (type) => parts.find((p) => p.type === type)?.value || "";
  const localDateStr = `${pick("year")}-${pick("month")}-${pick("day")}`;
  // Create a date at the target local time by computing the offset
  const utcNow = now.getTime();
  const localNowStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).format(now);
  // Parse "YYYY-MM-DD, HH:MM:SS"
  const [datePart, timePart] = localNowStr.split(", ");
  const localNowMs = new Date(`${datePart}T${timePart}Z`).getTime();
  const offsetMs = utcNow - localNowMs;
  // Target local time as if UTC, then apply offset
  const targetLocalMs = new Date(`${localDateStr}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00Z`).getTime();
  return new Date(targetLocalMs + offsetMs);
}

// Schedule pulses for ALL nudge types that haven't been sent yet during this cron run.
// On Vercel Hobby, cron fires once/day (often before morning brief window), so we
// schedule everything — including morning_brief — as pulses for webhook delivery.
async function scheduleAllRemainingNudges(profile, sentTypes, now) {
  const timezone = profile.timezone || "Asia/Kolkata";
  // Check weekends — don't schedule pulses if weekends are disabled
  if (!profile.weekendsEnabled) {
    const local = localTimeParts(now, timezone);
    if (local.weekday === "sat" || local.weekday === "sun") return [];
  }
  const nudgeTypes = [
    { type: "morning_brief", time: profile.morningBriefTime || "08:00" },
    { type: "midday_nudge", time: profile.middayNudgeTime || "12:30" },
    { type: "afternoon_followup", time: profile.afternoonFollowupTime || "16:00" },
    { type: "evening_checkin", time: profile.eveningCheckinTime || "20:30" },
  ];
  const scheduled = [];
  for (const nudge of nudgeTypes) {
    if (sentTypes.has(nudge.type)) continue;
    const fireAt = localTimeToUtcToday(nudge.time, timezone, now);
    // Only schedule if fire_at is in the future
    if (fireAt.getTime() <= now.getTime()) continue;
    try {
      await createPulse(profile.userId, fireAt.toISOString(), `scheduled_nudge:${nudge.type}`, nudge.type);
      scheduled.push({ type: nudge.type, fireAt: fireAt.toISOString() });
    } catch (err) {
      console.error("scheduleAllRemainingNudges failed", { userId: profile.userId, type: nudge.type, error: err.message });
    }
  }
  return scheduled;
}

async function sendAndLog({ userId, to, type, body, relatedTaskIds = [], metadata = {} }) {
  const sent = await sendWhatsAppMessage({ to, text: body });
  // Only log if Twilio confirmed delivery — prevents phantom "sent" records
  // from partial executions (504 timeouts) blocking future sends all day.
  if (sent?.ok !== false) {
    await logAgentMessage({
      userId,
      type,
      body,
      relatedTaskIds,
      metadata: {
        ...metadata,
        scheduler: true,
        sent,
      },
    });
  } else {
    console.error("sendAndLog_skipped_logging", { userId, type, reason: "twilio_send_failed", sent });
  }
  return sent;
}

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Auth: Accept CRON_SECRET Bearer token (Vercel cron) or Clerk JWT (manual trigger)
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  const authHeader = String(req.headers.authorization || "").trim();
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  const queryToken = String(req.query?.token || "").trim();
  const tokenCandidate = bearerToken || queryToken;

  let isCronAuth = false;
  if (cronSecret && tokenCandidate && tokenCandidate.length === cronSecret.length) {
    isCronAuth = crypto.timingSafeEqual(Buffer.from(tokenCandidate), Buffer.from(cronSecret));
  }

  // Vercel cron requests include this header — allow if CRON_SECRET is not configured
  // so the scheduler doesn't silently break when env vars are missing.
  const isVercelCron = req.headers["x-vercel-cron"] === "1";
  if (!isCronAuth && isVercelCron && !cronSecret) {
    console.warn("scheduler_auth_warning: CRON_SECRET env var is not set — allowing Vercel cron request without token verification. Set CRON_SECRET in Vercel env vars for security.");
    isCronAuth = true;
  }

  let isUserAuth = false;
  if (!isCronAuth) {
    const clerkUserId = await authenticateRequest(req);
    isUserAuth = Boolean(clerkUserId);
  }

  if (!isCronAuth && !isUserAuth) {
    console.error("scheduler_auth_failed", {
      hasCronSecret: Boolean(cronSecret),
      cronSecretLen: cronSecret.length,
      hasBearer: Boolean(bearerToken),
      bearerLen: bearerToken.length,
      hasQueryToken: Boolean(queryToken),
      queryTokenLen: queryToken.length,
      candidateLen: tokenCandidate.length,
      lengthMatch: cronSecret ? tokenCandidate.length === cronSecret.length : "no_secret",
      isVercelCron,
      method: req.method,
      host: req.headers.host || "",
    });
    return res.status(401).json({ error: "Unauthorized" });
  }

  const now = new Date();
  // Global deadline: stop processing 10s before Vercel kills the function.
  // This ensures we always return a response with partial results instead of a 504.
  const MAX_DURATION_MS = 170_000; // 170s (maxDuration is 180s)
  const deadline = now.getTime() + MAX_DURATION_MS;
  const forceType = String(req.query?.force || req.body?.force || "").trim();
  const profiles = await listActiveProfiles();
  const report = [];

  for (const profile of profiles) {
   if (Date.now() >= deadline) {
    report.push({ skipped: true, reason: "deadline_reached", remaining: profiles.length - report.length });
    break;
   }
   try {
    if (!profile.autoplanEnabled) continue;
    // Skip users whose bot is paused
    const pausedUntil = await getBotPauseStatus(profile.userId);
    if (pausedUntil) continue;
    const local = localTimeParts(now, profile.timezone || "Asia/Kolkata");
    const sentToday = await listAgentMessagesForDate(profile.userId, local.dateKey);
    // Only count messages that were actually delivered by Twilio.
    // Previous runs may have timed out (504) after logging but before Twilio confirmed.
    const sentTypes = new Set(
      (sentToday || [])
        .filter((entry) => {
          const meta = typeof entry.metadata === "string" ? JSON.parse(entry.metadata || "{}") : (entry.metadata || {});
          return meta.sent?.ok !== false;
        })
        .map((entry) => entry.type)
    );
    const profileReport = {
      userId: profile.userId,
      timezone: profile.timezone,
      dateKey: local.dateKey,
      minuteOfDay: local.minuteOfDay,
      actions: [],
    };

    if (forceType === "morning_brief" || shouldSend(profile, "morning_brief", local, sentTypes)) {
      const calendarEvents = profile.google_refresh_token
        ? await getTodayEvents(profile.google_refresh_token, profile.timezone || "Asia/Kolkata").catch((err) => { console.error("calendar_fetch_failed", { userId: profile.userId, err: err.message }); return []; })
        : [];
      const planState = await recomputeDailyPlan({
        userId: profile.userId,
        date: now,
        calendarEvents,
        profile,
      });
      // Enrich planState with goal task context for morning brief
      if (planState.goalTasks?.length > 0) {
        planState.goalTaskContext = planState.goalTasks.map((gt) =>
          `[${gt.goalTitle || "Goal"}] ${gt.milestoneTitle || gt.text || ""}`
        );
      }
      // Build rich context for the enhanced morning brief
      const briefContext = await buildMorningBriefContext({
        userId: profile.userId,
        date: now,
        planState,
        calendarEvents,
        profile,
      }).catch((err) => { console.error("briefContext failed", { error: err.message }); return null; });
      const llmBody = await llmMorningBrief(planState, calendarEvents, profile, briefContext).catch(() => null);
      const body = llmBody || buildMorningBrief({
        planState,
        tone: profile.tone || "firm",
      });
      const sent = await sendAndLog({
        userId: profile.userId,
        to: profile.whatsAppNumber,
        type: "morning_brief",
        body,
        relatedTaskIds: planState.topPriorities.map((task) => task.id),
        metadata: {
          reason: "scheduled_morning_brief",
          planDate: planState.plan?.date || local.dateKey,
        },
      });
      profileReport.actions.push({ type: "morning_brief", sent });
      sentTypes.add("morning_brief");
    }

    // Nudge pulse scheduling removed — on Pro plan, the */5 cron + shouldSend()
    // handles all nudge delivery directly. Pulse scheduling was a Hobby-plan
    // workaround that caused infinite retry loops (creating new pulses every
    // 5 minutes when sends failed, burning through Twilio rate limits).

    if (forceType === "midday_nudge" || shouldSend(profile, "midday_nudge", local, sentTypes)) {
      const planState = await recomputeDailyPlan({ userId: profile.userId, date: now });
      const calEventsNudge = profile.google_refresh_token
        ? await getUpcomingEvents(profile.google_refresh_token, profile.timezone || "Asia/Kolkata", 3).catch((err) => { console.error("calendar_fetch_failed", { userId: profile.userId, err: err.message }); return []; })
        : [];
      const recentCtx = sentToday || [];
      const behavior = detectBehaviorPatterns(planState, recentCtx, local.dateKey);
      // Compute escalation level for top task
      const topTask = (planState.topPriorities || []).find((t) => !t.done);
      const escalation = topTask ? computeEscalationLevel(topTask, [], []) : null;
      const llmBody = await llmNudge(planState, "midday_nudge", profile, calEventsNudge, behavior, escalation).catch(() => null);
      const nudge = await generateNudge({
        userId: profile.userId,
        tone: profile.tone || "firm",
        now,
      });
      const sent = await sendAndLog({
        userId: profile.userId,
        to: profile.whatsAppNumber,
        type: "midday_nudge",
        body: llmBody || nudge.body,
        relatedTaskIds: nudge.relatedTaskIds || [],
        metadata: { reason: nudge.reason || "scheduled_midday_nudge", behavior: behavior.primaryPattern },
      });
      profileReport.actions.push({ type: "midday_nudge", sent, reason: nudge.reason });
      sentTypes.add("midday_nudge");
    }

    if (forceType === "afternoon_followup" || shouldSend(profile, "afternoon_followup", local, sentTypes)) {
      const planState = await recomputeDailyPlan({ userId: profile.userId, date: now });
      const calEventsAfternoon = profile.google_refresh_token
        ? await getUpcomingEvents(profile.google_refresh_token, profile.timezone || "Asia/Kolkata", 3).catch((err) => { console.error("calendar_fetch_failed", { userId: profile.userId, err: err.message }); return []; })
        : [];
      const recentCtxAfternoon = sentToday || [];
      const behaviorAfternoon = detectBehaviorPatterns(planState, recentCtxAfternoon, local.dateKey);
      // Compute escalation for afternoon (more urgent)
      const topTaskAfternoon = (planState.topPriorities || []).find((t) => !t.done);
      const escalationAfternoon = topTaskAfternoon ? computeEscalationLevel(topTaskAfternoon, [], []) : null;
      const llmBody = await llmNudge(planState, "afternoon_followup", profile, calEventsAfternoon, behaviorAfternoon, escalationAfternoon).catch(() => null);
      const nudge = await generateNudge({
        userId: profile.userId,
        tone: profile.tone || "firm",
        now,
      });
      const body = llmBody || `${nudge.body}\nOne completion push before end of day.`;
      const sent = await sendAndLog({
        userId: profile.userId,
        to: profile.whatsAppNumber,
        type: "afternoon_followup",
        body,
        relatedTaskIds: nudge.relatedTaskIds || [],
        metadata: { reason: nudge.reason || "scheduled_afternoon_followup", behavior: behaviorAfternoon.primaryPattern },
      });
      profileReport.actions.push({ type: "afternoon_followup", sent, reason: nudge.reason });
      sentTypes.add("afternoon_followup");
    }

    if (forceType === "evening_checkin" || shouldSend(profile, "evening_checkin", local, sentTypes)) {
      const planState = await recomputeDailyPlan({
        userId: profile.userId,
        date: now,
      });
      const completedToday = (planState.scoredTasks || []).filter(
        (t) => t.done && t.completedAt && t.completedAt.startsWith(local.dateKey)
      );
      const calEventsEvening = profile.google_refresh_token
        ? await getTodayEvents(profile.google_refresh_token, profile.timezone || "Asia/Kolkata").catch((err) => { console.error("calendar_fetch_failed", { userId: profile.userId, err: err.message }); return []; })
        : [];
      const llmBody = await llmEveningCheckin(planState, completedToday, profile, calEventsEvening).catch(() => null);
      const body = llmBody || buildEveningCheckin({ planState });
      const sent = await sendAndLog({
        userId: profile.userId,
        to: profile.whatsAppNumber,
        type: "evening_checkin",
        body,
        relatedTaskIds: planState.topPriorities.map((task) => task.id),
        metadata: {
          reason: "scheduled_evening_checkin",
          planDate: planState.plan?.date || local.dateKey,
        },
      });
      profileReport.actions.push({ type: "evening_checkin", sent });
      sentTypes.add("evening_checkin");

      // Compute daily scorecard & analyze patterns after evening checkin
      try {
        const scorecard = await computeDailyScorecard(profile.userId, local.dateKey, planState);
        const analysis = await analyzeDay(profile.userId, local.dateKey, planState);
        profileReport.actions.push({ type: "scorecard", completionRate: scorecard.completionRate, streak: scorecard.streakDays, insights: analysis.insights?.length || 0 });
      } catch (err) {
        console.error("scorecard_computation_failed", { userId: profile.userId, error: err.message });
      }
    }

    // ─── Persistent follow-ups for avoided tasks ───
    // Only send between midday and evening, max 1 follow-up per run
    if (
      profile.whatsAppNumber &&
      local.minuteOfDay >= parseTimeToMinutes(profile.middayNudgeTime, "12:30") &&
      local.minuteOfDay <= parseTimeToMinutes(profile.eveningCheckinTime, "20:30") &&
      !sentTypes.has("followup")
    ) {
      const overdueTasks = await fetchOverdueTasks(profile.userId);
      const avoidedTask = overdueTasks.find(
        (t) => Number(t.reschedule_count || t.rescheduleCount || 0) >= 2
      );

      if (avoidedTask) {
        // Check we haven't already sent a follow-up for this task today
        const alreadySent = (sentToday || []).some(
          (m) => m.type === "followup" && m.related_task_ids?.includes(avoidedTask.id)
        );
        if (!alreadySent) {
          const calEventsFollowup = profile.google_refresh_token
            ? await getUpcomingEvents(profile.google_refresh_token, profile.timezone || "Asia/Kolkata", 2).catch((err) => { console.error("calendar_fetch_failed", { userId: profile.userId, err: err.message }); return []; })
            : [];
          const llmBody = await llmFollowUp(avoidedTask, calEventsFollowup, profile).catch(() => null);
          const fallbackBody = `You've postponed "${avoidedTask.title}" ${Number(avoidedTask.reschedule_count || 0)} times. Can you do just 10 minutes on it right now? Reply 'done' or 'archive' if it's no longer needed.`;
          const sent = await sendAndLog({
            userId: profile.userId,
            to: profile.whatsAppNumber,
            type: "followup",
            body: llmBody || fallbackBody,
            relatedTaskIds: [avoidedTask.id],
            metadata: { reason: "avoidance_followup", postponeCount: avoidedTask.reschedule_count },
          });
          profileReport.actions.push({ type: "followup", sent, taskId: avoidedTask.id });
        }
      }
    }

    // ─── Weekly Goal Review ───
    const reviewDay = (profile.weekly_review_day || profile.weeklyReviewDay || "sun").toLowerCase();
    const reviewTime = parseTimeToMinutes(profile.weekly_review_time || profile.weeklyReviewTime, "19:00");
    if (
      profile.whatsAppNumber &&
      local.weekday === reviewDay &&
      withinWindow(local.minuteOfDay, reviewTime, 22) &&
      !sentTypes.has("weekly_goal_review")
    ) {
      try {
        const goals = await listActiveLongTermGoals(profile.userId);
        if (goals.length > 0) {
          // Enrich each goal with milestones and completion rate
          const enrichedGoals = [];
          for (const g of goals) {
            const milestones = await listMilestonesForGoal(g.id, profile.userId);
            const stats = await countGoalTaskCompletions(profile.userId, g.id, 7);
            enrichedGoals.push({
              ...g,
              milestones,
              completionRate: stats.total > 0 ? stats.completed / stats.total : null,
            });
          }
          const llmBody = await llmWeeklyGoalReview(enrichedGoals, profile).catch(() => null);
          if (llmBody) {
            const sent = await sendAndLog({
              userId: profile.userId,
              to: profile.whatsAppNumber,
              type: "weekly_goal_review",
              body: llmBody,
              relatedTaskIds: [],
              metadata: { reason: "scheduled_weekly_goal_review", goalCount: goals.length },
            });
            profileReport.actions.push({ type: "weekly_goal_review", sent });
            sentTypes.add("weekly_goal_review");
          }
        }
      } catch (err) {
        console.error("weekly_goal_review failed", { userId: profile.userId, err: err.message });
      }
    }

    report.push(profileReport);
   } catch (err) {
    console.error("user_processing_failed", { userId: profile.userId, error: err.message, stack: err.stack });
    report.push({ userId: profile.userId, error: err.message });
   }
  }

  // ─── Process Pending Pulses ───
  const pulseReport = [];
  try {
    const pendingPulses = await getPendingPulses();
    for (const pulse of pendingPulses) {
      // Skip if user's bot is paused
      const pulsePaused = await getBotPauseStatus(pulse.user_id);
      if (pulsePaused) {
        await markPulseFired(pulse.id); // Don't fire late
        continue;
      }
      const pulseProfile = await getAgentProfileByUserId(pulse.user_id);
      if (!pulseProfile?.whatsAppNumber) {
        await markPulseFired(pulse.id);
        continue;
      }
      // Handle goal refinement timeout: auto-decompose if user didn't reply
      if (pulse.pulse_type === "goal_refinement_timeout") {
        try {
          const memories = await getCoreMemory(pulse.user_id);
          const draftingGoalMemory = memories.find((m) => m.key === "drafting_goal_id");
          if (draftingGoalMemory) {
            // User never replied — decompose with what we have
            const goalId = draftingGoalMemory.value;
            const goalTitleMemory = memories.find((m) => m.key === "drafting_goal_title");
            const goalTitle = goalTitleMemory?.value || "your goal";

            await deleteCoreMemory(pulse.user_id, "drafting_goal_id");
            await deleteCoreMemory(pulse.user_id, "drafting_goal_title");
            await updateLongTermGoal(goalId, { status: "active" });

            const decomposition = await llmDecomposeGoal(goalTitle, "", null, pulse.user_id);
            if (decomposition?.milestones) {
              for (let i = 0; i < decomposition.milestones.length; i++) {
                const m = decomposition.milestones[i];
                await createGoalMilestone(goalId, pulse.user_id, {
                  title: m.title,
                  description: m.description || "",
                  orderIndex: i,
                  targetDate: m.targetWeek
                    ? new Date(Date.now() + m.targetWeek * 7 * 86400000).toISOString().split("T")[0]
                    : null,
                  tasks: m.tasks || [],
                });
              }
            }

            const body = `I went ahead and broke down "${goalTitle}" into a plan. You can always refine it later by telling me more about your preferences.`;
            await sendAndLog({
              userId: pulse.user_id,
              to: pulseProfile.whatsAppNumber,
              type: "goal_refinement_timeout",
              body,
              relatedTaskIds: [],
              metadata: { goalId },
            });
          }
          // else: user already replied (drafting state cleared), skip
        } catch (err) {
          console.error("goal refinement timeout failed", { error: err.message, pulseId: pulse.id });
        }
        await markPulseFired(pulse.id);
        pulseReport.push({ pulseId: pulse.id, userId: pulse.user_id, sent: true, type: "goal_refinement_timeout" });
        continue;
      }

      // Generate contextual follow-up using LLM
      const pulseBody = await llmPulseMessage(pulse.context, pulseProfile).catch(() => null);
      const body = pulseBody || `Quick check-in: ${pulse.context}`;
      const sent = await sendAndLog({
        userId: pulse.user_id,
        to: pulseProfile.whatsAppNumber,
        type: "pulse",
        body,
        relatedTaskIds: [],
        metadata: { reason: "scheduled_pulse", pulseType: pulse.pulse_type, pulseId: pulse.id },
      });
      await markPulseFired(pulse.id);
      pulseReport.push({ pulseId: pulse.id, userId: pulse.user_id, sent });
    }
  } catch (err) {
    console.error("pulse processing failed", { error: err.message });
  }

  return res.status(200).json({
    ok: true,
    ranAt: now.toISOString(),
    profiles: report.length,
    pulses: pulseReport.length,
    report,
    pulseReport,
  });
}
