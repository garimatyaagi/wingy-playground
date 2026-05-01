import OpenAI from "openai";
import {
  getCoreMemory,
  upsertCoreMemory,
  deleteCoreMemory,
  createPulse,
  listActiveLongTermGoals,
} from "./_store.js";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function stripCodeFences(s) {
  return s
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

// ─── Structured output schema for message parsing (multi-intent) ───

const ActionItemSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: {
      type: "string",
      enum: [
        "create_task",
        "create_recurring_task",
        "complete_task",
        "reschedule_task",
        "archive_task",
        "cancel_task",
        "informational_update",
        "goal",
        "note",
        "ambiguous",
        "pause_bot",
        "resume_bot",
        "create_long_term_goal",
      ],
    },
    taskTitle: { type: "string" },
    dueDate: { type: ["string", "null"] },
    estimatedMinutes: { type: "integer" },
    urgency: { type: "integer" },
    importance: { type: "integer" },
    effortType: { type: "string" },
    isRecurring: { type: "boolean" },
    recurrenceRule: { type: ["string", "null"] },
    goalName: { type: "string" },
    completionTarget: { type: "string" },
    rescheduleDays: { type: "integer" },
    noteText: { type: "string" },
    goalTitle: { type: "string" },
    pauseDurationMinutes: { type: "integer" },
    memoryKey: { type: "string" },
    memoryValue: { type: "string" },
    memoryAction: { type: "string" },
    pulseDelayMinutes: { type: "integer" },
    pulseContext: { type: "string" },
    longTermGoalTitle: { type: "string" },
    longTermGoalScope: { type: "string" },
    longTermGoalTargetDate: { type: "string" },
    longTermGoalDescription: { type: "string" },
    totalEstimatedMinutes: { type: "integer" },
    dailyAllocatedMinutes: { type: "integer" },
    estimatedDays: { type: "integer" },
    estimationReasoning: { type: "string" },
  },
  required: [
    "intent", "taskTitle", "dueDate", "estimatedMinutes", "urgency",
    "importance", "effortType", "isRecurring", "recurrenceRule", "goalName",
    "completionTarget", "rescheduleDays", "noteText", "goalTitle",
    "pauseDurationMinutes", "memoryKey", "memoryValue", "memoryAction",
    "pulseDelayMinutes", "pulseContext",
    "longTermGoalTitle", "longTermGoalScope", "longTermGoalTargetDate", "longTermGoalDescription",
    "totalEstimatedMinutes", "dailyAllocatedMinutes", "estimatedDays", "estimationReasoning",
  ],
};

const ParseSchema = {
  name: "message_parse",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      actions: { type: "array", items: ActionItemSchema },
      confidence: { type: "number" },
      followUpQuestion: { type: "string" },
    },
    required: ["actions", "confidence", "followUpQuestion"],
  },
};

// ─── LLM Parse Message ───

