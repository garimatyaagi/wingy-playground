import { recomputeDailyPlan } from "./engine.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const userId = String(req.body?.userId || "").trim();
  if (!userId) return res.status(400).json({ error: "Missing userId" });
  const date = req.body?.date || new Date().toISOString();
  const dailyCapacityMinutes = Number(req.body?.dailyCapacityMinutes || 180);
  const state = await recomputeDailyPlan({
    userId,
    date,
    dailyCapacityMinutes,
  });
  return res.status(200).json({
    ok: true,
    plan: state.plan,
    topPriorities: state.topPriorities,
    nextBest: state.nextBest,
    dueToday: state.dueToday,
    overdue: state.overdue,
    deferred: state.deferred,
  });
}
