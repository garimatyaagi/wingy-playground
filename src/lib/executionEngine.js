const ACTION_VERBS = [
  "write",
  "draft",
  "send",
  "finalize",
  "finish",
  "build",
  "plan",
  "review",
  "call",
  "book",
  "schedule",
  "prepare",
  "submit",
  "create",
  "update",
  "fix",
  "ship",
  "complete",
  "outline",
  "design",
  "practice",
  "study",
  "renew",
  "pay",
  "record",
  "publish",
];

const NOTE_HINTS = [
  "i think",
  "i feel",
  "i had",
  "remember",
  "journal",
  "story",
  "memory",
  "thinking of",
  "wondering",
  "today i",
  "yesterday",
  "felt like",
];

const EFFORT_MAP = [
  { type: "deep_work", keywords: ["strategy", "deck", "proposal", "design", "code", "analysis", "memo"] },
  { type: "admin", keywords: ["email", "invoice", "follow up", "reply", "submit", "document", "organize"] },
  { type: "call", keywords: ["call", "meeting", "sync", "discuss"] },
  { type: "errand", keywords: ["buy", "pickup", "drop", "visit", "renew", "bank", "passport"] },
  { type: "health", keywords: ["workout", "run", "walk", "yoga", "meal", "sleep"] },
  { type: "learning", keywords: ["study", "course", "learn", "practice", "read"] },
  { type: "relationship", keywords: ["family", "friend", "parents", "partner", "birthday", "message"] },
];