export async function llmParseMessage(rawText, contextMessages = [], openTasks = [], userId = null) {
  if (!process.env.OPENAI_API_KEY) {
    console.error("llmParseMessage: no OPENAI_API_KEY");
    return { _skip: "no_api_key" };
  }

  const taskList = openTasks
    .slice(0, 15)
    .map((t) => `- "${t.title}" (id: ${t.id}, due: ${t.dueDate || "none"})`)
    .join("\n");

  const recentContext = contextMessages
    .slice(0, 12)
    .map((m) => `[${m.direction || m.type}]: ${m.text || m.body || m.raw_text || ""}`)
    .join("\n");

  const today = new Date().toISOString().split("T")[0];

  // Fetch core memory for this user
  let memoryBlock = "";
  if (userId) {
    try {
      const memories = await getCoreMemory(userId);
      if (memories.length > 0) {
        memoryBlock = "\n## Your Memory About This User\n" +
          memories.map((m) => `- ${m.key}: ${m.value}`).join("\n") +
          "\nReference these facts naturally. Update or delete stale memories.\n";
      }
    } catch (e) {
      console.error("llmParseMessage: getCoreMemory failed", e.message);
    }
  }

  const systemPrompt = `You are a personal task assistant parsing WhatsApp messages. Today is ${today}.
${memoryBlock}
The user's open tasks:
${taskList || "(none)"}

Recent conversation (newest first):
${recentContext || "(none)"}

YOUR #1 RULE: WHEN IN DOUBT, CREATE THE TASK.
This is a task management app. Users message you to track things they need to do.
If the message describes ANY actionable thing, create_task. Do NOT ask for clarification unless the message is truly meaningless gibberish.

CRITICAL: Return an "actions" array. A SINGLE MESSAGE can contain MULTIPLE intents.
Examples:
- "Done with pitch deck, now email Neha about partnership" → actions: [complete_task, create_task]
- "Finished emails and call dentist tomorrow" → actions: [complete_task, create_task]
- "Cancel the gym task, add yoga instead" → actions: [cancel_task, create_task]
- "Setup linkedin posting strategy" → actions: [create_task] (single action)
Most messages will have just ONE action. Only split when the user clearly describes multiple distinct actions.

RULES:

1. BIAS TOWARD ACTION:
   - "whatsapp flow for littlewise" → create_task (taskTitle: "Whatsapp flow for Littlewise")
   - "schedule posts on instagram" → create_task
   - "call dentist" → create_task
   ANY phrase that describes something that could be done = create_task.

2. TENSE MATTERS:
   - PAST = the user already DID it. NOT a new task.
     "I sent the emails" → informational_update
     "I have sent packages" → informational_update
     "Finished the report" → complete_task
   - PRESENT/FUTURE/IMPERATIVE = create_task.
     "Send emails" → create_task
     "Need to call dentist" → create_task

3. META-CONVERSATION (ONLY these exact patterns):
   "I want to add tasks" / "add a task" / "yes add a task" → ambiguous (ask what task)
   ONLY when user talks ABOUT adding tasks without saying WHAT the task is.

4. CLARIFICATION FOLLOW-UPS — check recent conversation:
   If the agent just asked "what task?" or "could you clarify?", the user's next message is likely the ANSWER → create_task.

5. COMPLETION SIGNALS → complete_task:
   "done", "done with X", "finished X", "completed X", "X is done"
   completionTarget = the TASK NAME being completed (NOT a date). Extract the action noun:
     "finished the pitch deck" → completionTarget: "pitch deck"
     "email flow is done" → completionTarget: "email flow"

6. STATUS UPDATES → informational_update:
   Past-tense updates: "meeting went well", "just got out of gym"

7. NEGATION / CORRECTION:
   After agent created a task, user says "no this is completed" → complete_task.

8. RESCHEDULE: "move X to tomorrow", "postpone X"
9. CANCEL: "cancel X", "drop X", "never mind about X"
10. NOTES: journal entries, reflections. GOALS (short category): "goal" intent for simple category labels.
11. BOT CONTROL: "pause bot" / "stop bot" → pause_bot. "resume bot" / "start bot" → resume_bot. Set pauseDurationMinutes (default 60).

12. LONG-TERM GOALS → create_long_term_goal:
   When user describes a goal with a timeline (year, quarter, months) or uses phrases like:
   "By end of year...", "This year I want to...", "My goal for 2026...", "In the next 6 months...",
   "Long term goal:", "yearly goal:", "quarterly goal:", "I want to achieve..."
   Set longTermGoalTitle, longTermGoalDescription, longTermGoalScope (quarterly/yearly/custom),
   and longTermGoalTargetDate (ISO date, end of period). All other fields use defaults (empty string / 0).
   This is DIFFERENT from "goal" intent — "goal" is a category bucket, "create_long_term_goal" is a
   time-bound aspiration that will be decomposed into milestones and daily tasks.

"ambiguous" is ONLY for messages where you genuinely cannot determine ANY intent — like "ok", "hmm". NOT for actionable phrases.

For due dates: ISO format. For urgency/importance: 1-5. For effortType: deep_work, admin, health, call, errand, learning.
For goalName: Health, Learning & Growth, Life Admin, Career, General.
If fields don't apply, use empty string or 0.

## TIME ESTIMATION (per action fields)
Estimate how long tasks REALLY take. Set totalEstimatedMinutes, dailyAllocatedMinutes, estimatedDays, and estimationReasoning.

BOOKS: Recognize book titles. Average book is ~250 pages, read at ~30-40 pages/hour.
- "Read Atomic Habits" → totalEstimatedMinutes: 270, dailyAllocatedMinutes: 45, estimatedDays: 6, estimationReasoning: "~250 pages at 40 pages/hr = 6.25 hrs. 45min/day = 6 sessions"
- "Read Sapiens" → totalEstimatedMinutes: 480, dailyAllocatedMinutes: 60, estimatedDays: 8, estimationReasoning: "~450 pages, longer book. 60min/day = 8 sessions"

PROJECTS (multi-day work): Estimate total scope, split into daily blocks of 60-90min.
- "Build landing page" → totalEstimatedMinutes: 480, dailyAllocatedMinutes: 90, estimatedDays: 6, estimationReasoning: "Design + code + copy + deploy ~8hrs. 90min/day"
- "Write blog post" → totalEstimatedMinutes: 180, dailyAllocatedMinutes: 60, estimatedDays: 3, estimationReasoning: "Research + draft + edit ~3hrs. 60min/day"

SIMPLE TASKS (single session): totalEstimatedMinutes = estimatedMinutes, estimatedDays = 1, dailyAllocatedMinutes = estimatedMinutes.
- "Call dentist" → totalEstimatedMinutes: 15, dailyAllocatedMinutes: 15, estimatedDays: 1, estimationReasoning: "Simple phone call"
- "Send invoice" → totalEstimatedMinutes: 20, dailyAllocatedMinutes: 20, estimatedDays: 1, estimationReasoning: "Quick admin task"

RECURRING TASKS: dailyAllocatedMinutes = per-session time. totalEstimatedMinutes: 0, estimatedDays: 0 (ongoing).
- "Workout daily" → totalEstimatedMinutes: 0, dailyAllocatedMinutes: 45, estimatedDays: 0, estimationReasoning: "Ongoing habit, 45min per session"

For estimatedMinutes (the field used for today's scheduling), ALWAYS use dailyAllocatedMinutes value.

## MEMORY (per action fields)
You have persistent memory. On any action, you can also set memoryAction/memoryKey/memoryValue to manage memory:
- memoryAction: "save", memoryKey: "morning_routine", memoryValue: "User runs at 6am" — store a fact
- memoryAction: "delete", memoryKey: "old_key", memoryValue: "" — remove outdated fact
Save important facts: preferences, habits, people mentioned, work patterns. Be selective.
Set memoryAction to "" and memoryKey/memoryValue to "" when no memory change needed.

## LONG-TERM GOAL FIELDS (per action)
Set longTermGoalTitle, longTermGoalScope, longTermGoalTargetDate, longTermGoalDescription when intent is create_long_term_goal.
Set all four to "" when not creating a long-term goal.

## FOLLOW-UP (per action fields)
Set pulseDelayMinutes and pulseContext to schedule a follow-up message:
- pulseDelayMinutes: 120, pulseContext: "Check if user started the pitch deck"
Use when user says "I'll do it later/after lunch". Set both to 0/"" when not needed.`;

  const input = [
    { role: "system", content: systemPrompt },
    { role: "user", content: rawText },
  ];

  try {
    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input,
      text: {
        format: {
          type: "json_schema",
          name: ParseSchema.name,
          strict: ParseSchema.strict,
          schema: ParseSchema.schema,
        },
      },
    });

    const cleaned = stripCodeFences((response.output_text || "").trim());
    const parsed = JSON.parse(cleaned);

    // Process memory and pulse ops embedded in actions
    if (userId && Array.isArray(parsed.actions)) {
      for (const action of parsed.actions) {
        // Memory operations
        try {
          if (action.memoryKey && action.memoryValue && action.memoryAction) {
            if (action.memoryAction === "save" || action.memoryAction === "update") {
              await upsertCoreMemory(userId, action.memoryKey, action.memoryValue);
            } else if (action.memoryAction === "delete") {
              await deleteCoreMemory(userId, action.memoryKey);
            }
          }
        } catch (e) {
          console.error("memoryOp failed", { error: e.message });
        }
        // Pulse scheduling
        try {
          if (action.pulseDelayMinutes > 0 && action.pulseContext) {
            const fireAt = new Date(Date.now() + action.pulseDelayMinutes * 60 * 1000).toISOString();
            await createPulse(userId, fireAt, action.pulseContext, "followup");
          }
        } catch (e) {
          console.error("pulseOp failed", { error: e.message });
        }
      }
    }

    return parsed;
  } catch (err) {
    console.error("llmParseMessage error:", err.message, err.status, err.code, JSON.stringify(err.error || {}).slice(0, 300));
    return { _skip: `llm_error:${err.message || "unknown"}`.slice(0, 200) };
  }
}

