import {
  getDailyPlan,
  listOpenTasks,
  logTaskEvent,
  saveDailyPlan,
  fetchRecentContext,
  updateTaskStep,
  listActiveLongTermGoals,
  listMilestonesForGoal,
  createTaskStep,
  countGoalTaskCompletions,
  getGoalDailyTasks,
  getCoreMemory,
  listTaskOccurrences,
  getMultiDayProgress,
  createLongTermGoal,
  createGoalMilestone,
  getSupabaseAdmin,
  saveDailyScorecard,
  getDailyScorecard,
  getRecentScorecards,
  upsertUserInsight,
  getUserInsights,
} from "./_store.js";
import { llmParseMessage, llmDecomposeGoal } from "./_llm.js";
import { buildOptimizedSchedule, formatScheduleForBrief } from "./_optimizer.js";

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
  "need",
  "buy",
  "fix",
  "schedule",
  "meet",
  "hire",
  "launch",
  "setup",
  "set up",
  "start",
  "apply",
  "create",
  "design",
  "research",
  "reach out",
  "follow up",
  "check",
  "pick up",
  "clean",
  "organize",
  "file",
  "sign",
  "register",
  "cancel",
  "return",
  "ship",
  "deliver",
  "cook",
  "order",
  "build",
  "test",
  "migrate",
  "deploy",
  "push",
  "upload",
  "download",
  "share",
  "post",
  "announce",
  "confirm",
  "negotiate",
  "pitch",
  "present",
  "practice",
  "meditate",
  "stretch",
  "run",
  "walk",
  "swim",
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

