import {
  getDailyPlan,
  listOpenTasks,
  logTaskEvent,
  saveDailyPlan,
} from "./store.js";

const ACTION_VERBS = [
  "finish",
  "finalize",
  "call",
  "renew",
  "read",
  "workout",
  "exercise",
  "send",
  "book",
  "prepare",
  "plan",
  "complete",
  "draft",
  "write",
  "review",
  "update",
  "submit",
  "pay",
];

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "to",
  "for",
  "on",
  "in",
  "with",
  "this",
  "that",
  "it",
  "my",
  "our",
  "and",
  "by",
  "of",
  "is",
  "be",
  "do",
  "done",
  "finished",
  "complete",
  "completed",
]);

function cleanText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function isoDate(value = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function asDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function endOfDay(dateInput) {
  const date = new Date(dateInput);
  date.setHours(23, 59, 0, 0);
  return date;
}

function addDays(dateInput, days) {
  const date = new Date(dateInput);
  date.setDate(date.getDate() + days);
  return date;
}

function titleCase(value) {
  const text = cleanText(value);
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function tokenize(value) {
  return cleanText(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token && !STOPWORDS.has(token));
}

function tokenOverlapScore(a, b) {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const setA = new Set(ta);
  const setB = new Set(tb);
  let common = 0;
  setA.forEach((token) => {
    if (setB.has(token)) common += 1;
  });
  const denominator = Math.max(setA.size, setB.size, 1);
  return common / denominator;
}

function inferGoalName(text) {
  const lower = text.toLowerCase();
  if (/\b(health|workout|run|gym|yoga|diet|sleep)\b/.test(lower)) return "Health";
  if (/\b(read|learn|study|course|practice)\b/.test(lower)) return "Learning & Growth";
  if (/\b(passport|tax|bank|insurance|dentist|bill|ca)\b/.test(lower)) return "Life Admin";
  if (/\b(deck|client|proposal|launch|business|strategy|investor|onboarding)\b/.test(lower)) return "Career";
  return "Inbox / Unassigned";
}

function inferEffortType(text) {
  const lower = text.toLowerCase();
  if (/\b(email|mail|invoice|reply|admin|follow up)\b/.test(lower)) return "admin";
  if (/\b(workout|run|gym|walk|health)\b/.test(lower)) return "health";
  if (/\b(call|meeting|talk|supplier)\b/.test(lower)) return "call";
  if (/\b(renew|book|bank|passport|dentist|buy|visit)\b/.test(lower)) return "errand";
  if (/\b(read|learn|study|practice)\b/.test(lower)) return "learning";
  return "deep_work";
}

function inferEstimatedMinutes(text, effortType) {
  const lower = text.toLowerCase();
  const explicit = lower.match(/(\d{1,3})\s*(min|mins|minutes|hour|hours|hr|hrs)\b/i);
  if (explicit) {
    const amount = Number(explicit[1]);
    if (!Number.isFinite(amount) || amount <= 0) return 30;
    return explicit[2].toLowerCase().startsWith("h") ? Math.min(240, amount * 60) : Math.min(240, amount);
  }
  if (effortType === "admin") return 20;
  if (effortType === "call") return 20;
  if (effortType === "errand") return 45;
  if (effortType === "health") return 45;
  if (effortType === "learning") return 35;
  if (/\b(deck|proposal|strategy|investor)\b/.test(lower)) return 90;
  return 40;
}

function weekdayToIndex(name) {
  const map = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };
  return map[String(name || "").toLowerCase()] ?? null;
}

function nextWeekday(now, weekday) {
  const target = weekdayToIndex(weekday);
  if (target == null) return null;
  const current = now.getDay();
  const delta = (target - current + 7) % 7 || 7;
  return endOfDay(addDays(now, delta));
}

function inferDueDate(text, now = new Date()) {
  const lower = text.toLowerCase();
  if (/\btoday\b/.test(lower)) return endOfDay(now).toISOString();
  if (/\btomorrow\b/.test(lower)) return endOfDay(addDays(now, 1)).toISOString();
  if (/\bthis month\b/.test(lower)) {
    return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 0, 0).toISOString();
  }
  const byWeekday = lower.match(/\bby\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (byWeekday) {
    const due = nextWeekday(now, byWeekday[1]);
    return due ? due.toISOString() : null;
  }
  if (/\bthis week\b/.test(lower)) {
    const due = nextWeekday(now, "friday");
    return due ? due.toISOString() : null;
  }
  return null;
}

function inferUrgency(text, dueDate) {
  const lower = text.toLowerCase();
  if (/\b(urgent|asap|immediately|critical)\b/.test(lower)) return 5;
  if (!dueDate) return 2;
  const due = asDate(dueDate);
  if (!due) return 2;
  const diffHours = (due.getTime() - Date.now()) / (1000 * 60 * 60);
  if (diffHours <= 24) return 5;
  if (diffHours <= 72) return 4;
  if (diffHours <= 168) return 3;
  return 2;
}

function inferImportance(text) {
  const lower = text.toLowerCase();
  if (/\b(strategy|client|investor|proposal|deck|launch)\b/.test(lower)) return 5;
  if (/\b(passport|tax|dentist|health|exam)\b/.test(lower)) return 4;
  if (/\b(admin|organize|cleanup)\b/.test(lower)) return 2;
  return 3;
}

function detectRecurring(text) {
  const lower = text.toLowerCase();
  if (/\b(every day|daily|each day)\b/.test(lower)) {
    return { isRecurring: true, recurrenceRule: { frequency: "daily", interval: 1 } };
  }
  const byWeekday = lower.match(/every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i);
  if (byWeekday) {
    return {
      isRecurring: true,
      recurrenceRule: { frequency: "weekly", interval: 1, daysOfWeek: [weekdayToIndex(byWeekday[1])] },
    };
  }
  const xTimesPerWeek = lower.match(/(\d+)\s*(x|times?)\s*(a|per)?\s*week/i);
  if (xTimesPerWeek) {
    return {
      isRecurring: true,
      recurrenceRule: { frequency: "weekly", interval: 1, timesPerWeek: Math.max(1, Number(xTimesPerWeek[1])) },
    };
  }
  if (/\b(weekly|every week)\b/.test(lower)) {
    return { isRecurring: true, recurrenceRule: { frequency: "weekly", interval: 1 } };
  }
  if (/\b(monthly|every month)\b/.test(lower)) {
    return { isRecurring: true, recurrenceRule: { frequency: "monthly", interval: 1 } };
  }
  return { isRecurring: false, recurrenceRule: null };
}

function isLikelyActionable(text) {
  const lower = text.toLowerCase();
  return (
    ACTION_VERBS.some((verb) => lower.includes(verb)) ||
    /\b(by|before|tomorrow|today|this month|every|daily|weekly)\b/.test(lower)
  );
}

function splitCompoundTasks(text) {
  const base = cleanText(text);
  if (!base) return [];
  const candidate = base.replace(/[.]+$/g, "");
  const withCommas = candidate.split(/\s*,\s*/).filter(Boolean);
  const expanded = [];
  withCommas.forEach((segment) => {
    const parts = segment.split(/\s+\band\b\s+/i).filter(Boolean);
    if (parts.length > 1 && parts.every((part) => isLikelyActionable(part))) {
      parts.forEach((part) => expanded.push(part));
    } else {
      expanded.push(segment);
    }
  });
  return expanded.length > 0 ? expanded : [candidate];
}

function cleanTaskTitle(rawPart, fullText) {
  let title = cleanText(rawPart);
  title = title
    .replace(/\b(by|before)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, "")
    .replace(/\b(today|tomorrow|this month)\b/gi, "")
    .replace(/\b(every day|daily|weekly|monthly)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!title) title = cleanText(fullText);
  return titleCase(title);
}

function detectCompletionIntent(text) {
  const lower = text.toLowerCase();
  if (/^(done|completed|finished|sent it|sent|done\.)$/.test(lower)) return { isCompletion: true, target: "" };
  if (/^(done with|finished|completed|sent)\b/.test(lower)) {
    const target = lower
      .replace(/^(done with|finished|completed|sent)\b/i, "")
      .replace(/^(the|it)\b/i, "")
      .trim();
    return { isCompletion: true, target };
  }
  if (/\b(workout done|done today|i finished|i completed|i sent)\b/.test(lower)) {
    const target = lower
      .replace(/i\s+(finished|completed|sent)\b/i, "")
      .replace(/\bdone\b/gi, "")
      .trim();
    return { isCompletion: true, target };
  }
  return { isCompletion: false, target: "" };
}

function detectRescheduleIntent(text) {
  const lower = text.toLowerCase();
  if (!/\b(skip|snooze|reschedule|move|not today|later|tomorrow)\b/.test(lower)) {
    return { isReschedule: false, days: 1 };
  }
  let days = 1;
  if (/\bnext week\b/.test(lower)) days = 7;
  if (/\bday after tomorrow\b/.test(lower)) days = 2;
  return { isReschedule: true, days };
}

function detectArchiveIntent(text) {
  return /\b(not doing this anymore|cancel this|drop this|archive this|not relevant anymore)\b/i.test(text);
}

function detectNoteIntent(text) {
  const lower = text.toLowerCase();
  return (
    /\b(i think|i feel|memory|journal|idea|falafel|interesting|remember this)\b/.test(lower) &&
    !isLikelyActionable(lower)
  );
}

function detectGoalIntent(text) {
  const lower = text.toLowerCase();
  return /^goal\s*:/i.test(text) || /^i want to\b/i.test(lower) || /\bthis year\b/.test(lower);
}

export function parseMessageIntent(rawText, now = new Date()) {
  const text = cleanText(rawText);
  if (!text) {
    return {
      intent: "ambiguous",
      confidence: 0.2,
      clarificationQuestion: "What should I capture from that message?",
      tasks: [],
    };
  }

  const completion = detectCompletionIntent(text);
  if (completion.isCompletion) {
    return {
      intent: "complete_task",
      confidence: completion.target ? 0.85 : 0.7,
      completionTarget: completion.target,
      tasks: [],
    };
  }

  if (detectArchiveIntent(text)) {
    return {
      intent: "archive_task",
      confidence: 0.8,
      completionTarget: text,
      tasks: [],
    };
  }

  const reschedule = detectRescheduleIntent(text);
  if (reschedule.isReschedule) {
    return {
      intent: "reschedule_task",
      confidence: 0.76,
      completionTarget: text,
      rescheduleDays: reschedule.days,
      tasks: [],
    };
  }

  if (detectGoalIntent(text)) {
    const title = text
      .replace(/^goal\s*:\s*/i, "")
      .replace(/^i want to\s+/i, "")
      .replace(/\s+this year\b/i, "")
      .trim();
    return {
      intent: "goal",
      confidence: title ? 0.82 : 0.5,
      goalTitle: title || text,
      tasks: [],
    };
  }

  if (detectNoteIntent(text)) {
    return {
      intent: "note",
      confidence: 0.88,
      noteText: text,
      tasks: [],
    };
  }

  if (!isLikelyActionable(text)) {
    return {
      intent: "ambiguous",
      confidence: 0.35,
      clarificationQuestion: "Do you want me to save this as a task, goal, or note?",
      tasks: [],
    };
  }

  const dueDate = inferDueDate(text, now);
  const recurring = detectRecurring(text);
  const parts = splitCompoundTasks(text);
  const tasks = parts
    .map((part) => {
      const title = cleanTaskTitle(part, text);
      const effortType = inferEffortType(part);
      return {
        title,
        normalizedTitle: title.toLowerCase(),
        rawSourceText: text,
        dueDate,
        isRecurring: recurring.isRecurring,
        recurrenceRule: recurring.recurrenceRule,
        estimatedMinutes: inferEstimatedMinutes(part, effortType),
        urgency: inferUrgency(part, dueDate),
        importance: inferImportance(part),
        effortType,
        source: "whatsapp",
        aiConfidence: parts.length > 1 ? 0.72 : 0.78,
        goalName: inferGoalName(part),
        status: "open",
      };
    })
    .filter((task) => task.title);

  if (tasks.length === 0) {
    return {
      intent: "ambiguous",
      confidence: 0.3,
      clarificationQuestion: "I need a concrete action. What exactly should be done?",
      tasks: [],
    };
  }

  const intent = tasks.some((task) => task.isRecurring) ? "create_recurring_task" : "create_task";
  return {
    intent,
    confidence: tasks.length > 1 ? 0.74 : 0.8,
    tasks,
  };
}

function compareScores(a, b) {
  return Number(b.score || 0) - Number(a.score || 0);
}

export function resolveTaskMatch({
  targetText,
  openTasks,
  preferredTaskIds = [],
}) {
  const tasks = (openTasks || []).filter((task) => !task.done && task.status !== "completed");
  if (tasks.length === 0) {
    return { status: "not_found", reason: "no_open_tasks" };
  }

  const normalizedTarget = cleanText(targetText).toLowerCase();
  if (!normalizedTarget || /^(it|this|that)?\s*$/.test(normalizedTarget)) {
    for (const taskId of preferredTaskIds) {
      const found = tasks.find((task) => task.id === taskId);
      if (found) return { status: "matched", task: found, score: 0.7, strategy: "context" };
    }
    return { status: "matched", task: tasks[0], score: 0.55, strategy: "recent_open" };
  }

  const scored = tasks
    .map((task) => {
      const title = String(task.title || "").toLowerCase();
      let score = tokenOverlapScore(normalizedTarget, title);
      if (title.includes(normalizedTarget)) score += 0.5;
      if (normalizedTarget.includes(title)) score += 0.25;
      if (preferredTaskIds.includes(task.id)) score += 0.25;
      return { task, score };
    })
    .sort(compareScores);

  const top = scored[0];
  const second = scored[1];
  if (!top || top.score < 0.22) {
    return { status: "not_found", reason: "low_match" };
  }
  if (second && second.score > 0.32 && Math.abs(top.score - second.score) < 0.08) {
    return {
      status: "ambiguous",
      options: scored.slice(0, 3).map((entry) => entry.task),
    };
  }
  return { status: "matched", task: top.task, score: top.score, strategy: "fuzzy" };
}

function recurrenceOccursOnDate(task, dateInput) {
  if (!task.isRecurring || !task.recurrenceRule) return false;
  const rule = task.recurrenceRule || {};
  const date = asDate(dateInput);
  if (!date) return false;
  const start = asDate(task.createdAt) || new Date();
  const diffDays = Math.floor((date.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return false;

  if (rule.frequency === "daily") {
    const interval = Number(rule.interval || 1);
    return diffDays % Math.max(1, interval) === 0;
  }
  if (rule.frequency === "weekly") {
    const interval = Number(rule.interval || 1);
    const weekIndex = Math.floor(diffDays / 7);
    if (weekIndex % Math.max(1, interval) !== 0) return false;
    if (Array.isArray(rule.daysOfWeek) && rule.daysOfWeek.length > 0) {
      return rule.daysOfWeek.includes(date.getDay());
    }
    return true;
  }
  if (rule.frequency === "monthly") {
    const interval = Number(rule.interval || 1);
    const monthDelta =
      date.getMonth() - start.getMonth() + (date.getFullYear() - start.getFullYear()) * 12;
    if (monthDelta < 0 || monthDelta % Math.max(1, interval) !== 0) return false;
    return date.getDate() === start.getDate();
  }
  return false;
}

function taskDuePressure(task, date) {
  if (!task.dueDate) return 0;
  const due = asDate(task.dueDate);
  if (!due) return 0;
  const diffHours = (due.getTime() - date.getTime()) / (1000 * 60 * 60);
  if (diffHours < 0) return 48;
  if (diffHours <= 24) return 34;
  if (diffHours <= 72) return 22;
  if (diffHours <= 168) return 12;
  return 5;
}

function unlockValue(task, allTasks) {
  return allTasks.filter((entry) => entry.blockedByTaskId === task.id && !entry.done).length * 10;
}

function estimateEffortFit(task, remainingMinutes) {
  const estimate = Number(task.estimatedMinutes || 30);
  if (estimate <= Math.max(remainingMinutes, 15)) return 8;
  if (estimate <= remainingMinutes + 30) return 2;
  return -7;
}

function toDateKey(dateInput) {
  return isoDate(dateInput);
}

export async function recomputeDailyPlan({
  userId,
  date = new Date(),
  dailyCapacityMinutes = 180,
}) {
  const targetDate = asDate(date) || new Date();
  const dateKey = toDateKey(targetDate);
  const openTasks = await listOpenTasks(userId);
  const tasks = openTasks.filter((task) => !task.done && task.status !== "completed");

  const recurringDue = tasks.filter((task) => recurrenceOccursOnDate(task, targetDate));
  const oneTimeOpen = tasks.filter((task) => !task.isRecurring);

  const scored = tasks
    .map((task) => {
      const isOverdue = Boolean(task.dueDate && asDate(task.dueDate)?.getTime() < targetDate.getTime());
      const isDueToday = Boolean(task.dueDate && isoDate(task.dueDate) === dateKey);
      const recurringDueToday = task.isRecurring && recurrenceOccursOnDate(task, targetDate);
      const score =
        taskDuePressure(task, targetDate) +
        Number(task.importance || 3) * 10 +
        Number(task.urgency || 2) * 8 +
        (isOverdue ? 24 : 0) +
        (isDueToday ? 16 : 0) +
        (recurringDueToday ? 20 : 0) +
        unlockValue(task, tasks) +
        Math.min(18, Number(task.rescheduleCount || 0) * 3) +
        (task.isBlocked ? -28 : 0) +
        estimateEffortFit(task, dailyCapacityMinutes);
      return {
        ...task,
        priorityScore: Math.round(score),
        recurringDueToday,
        isDueToday,
        isOverdue,
      };
    })
    .sort((a, b) => Number(b.priorityScore || 0) - Number(a.priorityScore || 0));

  const topPriorities = [];
  let usedMinutes = 0;
  for (const task of scored) {
    if (topPriorities.length >= 3) break;
    const estimate = Math.max(10, Number(task.estimatedMinutes || 30));
    if (topPriorities.length > 0 && usedMinutes + estimate > dailyCapacityMinutes + 20) continue;
    topPriorities.push(task);
    usedMinutes += estimate;
  }
  if (topPriorities.length === 0) {
    topPriorities.push(...scored.slice(0, 3));
  }

  const topIds = topPriorities.map((task) => task.id);
  const nextBest = topPriorities[0] || null;
  const dueToday = scored.filter((task) => task.isDueToday || task.recurringDueToday).slice(0, 12);
  const overdue = scored.filter((task) => task.isOverdue).slice(0, 12);
  const deferred = scored
    .filter((task) => !topIds.includes(task.id))
    .filter((task) => task.isOverdue || task.priorityScore >= 45)
    .slice(0, 8);
  const nudgeCandidates = topPriorities.concat(overdue).slice(0, 6);

  const summary = [
    `Top focus: ${topPriorities.length} task${topPriorities.length === 1 ? "" : "s"} selected`,
    `Recurring due: ${recurringDue.length}`,
    `Due today: ${dueToday.length}`,
    `Overdue: ${overdue.length}`,
    `Deferred: ${deferred.length}`,
  ].join(" | ");

  const plan = await saveDailyPlan({
    userId,
    date: dateKey,
    topPriorityTaskIds: topIds,
    nextBestTaskId: nextBest?.id || null,
    dueTodayTaskIds: dueToday.map((task) => task.id),
    overdueTaskIds: overdue.map((task) => task.id),
    nudgeCandidateTaskIds: nudgeCandidates.map((task) => task.id),
    deferredTaskIds: deferred.map((task) => task.id),
    planSummary: summary,
    version: new Date().toISOString(),
  });

  for (const task of topPriorities) {
    await logTaskEvent(task.id, "reprioritized", {
      priorityScore: task.priorityScore,
      date: dateKey,
    });
  }

  return {
    plan:
      plan || {
        user_id: userId,
        date: dateKey,
        top_priority_task_ids: topIds,
        next_best_task_id: nextBest?.id || null,
        due_today_task_ids: dueToday.map((task) => task.id),
        overdue_task_ids: overdue.map((task) => task.id),
        nudge_candidate_task_ids: nudgeCandidates.map((task) => task.id),
        deferred_task_ids: deferred.map((task) => task.id),
        plan_summary: summary,
      },
    scoredTasks: scored,
    taskMap: new Map(scored.map((task) => [task.id, task])),
    topPriorities,
    nextBest,
    recurringDue,
    dueToday,
    overdue,
    deferred,
    nudgeCandidates,
    dailyCapacityMinutes,
  };
}

function formatTaskLine(task) {
  return `${task.title} — ${task.estimatedMinutes || 30} min`;
}

export function buildMorningBrief({ planState, tone = "firm" }) {
  const top = planState.topPriorities || [];
  const recurring = planState.recurringDue || [];
  const overdue = planState.overdue || [];
  const next = planState.nextBest;

  const lines = ["Good morning. Here is your plan.", ""];
  lines.push("Top 3:");
  if (top.length === 0) lines.push("- No priorities yet.");
  top.slice(0, 3).forEach((task, index) => {
    lines.push(`${index + 1}. ${formatTaskLine(task)}`);
  });
  lines.push("");
  lines.push("Recurring due:");
  if (recurring.length === 0) lines.push("- None.");
  recurring.slice(0, 4).forEach((task) => lines.push(`- ${task.title}`));
  lines.push("");
  if (overdue.length > 0) lines.push(`Risk: ${overdue[0].title} is overdue.`);
  else lines.push("Risk: avoid replacing deep work with admin.");
  lines.push(
    tone === "ruthless"
      ? "Rule: no new tasks before priority #1 is done."
      : tone === "gentle"
        ? "Rule: start priority #1 with one focused block."
        : "Rule: finish the hard thing first."
  );
  if (next) lines.push(`Next best: ${next.title}`);
  return lines.join("\n");
}

export function buildEveningCheckin({ planState }) {
  const top = planState.topPriorities || [];
  const lines = ["Evening check-in. Reply done / partial / skipped for:"];
  top.slice(0, 3).forEach((task, index) => {
    lines.push(`${index + 1}. ${task.title}`);
  });
  lines.push("If skipped, add reason: time issue / avoided / blocked / not needed.");
  return lines.join("\n");
}

export async function generateNudge({
  userId,
  tone = "firm",
  now = new Date(),
  dailyCapacityMinutes = 180,
}) {
  const dateKey = isoDate(now);
  const planRow = await getDailyPlan(userId, dateKey);
  const planState =
    planRow?.top_priority_task_ids?.length
      ? await recomputeDailyPlan({ userId, date: now, dailyCapacityMinutes })
      : await recomputeDailyPlan({ userId, date: now, dailyCapacityMinutes });

  const top = planState.topPriorities.filter((task) => !task.done);
  if (top.length === 0) {
    return {
      body: "Strong progress today. Capture one meaningful next step for tomorrow.",
      relatedTaskIds: [],
      reason: "no_open_top_priorities",
    };
  }

  const target = top[0];
  const completedToday = planState.scoredTasks.filter(
    (task) => task.done && task.completedAt && isoDate(task.completedAt) === dateKey
  );
  const completedLowValueOnly =
    completedToday.length > 0 && completedToday.every((task) => Number(task.importance || 0) <= 3);

  if (Number(target.rescheduleCount || 0) >= 2 || Number(target.avoidanceScore || 0) >= 3) {
    return {
      body: `You postponed "${target.title}" multiple times. Start a 20-minute first step now?`,
      relatedTaskIds: [target.id],
      reason: "repeated_postponement",
    };
  }

  if (completedLowValueOnly && Number(target.importance || 0) >= 4) {
    return {
      body: `You cleared admin tasks, but "${target.title}" is still pending. Start a focused block now?`,
      relatedTaskIds: [target.id],
      reason: "drift_to_low_value",
    };
  }

  const sprintMinutes = Math.min(30, Math.max(15, Number(target.estimatedMinutes || 30)));
  return {
    body:
      tone === "ruthless"
        ? `Main priority still pending: "${target.title}". Start ${sprintMinutes} minutes now.`
        : `Your next priority is "${target.title}". Start a ${sprintMinutes}-minute sprint now?`,
    relatedTaskIds: [target.id],
    reason: "next_best_incomplete",
  };
}