// ─── Core Memory Helper for Scheduler Prompts ───

async function buildMemoryContext(userId) {
  if (!userId) return "";
  try {
    const memories = await getCoreMemory(userId);
    if (memories.length === 0) return "";
    return "\nWhat you know about this user:\n" +
      memories.map((m) => `- ${m.key}: ${m.value}`).join("\n") +
      "\nUse this context naturally in your message.\n";
  } catch {
    return "";
  }
}

// ─── LLM Morning Brief ───

export async function llmMorningBrief(tasks, calendarEvents = [], profile = {}) {
  if (!process.env.OPENAI_API_KEY) return null;

  const tone = profile.tone || "firm";
  const today = new Date().toISOString().split("T")[0];
  const topTasks = (tasks.topPriorities || []).slice(0, 5);
  const overdue = (tasks.overdue || []).slice(0, 5);
  const recurring = (tasks.recurringDue || []).slice(0, 5);

  const taskBlock = topTasks
    .map((t, i) => {
      const postponed = Number(t.rescheduleCount || 0);
      const progress = t.multiDayProgress;
      const timeLabel = progress?.isMultiDay
        ? `${progress.todayAllocatedMinutes}m today — ${progress.progressLabel}`
        : `${t.estimatedMinutes || 30}m`;
      return `${i + 1}. ${t.title} (${timeLabel})${postponed >= 2 ? ` — postponed ${postponed}x` : ""}`;
    })
    .join("\n");

  const overdueBlock = overdue
    .map((t) => `- ${t.title} (${Number(t.rescheduleCount || 0)} postponements)`)
    .join("\n");

  const calBlock = calendarEvents
    .map((e) => `- ${e.time || ""} ${e.summary || e.title}`)
    .join("\n");

  const recurringBlock = recurring.map((t) => `- ${t.title}`).join("\n");

  const goalTaskBlock = (tasks.goalTaskContext || [])
    .map((g) => `- ${g}`)
    .join("\n");

  const memoryContext = await buildMemoryContext(profile?.userId);

  const prompt = `Write a concise, personal morning briefing for today (${today}). Tone: ${tone}.
${memoryContext}
Today's priorities:
${taskBlock || "No tasks scheduled."}

${overdue.length > 0 ? `Overdue tasks:\n${overdueBlock}\n` : ""}${calendarEvents.length > 0 ? `Calendar events:\n${calBlock}\n` : ""}${recurring.length > 0 ? `Recurring habits:\n${recurringBlock}\n` : ""}${goalTaskBlock ? `Long-term goal tasks for today:\n${goalTaskBlock}\n` : ""}
Rules:
- Keep it under 200 words
- Start with a greeting appropriate to the tone
- Mention total focus time needed
- If there are overdue tasks, call them out (be direct if tone is ruthless)
- If there are calendar events, weave them into the schedule
- If there are long-term goal tasks, mention them with context (e.g. "Marathon training: 25-min run — Week 3 of your plan")
- For multi-day tasks (shown as "session X/Y"), mention progress naturally (e.g., "You're on session 3 of 6")
- End with one motivating line appropriate to the tone
- Do NOT use markdown. Plain text only with line breaks.`;

  try {
    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: "You are a personal productivity assistant writing WhatsApp messages. Keep messages casual, direct, and human." },
        { role: "user", content: prompt },
      ],
    });
    return (response.output_text || "").trim();
  } catch (err) {
    console.error("llmMorningBrief error:", err.message);
    return null;
  }
}