function safeParseRecurrence(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return null; }
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
  // Books: return daily session time (not total)
  if (/\bread\b.*\b(book|chapter|pages?)\b/.test(lower) || /\bread\s+[A-Z]/.test(text)) return 45;
  // Multi-day project work: return daily session
  if (/\b(build|write|create|design)\s+(a\s+)?(website|app|landing|blog|thesis|course)\b/.test(lower)) return 90;
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
  if (/\b(strategy|client|investor|proposal|deck|launch|pitch|hire|negotiate|revenue|funding)\b/.test(lower)) return 5;
  if (/\b(passport|tax|dentist|health|exam|deadline|urgent|critical|interview|onboarding|contract)\b/.test(lower)) return 4;
  if (/\b(influencer|marketing|sales|partnership|outreach|meeting|presentation|demo)\b/.test(lower)) return 4;
  if (/\b(admin|organize|cleanup|tidy|sort)\b/.test(lower)) return 2;
  if (/\b(groceries|laundry|dishes)\b/.test(lower)) return 1;
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

  // Detect explicit task prefix
  const explicitTaskPrefix = /^add\s+task\s*[:!-]\s*/i.test(text);

  // Past tense = informational update, not a task
  const pastTenseUpdate = /^i\s+(have\s+)?(already\s+)?(sent|done|finished|completed|called|emailed|submitted|paid|booked|bought|fixed|cleaned|organized|filed|scheduled|met|hired|launched|created|designed|researched)\b/i.test(text)
    || /\b(is|are|was)\s+(completed|done|finished)\b/i.test(text);
  if (pastTenseUpdate && !explicitTaskPrefix) {
    // Check if it matches an open task → complete_task, else informational_update
    return {
      intent: "informational_update",
      confidence: 0.8,
      noteText: text,
      tasks: [],
    };
  }

  const looksLikeTask = explicitTaskPrefix || /^(i\s+)?(need|have|got|want|gotta|must|should)\s+(to\s+)?/i.test(text);
  if (!isLikelyActionable(text) && !looksLikeTask) {
    return {
      intent: "ambiguous",
      confidence: 0.35,
      clarificationQuestion: "What would you like me to do with this? Reply with a task like 'Finish pitch deck by Friday'.",
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

// ─── LLM-powered parse with regex fallback ───

export async function parseMessageIntentWithLLM(rawText, userId, now = new Date()) {
  try {
    const [contextRaw, openTasks] = await Promise.all([
      fetchRecentContext(userId, 15),
      listOpenTasks(userId),
    ]);

    // Merge and format context for the LLM — interleave user messages and agent replies
    const contextMessages = [
      ...(contextRaw.recentCaptures || []).map((c) => ({
        direction: "user",
        text: c.raw_text || "",
        intent: c.parsed_intent || "",
        clarification: c.clarification_requested || false,
      })),
      ...(contextRaw.recentMessages || []).map((m) => ({
        direction: "agent",
        text: m.body || "",
        type: m.type || "",
      })),
    ].sort((a, b) => {
      const aDate = a.created_at || a.sent_at || "";
      const bDate = b.created_at || b.sent_at || "";
      return aDate < bDate ? 1 : -1; // newest first
    });

    const llmResult = await llmParseMessage(rawText, contextMessages, openTasks, userId);
    if (llmResult?._skip) {
      const regexResult = parseMessageIntent(rawText, now);
      regexResult.parseMethod = "regex_fallback";
      regexResult._llmError = llmResult._skip;
      // Wrap single-intent regex result in actions array
      return wrapSingleIntentAsActions(regexResult);
    }

    // New multi-intent format: LLM returns { actions: [...], confidence, followUpQuestion }
    if (llmResult?.actions && Array.isArray(llmResult.actions) && llmResult.actions.length > 0) {
      const confidence = llmResult.confidence || 0.85;
      const actions = llmResult.actions.map((a) => mapLlmAction(a, rawText, confidence));
      return { actions, confidence, parseMethod: "llm", followUpQuestion: llmResult.followUpQuestion || "" };
    }

    // Backward compat: old single-intent format (if LLM returns it)
    if (llmResult?.intent) {
      const mapped = mapLlmAction(llmResult, rawText, llmResult.confidence || 0.85);
      return { actions: [mapped], confidence: llmResult.confidence || 0.85, parseMethod: "llm", followUpQuestion: llmResult.followUpQuestion || "" };
    }
  } catch (err) {
    console.error("parseMessageIntentWithLLM error, falling back to regex:", err.message);
    const regexResult = parseMessageIntent(rawText, now);
    regexResult.parseMethod = "regex_fallback";
    regexResult._llmError = err.message;
    return wrapSingleIntentAsActions(regexResult);
  }

  // Fallback to regex-based parser (LLM returned null)
  const regexResult = parseMessageIntent(rawText, now);
  regexResult.parseMethod = "regex_fallback";
  regexResult._llmError = "llm_returned_null";
  return wrapSingleIntentAsActions(regexResult);
}

// Convert a single LLM action object into normalized internal format
function mapLlmAction(a, rawText, confidence) {
  const result = {
    intent: a.intent,
    confidence,
  };

  if (a.intent === "create_task" || a.intent === "create_recurring_task") {
    const title = a.taskTitle || a.title || rawText;
    result.tasks = [{
      title,
      normalizedTitle: title.toLowerCase().trim(),
      rawSourceText: rawText,
      dueDate: a.dueDate || null,
      isRecurring: a.isRecurring || false,
      recurrenceRule: a.recurrenceRule ? safeParseRecurrence(a.recurrenceRule) : null,
      estimatedMinutes: a.estimatedMinutes || 30,
      urgency: a.urgency || 3,
      importance: a.importance || 3,
      effortType: a.effortType || "deep_work",
      source: "whatsapp",
      aiConfidence: confidence,
      goalName: a.goalName || "General",
      status: "open",
      totalEstimatedMinutes: a.totalEstimatedMinutes || a.estimatedMinutes || 30,
      dailyAllocatedMinutes: a.dailyAllocatedMinutes || a.estimatedMinutes || 30,
      estimatedDays: a.estimatedDays || 1,
      estimationReasoning: a.estimationReasoning || "",
    }];
  }
  if (a.intent === "complete_task") {
    result.completionTarget = a.completionTarget || rawText;
  }
  if (a.intent === "reschedule_task") {
    result.completionTarget = a.completionTarget || rawText;
    result.rescheduleDays = a.rescheduleDays || 1;
  }
  if (a.intent === "archive_task" || a.intent === "cancel_task") {
    result.completionTarget = a.completionTarget || rawText;
  }
  if (a.intent === "informational_update" || a.intent === "note") {
    result.noteText = a.noteText || rawText;
  }
  if (a.intent === "goal") {
    result.goalTitle = a.goalTitle || rawText;
  }
  if (a.intent === "ambiguous") {
    result.clarificationQuestion = a.followUpQuestion || "Could you be more specific?";
  }
  if (a.intent === "pause_bot") {
    result.pauseDurationMinutes = a.pauseDurationMinutes || 60;
  }
  if (a.intent === "resume_bot") {
    // no extra fields needed
  }

  return result;
}

// Wrap old single-intent regex result into the new actions-array format
function wrapSingleIntentAsActions(regexResult) {
  const action = { ...regexResult };
  return {
    actions: [action],
    confidence: regexResult.confidence || 0.5,
    parseMethod: regexResult.parseMethod || "regex_fallback",
    _llmError: regexResult._llmError,
    followUpQuestion: regexResult.clarificationQuestion || "",
  };
}

// ─── Context Bundle Builder (Phase 2A) ───

export async function buildMessageContext(userId, now = new Date()) {
  const dateKey = isoDate(now);
  const [openTasks, recentContext, existingPlan] = await Promise.all([
    listOpenTasks(userId),
    fetchRecentContext(userId, 15),
    getDailyPlan(userId, dateKey),
  ]);

  const activeTasks = openTasks.filter((t) => !t.done && t.status !== "completed" && t.status !== "archived");
  const overdueTasks = activeTasks.filter((t) => t.dueDate && asDate(t.dueDate)?.getTime() < now.getTime() && isoDate(t.dueDate) !== dateKey);
  const dueTodayTasks = activeTasks.filter((t) => t.dueDate && isoDate(t.dueDate) === dateKey);
  const recurringDueToday = activeTasks.filter((t) => t.isRecurring && recurrenceOccursOnDate(t, now));

  // Find last nudged task from recent agent_messages
  const recentMessages = recentContext?.recentMessages || recentContext || [];
  let lastNudgedTaskId = null;
  for (const msg of (Array.isArray(recentMessages) ? recentMessages : [])) {
    const ids = msg.related_task_ids || msg.relatedTaskIds || [];
    if ((msg.type === "nudge" || msg.type === "follow_up") && ids.length > 0) {
      lastNudgedTaskId = ids[0];
      break;
    }
  }

  // Recent completions (last 24h)
  const oneDayAgo = new Date(now.getTime() - 86400000).toISOString();
  const recentCompletions = openTasks.filter((t) => t.done && t.completedAt && t.completedAt > oneDayAgo);

  // Build preferred task IDs
  const preferredTaskIds = [];
  const pushUnique = (id) => { if (id && !preferredTaskIds.includes(id)) preferredTaskIds.push(id); };
  if (lastNudgedTaskId) pushUnique(lastNudgedTaskId);
  if (existingPlan?.next_best_task_id) pushUnique(existingPlan.next_best_task_id);
  (existingPlan?.top_priority_task_ids || []).forEach(pushUnique);
  for (const msg of (Array.isArray(recentMessages) ? recentMessages : [])) {
    (msg.related_task_ids || msg.relatedTaskIds || []).forEach(pushUnique);
  }

  return {
    openTasks: activeTasks,
    allOpenTasks: openTasks,
    overdueTasks,
    dueTodayTasks,
    recurringDueToday,
    lastNudgedTaskId,
    recentCompletions,
    recentContext,
    recentMessages,
    existingPlan,
    preferredTaskIds,
    dateKey,
  };
}

// ─── Avoidance Score (Phase 2E) ───

export function computeAvoidanceScore(task) {
  let score = 0;
  const rescheduleCount = Number(task.rescheduleCount || 0);
  score += Math.min(6, rescheduleCount * 1.5);

  const createdAt = asDate(task.createdAt);
  if (createdAt) {
    const ageDays = Math.floor((Date.now() - createdAt.getTime()) / 86400000);
    if (ageDays > 14) score += 1.5;
    else if (ageDays > 7) score += 0.8;
    else if (ageDays > 3) score += 0.4;
  }

  if (task.effortType === "deep_work" && Number(task.importance || 0) >= 4) {
    score += 1.0;
  }

  return Math.min(10, score);
}

// ─── Behavior Pattern Detection (Phase 3A) ───

export function detectBehaviorPatterns(planState, recentContext, dateKey) {
  const patterns = [];
  const top = planState?.topPriorities || [];
  const scored = planState?.scoredTasks || [];

  const completedToday = scored.filter(
    (t) => t.done && t.completedAt && isoDate(t.completedAt) === dateKey
  );

  // Repeated postponement
  for (const task of top) {
    if (Number(task.rescheduleCount || 0) >= 3) {
      patterns.push({ type: "repeated_postponement", taskId: task.id, taskTitle: task.title, rescheduleCount: task.rescheduleCount });
    }
  }

  // Admin drift: completed low-importance while high-importance undone
  const highUndone = top.filter((t) => !t.done && Number(t.importance || 0) >= 4);
  const completedLowOnly = completedToday.length > 0 && completedToday.every((t) => Number(t.importance || 0) <= 3);
  if (completedLowOnly && highUndone.length > 0) {
    patterns.push({ type: "admin_drift", completedLowCount: completedToday.length, highUndoneCount: highUndone.length });
  }

  // Deep work avoidance: deep_work tasks rescheduled while admin completed
  const deepWorkRescheduled = scored.filter((t) => t.effortType === "deep_work" && Number(t.rescheduleCount || 0) >= 2 && !t.done);
  const adminCompleted = completedToday.filter((t) => t.effortType === "admin");
  if (deepWorkRescheduled.length > 0 && adminCompleted.length > 0) {
    patterns.push({ type: "deep_work_avoidance", avoidedCount: deepWorkRescheduled.length, adminDoneCount: adminCompleted.length });
  }

  // Ignored nudges: recent nudge messages with no completion response within recent context
  const recentMessages = Array.isArray(recentContext) ? recentContext : (recentContext?.recentMessages || []);
  const nudges = recentMessages.filter((m) => m.type === "nudge" || m.type === "follow_up");
  const completions = recentMessages.filter((m) => m.type === "ack" && (m.metadata?.result === "task_completed" || String(m.body || "").includes("done")));
  if (nudges.length >= 2 && completions.length === 0) {
    patterns.push({ type: "ignored_nudges", nudgeCount: nudges.length });
  }

  const severity = patterns.length === 0 ? "none" : patterns.length >= 3 ? "high" : patterns.length >= 2 ? "medium" : "low";
  return { patterns, primaryPattern: patterns[0]?.type || null, severity };
}

function compareScores(a, b) {
  return Number(b.score || 0) - Number(a.score || 0);
}

export function resolveTaskMatch({
  targetText,
  openTasks,
  preferredTaskIds = [],
  lastNudgedTaskId = null,
}) {
  const tasks = (openTasks || []).filter((task) => !task.done && task.status !== "completed");
  if (tasks.length === 0) {
    return { status: "not_found", reason: "no_open_tasks" };
  }

  const normalizedTarget = cleanText(targetText).toLowerCase();

  // Bare "done" / pronoun → ordered resolution: nudged → preferred → first open
  if (!normalizedTarget || /^(it|this|that|done|finished|completed)?\s*$/.test(normalizedTarget)) {
    if (lastNudgedTaskId) {
      const nudged = tasks.find((task) => task.id === lastNudgedTaskId);
      if (nudged) return { status: "matched", task: nudged, score: 0.85, strategy: "nudged_task" };
    }
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

      // Exact / substring match bonuses
      if (title === normalizedTarget) score += 0.8;
      else if (title.includes(normalizedTarget)) score += 0.5;
      if (normalizedTarget.includes(title)) score += 0.25;

      // Preferred task bonus
      if (preferredTaskIds.includes(task.id)) score += 0.25;

      // Nudged task gets strong bonus
      if (task.id === lastNudgedTaskId) score += 0.3;

      // Recency weighting
      const createdAt = asDate(task.createdAt);
      if (createdAt) {
        const ageHours = (Date.now() - createdAt.getTime()) / 3600000;
        if (ageHours < 24) score += 0.15;
        else if (ageHours < 168) score += 0.08;
      }

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
  return { status: "matched", task: top.task, score: top.score, strategy: top.task.id === lastNudgedTaskId ? "nudged_fuzzy" : "fuzzy" };
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
  calendarEvents = [],
  profile = {},
}) {
  const targetDate = asDate(date) || new Date();
  const dateKey = toDateKey(targetDate);

  // Generate goal-derived tasks FIRST so they're included in scoring + optimizer
  let goalTasks = [];
  try {
    const goalResult = await generateGoalDailyTasks({ userId, date: targetDate });
    goalTasks = goalResult.generated || goalResult.existing || [];
  } catch (e) {
    console.error("generateGoalDailyTasks in recomputeDailyPlan failed", e.message);
  }

  // Fetch open tasks (now includes any newly-created goal tasks)
  const openTasks = await listOpenTasks(userId);
  const tasks = openTasks.filter((task) => !task.done && task.status !== "completed");

  const recurringDue = tasks.filter((task) => recurrenceOccursOnDate(task, targetDate));
  const oneTimeOpen = tasks.filter((task) => !task.isRecurring);

  // Fetch multi-day progress for tasks that span multiple days
  const multiDayTasks = tasks.filter((t) => Number(t.estimatedDays || 0) > 1);
  const progressMap = new Map();
  for (const t of multiDayTasks) {
    try {
      const occurrences = await listTaskOccurrences(t.id, userId);
      progressMap.set(t.id, getMultiDayProgress(t, occurrences));
    } catch { /* ignore */ }
  }

  const scored = tasks
    .map((task) => {
      const isOverdue = Boolean(task.dueDate && asDate(task.dueDate)?.getTime() < targetDate.getTime());
      const isDueToday = Boolean(task.dueDate && isoDate(task.dueDate) === dateKey);
      const recurringDueToday = task.isRecurring && recurrenceOccursOnDate(task, targetDate);
      const avoidance = computeAvoidanceScore(task);
      const multiDayProgress = progressMap.get(task.id) || null;

      // Use daily allocation for capacity fitting on multi-day tasks
      const effectiveMinutes = multiDayProgress?.isMultiDay
        ? multiDayProgress.todayAllocatedMinutes
        : Number(task.estimatedMinutes || 30);

      // Boost priority for multi-day tasks with incomplete sessions
      const multiDayBoost = multiDayProgress?.isMultiDay && multiDayProgress.completedSessions < multiDayProgress.totalSessions ? 8 : 0;

      const score =
        taskDuePressure(task, targetDate) +
        Number(task.importance || 3) * 10 +
        Number(task.urgency || 2) * 8 +
        (isOverdue ? 24 : 0) +
        (isDueToday ? 16 : 0) +
        (recurringDueToday ? 20 : 0) +
        unlockValue(task, tasks) +
        Math.min(18, Number(task.rescheduleCount || 0) * 3) +
        Math.min(12, avoidance * 2) +
        (task.isBlocked ? -28 : 0) +
        estimateEffortFit({ ...task, estimatedMinutes: effectiveMinutes }, dailyCapacityMinutes) +
        multiDayBoost;
      return {
        ...task,
        priorityScore: Math.round(score),
        avoidanceScore: Math.round(avoidance * 10) / 10,
        recurringDueToday,
        isDueToday,
        isOverdue,
        multiDayProgress,
        effectiveMinutes,
      };
    })
    .sort((a, b) => Number(b.priorityScore || 0) - Number(a.priorityScore || 0));

  // Smart replanning (Phase 3B):
  // 1. Scope reduction: avoided tasks with high estimates get halved
  for (const task of scored) {
    if (task.avoidanceScore >= 5 && Number(task.estimatedMinutes || 0) > 30) {
      task.estimatedMinutes = Math.max(15, Math.round(Number(task.estimatedMinutes) / 2));
    }
  }

  // 2. Always include recurring-due-today in top priorities
  const recurringMustDo = scored.filter((t) => t.recurringDueToday);

  const topPriorities = [];
  let usedMinutes = 0;

  // First: add recurring-due-today
  for (const task of recurringMustDo) {
    if (topPriorities.length >= 5) break;
    topPriorities.push(task);
    usedMinutes += Math.max(10, Number(task.estimatedMinutes || 30));
  }

  // Then: fill remaining slots from scored
  for (const task of scored) {
    if (topPriorities.length >= 3 + recurringMustDo.length) break;
    if (topPriorities.some((t) => t.id === task.id)) continue;
    const estimate = Math.max(10, task.effectiveMinutes || Number(task.estimatedMinutes || 30));
    // 3. Overload protection: if must-do > 1.5x capacity, defer low-importance non-overdue
    if (topPriorities.length > 0 && usedMinutes + estimate > dailyCapacityMinutes * 1.5) {
      if (!task.isOverdue && Number(task.importance || 0) < 4) continue;
    }
    if (topPriorities.length > 0 && usedMinutes + estimate > dailyCapacityMinutes + 20) continue;
    topPriorities.push(task);
    usedMinutes += estimate;
  }
  if (topPriorities.length === 0) {
    topPriorities.push(...scored.slice(0, 3));
  }

  // Write avoidance scores to top priority tasks
  for (const task of topPriorities) {
    if (task.avoidanceScore > 0) {
      updateTaskStep(task.id, task.goalId || task.task_id, { ...task, avoidanceScore: task.avoidanceScore }).catch(() => {});
    }
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
    }, userId);
  }

  // ─── Calendar-Aware Time-Block Optimization ───
  let optimizedSchedule = null;
  try {
    optimizedSchedule = buildOptimizedSchedule({
      scoredTasks: scored,
      topPriorities,
      calendarEvents,
      profile,
      dateKey,
    });
  } catch (err) {
    console.error("buildOptimizedSchedule failed, proceeding without schedule:", err.message);
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
    goalTasks,
    optimizedSchedule,
  };
}

