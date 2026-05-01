// ─── Proactive Intelligence Module ───
// Detects empty days, stalling goals, computes escalation levels,
// and generates suggestions for underutilized time.

import {
  listActiveLongTermGoals,
  listMilestonesForGoal,
  countGoalTaskCompletions,
  getRecentScorecards,
  getUserInsights,
} from "./_store.js";

// ─── Empty Day Detection ───

export function detectEmptyDay(planState, calendarEvents = [], profile = {}) {
  const taskCount = (planState?.topPriorities || []).filter((t) => !t.done).length;
  const workdayStart = profile?.workdayStart || "09:00";
  const workdayEnd = profile?.workdayEnd || "18:00";
  const workMinutes = (parseInt(workdayEnd) - parseInt(workdayStart)) * 60 || 540;

  const calendarMinutes = (calendarEvents || []).reduce((s, e) => {
    if (e.durationMinutes) return s + e.durationMinutes;
    if (e.start && e.end) return s + Math.max(0, (new Date(e.end) - new Date(e.start)) / 60000);
    return s + 60;
  }, 0);

  const freeMinutes = Math.max(0, workMinutes - calendarMinutes);
  const taskMinutes = (planState?.topPriorities || [])
    .filter((t) => !t.done)
    .reduce((s, t) => s + (t.estimatedMinutes || 30), 0);

  const isEmpty = taskCount <= 1 && freeMinutes > 240;
  const isUnderutilized = freeMinutes - taskMinutes > 180; // >3h unaccounted for

  return {
    isEmpty,
    isUnderutilized,
    freeMinutes,
    taskMinutes,
    gapMinutes: freeMinutes - taskMinutes,
    taskCount,
  };
}

// ─── Stalling Goal Detection ───

export async function detectStallingGoals(userId) {
  const goals = await listActiveLongTermGoals(userId);
  const stallingGoals = [];

  for (const goal of goals) {
    // Check 7-day and 14-day completion
    const stats7 = await countGoalTaskCompletions(userId, goal.id, 7);
    const stats14 = await countGoalTaskCompletions(userId, goal.id, 14);

    const isStalling7 = stats7.completed === 0;
    const isStalling14 = stats14.completed === 0;

    // Check if deadline is approaching
    let daysUntilDeadline = null;
    if (goal.target_date) {
      const deadline = new Date(goal.target_date);
      daysUntilDeadline = Math.ceil((deadline - new Date()) / 86400000);
    }

    if (isStalling7) {
      // Find the current milestone for suggestion
      const milestones = await listMilestonesForGoal(goal.id);
      const currentMilestone = milestones.find((m) => m.status === "pending" || m.status === "in_progress");
      const suggestedTask = currentMilestone
        ? (Array.isArray(currentMilestone.tasks) ? currentMilestone.tasks[0] : null)
        : null;

      stallingGoals.push({
        goalId: goal.id,
        title: goal.title,
        stallDays: isStalling14 ? 14 : 7,
        priority: goal.priority,
        daysUntilDeadline,
        urgency: daysUntilDeadline !== null && daysUntilDeadline < 30 ? "high" : isStalling14 ? "medium" : "low",
        currentMilestone: currentMilestone?.title || null,
        suggestedTask: suggestedTask?.title || null,
        suggestedMinutes: suggestedTask?.estimatedMinutes || 20,
      });
    }
  }

  return stallingGoals.sort((a, b) => {
    const urgencyOrder = { high: 0, medium: 1, low: 2 };
    return (urgencyOrder[a.urgency] || 2) - (urgencyOrder[b.urgency] || 2);
  });
}

// ─── Escalation Level Computation ───