// ─── LLM Evening Check-in ───

export async function llmEveningCheckin(tasks, completedToday = [], profile = {}, calendarEvents = []) {
  const tone = profile.tone || "firm";
  if (!process.env.OPENAI_API_KEY) return null;

  const topTasks = (tasks.topPriorities || []).slice(0, 5);
  const overdue = (tasks.overdue || []).slice(0, 5);

  const taskBlock = topTasks
    .map((t, i) => {
      const done = completedToday.some((c) => c.id === t.id);
      const progress = t.multiDayProgress;
      const progressSuffix = progress?.isMultiDay ? ` (${progress.progressLabel})` : "";
      return `${i + 1}. ${t.title}${progressSuffix} — ${done ? "DONE" : "NOT DONE"}`;
    })
    .join("\n");

  const calBlock = calendarEvents
    .map((e) => `- ${e.time || ""} ${e.summary || e.title}`)
    .join("\n");

  const prompt = `Write a brief evening check-in message. Tone: ${tone}.

Today's tasks:
${taskBlock || "No tasks were scheduled."}

${completedToday.length} tasks completed today.
${overdue.length} tasks are overdue.
${calendarEvents.length > 0 ? `\nToday's calendar:\n${calBlock}\n` : ""}
Rules:
- Acknowledge what was completed (celebrate wins)
- If the day was meeting-heavy, acknowledge it and adjust expectations for task completion
- For unfinished tasks, ask "done / partial / skipped" for each
- If tasks were skipped, ask the reason: time issue / avoided / blocked / not needed
- Ask what the #1 priority for tomorrow should be
- Keep under 150 words
- Plain text only, no markdown`;

  try {
    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: "You are a personal productivity assistant. Be encouraging but honest." },
        { role: "user", content: prompt },
      ],
    });
    return (response.output_text || "").trim();
  } catch (err) {
    console.error("llmEveningCheckin error:", err.message);
    return null;
  }
}

// ─── LLM Nudge ───

export async function llmNudge(tasks, messageType = "midday_nudge", profile = {}, calendarEvents = [], behaviorPatterns = null) {
  const tone = profile.tone || "firm";
  if (!process.env.OPENAI_API_KEY) return null;

  const top = (tasks.topPriorities || []).filter((t) => !t.done).slice(0, 3);
  if (top.length === 0) return null;

  const target = top[0];
  const totalLeft = top.reduce((s, t) => s + (t.estimatedMinutes || 30), 0);
  const postponed = Number(target.rescheduleCount || 0);

  const timeOfDay = messageType === "midday_nudge" ? "midday" : "afternoon";

  const calBlock = calendarEvents
    .map((e) => `- ${e.time || ""} ${e.summary || e.title}`)
    .join("\n");

  // Build behavioral context for the prompt
  let behaviorBlock = "";
  if (behaviorPatterns?.patterns?.length > 0) {
    const lines = behaviorPatterns.patterns.map((p) => {
      if (p.type === "admin_drift") return `- Pattern: User completed ${p.completedLowCount} low-priority tasks while ${p.highUndoneCount} important tasks are untouched`;
      if (p.type === "deep_work_avoidance") return `- Pattern: User avoids deep work tasks — ${p.avoidedCount} deep tasks postponed while ${p.adminDoneCount} admin tasks done`;
      if (p.type === "repeated_postponement") return `- Pattern: "${p.taskTitle}" has been postponed ${p.rescheduleCount} times`;
      if (p.type === "ignored_nudges") return `- Pattern: ${p.nudgeCount} nudges sent recently with no task completions`;
      return "";
    }).filter(Boolean);
    if (lines.length > 0) behaviorBlock = `\nBehavioral patterns detected:\n${lines.join("\n")}\n`;
  }

  const progress = target.multiDayProgress;
  const progressLine = progress?.isMultiDay
    ? `\nMulti-day progress: ${progress.progressLabel}, ${progress.remainingMinutes}m total remaining`
    : "";
  const effectiveMinutes = progress?.isMultiDay ? progress.todayAllocatedMinutes : (target.estimatedMinutes || 30);

  const prompt = `Write a short ${timeOfDay} nudge message. Tone: ${tone}.

Top pending task: "${target.title}" (${effectiveMinutes}m today)
Times postponed: ${postponed}
Total remaining tasks: ${top.length} (${totalLeft}m total)${progressLine}
${calendarEvents.length > 0 ? `\nUpcoming calendar events:\n${calBlock}\n` : ""}${behaviorBlock}
Rules:
- Focus on the #1 task
- If postponed 2+ times, be more direct about it
- Suggest a specific time block (e.g. "Start a 20-minute sprint")
- If there's a meeting coming up soon, suggest a shorter sprint before it or schedule the task after it${behaviorBlock ? "\n- Reference the behavioral pattern naturally (don't lecture, but be direct)" : ""}${progressLine ? "\n- Reference the multi-day progress naturally (e.g., 'session 3 of 6 today')" : ""}
- ${timeOfDay === "afternoon" ? "Mention that end of day is approaching" : "Encourage starting now"}
- Keep under 80 words
- Plain text only`;

  try {
    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: "You are a personal productivity assistant sending brief WhatsApp nudges. Be direct and actionable." },
        { role: "user", content: prompt },
      ],
    });
    return (response.output_text || "").trim();
  } catch (err) {
    console.error("llmNudge error:", err.message);
    return null;
  }
}

// ─── LLM Pulse Message (for proactive follow-ups) ───

export async function llmPulseMessage(context, profile = {}) {
  const tone = profile.tone || "firm";
  if (!process.env.OPENAI_API_KEY) return null;

  const memoryContext = await buildMemoryContext(profile?.userId);

  const prompt = `Write a brief, casual follow-up WhatsApp message. Tone: ${tone}.