// ─── Rich Response Builder ───

export function buildRichResponse(actionsTaken, ctx, calendarEvents = []) {
  if (!actionsTaken || actionsTaken.length === 0) {
    return "Captured.";
  }

  const lines = [];
  const openCount = (ctx?.openTasks || []).length;
  const overdueCount = (ctx?.overdueTasks || []).length;
  const todayCount = (ctx?.dueTodayTasks || []).length;
  const topPriority = ctx?.openTasks?.[0];

  // Compute today's completed count from recent completions
  const completedTodayCount = (ctx?.recentCompletions || []).length;

  for (const action of actionsTaken) {
    if (action.type === "task_created" && action.task) {
      lines.push(`Added: "${action.task.title || action.task.text}"`);
    } else if (action.type === "task_completed" && action.task) {
      lines.push(`Done: "${action.task.title}" \u2713`);
    } else if (action.type === "task_rescheduled" && action.task) {
      const newDate = action.newDate ? ` to ${action.newDate.slice(0, 10)}` : "";
      lines.push(`Rescheduled: "${action.task.title}"${newDate}`);
    } else if (action.type === "task_archived" && action.task) {
      lines.push(`Archived: "${action.task.title}"`);
    } else if (action.type === "task_cancelled" && action.task) {
      lines.push(`Cancelled: "${action.task.title}"`);
    } else if (action.type === "goal_created" && action.goal) {
      lines.push(`Goal captured: "${action.goal.title}"`);
    } else if (action.type === "long_term_goal_created" && action.goal) {
      lines.push(`Long-term goal set: "${action.goal.title}"`);
      if (action.milestones?.length > 0) {
        lines.push(`\nBroken down into ${action.milestones.length} milestones:`);
        for (const m of action.milestones.slice(0, 6)) {
          lines.push(`  ${m.order_index + 1}. ${m.title}`);
        }
      }
      if (action.decomposition?.dailyHabitSuggestion) {
        lines.push(`\nDaily habit: ${action.decomposition.dailyHabitSuggestion}`);
      }
      if (action.decomposition?.weeklyCheckpoint) {
        lines.push(`Weekly check: ${action.decomposition.weeklyCheckpoint}`);
      }
      lines.push(`\nI'll start weaving daily tasks from this goal into your morning plan.`);
    } else if (action.type === "long_term_goal_limit") {
      lines.push(action.message);
    } else if (action.type === "bot_paused") {
      return `Bot paused until ${action.resumeTime}. Send "resume bot" to reactivate.`;
    } else if (action.type === "bot_resumed") {
      return "Bot resumed. I'm back and listening.";
    } else if (action.type === "note_saved") {
      lines.push("Noted.");
    } else if (action.type === "update_noted") {
      lines.push("Got it \u2014 noted.");
    } else if (action.type === "clarification") {
      // Clarification is the whole response
      return action.question || "Which task did you mean?";
    } else if (action.type === "error") {
      return action.message || "I had trouble processing that. Please try again.";
    }
  }

  // Add state context line
  const hasCompletion = actionsTaken.some((a) => a.type === "task_completed");
  const hasCreation = actionsTaken.some((a) => a.type === "task_created");
  const hasNote = actionsTaken.some((a) => a.type === "note_saved" || a.type === "update_noted");

  if (hasCompletion) {
    const totalToday = completedTodayCount + todayCount;
    const progressLine = totalToday > 0
      ? `${completedTodayCount}/${totalToday} done today.`
      : `${completedTodayCount} done today.`;
    const parts = [progressLine];
    if (overdueCount > 0) parts.push(`\u26a0\ufe0f ${overdueCount} overdue.`);
    lines.push(parts.join(" "));
  } else if (hasCreation) {
    const totalMin = (ctx?.openTasks || []).reduce((s, t) => s + (t.estimatedMinutes || 30), 0);
    lines.push(`${openCount} task${openCount === 1 ? "" : "s"} open (${totalMin}m total).`);
  }

  // Next priority line
  if (topPriority && !hasNote) {
    const skipIds = new Set(actionsTaken.filter((a) => a.task?.id).map((a) => a.task.id));
    const nextTask = (ctx?.openTasks || []).find((t) => !skipIds.has(t.id)) || topPriority;
    if (nextTask) {
      lines.push(`Next up: "${nextTask.title}" (${nextTask.estimatedMinutes || 30}m)`);
    }
  }

  // Calendar context (if events available)
  if (calendarEvents.length > 0) {
    const calLine = buildCalendarContextLine(calendarEvents);
    if (calLine) lines.push(calLine);
  }

  return lines.join("\n");
}