const GOAL_HINTS = [
  { goal: "Career", keywords: ["client", "deck", "proposal", "launch", "product", "business"] },
  { goal: "Health", keywords: ["workout", "run", "sleep", "meal", "health", "yoga"] },
  { goal: "Learning & Growth", keywords: ["study", "course", "learn", "read", "practice"] },
  { goal: "Life Admin", keywords: ["bill", "passport", "renew", "tax", "bank", "home", "insurance"] },
  { goal: "Relationships", keywords: ["family", "friend", "partner", "parents"] },
];

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function asDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function diffDays(a, b) {
  const ms = startOfDay(a).getTime() - startOfDay(b).getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function titleCaseSentence(value) {
  const clean = String(value || "").trim().replace(/\s+/g, " ");
  if (!clean) return "";
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function weekdayToIndex(name) {
  const days = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };
  return days[String(name || "").toLowerCase()] ?? null;
}

function nextWeekday(fromDate, weekdayName) {
  const target = weekdayToIndex(weekdayName);
  if (target == null) return null;
  const from = startOfDay(fromDate);
  const delta = (target - from.getDay() + 7) % 7 || 7;
  return endOfDay(addDays(from, delta));
}

function parseDueDate(text, now = new Date()) {
  const clean = String(text || "").toLowerCase();
  if (clean.includes("today")) return endOfDay(now);
  if (clean.includes("tomorrow")) return endOfDay(addDays(now, 1));
  const weekdayMatch = clean.match(/by\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i);
  if (weekdayMatch) return nextWeekday(now, weekdayMatch[1]);
  if (/(this|end of)\s+week/i.test(clean)) return nextWeekday(now, "friday");
  return null;
}

function inferEffortType(text) {
  const clean = String(text || "").toLowerCase();
  for (const item of EFFORT_MAP) {
    if (item.keywords.some((keyword) => clean.includes(keyword))) return item.type;
  }
  return "deep_work";
}

function inferGoalName(text) {
  const clean = String(text || "").toLowerCase();
  for (const item of GOAL_HINTS) {
    if (item.keywords.some((keyword) => clean.includes(keyword))) return item.goal;
  }
  return "General";
}

function inferRecurrenceRule(text, now = new Date()) {
  const clean = String(text || "").toLowerCase();
  const weeklyMatch = clean.match(/every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i);
  if (weeklyMatch) {
    return {
      frequency: "weekly",
      interval: 1,
      daysOfWeek: [weekdayToIndex(weeklyMatch[1])],
      preferredStart: isoDate(now),
    };
  }
  if (/\b(daily|every day|each day|per day)\b/.test(clean)) {
    return { frequency: "daily", interval: 1, preferredStart: isoDate(now) };
  }
  if (/\b(weekly|every week)\b/.test(clean)) {
    return { frequency: "weekly", interval: 1, daysOfWeek: [now.getDay()], preferredStart: isoDate(now) };
  }
  if (/\b(monthly|every month)\b/.test(clean)) {
    return {
      frequency: "monthly",
      interval: 1,
      dayOfMonth: now.getDate(),
      preferredStart: isoDate(now),
    };
  }
  return null;
}

function estimateDuration(text, effortType) {
  const clean = String(text || "").toLowerCase();
  const explicit = clean.match(/(\d{1,3})\s*(min|mins|minutes|hour|hours|hr|hrs)\b/);
  if (explicit) {
    const amount = Number(explicit[1]);
    if (!Number.isFinite(amount) || amount <= 0) return 30;
    if (explicit[2].startsWith("h")) return Math.min(240, amount * 60);
    return Math.min(240, amount);
  }
  if (effortType === "admin") return 20;
  if (effortType === "call") return 30;
  if (effortType === "errand") return 45;
  if (effortType === "health") return 45;
  if (effortType === "learning") return 35;
  if (effortType === "relationship") return 20;
  if (clean.includes("quick")) return 10;
  if (clean.includes("finalize") || clean.includes("strategy") || clean.includes("deck")) return 90;
  return 45;
}

function likelyTask(text) {
  const clean = String(text || "").toLowerCase();
  if (!clean) return false;
  if (ACTION_VERBS.some((verb) => clean.startsWith(`${verb} `) || clean.includes(` ${verb} `))) return true;
  return /\b(by|before|submit|send|complete|finish|plan|prepare|renew)\b/.test(clean);
}

function likelyNote(text) {
  const clean = String(text || "").toLowerCase();
  if (!clean) return false;
  if (NOTE_HINTS.some((hint) => clean.includes(hint))) return true;
  return clean.length > 160 && !likelyTask(clean);
}

function splitCompoundTask(text) {
  const clean = String(text || "").trim();
  if (!clean) return [];
  return clean
    .split(/\s+(?:and then|then|and|, then)\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function inferUrgency(dueDate, rawText) {
  const clean = String(rawText || "").toLowerCase();
  if (/\b(asap|urgent|immediately|critical)\b/.test(clean)) return 5;
  if (!dueDate) return 2;
  const diffHours = (dueDate.getTime() - Date.now()) / (1000 * 60 * 60);
  if (diffHours <= 24) return 5;
  if (diffHours <= 72) return 4;
  if (diffHours <= 168) return 3;
  return 2;
}

function inferImportance(rawText) {
  const clean = String(rawText || "").toLowerCase();
  if (/\b(strategy|client|launch|proposal|interview|exam|revenue)\b/.test(clean)) return 5;
  if (/\b(team|presentation|review|finance)\b/.test(clean)) return 4;
  if (/\b(clean|organize|admin|routine)\b/.test(clean)) return 2;
  return 3;
}

function inferProofType(rawText) {
  const clean = String(rawText || "").toLowerCase();
  if (/\b(send|sent|email|submit|uploaded|upload|publish|share)\b/.test(clean)) return "link";
  if (/\b(build|design|draft|create|write|deck|document)\b/.test(clean)) return "screenshot";
  if (/\b(call|meeting|workout|run|practice|study)\b/.test(clean)) return "timer";
  return "note";
}

function rewriteActionTitle(text) {
  const clean = titleCaseSentence(text);
  if (!clean) return "";
  const words = clean.split(" ");
  if (words.length >= 2) return clean;
  return `Do ${clean.toLowerCase()}`;
}

function confidenceForTask(title, original) {
  const t = String(title || "").trim();
  const raw = String(original || "").trim();
  if (!t) return 0.2;
  let confidence = 0.58;
  if (likelyTask(raw)) confidence += 0.2;
  if (t.split(" ").length >= 2) confidence += 0.1;
  if (t.length > 75) confidence -= 0.15;
  if (likelyNote(raw)) confidence -= 0.22;
  return Math.max(0.1, Math.min(0.98, confidence));
}

export function normalizeRecurrenceRule(rule) {
  if (!rule || typeof rule !== "object") return null;
  const frequency = ["daily", "weekly", "monthly", "custom"].includes(rule.frequency)
    ? rule.frequency
    : "weekly";
  const interval = Number.isFinite(rule.interval) && rule.interval > 0 ? Math.round(rule.interval) : 1;
  const daysOfWeek = Array.isArray(rule.daysOfWeek)
    ? rule.daysOfWeek.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    : [];
  return {
    frequency,
    interval,
    daysOfWeek,
    dayOfMonth: Number.isFinite(rule.dayOfMonth) ? Math.max(1, Math.min(28, Math.round(rule.dayOfMonth))) : null,
    preferredStart: rule.preferredStart || isoDate(new Date()),
  };
}

export function defaultTaskModel(partial = {}) {
  const nowIso = new Date().toISOString();
  const recurrenceRule = normalizeRecurrenceRule(partial.recurrenceRule);
  const isRecurring =
    Boolean(partial.isRecurring) ||
    partial.type === "recurring" ||
    (recurrenceRule && recurrenceRule.frequency !== "custom");

  return {
    id: partial.id || "",
    title: partial.title || "",
    description: partial.description || "",
    goalId: partial.goalId || null,
    status: partial.status || "active",
    type: isRecurring ? "recurring" : "one_time",
    effortType: partial.effortType || "deep_work",
    isRecurring,
    recurrenceRule: isRecurring ? recurrenceRule || { frequency: "weekly", interval: 1, daysOfWeek: [1] } : null,
    estimatedMinutes: Number.isFinite(partial.estimatedMinutes) ? partial.estimatedMinutes : 30,
    actualMinutes: Number.isFinite(partial.actualMinutes) ? partial.actualMinutes : 0,
    dueDate: partial.dueDate || null,
    scheduledDate: partial.scheduledDate || null,
    scheduledStart: partial.scheduledStart || null,
    scheduledEnd: partial.scheduledEnd || null,
    completionDate: partial.completionDate || partial.completedAt || null,
    priorityScore: Number.isFinite(partial.priorityScore) ? partial.priorityScore : 0,
    urgency: Number.isFinite(partial.urgency) ? partial.urgency : 2,
    importance: Number.isFinite(partial.importance) ? partial.importance : 3,
    avoidanceScore: Number.isFinite(partial.avoidanceScore) ? partial.avoidanceScore : 0,
    rescheduleCount: Number.isFinite(partial.rescheduleCount) ? partial.rescheduleCount : 0,
    proofType: partial.proofType || inferProofType(partial.title),
    proofRequired: Boolean(partial.proofRequired ?? (Number(partial.importance || 0) >= 4)),
    proofNote: partial.proofNote || "",
    proofLink: partial.proofLink || "",
    proofProvidedAt: partial.proofProvidedAt || null,
    commitmentStatus: partial.commitmentStatus || "none",
    commitmentLevel: partial.commitmentLevel || "normal",
    escalationLevel: Number.isFinite(partial.escalationLevel) ? partial.escalationLevel : 0,
    isBlocked: Boolean(partial.isBlocked),
    blockedByTaskId: partial.blockedByTaskId || null,
    aiConfidence: Number.isFinite(partial.aiConfidence) ? partial.aiConfidence : 0.6,
    sourceType: partial.sourceType || "manual",
    isNote: Boolean(partial.isNote),
    suggestedTimeSlot: partial.suggestedTimeSlot || null,
    nextAction: partial.nextAction || "",
    createdAt: partial.createdAt || nowIso,
    updatedAt: partial.updatedAt || nowIso,
    completedAt: partial.completedAt || partial.completionDate || null,
    subtasks: Array.isArray(partial.subtasks) ? partial.subtasks : [],
  };
}

export function defaultTaskOccurrence(partial = {}) {
  return {
    id: partial.id || "",
    parentTaskId: partial.parentTaskId || "",
    date: partial.date || isoDate(new Date()),
    status: partial.status || "pending",
    actualMinutes: Number.isFinite(partial.actualMinutes) ? partial.actualMinutes : 0,
    skipped: Boolean(partial.skipped),
    rescheduledTo: partial.rescheduledTo || null,
    completedAt: partial.completedAt || null,
  };
}

export function occurrenceKey(parentTaskId, dateKey) {
  return `${parentTaskId}:${dateKey}`;
}

export function recurrenceOccursOnDate(task, dateInput) {
  if (!task?.isRecurring || !task?.recurrenceRule) return false;
  const rule = normalizeRecurrenceRule(task.recurrenceRule);
  const date = startOfDay(asDate(dateInput) || new Date(dateInput));
  const start = startOfDay(asDate(rule.preferredStart) || asDate(task.createdAt) || new Date());
  if (date < start) return false;
  const days = diffDays(date, start);
  if (days < 0) return false;

  if (rule.frequency === "daily") {
    return days % rule.interval === 0;
  }
  if (rule.frequency === "weekly") {
    const weekIndex = Math.floor(days / 7);
    if (weekIndex % rule.interval !== 0) return false;
    if (rule.daysOfWeek.length === 0) return date.getDay() === start.getDay();
    return rule.daysOfWeek.includes(date.getDay());
  }
  if (rule.frequency === "monthly") {
    const monthDelta = date.getMonth() - start.getMonth() + 12 * (date.getFullYear() - start.getFullYear());
    if (monthDelta < 0 || monthDelta % rule.interval !== 0) return false;
    const dayOfMonth = rule.dayOfMonth || start.getDate();
    return date.getDate() === Math.min(dayOfMonth, 28);
  }
  return false;
}

export function enrichTaskFromStep(step, goalId, meta = {}) {
  const base = defaultTaskModel({
    id: step.id,
    title: step.text || step.title || meta.title || "",
    description: step.description || meta.description || "",
    goalId,
    status: step.done ? "done" : step.status || meta.status || "active",
    type: step.type || meta.type || "one_time",
    effortType: step.effort_type || meta.effortType || inferEffortType(step.text || ""),
    isRecurring: step.is_recurring ?? meta.isRecurring,
    recurrenceRule: step.recurrence_rule || meta.recurrenceRule || null,
    estimatedMinutes:
      Number.isFinite(step.estimate_minutes) && step.estimate_minutes > 0
        ? step.estimate_minutes
        : Number.isFinite(step.minutes) && step.minutes > 0
          ? step.minutes
          : meta.estimatedMinutes,
    actualMinutes: Number.isFinite(step.actual_minutes) ? step.actual_minutes : meta.actualMinutes,
    dueDate: step.due_date || meta.dueDate || null,
    scheduledDate: step.scheduled_date || meta.scheduledDate || null,
    scheduledStart: step.scheduled_start || meta.scheduledStart || null,
    scheduledEnd: step.scheduled_end || meta.scheduledEnd || null,
    completionDate: step.completion_date || meta.completionDate || null,
    priorityScore: step.priority_score ?? meta.priorityScore,
    urgency: step.urgency ?? meta.urgency,
    importance: step.importance ?? meta.importance,
    avoidanceScore: step.avoidance_score ?? meta.avoidanceScore,
    rescheduleCount: step.reschedule_count ?? meta.rescheduleCount,
    proofType: step.proof_type || meta.proofType || inferProofType(step.text || ""),
    proofRequired: step.proof_required ?? meta.proofRequired,
    proofNote: step.proof_note || meta.proofNote || "",
    proofLink: step.proof_link || meta.proofLink || "",
    proofProvidedAt: step.proof_provided_at || meta.proofProvidedAt || null,
    commitmentStatus: step.commitment_status || meta.commitmentStatus || "none",
    commitmentLevel: step.commitment_level || meta.commitmentLevel || "normal",
    escalationLevel: step.escalation_level ?? meta.escalationLevel,
    isBlocked: step.is_blocked ?? meta.isBlocked,
    blockedByTaskId: step.blocked_by_task_id || meta.blockedByTaskId || null,
    aiConfidence: step.ai_confidence ?? meta.aiConfidence,
    sourceType: step.source_type || meta.sourceType || "manual",
    isNote: step.is_note ?? meta.isNote,
    suggestedTimeSlot: step.suggested_time_slot || meta.suggestedTimeSlot || null,
    nextAction: step.next_action || meta.nextAction || "",
    createdAt: step.created_at || meta.createdAt,
    updatedAt: step.updated_at || meta.updatedAt,
    completedAt: step.completed_at || meta.completedAt || null,
    subtasks: meta.subtasks || [],
  });
  return base;
}

export function taskMetaSnapshot(task) {
  return {
    title: task.title,
    description: task.description,
    status: task.status,
    type: task.type,
    effortType: task.effortType,
    isRecurring: task.isRecurring,
    recurrenceRule: task.recurrenceRule,
    estimatedMinutes: task.estimatedMinutes,
    actualMinutes: task.actualMinutes,
    dueDate: task.dueDate,
    scheduledDate: task.scheduledDate,
    scheduledStart: task.scheduledStart,
    scheduledEnd: task.scheduledEnd,
    completionDate: task.completionDate,
    priorityScore: task.priorityScore,
    urgency: task.urgency,
    importance: task.importance,
    avoidanceScore: task.avoidanceScore,
    rescheduleCount: task.rescheduleCount,
    proofType: task.proofType,
    proofRequired: task.proofRequired,
    proofNote: task.proofNote,
    proofLink: task.proofLink,
    proofProvidedAt: task.proofProvidedAt,
    commitmentStatus: task.commitmentStatus,
    commitmentLevel: task.commitmentLevel,
    escalationLevel: task.escalationLevel,
    isBlocked: task.isBlocked,
    blockedByTaskId: task.blockedByTaskId,
    aiConfidence: task.aiConfidence,
    sourceType: task.sourceType,
    isNote: task.isNote,
    suggestedTimeSlot: task.suggestedTimeSlot,
    nextAction: task.nextAction,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
    subtasks: task.subtasks,
  };
}

export function parseIntakeInput(rawText, now = new Date()) {
  const lines = String(rawText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const preview = [];
  lines.forEach((line, lineIndex) => {
    const wordCount = line.split(/\s+/).length;
    const seemsJournal = likelyNote(line) || (wordCount > 32 && !likelyTask(line));
    if (seemsJournal) {
      preview.push({
        id: `preview-${lineIndex}-${Math.random().toString(16).slice(2, 8)}`,
        source: line,
        kind: "note",
        title: line.length > 120 ? `${line.slice(0, 117)}...` : line,
        description: "Detected as reflective/journal-like text. Saved as note candidate.",
        confidence: 0.92,
      });
      return;
    }

    if (!likelyTask(line) && wordCount < 3) {
      preview.push({
        id: `preview-${lineIndex}-${Math.random().toString(16).slice(2, 8)}`,
        source: line,
        kind: "needs_review",
        title: titleCaseSentence(line),
        description: "Not enough action context. Needs manual clarification.",
        confidence: 0.32,
      });
      return;
    }

    const parts = splitCompoundTask(line);
    const dueDate = parseDueDate(line, now);
    const effortType = inferEffortType(line);
    const goalName = inferGoalName(line);
    const recurrenceRule = inferRecurrenceRule(line, now);
    const isRecurring = Boolean(recurrenceRule);
    const duration = estimateDuration(line, effortType);
    const importance = inferImportance(line);
    const urgency = inferUrgency(dueDate, line);

    parts.forEach((part, index) => {
      const rawPart = part.replace(/\b(by|before)\b.+$/i, "").trim();
      const cleanedTitle = rewriteActionTitle(rawPart);
      const confidence = confidenceForTask(cleanedTitle, line);
      const ambiguous = cleanedTitle.split(" ").length < 2 || cleanedTitle.length > 100;
      const isTask = confidence >= 0.52 && !ambiguous;
      const dependencyIndex = index > 0 ? index - 1 : null;
      preview.push({
        id: `preview-${lineIndex}-${index}-${Math.random().toString(16).slice(2, 8)}`,
        source: line,
        kind: isTask ? "task" : "needs_review",
        title: cleanedTitle || titleCaseSentence(part),
        description: isTask ? "" : "Low confidence. Clarify action + expected outcome before scheduling.",
        goalName,
        effortType,
        dueDate: dueDate ? dueDate.toISOString() : null,
        estimatedMinutes: duration,
        urgency,
        importance,
        proofType: inferProofType(cleanedTitle),
        confidence,
        dependencyIndex,
        isRecurring,
        recurrenceRule,
        taskType: isRecurring ? "recurring" : "one_time",
      });
    });
  });

  return preview;
}

function taskDuePressure(task, date = new Date()) {
  const due = asDate(task.dueDate);
  if (!due) return 0;
  const diffHours = (due.getTime() - date.getTime()) / (1000 * 60 * 60);
  if (diffHours < 0) return 40;
  if (diffHours <= 24) return 30;
  if (diffHours <= 72) return 20;
  if (diffHours <= 168) return 12;
  return 4;
}

function staleBoost(task) {
  const created = asDate(task.createdAt);
  if (!created) return 0;
  const ageDays = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays >= 14) return 10;
  if (ageDays >= 7) return 6;
  return 0;
}

function effortFitScore(task, windows) {
  const estimate = Number.isFinite(task.estimatedMinutes) ? task.estimatedMinutes : 30;
  const bestWindow = windows.reduce((max, window) => Math.max(max, window.durationMinutes), 0);
  if (estimate <= bestWindow) return 7;
  if (estimate <= bestWindow + 20) return 2;
  return -8;
}

function unlockScore(task, tasks) {
  if (!task.id) return 0;
  const blockedCount = tasks.filter((item) => item.blockedByTaskId === task.id && !item.completedAt).length;
  return blockedCount * 10;
}

export function defaultAvailabilityWindows() {
  return [
    { id: "w1", label: "Morning deep block", start: "09:30", end: "11:00", durationMinutes: 90 },
    { id: "w2", label: "Afternoon focus", start: "14:00", end: "15:00", durationMinutes: 60 },
    { id: "w3", label: "Late admin", start: "17:00", end: "17:40", durationMinutes: 40 },
  ];
}

export function getTaskOccurrence(task, dateInput, occurrenceStore = {}) {
  const date = asDate(dateInput);
  if (!date || !task?.isRecurring || !recurrenceOccursOnDate(task, date)) return null;
  const key = occurrenceKey(task.id, isoDate(date));
  if (occurrenceStore[key]) return { ...defaultTaskOccurrence({ parentTaskId: task.id, date: isoDate(date) }), ...occurrenceStore[key] };
  return defaultTaskOccurrence({ id: key, parentTaskId: task.id, date: isoDate(date) });
}

export function getRecurringDueTasks(tasks, dateInput, occurrenceStore = {}) {
  const date = asDate(dateInput) || new Date();
  return tasks
    .filter((task) => task.isRecurring && !task.isNote && task.status !== "archived")
    .map((task) => {
      const occurrence = getTaskOccurrence(task, date, occurrenceStore);
      return occurrence ? { ...task, occurrence } : null;
    })
    .filter(Boolean)
    .filter((task) => {
      const occurrence = task.occurrence;
      if (!occurrence) return false;
      if (occurrence.rescheduledTo && occurrence.rescheduledTo !== isoDate(date)) return false;
      if (occurrence.skipped) return false;
      return occurrence.status !== "done";
    });
}

function slotSupportsTask(window, task) {
  if (task.estimatedMinutes > window.durationMinutes) return false;
  if (task.effortType === "deep_work") return window.durationMinutes >= 45;
  if (task.effortType === "admin" || task.effortType === "relationship") return window.durationMinutes <= 60;
  return true;
}

export function prioritizeTasks(tasks, context = {}) {
  const windows = context.windows || [];
  const date = asDate(context.date) || new Date();
  const highValueDeepWorkExists = tasks.some(
    (task) =>
      !task.completedAt &&
      task.status !== "done" &&
      task.effortType === "deep_work" &&
      Number(task.importance || 0) >= 4
  );
  const recurringDueIds = new Set(
    getRecurringDueTasks(tasks, date, context.occurrenceStore || {}).map((task) => task.id)
  );

  return tasks
    .filter((task) => !task.isNote && task.status !== "done" && task.status !== "archived" && !task.completedAt)
    .map((task) => {
      let score = 0;
      const reasons = [];

      if (task.isRecurring && recurringDueIds.has(task.id)) {
        score += 24;
        reasons.push("recurring task due today");
      }

      const dueScore = taskDuePressure(task, date);
      score += dueScore;
      if (dueScore >= 30) reasons.push("deadline pressure is high");
      if (dueScore >= 40) reasons.push("overdue and needs recovery");

      const urgencyScore = (Number(task.urgency || 0) - 1) * 6;
      const importanceScore = (Number(task.importance || 0) - 1) * 6;
      score += urgencyScore + importanceScore;
      if (importanceScore >= 18) reasons.push("strong strategic value");

      const avoidanceBoost = Number.isFinite(task.avoidanceScore) ? task.avoidanceScore * 1.5 : 0;
      const postponementBoost = Number.isFinite(task.rescheduleCount) ? task.rescheduleCount * 3 : 0;
      score += avoidanceBoost + postponementBoost;
      if (task.rescheduleCount >= 2) reasons.push("postponed repeatedly");
      if (task.avoidanceScore >= 3) reasons.push("showing avoidance pattern");

      if (task.isBlocked) {
        score -= 18;
        reasons.push("currently blocked");
      }

      const unlock = unlockScore(task, tasks);
      score += unlock;
      if (unlock > 0) reasons.push(`unlocks ${Math.round(unlock / 10)} dependent tasks`);

      const fit = effortFitScore(task, windows);
      score += fit;
      if (fit > 0) reasons.push("fits available focus windows");

      const stale = staleBoost(task);
      score += stale;
      if (stale > 0) reasons.push("waiting too long");

      if (task.isRecurring) score += 4;

      if (highValueDeepWorkExists && task.effortType === "admin" && Number(task.importance || 0) <= 3) {
        score -= 8;
        reasons.push("deprioritized to protect deep work");
      }

      const confidencePenalty = task.aiConfidence < 0.45 ? -8 : 0;
      score += confidencePenalty;
      if (confidencePenalty < 0) reasons.push("needs review due to low confidence");

      return {
        ...task,
        priorityScore: Math.round(score),
        why: reasons.slice(0, 2).join(" + ") || "balanced priority",
      };
    })
    .sort((a, b) => b.priorityScore - a.priorityScore);
}

function dateRange(startInput, endInput) {
  const start = startOfDay(asDate(startInput) || new Date());
  const end = startOfDay(asDate(endInput) || start);
  const result = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    result.push(new Date(cursor));
  }
  return result;
}

function totalDailyLoadForDate(dateKey, recurringLoadMap, oneTimeLoadMap) {
  return (recurringLoadMap[dateKey] || 0) + (oneTimeLoadMap[dateKey] || 0);
}

function assignOneTimeTaskToDay(task, candidateDates, capacityMap, oneTimeLoadMap, recurringLoadMap, dailyCapacityMinutes) {
  const estimate = Number.isFinite(task.estimatedMinutes) ? task.estimatedMinutes : 30;
  let bestDateKey = null;
  let bestScore = -Infinity;

  candidateDates.forEach((date) => {
    const key = isoDate(date);
    const remaining = capacityMap[key] || 0;
    const projected = totalDailyLoadForDate(key, recurringLoadMap, oneTimeLoadMap);
    let score = remaining - estimate;
    score -= projected * 0.3;
    if (score < -dailyCapacityMinutes) return;
    if (task.dueDate) {
      const due = asDate(task.dueDate);
      if (due) {
        const daysToDue = diffDays(due, date);
        score -= Math.abs(daysToDue) * 0.2;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestDateKey = key;
    }
  });

  return bestDateKey;
}

export function buildYearlySchedule(tasks, constraints = {}, occurrenceStore = {}, fromDate = new Date()) {
  const start = startOfDay(asDate(fromDate) || new Date());
  const end = new Date(start.getFullYear(), 11, 31);
  const dates = dateRange(start, end);
  const dailyCapacityMinutes = Number.isFinite(constraints.dailyCapacityMinutes)
    ? Math.max(60, constraints.dailyCapacityMinutes)
    : 180;

  const recurringLoadMap = {};
  const oneTimeLoadMap = {};
  const capacityMap = {};
  const taskScheduleById = {};
  const overflowTaskIds = [];

  dates.forEach((date) => {
    const key = isoDate(date);
    const recurringDue = getRecurringDueTasks(tasks, date, occurrenceStore);
    const recurringLoad = recurringDue.reduce(
      (sum, task) => sum + (Number.isFinite(task.estimatedMinutes) ? task.estimatedMinutes : 0),
      0
    );
    recurringLoadMap[key] = recurringLoad;
    oneTimeLoadMap[key] = 0;
    capacityMap[key] = Math.max(0, dailyCapacityMinutes - recurringLoad);
  });

  const oneTimeTasks = tasks
    .filter((task) => !task.isRecurring && !task.isNote && task.status !== "done" && !task.completedAt)
    .sort((a, b) => {
      const dueA = asDate(a.dueDate)?.getTime() || Number.MAX_SAFE_INTEGER;
      const dueB = asDate(b.dueDate)?.getTime() || Number.MAX_SAFE_INTEGER;
      if (dueA !== dueB) return dueA - dueB;
      return (b.priorityScore || 0) - (a.priorityScore || 0);
    });

  oneTimeTasks.forEach((task) => {
    const estimate = Number.isFinite(task.estimatedMinutes) ? task.estimatedMinutes : 30;
    if (task.scheduledDate && capacityMap[task.scheduledDate] >= estimate) {
      taskScheduleById[task.id] = task.scheduledDate;
      capacityMap[task.scheduledDate] -= estimate;
      oneTimeLoadMap[task.scheduledDate] += estimate;
      return;
    }

    const due = asDate(task.dueDate);
    const candidateDates = dates.filter((date) => {
      if (!due) return true;
      return startOfDay(date) <= startOfDay(due);
    });
    const assignedDateKey = assignOneTimeTaskToDay(
      task,
      candidateDates.length > 0 ? candidateDates : dates,
      capacityMap,
      oneTimeLoadMap,
      recurringLoadMap,
      dailyCapacityMinutes
    );

    if (!assignedDateKey) {
      overflowTaskIds.push(task.id);
      return;
    }

    taskScheduleById[task.id] = assignedDateKey;
    capacityMap[assignedDateKey] = Math.max(0, capacityMap[assignedDateKey] - estimate);
    oneTimeLoadMap[assignedDateKey] += estimate;
  });

  return {
    startDate: isoDate(start),
    endDate: isoDate(end),
    dailyCapacityMinutes,
    recurringLoadMap,
    oneTimeLoadMap,
    taskScheduleById,
    overflowTaskIds,
  };
}

export function rebalanceFutureDays(tasks, constraints, occurrenceStore = {}, fromDate = new Date()) {
  return buildYearlySchedule(tasks, constraints, occurrenceStore, fromDate);
}

export function buildDailyPlan(prioritizedTasks, windows = defaultAvailabilityWindows(), options = {}) {
  const date = asDate(options.date) || new Date();
  const dateKey = isoDate(date);
  const occurrenceStore = options.occurrenceStore || {};
  const dailyCapacityMinutes = Number.isFinite(options.dailyCapacityMinutes)
    ? Math.max(60, options.dailyCapacityMinutes)
    : 180;
  const yearSchedule = options.yearSchedule || null;

  const recurringDue = getRecurringDueTasks(prioritizedTasks, date, occurrenceStore)
    .map((task) => ({ ...task, planType: "recurring", why: "recurring obligation due today" }));

  const recurringMinutes = recurringDue.reduce(
    (sum, task) => sum + (Number.isFinite(task.estimatedMinutes) ? task.estimatedMinutes : 0),
    0
  );
  let remainingCapacity = Math.max(0, dailyCapacityMinutes - recurringMinutes);

  const oneTimeCandidates = prioritizedTasks
    .filter((task) => !task.isRecurring)
    .filter((task) => {
      if (task.status === "done" || task.completedAt || task.isNote) return false;
      const scheduled = task.scheduledDate || yearSchedule?.taskScheduleById?.[task.id] || null;
      if (scheduled === dateKey) return true;
      const due = asDate(task.dueDate);
      if (due && diffDays(due, date) <= 2) return true;
      return task.priorityScore >= 42;
    })
    .sort((a, b) => b.priorityScore - a.priorityScore);

  const queue = [...recurringDue, ...oneTimeCandidates];
  const suggestions = [];
  const usedIds = new Set();

  windows.forEach((window) => {
    const candidate = queue.find((task) => {
      if (usedIds.has(task.id)) return false;
      if (!slotSupportsTask(window, task)) return false;
      if (!task.isRecurring && task.estimatedMinutes > remainingCapacity) return false;
      return true;
    });
    if (!candidate) return;
    usedIds.add(candidate.id);
    if (!candidate.isRecurring) {
      remainingCapacity = Math.max(0, remainingCapacity - (candidate.estimatedMinutes || 0));
    }

    const deprioritized = queue
      .filter((task) => task.id !== candidate.id && !usedIds.has(task.id))
      .slice(0, 2)
      .map((task) => task.title);

    suggestions.push({
      id: `${window.id}-${candidate.id}-${dateKey}`,
      taskId: candidate.id,
      goalId: candidate.goalId,
      title: candidate.title,
      estimatedMinutes: candidate.estimatedMinutes,
      timeSlot: `${window.start} - ${window.end}`,
      windowLabel: window.label,
      whyTask: candidate.why || (candidate.isRecurring ? "recurring due today" : "high one-time priority"),
      whyTime:
        window.durationMinutes >= 75
          ? "fits your uninterrupted focus block"
          : "fits this shorter practical window",
      deprioritized,
      effortType: candidate.effortType,
      planType: candidate.isRecurring ? "recurring" : "one_time",
      date: dateKey,
    });
  });

  return {
    suggestions,
    recurringDue,
    recurringMinutes,
    remainingCapacity,
  };
}

function weekStartDate(now = new Date()) {
  const date = startOfDay(now);
  const day = date.getDay();
  return addDays(date, -day);
}

export function computeWeeklyMomentum(tasks, goals, options = {}) {
  const now = asDate(options.date) || new Date();
  const weekStart = weekStartDate(now);
  const occurrenceStore = options.occurrenceStore || {};

  const completedOneTime = tasks.filter((task) => {
    const completion = asDate(task.completedAt || task.completionDate);
    return completion && completion >= weekStart && !task.isRecurring;
  });

  const completedOccurrences = Object.values(occurrenceStore).filter((occ) => {
    if (!occ || occ.status !== "done") return false;
    const completed = asDate(occ.completedAt);
    return completed && completed >= weekStart;
  });

  const completedThisWeek = completedOneTime.length + completedOccurrences.length;

  const deepWorkMinutes = completedOneTime
    .filter((task) => task.effortType === "deep_work")
    .reduce(
      (sum, task) =>
        sum + (Number.isFinite(task.actualMinutes) && task.actualMinutes > 0 ? task.actualMinutes : task.estimatedMinutes || 0),
      0
    );

  const overdue = tasks.filter((task) => {
    if (task.isRecurring || task.completedAt || task.status === "done") return false;
    const due = asDate(task.dueDate);
    return due && due < now;
  }).length;

  const goalsAdvanced = goals.filter((goal) =>
    goal.tasks.some((task) => {
      const done = asDate(task.completedAt || task.completionDate);
      return done && done >= weekStart;
    })
  ).length;

  const activeCount = tasks.filter((task) => task.status !== "done" && !task.isNote).length;
  let insight = "Momentum is steady. Keep one deep-work block protected each day.";
  if (activeCount > 12) {
    insight = `You have ${activeCount} active tasks. Completion drops sharply above 3 active goals. Pause or defer 2 low-impact items.`;
  } else if (overdue > 0) {
    insight = `${overdue} tasks are overdue. Recover one overdue item in your first focus block tomorrow.`;
  } else if (deepWorkMinutes < 180) {
    insight = "Deep-work volume is below target. Add two 45-minute strategy blocks this week.";
  }

  return {
    completedThisWeek,
    overdue,
    deepWorkHours: Math.round((deepWorkMinutes / 60) * 10) / 10,
    goalsAdvanced,
    insight,
  };
}

function countExpectedOccurrences(task, start, end) {
  if (!task.isRecurring) return 0;
  let count = 0;
  for (let cursor = startOfDay(start); cursor <= end; cursor = addDays(cursor, 1)) {
    if (recurrenceOccursOnDate(task, cursor)) count += 1;
  }
  return count;
}

function completedOccurrencesForTask(task, occurrenceStore, start, end) {
  return Object.values(occurrenceStore).filter((occ) => {
    if (!occ || occ.parentTaskId !== task.id || occ.status !== "done") return false;
    const completed = asDate(occ.completedAt);
    return completed && completed >= start && completed <= end;
  }).length;
}

function recurringStreak(tasks, occurrenceStore, untilDate = new Date()) {
  let streak = 0;
  for (let offset = 0; offset < 365; offset += 1) {
    const date = addDays(startOfDay(untilDate), -offset);
    const dueTasks = getRecurringDueTasks(tasks, date, occurrenceStore);
    if (dueTasks.length === 0) continue;
    const allDone = dueTasks.every((task) => task.occurrence?.status === "done");
    if (!allDone) break;
    streak += 1;
  }
  return streak;
}

export function computeYearSnapshot(tasks, goals, occurrenceStore = {}, year = new Date().getFullYear()) {
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31, 23, 59, 59, 999);
  const tasksInYear = tasks.filter((task) => {
    const created = asDate(task.createdAt);
    return !created || created <= end;
  });

  const goalProgress = goals.map((goal) => {
    const goalTasks = goal.tasks || [];
    const oneTime = goalTasks.filter((task) => !task.isRecurring && !task.isNote);
    const oneTimeCompleted = oneTime.filter((task) => task.status === "done" || task.completedAt).length;
    const recurring = goalTasks.filter((task) => task.isRecurring);
    const expected = recurring.reduce((sum, task) => sum + countExpectedOccurrences(task, start, end), 0);
    const completed = recurring.reduce(
      (sum, task) => sum + completedOccurrencesForTask(task, occurrenceStore, start, end),
      0
    );
    const progressPct =
      oneTime.length + expected === 0
        ? 0
        : Math.round(((oneTimeCompleted + completed) / Math.max(1, oneTime.length + expected)) * 100);
    const hours = goalTasks.reduce(
      (sum, task) => sum + ((Number.isFinite(task.actualMinutes) ? task.actualMinutes : 0) / 60),
      0
    );
    return {
      goalId: goal.id,
      goalTitle: goal.title,
      progressPct,
      oneTimeCompleted,
      oneTimeTotal: oneTime.length,
      recurringExpected: expected,
      recurringCompleted: completed,
      hours: Math.round(hours * 10) / 10,
      atRisk: progressPct < 35 && (oneTime.length + expected) >= 4,
    };
  });

  const oneTimeTasks = tasksInYear.filter((task) => !task.isRecurring && !task.isNote);
  const oneTimeCompleted = oneTimeTasks.filter((task) => task.status === "done" || task.completedAt).length;

  const recurringTasks = tasksInYear.filter((task) => task.isRecurring && !task.isNote);
  const recurringExpected = recurringTasks.reduce((sum, task) => sum + countExpectedOccurrences(task, start, end), 0);
  const recurringCompleted = recurringTasks.reduce(
    (sum, task) => sum + completedOccurrencesForTask(task, occurrenceStore, start, end),
    0
  );

  const monthlyCompletions = Array.from({ length: 12 }, () => 0);
  oneTimeTasks.forEach((task) => {
    const done = asDate(task.completedAt || task.completionDate);
    if (!done || done.getFullYear() !== year) return;
    monthlyCompletions[done.getMonth()] += 1;
  });
  Object.values(occurrenceStore).forEach((occ) => {
    if (!occ || occ.status !== "done") return;
    const done = asDate(occ.completedAt);
    if (!done || done.getFullYear() !== year) return;
    monthlyCompletions[done.getMonth()] += 1;
  });

  const totalHoursSpent = tasksInYear.reduce((sum, task) => sum + (Number(task.actualMinutes || 0) / 60), 0);
  const occurrenceHours = Object.values(occurrenceStore).reduce((sum, occ) => sum + (Number(occ.actualMinutes || 0) / 60), 0);

  const completedGoals = goals.filter((goal) => {
    if (goal.status === "completed") return true;
    const summary = goalProgress.find((item) => item.goalId === goal.id);
    return summary ? summary.progressPct >= 100 : false;
  }).length;

  const activeGoals = goals.filter((goal) => goal.status !== "archived" && goal.status !== "completed").length;
  const overdueLoad = tasksInYear.filter((task) => {
    if (task.isRecurring || task.status === "done" || task.completedAt) return false;
    const due = asDate(task.dueDate);
    return due && due < new Date();
  }).length;
  const executionScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        oneTimeTasks.length === 0 && recurringExpected === 0
          ? 0
          : (((oneTimeCompleted + recurringCompleted) / Math.max(1, oneTimeTasks.length + recurringExpected)) * 100 +
              Math.min(20, Math.round((totalHoursSpent + occurrenceHours) / 4))) *
              0.82 -
              overdueLoad * 1.2
      )
    )
  );

  return {
    totalGoals: goals.length,
    activeGoals,
    completedGoals,
    goalProgress,
    oneTimeCompleted,
    oneTimeTotal: oneTimeTasks.length,
    recurringCompletionRate:
      recurringExpected > 0 ? Math.round((recurringCompleted / recurringExpected) * 100) : 0,
    recurringStreak: recurringStreak(recurringTasks, occurrenceStore, new Date()),
    overdueLoad,
    executionScore,
    totalHoursSpent: Math.round((totalHoursSpent + occurrenceHours) * 10) / 10,
    monthlyCompletions,
    atRiskGoals: goalProgress.filter((item) => item.atRisk),
  };
}

