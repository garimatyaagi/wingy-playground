import { recomputeDailyPlan } from "./_engine.js";
import { requireAuth } from "./_auth.js";
import { getTodayEvents } from "./_calendar.js";
import { getAgentProfileByUserId } from "./_store.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const requestedUserId = String(req.body?.userId || "").trim();
  if (!requestedUserId) return res.status(400).json({ error: "Missing userId" });
  const userId = await requireAuth(req, res, requestedUserId);
  if (!userId) return;
  const date = req.body?.date || new Date().toISOString();
  const dailyCapacityMinutes = Number(req.body?.dailyCapacityMinutes || 180);

  // Fetch calendar events and profile for optimizer
  const profile = await getAgentProfileByUserId(userId);
  let calendarEvents = [];
  if (profile?.google_refresh_token) {
    calendarEvents = await getTodayEvents(
      profile.google_refresh_token,
      profile?.timezone || "Asia/Kolkata"
    ).catch(() => []);
  }

  const state = await recomputeDailyPlan({
    userId,
    date,
    dailyCapacityMinutes,
    calendarEvents,
    profile: profile || {},
  });
  return res.status(200).json({
    ok: true,
    plan: state.plan,
    topPriorities: state.topPriorities,
    nextBest: state.nextBest,
    dueToday: state.dueToday,
    overdue: state.overdue,
    deferred: state.deferred,
    optimizedSchedule: state.optimizedSchedule || null,
  });
}