function buildCalendarContextLine(events) {
  if (!events || events.length === 0) return null;

  const now = new Date();
  const upcoming = events.filter((e) => {
    if (e.allDay) return false;
    const start = new Date(e.start);
    return start > now;
  });

  if (upcoming.length === 0) return null;

  const next = upcoming[0];
  const startTime = new Date(next.start);
  const minutesUntil = Math.round((startTime - now) / 60000);

  if (minutesUntil <= 0) return null;
  if (minutesUntil <= 15) return `Meeting "${next.summary}" starting soon.`;
  if (minutesUntil <= 60) return `${minutesUntil}min until "${next.summary}" \u2014 good window for a quick sprint.`;
  if (upcoming.length >= 3) return `Busy day with ${upcoming.length} meetings ahead. Focus between them.`;
  return null;
}

// ─── Evening Response Handler ───

export function parseEveningResponse(rawText, topTaskTitles = []) {
  const lower = rawText.toLowerCase().trim();
  const results = [];

  // Try numbered format: "1. done 2. skipped 3. partial"
  const numbered = lower.match(/(\d+)\s*[.):\-]?\s*(done|partial|skipped|not done|completed|finished|avoided|blocked|not needed)/gi);
  if (numbered && numbered.length > 0) {
    for (const match of numbered) {
      const parts = match.match(/(\d+)\s*[.):\-]?\s*(.+)/i);
      if (parts) {
        const idx = parseInt(parts[1], 10) - 1;
        const status = normalizeEveningStatus(parts[2].trim());
        results.push({ index: idx, status, taskTitle: topTaskTitles[idx] || null });
      }
    }
    return results.length > 0 ? results : null;
  }

  // Try single word for all: "done" / "all done" / "skipped"
  if (/^(all\s+)?done\b/.test(lower)) {
    return topTaskTitles.map((title, idx) => ({ index: idx, status: "done", taskTitle: title }));
  }

  return null;
}