function isTaskDone(task) {
  return task.status === "done" || Boolean(task.completedAt) || Boolean(task.completionDate);
}

function startSprintMinutes(task) {
  const estimate = Number(task.estimatedMinutes || 30);
  if (estimate <= 20) return estimate;
  if (estimate <= 45) return 20;
  return 25;
}

export function buildCommandCenter(prioritizedTasks, options = {}) {
  const date = asDate(options.date) || new Date();
  const topPriorities = prioritizedTasks
    .filter((task) => !task.isNote && !isTaskDone(task))
    .slice(0, 3)
    .map((task) => {
      const due = asDate(task.dueDate);
      const daysToDue = due ? diffDays(due, date) : null;
      const dueRisk =
        daysToDue == null
          ? "normal"
          : daysToDue < 0
            ? "overdue"
            : daysToDue <= 1
              ? "high"
              : daysToDue <= 3
                ? "medium"
                : "normal";
      return {
        ...task,
        dueRisk,
        startSprintMinutes: startSprintMinutes(task),
        unlockImpact: unlockScore(task, prioritizedTasks),
      };
    });
  const nextTask = topPriorities[0] || null;
  const whatSuffers = topPriorities
    .slice(1, 3)
    .map((task) => task.title)
    .filter(Boolean);
  return {
    topPriorities,
    nextTask,
    whatSuffers,
  };
}