export function computeEscalationLevel(task, userInsights = [], dailyScorecards = []) {
  let level = 0;
  const reasons = [];

  const rescheduleCount = Number(task.rescheduleCount || 0);
  const importance = Number(task.importance || 3);

  // Level 1: Direct callout (postponed 3-4x)
  if (rescheduleCount >= 3 && rescheduleCount <= 4) {
    level = Math.max(level, 1);
    reasons.push(`postponed ${rescheduleCount} times`);
  }

  // Level 2: Pattern confrontation (postponed 5+ OR part of broader pattern)
  if (rescheduleCount >= 5) {
    level = Math.max(level, 2);
    reasons.push(`postponed ${rescheduleCount} times — chronic avoidance`);
  }

  // Check if this task's effort type matches a known weakness
  const effortType = task.effortType || "deep_work";
  const matchingWeakness = userInsights.find(
    (i) => i.category === "weakness" && i.insight.includes(effortType)
  );
  if (matchingWeakness && rescheduleCount >= 2) {
    level = Math.max(level, 2);
    reasons.push(`known avoidance pattern for ${effortType} tasks`);
  }

  // Level 3: Goal impact (high importance + linked to goal + stalling)
  if (rescheduleCount >= 5 && importance >= 4) {
    level = Math.max(level, 3);
    reasons.push(`high-importance task stalling — goal impact`);
  }

  // Low completion rate context amplifies escalation
  if (dailyScorecards.length >= 3) {
    const recentRates = dailyScorecards.slice(0, 3).map((sc) => sc.completion_rate || 0);
    const avgRate = recentRates.reduce((s, r) => s + r, 0) / recentRates.length;
    if (avgRate < 0.4 && level >= 1) {
      level = Math.min(3, level + 1);
      reasons.push(`completion rate only ${Math.round(avgRate * 100)}% lately`);
    }
  }

  return { level, reasons, rescheduleCount };
}

// ─── Proactive Suggestions for Empty/Underutilized Days ───

export async function generateProactiveSuggestions(userId, planState, goals = null) {
  const activeGoals = goals || await listActiveLongTermGoals(userId);
  const suggestions = [];

  // 1. Find goals with lowest weekly completion rate
  const goalRates = [];
  for (const goal of activeGoals) {
    const stats = await countGoalTaskCompletions(userId, goal.id, 7);
    goalRates.push({
      goal,
      rate: stats.total > 0 ? stats.completed / stats.total : 0,
      total: stats.total,
      completed: stats.completed,
    });
  }

  // Sort: goals with lowest completion first, then by priority
  goalRates.sort((a, b) => a.rate - b.rate || (a.goal.priority || 3) - (b.goal.priority || 3));

  for (const { goal } of goalRates.slice(0, 3)) {
    const milestones = await listMilestonesForGoal(goal.id);
    const currentMilestone = milestones.find((m) => m.status === "pending" || m.status === "in_progress");
    if (!currentMilestone) continue;

    const tasks = Array.isArray(currentMilestone.tasks) ? currentMilestone.tasks : [];
    const dailyTask = tasks.find((t) => t.frequency === "daily") || tasks[0];
    if (!dailyTask) continue;

    suggestions.push({
      goalTitle: goal.title,
      milestoneTitle: currentMilestone.title,
      taskTitle: dailyTask.title,
      estimatedMinutes: dailyTask.estimatedMinutes || 20,
      effortType: dailyTask.effortType || "deep_work",
      reason: `Goal "${goal.title}" needs attention`,
    });

    if (suggestions.length >= 3) break;
  }

  // 2. Check for overdue tasks that could be broken smaller
  const overdue = (planState?.overdue || []).slice(0, 2);
  for (const task of overdue) {
    if (Number(task.rescheduleCount || 0) >= 3 && (task.estimatedMinutes || 30) > 30) {
      suggestions.push({
        goalTitle: task.goalTitle || "Overdue",
        taskTitle: `Break down "${task.title}" into a 15-min starter`,
        estimatedMinutes: 15,
        effortType: task.effortType || "deep_work",
        reason: `Postponed ${task.rescheduleCount}x — try a smaller chunk`,
      });
    }
  }

  return suggestions.slice(0, 4);
}