function normalizeEveningStatus(text) {
  const lower = text.toLowerCase();
  if (/done|completed|finished/.test(lower)) return "done";
  if (/partial/.test(lower)) return "partial";
  if (/skipped|not done|avoided|blocked|not needed/.test(lower)) return "skipped";
  return "skipped";
}

function formatTaskLine(task) {
  return `${task.title} — ${task.estimatedMinutes || 30} min`;
}

export function buildMorningBrief({ planState, tone = "firm" }) {
  const top = planState.topPriorities || [];
  const recurring = planState.recurringDue || [];
  const overdue = planState.overdue || [];
  const deferred = planState.deferred || [];
  const next = planState.nextBest;
  const schedule = planState.optimizedSchedule;

  const lines = [];
  if (tone === "ruthless") {
    lines.push("No excuses today. Here is what gets done:");
  } else if (tone === "gentle") {
    lines.push("Good morning. Let's make today count.");
  } else {
    lines.push("Morning. Your day is planned.");
  }
  lines.push("");

  if (overdue.length > 0) {
    lines.push(`\u26a0\ufe0f ${overdue.length} overdue task${overdue.length > 1 ? "s" : ""}:`);
    overdue.slice(0, 3).forEach((task) => {
      const postponed = Number(task.rescheduleCount || 0);
      lines.push(`  - ${task.title}${postponed >= 2 ? ` (postponed ${postponed}x)` : ""}`);
    });
    lines.push("");
  }

  // If we have an optimized time-blocked schedule, show it instead of the plain list
  const scheduleBlock = schedule ? formatScheduleForBrief(schedule) : null;

  if (scheduleBlock) {
    lines.push(scheduleBlock);
  } else {
    lines.push("Today's top priorities:");
    if (top.length === 0) {
      lines.push("- Nothing scheduled. Capture tasks by sending them here.");
    }
    top.slice(0, 3).forEach((task, index) => {
      const progress = task.multiDayProgress;
      const est = progress?.isMultiDay ? progress.todayAllocatedMinutes : (task.estimatedMinutes || 30);
      const postponed = Number(task.rescheduleCount || 0);
      let line = `${index + 1}. ${task.title} (${est}m${progress?.isMultiDay ? ` today, ${progress.progressLabel}` : ""})`;
      if (postponed >= 2) line += ` \u2014 you've postponed this ${postponed} times`;
      if (task.avoidanceScore >= 3) line += " \u2014 this one keeps getting skipped";
      lines.push(line);
    });
  }
  lines.push("");

  if (recurring.length > 0) {
    lines.push(`Recurring (${recurring.length}):`);
    recurring.slice(0, 4).forEach((task) => lines.push(`  - ${task.title}`));
    lines.push("");
  }

  const totalMinutes = top.reduce((sum, t) => {
    const progress = t.multiDayProgress;
    return sum + (progress?.isMultiDay ? progress.todayAllocatedMinutes : (t.estimatedMinutes || 30));
  }, 0);
  lines.push(`Total focus needed: ${totalMinutes} minutes.`);

  if (tone === "ruthless") {
    lines.push("Start with #1 before anything else.");
  } else if (tone === "gentle") {
    lines.push("Maybe start with #1? Even just 25 minutes.");
  } else {
    lines.push("Start with the hardest one. Reply 'done' when you're through it.");
  }

  if (deferred.length > 0) {
    lines.push(`\n${deferred.length} deferred task${deferred.length > 1 ? "s" : ""} waiting for attention.`);
  }
  return lines.join("\n");
}