export function detectProcrastinationSignals(tasks, options = {}) {
  const date = asDate(options.date) || new Date();
  const dailyCapacityMinutes = Number.isFinite(options.dailyCapacityMinutes)
    ? Math.max(60, options.dailyCapacityMinutes)
    : 180;
  const scheduledForDay = tasks.filter((task) => {
    const key = task.scheduledDate ? isoDate(asDate(task.scheduledDate) || new Date(task.scheduledDate)) : null;
    return key === isoDate(date) && !isTaskDone(task);
  });
  const scheduledLoad = scheduledForDay.reduce((sum, task) => sum + Number(task.estimatedMinutes || 0), 0);

  const signals = [];
  const postponed = tasks
    .filter((task) => !isTaskDone(task) && Number(task.rescheduleCount || 0) >= 3)
    .sort((a, b) => (b.rescheduleCount || 0) - (a.rescheduleCount || 0));
  postponed.slice(0, 2).forEach((task) => {
    signals.push({
      id: `postponed-${task.id}`,
      level: "high",
      taskId: task.id,
      title: "Repeated postponement detected",
      message: `"${task.title}" has been postponed ${task.rescheduleCount} times.`,
      action: "Shrink into a 20-minute first step and commit exact start time.",
    });
  });

  const deepPending = tasks.some(
    (task) =>
      !isTaskDone(task) &&
      task.effortType === "deep_work" &&
      Number(task.importance || 0) >= 4 &&
      Number(task.urgency || 0) >= 3
  );
  const adminScheduled = scheduledForDay.filter((task) => task.effortType === "admin").length;
  if (deepPending && adminScheduled >= 3) {
    signals.push({
      id: "admin-shielding",
      level: "medium",
      title: "Admin work is displacing high-value execution",
      message: "You are stacking admin tasks while strategic work is pending.",
      action: "Protect one 45-minute deep-work block before any more admin.",
    });
  }

  if (scheduledLoad > dailyCapacityMinutes + 30) {
    signals.push({
      id: "overbooked",
      level: "high",
      title: "Plan is unrealistic",
      message: `Today is overbooked by ${scheduledLoad - dailyCapacityMinutes} minutes.`,
      action: "Move 1-2 low-impact tasks to later this week now.",
    });
  }

  const avoidance = tasks
    .filter((task) => !isTaskDone(task) && Number(task.avoidanceScore || 0) >= 4)
    .sort((a, b) => (b.avoidanceScore || 0) - (a.avoidanceScore || 0))[0];
  if (avoidance) {
    signals.push({
      id: `avoidance-${avoidance.id}`,
      level: "high",
      taskId: avoidance.id,
      title: "Avoidance pattern detected",
      message: `"${avoidance.title}" shows high avoidance.`,
      action: "Start first 15 minutes now. Do not optimize more before starting.",
    });
  }

  return signals.slice(0, 5);
}

