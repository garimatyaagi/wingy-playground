import {
  listActiveProfiles,
  listAgentMessagesForDate,
  logAgentMessage,
} from "./store.js";
import {
  buildEveningCheckin,
  buildMorningBrief,
  generateNudge,
  recomputeDailyPlan,
} from "./engine.js";
import { sendWhatsAppMessage } from "./twilio.js";

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

  const now = new Date();
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
      actions: [],
    };

    if (shouldSend(profile, "morning_brief", local, sentTypes)) {
      const planState = await recomputeDailyPlan({
        userId: profile.userId,
        date: now,
      });
      const body = buildMorningBrief({
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

    if (shouldSend(profile, "midday_nudge", local, sentTypes)) {
      const nudge = await generateNudge({
        userId: profile.userId,
        tone: profile.tone || "firm",
        now,
      });
      const sent = await sendAndLog({
        userId: profile.userId,
        to: profile.whatsAppNumber,
        type: "midday_nudge",
        body: nudge.body,
        relatedTaskIds: nudge.relatedTaskIds || [],
        metadata: { reason: nudge.reason || "scheduled_midday_nudge" },
      });
      profileReport.actions.push({ type: "midday_nudge", sent, reason: nudge.reason });
      sentTypes.add("midday_nudge");
    }

    if (shouldSend(profile, "afternoon_followup", local, sentTypes)) {
      const nudge = await generateNudge({
        userId: profile.userId,
        tone: profile.tone || "firm",
        now,
      });
      const body = `${nudge.body}\nOne completion push before end of day.`;
      const sent = await sendAndLog({
        userId: profile.userId,
        to: profile.whatsAppNumber,
        type: "afternoon_followup",
        body,
        relatedTaskIds: nudge.relatedTaskIds || [],
        metadata: { reason: nudge.reason || "scheduled_afternoon_followup" },
      });
      profileReport.actions.push({ type: "afternoon_followup", sent, reason: nudge.reason });
      sentTypes.add("afternoon_followup");
    }

    if (shouldSend(profile, "evening_checkin", local, sentTypes)) {
      const planState = await recomputeDailyPlan({
        userId: profile.userId,
        date: now,
      });
      const body = buildEveningCheckin({ planState });
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

    report.push(profileReport);
  }

  return res.status(200).json({
    ok: true,
    ranAt: now.toISOString(),
    profiles: report.length,
    report,
  });
}
