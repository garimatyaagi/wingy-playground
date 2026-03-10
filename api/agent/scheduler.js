import {
  listActiveProfiles,
  listAgentMessagesForDate,
  logAgentMessage,
  fetchOverdueTasks,
} from "./_store.js";
import {
  buildEveningCheckin,
  buildMorningBrief,
  detectBehaviorPatterns,
  generateNudge,
  recomputeDailyPlan,
} from "./_engine.js";
import { sendWhatsAppMessage } from "./_twilio.js";
import { llmMorningBrief, llmEveningCheckin, llmNudge, llmFollowUp } from "./_llm.js";
import { getTodayEvents, getUpcomingEvents } from "./_calendar.js";

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

function withinWindow(currentMinutes, targetMinutes, tolerance = 20) {
  return Math.abs(currentMinutes - targetMinutes) <= tolerance;
}

function shouldSend(profile, type, local, sentTypes) {
  if (!profile.whatsAppNumber) return false;
  if (sentTypes.has(type)) return false;
  const startMinutes = parseTimeToMinutes(profile.workdayStart, "09:00");
  const endMinutes = parseTimeToMinutes(profile.workdayEnd, "18:00");
  if (!profile.weekendsEnabled && (local.weekday === "sat" || local.weekday === "sun")) return false;
  if (local.minuteOfDay < startMinutes - 90 || local.minuteOfDay > endMinutes + 180) return false;

  const schedule = {
    morning_brief: parseTimeToMinutes(profile.morningBriefTime, "08:00"),
    midday_nudge: parseTimeToMinutes(profile.middayNudgeTime, "12:30"),
    afternoon_followup: parseTimeToMinutes(profile.afternoonFollowupTime, "16:00"),
    evening_checkin: parseTimeToMinutes(profile.eveningCheckinTime, "20:30"),
  };
  return withinWindow(local.minuteOfDay, schedule[type], 22);
}

async function sendAndLog({ userId, to, type, body, relatedTaskIds = [], metadata = {} }) {
  const sent = await sendWhatsAppMessage({ to, text: body });
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
  return sent;
}

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Auth: Accept Bearer header (Vercel cron) or ?token= query param (external cron services)
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  if (cronSecret) {
    const authHeader = String(req.headers.authorization || "").trim();
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const queryToken = String(req.query?.token || "").trim();
    const authenticated = bearerToken === cronSecret || queryToken === cronSecret;
    if (!authenticated) {
      console.error("scheduler_auth_failed", JSON.stringify({
        hasAuth: !!authHeader,
        hasQueryToken: !!queryToken,
        bearerLen: bearerToken.length,
        secretLen: cronSecret.length,
      }));
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  const now = new Date();
  const forceType = String(req.query?.force || req.body?.force || "").trim();
  const profiles = await listActiveProfiles();
  const report = [];

  for (const profile of profiles) {
    if (!profile.autoplanEnabled) continue;
    const local = localTimeParts(now, profile.timezone || "Asia/Kolkata");
    const sentToday = await listAgentMessagesForDate(profile.userId, local.dateKey);
    const sentTypes = new Set((sentToday || []).map((entry) => entry.type));
    const profileReport = {
      userId: profile.userId,
      timezone: profile.timezone,
      dateKey: local.dateKey,
      minuteOfDay: local.minuteOfDay,
      actions: [],
    };

    if (forceType === "morning_brief" || shouldSend(profile, "morning_brief", local, sentTypes)) {
      const planState = await recomputeDailyPlan({
        userId: profile.userId,
        date: now,
      });
      const calendarEvents = profile.google_refresh_token
        ? await getTodayEvents(profile.google_refresh_token, profile.timezone || "Asia/Kolkata").catch((err) => { console.error("calendar_fetch_failed", { userId: profile.userId, err: err.message }); return []; })
        : [];
      const llmBody = await llmMorningBrief(planState, calendarEvents, profile).catch(() => null);
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

    if (forceType === "midday_nudge" || shouldSend(profile, "midday_nudge", local, sentTypes)) {
      const planState = await recomputeDailyPlan({ userId: profile.userId, date: now });
      const calEventsNudge = profile.google_refresh_token
        ? await getUpcomingEvents(profile.google_refresh_token, profile.timezone || "Asia/Kolkata", 3).catch((err) => { console.error("calendar_fetch_failed", { userId: profile.userId, err: err.message }); return []; })
        : [];
      const recentCtx = sentToday || [];
      const behavior = detectBehaviorPatterns(planState, recentCtx, local.dateKey);
      const llmBody = await llmNudge(planState, "midday_nudge", profile, calEventsNudge, behavior).catch(() => null);
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
      const llmBody = await llmNudge(planState, "afternoon_followup", profile, calEventsAfternoon, behaviorAfternoon).catch(() => null);
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

    report.push(profileReport);
  }

  return res.status(200).json({
    ok: true,
    ranAt: now.toISOString(),
    profiles: report.length,
    report,
  });
}