export function buildAccountabilityFeed(tasks, commitments = [], options = {}) {
  const today = asDate(options.date) || new Date();
  const todayKey = isoDate(today);
  const overdue = tasks.filter((task) => {
    if (task.isRecurring || isTaskDone(task)) return false;
    const due = asDate(task.dueDate);
    return due && due < today;
  });

  const feed = [];
  commitments
    .filter((entry) => entry.committedForDate === todayKey)
    .forEach((entry) => {
      const task = tasks.find((item) => item.id === entry.taskId);
      if (!task) return;
      const done = isTaskDone(task);
      feed.push({
        id: `commit-${entry.id}`,
        type: done ? "kept" : "pending",
        taskId: task.id,
        title: task.title,
        message: done
          ? "Commitment kept."
          : `Committed for today (${entry.commitmentLevel}). Not done yet.`,
      });
    });

  overdue.slice(0, 3).forEach((task) => {
    const due = asDate(task.dueDate);
    const daysOver = due ? Math.max(1, Math.abs(diffDays(today, due))) : 1;
    feed.push({
      id: `overdue-${task.id}`,
      type: "overdue",
      taskId: task.id,
      title: task.title,
      message: `Overdue by ${daysOver} day${daysOver === 1 ? "" : "s"}.`,
    });
  });

  tasks
    .filter((task) => !isTaskDone(task) && Number(task.rescheduleCount || 0) >= 2)
    .slice(0, 3)
    .forEach((task) => {
      feed.push({
        id: `rescheduled-${task.id}`,
        type: "rescheduled",
        taskId: task.id,
        title: task.title,
        message: `Auto-rescheduled ${task.rescheduleCount} times.`,
      });
    });

  tasks
    .filter(
      (task) =>
        !isTaskDone(task) &&
        task.proofRequired &&
        (task.commitmentStatus === "committed" || Number(task.importance || 0) >= 4)
    )
    .slice(0, 2)
    .forEach((task) => {
      feed.push({
        id: `proof-${task.id}`,
        type: "proof",
        taskId: task.id,
        title: task.title,
        message: `Proof required on completion (${task.proofType || "note"}).`,
      });
    });

  return feed.slice(0, 10);
}