${memoryContext}
Context for the follow-up: "${context}"

Rules:
- Keep under 40 words
- Be natural and casual, like a friend checking in
- Reference the context directly
- End with a simple question or prompt for action
- Plain text only`;

  try {
    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: "You are a personal productivity assistant sending brief WhatsApp follow-ups." },
        { role: "user", content: prompt },
      ],
    });
    return (response.output_text || "").trim();
  } catch (err) {
    console.error("llmPulseMessage error:", err.message);
    return null;
  }
}

// ─── LLM Follow-up for avoided tasks ───

// ─── LLM Goal Decomposition ───

const GoalDecompositionSchema = {
  name: "goal_decomposition",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      milestones: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            targetWeek: { type: "integer" },
            tasks: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  title: { type: "string" },
                  frequency: { type: "string" },
                  estimatedMinutes: { type: "integer" },
                  effortType: { type: "string" },
                },
                required: ["title", "frequency", "estimatedMinutes", "effortType"],
              },
            },
          },
          required: ["title", "description", "targetWeek", "tasks"],
        },
      },
      dailyHabitSuggestion: { type: "string" },
      weeklyCheckpoint: { type: "string" },
      suggestedPriority: { type: "integer" },
    },
    required: ["milestones", "dailyHabitSuggestion", "weeklyCheckpoint", "suggestedPriority"],
  },
};

export async function llmDecomposeGoal(goalTitle, goalDescription, targetDate, userId = null) {
  if (!process.env.OPENAI_API_KEY) return null;

  const memoryContext = await buildMemoryContext(userId);
  const today = new Date().toISOString().split("T")[0];
  const targetStr = targetDate || "end of year";

  // Fetch existing active goals to give context on workload
  let existingGoalsBlock = "";
  if (userId) {
    try {
      const existing = await listActiveLongTermGoals(userId);
      if (existing.length > 0) {
        existingGoalsBlock = "\nUser's existing active long-term goals:\n" +
          existing.map((g) => `- ${g.title} (priority ${g.priority}, target: ${g.target_date || "none"})`).join("\n") +
          `\nTotal active goals: ${existing.length}. Keep this workload in mind when sizing milestones.\n`;
      }
    } catch { /* ignore */ }
  }

  const prompt = `Break down this long-term goal into milestones and daily actionable tasks.

