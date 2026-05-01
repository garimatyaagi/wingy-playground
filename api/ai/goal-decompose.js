import { authenticateRequest } from "../agent/_auth.js";
import {
  createLongTermGoal,
  createGoalMilestone,
  listActiveLongTermGoals,
} from "../agent/_store.js";
import { llmDecomposeGoal } from "../agent/_llm.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const userId = await authenticateRequest(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { title, description = "", scope = "yearly", targetDate = null } = req.body || {};
  if (!title || typeof title !== "string" || title.length > 500) {
    return res.status(400).json({ error: "Missing or invalid title" });
  }

  // Cap at 5 active goals
  const existing = await listActiveLongTermGoals(userId);
  if (existing.length >= 5) {
    return res.status(400).json({
      error: "goal_limit",
      message: `You have ${existing.length} active long-term goals. Archive or pause one before adding another.`,
      activeGoals: existing.map((g) => ({ id: g.id, title: g.title })),
    });
  }

  // Determine priority: max 2 primary (daily) goals
  const primaryCount = existing.filter((g) => g.priority === 1).length;
  const priority = existing.length === 0 ? 1 : primaryCount < 2 ? 1 : 2;

  const goal = await createLongTermGoal(userId, {
    title: title.trim(),
    description: description.slice(0, 2000),
    scope,
    targetDate: targetDate || null,
    priority,
  });

  if (!goal?.id) {
    return res.status(500).json({ error: "Failed to create long-term goal" });
  }

  // Decompose into milestones via LLM
  const decomposition = await llmDecomposeGoal(
    goal.title,
    goal.description,
    goal.target_date,
    userId
  );

  const milestones = [];
  if (decomposition?.milestones) {
    for (let i = 0; i < decomposition.milestones.length; i++) {
      const m = decomposition.milestones[i];
      const saved = await createGoalMilestone(goal.id, userId, {
        title: m.title,
        description: m.description || "",
        orderIndex: i,
        targetDate: m.targetWeek
          ? new Date(Date.now() + m.targetWeek * 7 * 86400000).toISOString().split("T")[0]
          : null,
        tasks: m.tasks || [],
      });
      if (saved) milestones.push(saved);
    }
  }

  return res.status(200).json({
    goal,
    milestones,
    decomposition: decomposition
      ? {
          dailyHabitSuggestion: decomposition.dailyHabitSuggestion,
          weeklyCheckpoint: decomposition.weeklyCheckpoint,
          suggestedPriority: decomposition.suggestedPriority,
        }
      : null,
  });
}