export function buildEveningCheckin({ planState }) {
  const top = planState.topPriorities || [];
  const overdue = planState.overdue || [];
  const lines = ["Evening check-in. How did today go?", ""];
  lines.push("Reply done / partial / skipped for each:");
  top.slice(0, 3).forEach((task, index) => {
    const postponed = Number(task.rescheduleCount || 0);
    const progress = task.multiDayProgress;
    let line = `${index + 1}. ${task.title}`;
    if (progress?.isMultiDay) line += ` (${progress.progressLabel})`;
    if (postponed >= 2) line += ` (postponed ${postponed}x already)`;
    lines.push(line);
  });
  lines.push("");
  if (overdue.length > 0) {
    lines.push(`You still have ${overdue.length} overdue task${overdue.length > 1 ? "s" : ""}. Should I reschedule or archive any?`);
  }
  lines.push("If skipped: time issue / avoided / blocked / not needed.");
  lines.push("What's the #1 thing for tomorrow?");
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
      body: "You're all caught up today. Got anything you want to add for tomorrow?",
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
      body: `"${target.title}" keeps getting pushed. Want to just do 10 minutes on it and see how it goes?`,
      relatedTaskIds: [target.id],
      reason: "repeated_postponement",
    };
  }

  if (completedLowValueOnly && Number(target.importance || 0) >= 4) {
    return {
      body: `Nice work on the small stuff. "${target.title}" is still there though — got time for it?`,
      relatedTaskIds: [target.id],
      reason: "drift_to_low_value",
    };
  }

  const progress = target.multiDayProgress;
  const effectiveMinutes = progress?.isMultiDay ? progress.todayAllocatedMinutes : Number(target.estimatedMinutes || 30);
  const sprintMinutes = Math.min(30, Math.max(15, effectiveMinutes));
  const openCount = top.length;
  const totalLeft = top.reduce((s, t) => {
    const p = t.multiDayProgress;
    return s + (p?.isMultiDay ? p.todayAllocatedMinutes : (t.estimatedMinutes || 30));
  }, 0);

  const progressNote = progress?.isMultiDay ? ` (${progress.progressLabel})` : "";

  if (tone === "ruthless") {
    return {
      body: `"${target.title}"${progressNote} — still not done. ${openCount} things left, about ${totalLeft}m total. ${sprintMinutes} minutes, let's go.`,
      relatedTaskIds: [target.id],
      reason: "next_best_incomplete",
    };
  }
  return {
    body: `Next up: "${target.title}"${progressNote}, about ${sprintMinutes}m. ${openCount - 1} more after that.`,
    relatedTaskIds: [target.id],
    reason: "next_best_incomplete",
  };
}

// ─── Long-Term Goal Auto-Sync & Decomposition ───

const SKIP_GOAL_TITLES = new Set([
  "inbox / unassigned", "general", "inbox", "unassigned",
]);