Goal: "${goalTitle}"
${goalDescription ? `Description: ${goalDescription}` : ""}
Target date: ${targetStr}
Today: ${today}
${memoryContext}${existingGoalsBlock}
Rules:
1. Create 3-6 milestones, ordered chronologically. Each milestone should take 2-8 weeks.
2. Each milestone should have 1-3 repeatable daily/weekly tasks that drive progress.
3. Tasks should be TINY and specific — under 30 minutes each. The smaller the better.
4. Use "frequency" to indicate how often: "daily", "3x/week", "2x/week", "weekly".
5. "effortType" must be one of: deep_work, admin, health, call, errand, learning.
6. "targetWeek" = week number from today when this milestone should be reached.
7. "dailyHabitSuggestion" = an implementation intention anchored to an existing routine.
   Use the user's known routines from memory if available. Format: "After [existing routine], [new habit]".
8. "weeklyCheckpoint" = what to review each week to track progress.
9. "suggestedPriority" = 1 (daily attention), 2 (2-3x/week), or 3 (weekly). Consider existing goals workload.
10. Be realistic about pacing. Don't front-load everything into week 1.`;

  try {
    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: "You are an expert goal coach and habit designer. You specialize in breaking ambitious goals into tiny, achievable daily actions using behavioral science (implementation intentions, habit stacking, progressive overload). Be practical, not aspirational." },
        { role: "user", content: prompt },
      ],
      text: {
        format: {
          type: "json_schema",
          name: GoalDecompositionSchema.name,
          strict: GoalDecompositionSchema.strict,
          schema: GoalDecompositionSchema.schema,
        },
      },
    });

    const cleaned = stripCodeFences((response.output_text || "").trim());
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("llmDecomposeGoal error:", err.message);
    return null;
  }
}