export function buildReplanProposal(prioritizedTasks, options = {}) {
  const date = asDate(options.date) || new Date();
  const dateKey = isoDate(date);
  const dailyCapacityMinutes = Number.isFinite(options.dailyCapacityMinutes)
    ? Math.max(60, options.dailyCapacityMinutes)
    : 180;
  const commitments = Array.isArray(options.commitments) ? options.commitments : [];
  const scheduleMap = options.scheduleMap || {};

  const todayTasks = prioritizedTasks.filter((task) => {
    if (task.isRecurring || isTaskDone(task)) return false;
    const scheduledKey = task.scheduledDate ? isoDate(asDate(task.scheduledDate) || date) : scheduleMap[task.id];
    return scheduledKey === dateKey;
  });

  const scheduledLoad = todayTasks.reduce((sum, task) => sum + Number(task.estimatedMinutes || 0), 0);
  const overBy = Math.max(0, scheduledLoad - dailyCapacityMinutes);
  const missedCommitted = commitments
    .filter((entry) => entry.committedForDate === dateKey && entry.outcomeStatus !== "kept")
    .map((entry) => prioritizedTasks.find((task) => task.id === entry.taskId))
    .filter(Boolean);

  if (overBy <= 0 && missedCommitted.length === 0) {
    return { needed: false, adjustments: [], summary: "Plan is realistic. No replan needed." };
  }

  const adjustments = [];
  let remainingOver = overBy;
  const moveCandidates = todayTasks
    .filter((task) => Number(task.importance || 0) <= 3)
    .sort((a, b) => (a.priorityScore || 0) - (b.priorityScore || 0));

  moveCandidates.forEach((task) => {
    if (remainingOver <= 0) return;
    adjustments.push({
      taskId: task.id,
      action: "move_to_tomorrow",
      title: task.title,
      reason: "Lower strategic value for today.",
    });
    remainingOver -= Number(task.estimatedMinutes || 0);
  });

  missedCommitted.slice(0, 2).forEach((task) => {
    adjustments.push({
      taskId: task.id,
      action: "reduce_scope",
      title: task.title,
      toMinutes: Math.max(15, Math.min(30, Math.round(Number(task.estimatedMinutes || 30) * 0.5))),
      reason: "Missed commitment. Shrink to recover momentum quickly.",
    });
  });

  const protectedTasks = prioritizedTasks
    .filter((task) => !isTaskDone(task))
    .slice(0, 2)
    .map((task) => ({ taskId: task.id, title: task.title }));

  return {
    needed: true,
    overBy,
    adjustments,
    protectedTasks,
    summary:
      overBy > 0
        ? `Overbooked by ${overBy} minutes. Low-value tasks shifted and missed commitments resized.`
        : "Missed commitments detected. Scope reduced to protect core priorities.",
  };
}