async function ensureGoalsDecomposed(userId) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !userId) return;

  // 1. Get all goals from the old tasks table
  const { data: oldGoals, error: oldErr } = await supabase
    .from("tasks")
    .select("id, title, status, created_at")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (oldErr || !oldGoals?.length) return;

  // 2. Get existing long-term goals
  const ltGoals = await listActiveLongTermGoals(userId);
  const ltTitles = new Set(ltGoals.map((g) => g.title.toLowerCase().trim()));

  // 3. Sync: create long_term_goals entries for old goals that don't have one
  const newlyCreated = [];
  for (const og of oldGoals) {
    const titleLower = (og.title || "").toLowerCase().trim();
    if (SKIP_GOAL_TITLES.has(titleLower)) continue;
    if (ltTitles.has(titleLower)) continue;
    if (ltGoals.length + newlyCreated.length >= 5) break;

    const priority = (ltGoals.length + newlyCreated.length) === 0 ? 1 : 2;
    const created = await createLongTermGoal(userId, {
      title: og.title,
      description: "",
      scope: "yearly",
      priority,
    });
    if (created) newlyCreated.push(created);
  }

  // 4. Decompose any long-term goals that have zero milestones
  const allLtGoals = [...ltGoals, ...newlyCreated];
  for (const goal of allLtGoals) {
    const milestones = await listMilestonesForGoal(goal.id, userId);
    if (milestones.length > 0) continue;

    const decomposition = await llmDecomposeGoal(goal.title, goal.description || "", goal.target_date, userId);
    if (!decomposition?.milestones) continue;

    for (let i = 0; i < decomposition.milestones.length; i++) {
      const m = decomposition.milestones[i];
      await createGoalMilestone(goal.id, userId, {
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
}

// ─── Long-Term Goal Daily Task Generation ───

function shouldGenerateForGoalToday(goal, dayOfWeek) {
  // Priority 1: daily, Priority 2: Mon/Wed/Fri, Priority 3: Monday only
  if (goal.priority === 1) return true;
  if (goal.priority === 2) return [1, 3, 5].includes(dayOfWeek); // Mon, Wed, Fri
  if (goal.priority === 3) return dayOfWeek === 1; // Monday
  return false;
}

export async function generateGoalDailyTasks({ userId, date = new Date() }) {
  const targetDate = typeof date === "string" ? new Date(date) : date;
  const dateKey = targetDate.toISOString().split("T")[0];
  const dayOfWeek = targetDate.getDay(); // 0=Sun, 1=Mon...

  // Check if we already generated goal tasks for today
  const existing = await getGoalDailyTasks(userId, dateKey);
  if (existing.length > 0) {
    return { generated: [], existing, skipped: "already_generated" };
  }

  // Auto-sync old goals and decompose any that are missing milestones
  try {
    await ensureGoalsDecomposed(userId);
  } catch (e) {
    console.error("ensureGoalsDecomposed failed (non-blocking)", e.message);
  }

  const goals = await listActiveLongTermGoals(userId);
  if (goals.length === 0) return { generated: [], existing: [], skipped: "no_active_goals" };

  // Fetch core memory for implementation intentions
  let routineHint = "";
  try {
    const memories = await getCoreMemory(userId);
    const routineMemory = memories.find((m) =>
      /routine|morning|habit|exercise|schedule|wake/i.test(m.key)
    );
    if (routineMemory) routineHint = routineMemory.value;
  } catch { /* ignore */ }

  const generated = [];
  const MAX_GOAL_TASKS_PER_DAY = 3;

  for (const goal of goals) {
    if (generated.length >= MAX_GOAL_TASKS_PER_DAY) break;
    if (!shouldGenerateForGoalToday(goal, dayOfWeek)) continue;

    // Check recent completion rate for adaptive difficulty
    const stats = await countGoalTaskCompletions(userId, goal.id, 7);
    const completionRate = stats.total > 0 ? stats.completed / stats.total : 1;

    // If completion rate is very low, skip generating (will trigger recalibrate in weekly review)
    if (stats.total >= 3 && completionRate < 0.3) continue;

    // Find the current active milestone
    const milestones = await listMilestonesForGoal(goal.id, userId);
    const currentMilestone = milestones.find((m) => m.status === "pending" || m.status === "in_progress");
    if (!currentMilestone) continue;

    // Extract the daily task from milestone's stored tasks
    const milestoneTasks = Array.isArray(currentMilestone.tasks) ? currentMilestone.tasks : [];
    const dailyTask = milestoneTasks.find((t) => t.frequency === "daily")
      || milestoneTasks.find((t) => /3x|2x/i.test(t.frequency || ""))
      || milestoneTasks[0];

    // Use the granular task title, not the milestone title
    const taskTitle = dailyTask
      ? `[${goal.title}] ${dailyTask.title}`
      : `[${goal.title}] ${currentMilestone.title}`;

    // Use LLM-estimated minutes with adaptive reduction
    let estimatedMinutes = dailyTask?.estimatedMinutes || 20;
    if (completionRate < 0.5 && stats.total >= 2) {
      estimatedMinutes = Math.max(5, Math.round(estimatedMinutes / 2));
    }

    const effortType = dailyTask?.effortType || "deep_work";

    const task = await createTaskStep(userId, {
      title: taskTitle,
      dueDate: dateKey,
      scheduledDate: dateKey,
      estimatedMinutes,
      urgency: goal.priority === 1 ? 3 : 2,
      importance: goal.priority === 1 ? 4 : 3,
      effortType,
      source: "goal_planner",
      goalName: goal.title,
      longTermGoalId: goal.id,
      milestoneId: currentMilestone.id,
    });

    if (task) {
      generated.push({
        ...task,
        goalTitle: goal.title,
        milestoneTitle: currentMilestone.title,
        completionRate,
        adaptedMinutes: estimatedMinutes,
      });
    }
  }

  return { generated, existing: [], goals: goals.length };
}

// ─── Daily Scorecard Computation ───

export async function computeDailyScorecard(userId, dateKey, planState) {
  const scored = planState?.scoredTasks || [];
  const top = planState?.topPriorities || [];

  const completedToday = scored.filter(
    (t) => t.done && t.completedAt && t.completedAt.startsWith(dateKey)
  );
  const postponedToday = scored.filter(
    (t) => !t.done && Number(t.rescheduleCount || 0) > 0
  );

  const tasksPlanned = top.length;
  const tasksCompleted = completedToday.length;
  const tasksPostponed = postponedToday.length;
  const completionRate = tasksPlanned > 0 ? tasksCompleted / tasksPlanned : 0;

  // Minutes by effort type
  let deepWorkMinutes = 0;
  let adminMinutes = 0;
  let healthMinutes = 0;
  let totalFocusMinutes = 0;

  for (const task of completedToday) {
    const mins = task.actualMinutes || task.estimatedMinutes || 30;
    totalFocusMinutes += mins;
    const effort = task.effortType || "deep_work";
    if (effort === "deep_work" || effort === "learning") deepWorkMinutes += mins;
    else if (effort === "admin" || effort === "errand") adminMinutes += mins;
    else if (effort === "health") healthMinutes += mins;
  }

  // Identify avoidance types - effort types that had tasks but none completed
  const avoidanceTypes = [];
  const effortGroups = {};
  for (const task of top) {
    const effort = task.effortType || "deep_work";
    if (!effortGroups[effort]) effortGroups[effort] = { total: 0, done: 0 };
    effortGroups[effort].total++;
    if (task.done) effortGroups[effort].done++;
  }
  for (const [effort, counts] of Object.entries(effortGroups)) {
    if (counts.total > 0 && counts.done === 0) avoidanceTypes.push(effort);
  }

  // Top avoided task - highest importance that wasn't done
  const topAvoided = postponedToday
    .sort((a, b) => (Number(b.importance || 0) - Number(a.importance || 0)) || (Number(b.rescheduleCount || 0) - Number(a.rescheduleCount || 0)))
    [0];

  // Streak calculation - fetch previous day's scorecard
  const yesterday = new Date(dateKey);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = yesterday.toISOString().split("T")[0];
  const yesterdayScorecard = await getDailyScorecard(userId, yesterdayKey);
  const previousStreak = yesterdayScorecard?.streak_days || 0;
  const streakDays = completionRate >= 0.6 ? previousStreak + 1 : 0;

  const scorecard = {
    tasksPlanned,
    tasksCompleted,
    tasksPostponed,
    deepWorkMinutes,
    adminMinutes,
    healthMinutes,
    totalFocusMinutes,
    completionRate: Math.round(completionRate * 100) / 100,
    avoidanceTypes,
    topAvoidedTask: topAvoided?.title || null,
    streakDays,
    energyUtilization: 0, // TODO: compute from optimizer data
  };

  const saved = await saveDailyScorecard(userId, dateKey, scorecard);
  return { ...scorecard, saved: Boolean(saved) };
}

// ─── Day Analysis & Insight Generation ───

export async function analyzeDay(userId, dateKey, planState) {
  const scorecard = await getDailyScorecard(userId, dateKey);
  if (!scorecard) return { insights: [] };

  const recentScorecards = await getRecentScorecards(userId, 14);
  const insights = [];

  // Pattern: Consistent avoidance of specific effort types
  if (recentScorecards.length >= 3) {
    const avoidanceCounts = {};
    for (const sc of recentScorecards) {
      for (const type of (sc.avoidance_types || [])) {
        avoidanceCounts[type] = (avoidanceCounts[type] || 0) + 1;
      }
    }
    for (const [type, count] of Object.entries(avoidanceCounts)) {
      if (count >= 3) {
        await upsertUserInsight(userId, "weakness", `Consistently avoids ${type} tasks (${count}/${recentScorecards.length} days)`, {
          date: dateKey,
          event: `avoided_${type}`,
          count,
        });
        insights.push({ category: "weakness", insight: `avoids_${type}`, count });
      }
    }
  }

  // Pattern: Low completion rate trend
  if (recentScorecards.length >= 5) {
    const recentRates = recentScorecards.slice(0, 5).map((sc) => sc.completion_rate || 0);
    const avgRate = recentRates.reduce((s, r) => s + r, 0) / recentRates.length;
    if (avgRate < 0.4) {
      await upsertUserInsight(userId, "pattern", `Low completion rate trending (avg ${Math.round(avgRate * 100)}% over last 5 days)`, {
        date: dateKey,
        event: "low_completion_trend",
        avgRate,
      });
      insights.push({ category: "pattern", insight: "low_completion_trend", avgRate });
    }
    if (avgRate > 0.8) {
      await upsertUserInsight(userId, "strength", `High consistency — averaging ${Math.round(avgRate * 100)}% completion over last 5 days`, {
        date: dateKey,
        event: "high_completion_trend",
        avgRate,
      });
      insights.push({ category: "strength", insight: "high_completion_trend", avgRate });
    }
  }

  // Pattern: Deep work vs admin balance
  if (recentScorecards.length >= 5) {
    const totalDeep = recentScorecards.slice(0, 5).reduce((s, sc) => s + (sc.deep_work_minutes || 0), 0);
    const totalAdmin = recentScorecards.slice(0, 5).reduce((s, sc) => s + (sc.admin_minutes || 0), 0);
    if (totalAdmin > totalDeep * 2 && totalAdmin > 60) {
      await upsertUserInsight(userId, "pattern", `Admin-heavy pattern: ${totalAdmin}m admin vs ${totalDeep}m deep work over 5 days`, {
        date: dateKey,
        event: "admin_heavy",
        totalAdmin,
        totalDeep,
      });
      insights.push({ category: "pattern", insight: "admin_heavy" });
    }
  }

  // Pattern: Streak tracking
  if (scorecard.streak_days >= 3) {
    await upsertUserInsight(userId, "strength", `Consistent execution streak (${scorecard.streak_days} days above 60%)`, {
      date: dateKey,
      event: "streak",
      days: scorecard.streak_days,
    });
    insights.push({ category: "strength", insight: "streak", days: scorecard.streak_days });
  }

  // Pattern: Specific task chronic avoidance
  const scored = planState?.scoredTasks || [];
  const chronicAvoiders = scored.filter((t) => Number(t.rescheduleCount || 0) >= 4 && !t.done);
  for (const task of chronicAvoiders.slice(0, 3)) {
    await upsertUserInsight(userId, "trigger", `Chronically avoids: "${task.title}" (postponed ${task.rescheduleCount}x)`, {
      date: dateKey,
      event: "chronic_avoidance",
      taskTitle: task.title,
      rescheduleCount: task.rescheduleCount,
    });
    insights.push({ category: "trigger", insight: "chronic_avoidance", task: task.title });
  }

  return { insights, scorecard };
}

// ─── Build Rich Context for Morning Brief ───

export async function buildMorningBriefContext({ userId, date, planState, calendarEvents, profile }) {
  const dateKey = date instanceof Date ? date.toISOString().split("T")[0] : String(date).split("T")[0];

  // Yesterday's scorecard
  const yesterday = new Date(dateKey);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = yesterday.toISOString().split("T")[0];
  const yesterdayScorecard = await getDailyScorecard(userId, yesterdayKey);

  // This week's scorecards
  const weekScorecards = await getRecentScorecards(userId, 7);
  const weekCompletionRate = weekScorecards.length > 0
    ? weekScorecards.reduce((s, sc) => s + (sc.completion_rate || 0), 0) / weekScorecards.length
    : null;
  const currentStreak = weekScorecards[0]?.streak_days || 0;

  // User insights (patterns, weaknesses, strengths)
  const allInsights = await getUserInsights(userId);
  const weaknesses = allInsights.filter((i) => i.category === "weakness" && i.confidence >= 0.5);
  const strengths = allInsights.filter((i) => i.category === "strength" && i.confidence >= 0.5);
  const patterns = allInsights.filter((i) => i.category === "pattern" && i.confidence >= 0.5);
  const triggers = allInsights.filter((i) => i.category === "trigger" && i.confidence >= 0.5);

  // Core memory (user facts)
  const coreMemory = await getCoreMemory(userId);

  // Goal progress
  const goals = await listActiveLongTermGoals(userId);
  const goalProgress = [];
  for (const goal of goals.slice(0, 5)) {
    const stats = await countGoalTaskCompletions(userId, goal.id, 7);
    goalProgress.push({
      title: goal.title,
      weeklyRate: stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : null,
      weeklyCompleted: stats.completed,
      weeklyTotal: stats.total,
      priority: goal.priority,
      targetDate: goal.target_date,
    });
  }

  // Stalling goals (no completions in 7+ days)
  const stallingGoals = goalProgress.filter((g) => g.weeklyCompleted === 0 && g.weeklyTotal === 0);

  // Overdue & chronically avoided tasks
  const topPriorities = planState?.topPriorities || [];
  const chronicAvoiders = topPriorities.filter((t) => Number(t.rescheduleCount || 0) >= 3);

  // Calendar density
  const eventCount = (calendarEvents || []).length;
  const calendarDensity = eventCount === 0 ? "open" : eventCount <= 3 ? "moderate" : "packed";

  // Free time calculation (rough)
  const workdayStart = profile?.workdayStart || "09:00";
  const workdayEnd = profile?.workdayEnd || "18:00";
  const workMinutes = (parseInt(workdayEnd) - parseInt(workdayStart)) * 60 || 540;
  const calendarMinutes = (calendarEvents || []).reduce((s, e) => {
    if (e.durationMinutes) return s + e.durationMinutes;
    if (e.start && e.end) {
      return s + Math.max(0, (new Date(e.end) - new Date(e.start)) / 60000);
    }
    return s + 60; // default 1h per event
  }, 0);
  const freeMinutes = Math.max(0, workMinutes - calendarMinutes);
  const taskMinutes = topPriorities.reduce((s, t) => s + (t.estimatedMinutes || 30), 0);

  return {
    yesterdayScorecard: yesterdayScorecard ? {
      completionRate: yesterdayScorecard.completion_rate,
      tasksCompleted: yesterdayScorecard.tasks_completed,
      tasksPlanned: yesterdayScorecard.tasks_planned,
      tasksPostponed: yesterdayScorecard.tasks_postponed,
      deepWorkMinutes: yesterdayScorecard.deep_work_minutes,
      topAvoidedTask: yesterdayScorecard.top_avoided_task,
      streakDays: yesterdayScorecard.streak_days,
    } : null,
    weekStats: {
      avgCompletionRate: weekCompletionRate,
      daysTracked: weekScorecards.length,
      currentStreak,
    },
    userProfile: {
      weaknesses: weaknesses.map((w) => w.insight),
      strengths: strengths.map((s) => s.insight),
      patterns: patterns.map((p) => p.insight),
      triggers: triggers.map((t) => t.insight),
    },
    coreMemory: coreMemory.map((m) => ({ key: m.key, value: m.value })),
    goalProgress,
    stallingGoals,
    chronicAvoiders: chronicAvoiders.map((t) => ({
      title: t.title,
      rescheduleCount: t.rescheduleCount,
      importance: t.importance,
    })),
    calendarDensity,
    freeMinutes,
    taskMinutes,
    isEmptyDay: topPriorities.length <= 1 && freeMinutes > 240,
  };
}