// ─── LLM Onboarding Answer Extraction ───

export async function llmExtractOnboardingAnswer(rawText, questionTopic) {
  if (!process.env.OPENAI_API_KEY) return rawText.trim();
  try {
    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: `You extract concise, useful facts from a user's answer about "${questionTopic}". Return a short summary (1-2 sentences max) that captures the key insight. Keep it factual and in third person (e.g., "User is a..." not "I am a..."). If the answer is unclear or empty, return "Not specified".`,
        },
        { role: "user", content: rawText },
      ],
    });
    return (response.output_text || rawText).trim();
  } catch (err) {
    console.error("llmExtractOnboardingAnswer error:", err.message);
    return rawText.trim();
  }
}

// ─── LLM Weekly Goal Review ───

export async function llmWeeklyGoalReview(goals, profile = {}) {
  const tone = profile.tone || "firm";
  if (!process.env.OPENAI_API_KEY) return null;

  const memoryContext = await buildMemoryContext(profile?.userId);

  const goalsBlock = goals
    .map((g) => {
      const milestoneStatus = (g.milestones || [])
        .map((m) => `  - ${m.title}: ${m.status}${m.completed_at ? " (done)" : ""}`)
        .join("\n");
      const completionRate = g.completionRate !== undefined
        ? `${Math.round(g.completionRate * 100)}% task completion this week`
        : "no data yet";
      return `Goal: "${g.title}" (priority ${g.priority}, target: ${g.target_date || "none"})
  Status: ${completionRate}
  Milestones:\n${milestoneStatus || "  (none yet)"}`;
    })
    .join("\n\n");

  const prompt = `Write a weekly goal review message. Tone: ${tone}.
${memoryContext}
${goalsBlock || "No active long-term goals."}

Rules:
- Summarize progress on each goal in 1-2 lines
- Celebrate milestones completed this week
- Flag goals where completion rate is below 50% — suggest reducing scope or pausing
- If a goal has no task completions, ask if it's still relevant
- Suggest focus areas for the coming week
- Keep under 250 words
- Plain text only, no markdown`;

  try {
    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: "You are a personal goal coach doing a weekly check-in via WhatsApp. Be encouraging but honest about progress." },
        { role: "user", content: prompt },
      ],
    });
    return (response.output_text || "").trim();
  } catch (err) {
    console.error("llmWeeklyGoalReview error:", err.message);
    return null;
  }
}

// ─── LLM Follow-up for avoided tasks ───

export async function llmFollowUp(task, calendarEvents = [], profile = {}) {
  const tone = profile.tone || "firm";
  if (!process.env.OPENAI_API_KEY) return null;

  const postponed = Number(task.rescheduleCount || 0);
  const daysSinceCreated = Math.floor(
    (Date.now() - new Date(task.createdAt || Date.now()).getTime()) / 86400000
  );

  const calBlock = calendarEvents
    .map((e) => `- ${e.time || ""} ${e.summary || e.title}`)
    .join("\n");

  const prompt = `Write a targeted follow-up for a task the user keeps avoiding. Tone: ${tone}.

Task: "${task.title}"
Times postponed: ${postponed}
Days since created: ${daysSinceCreated}
Estimated time: ${task.estimatedMinutes || 30} minutes
${calendarEvents.length > 0 ? `\nUpcoming events:\n${calBlock}\n` : ""}
Rules:
- Acknowledge the avoidance pattern without being judgmental
- Suggest breaking it into a tiny first step (5-10 minutes)
- If there's a gap before the next meeting, suggest using that window for this task
- Ask if the task is still relevant (maybe it should be archived)
- Keep under 60 words
- Plain text only`;

  try {
    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: "You are a personal accountability partner. Be firm but empathetic." },
        { role: "user", content: prompt },
      ],
    });
    return (response.output_text || "").trim();
  } catch (err) {
    console.error("llmFollowUp error:", err.message);
    return null;
  }
}