export function computeExecutionMetrics(tasks, commitments = [], options = {}) {
  const date = asDate(options.date) || new Date();
  const weekStart = weekStartDate(date);
  const commitmentsInWeek = commitments.filter((entry) => {
    const committedDate = asDate(entry.committedForDate);
    return committedDate && committedDate >= weekStart && committedDate <= date;
  });
  const promisesKept = commitmentsInWeek.filter((entry) => entry.outcomeStatus === "kept").length;
  const promisesTotal = commitmentsInWeek.length;

  const topPriorityWeek = tasks.filter((task) => {
    if (task.isNote) return false;
    const due = asDate(task.dueDate);
    if (due && due < weekStart) return false;
    return Number(task.importance || 0) >= 4 || Number(task.priorityScore || 0) >= 45;
  });
  const topPriorityCompleted = topPriorityWeek.filter((task) => isTaskDone(task)).length;

  const deepWorkDoneMinutes = tasks
    .filter((task) => task.effortType === "deep_work" && isTaskDone(task))
    .reduce(
      (sum, task) => sum + (Number.isFinite(task.actualMinutes) && task.actualMinutes > 0 ? task.actualMinutes : Number(task.estimatedMinutes || 0)),
      0
    );

  const overdueTotal = tasks.filter((task) => {
    if (task.isRecurring || task.isNote) return false;
    const due = asDate(task.dueDate);
    return due && due < date;
  });
  const overdueRecovered = overdueTotal.filter((task) => isTaskDone(task)).length;

  const procrastinationIncidents = tasks.filter(
    (task) => Number(task.rescheduleCount || 0) >= 3 || Number(task.avoidanceScore || 0) >= 4
  ).length;
  const rescheduleCount = tasks.reduce((sum, task) => sum + Number(task.rescheduleCount || 0), 0);
  const recurringTasks = tasks.filter((task) => task.isRecurring).length;
  const recurringDone = tasks.filter((task) => task.isRecurring && isTaskDone(task)).length;

  const promisesRate = promisesTotal > 0 ? (promisesKept / promisesTotal) * 100 : 0;
  const topRate = topPriorityWeek.length > 0 ? (topPriorityCompleted / topPriorityWeek.length) * 100 : 0;
  const overdueRecoveryRate = overdueTotal.length > 0 ? (overdueRecovered / overdueTotal.length) * 100 : 100;
  const recurringConsistency = recurringTasks > 0 ? (recurringDone / recurringTasks) * 100 : 100;
  const planRealism = Math.max(0, 100 - procrastinationIncidents * 7 - Math.max(0, rescheduleCount - 3) * 2);
  const executionScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(promisesRate * 0.28 + topRate * 0.27 + overdueRecoveryRate * 0.18 + recurringConsistency * 0.12 + planRealism * 0.15)
    )
  );

  return {
    promisesKept,
    promisesTotal,
    promisesRate: Math.round(promisesRate),
    topPriorityCompletionRate: Math.round(topRate),
    deepWorkHours: Math.round((deepWorkDoneMinutes / 60) * 10) / 10,
    overdueRecoveryRate: Math.round(overdueRecoveryRate),
    procrastinationIncidents,
    rescheduleCount,
    recurringConsistency: Math.round(recurringConsistency),
    planRealism: Math.round(planRealism),
    executionScore,
  };
}

export function formatFriendlyDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(date);
}
