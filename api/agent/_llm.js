import OpenAI from "openai";
import {
  getCoreMemory,
  upsertCoreMemory,
  deleteCoreMemory,
  createPulse,
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
  },
  required: [
    "intent", "taskTitle", "dueDate", "estimatedMinutes", "urgency",
    "importance", "effortType", "isRecurring", "recurrenceRule", "goalName",
    "completionTarget", "rescheduleDays", "noteText", "goalTitle",
    "pauseDurationMinutes",
  ],
};

// Memory tool calls schema returned alongside actions
const MemoryToolSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: { type: "string", enum: ["save", "update", "delete"] },
    key: { type: "string" },
    value: { type: "string" },
  },
  required: ["action", "key", "value"],
};

// Pulse/follow-up scheduling schema
const PulseToolSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    delayMinutes: { type: "integer" },
    context: { type: "string" },
    pulseType: { type: "string" },
  },
  required: ["delayMinutes", "context", "pulseType"],
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
      memoryOps: { type: "array", items: MemoryToolSchema },
      pulseOps: { type: "array", items: PulseToolSchema },
    },
    required: ["actions", "confidence", "followUpQuestion", "memoryOps", "pulseOps"],
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
10. NOTES: journal entries, reflections. GOALS: long-term aspirations.
11. BOT CONTROL: "pause bot" / "stop bot" → pause_bot. "resume bot" / "start bot" → resume_bot. Set pauseDurationMinutes (default 60).

"ambiguous" is ONLY for messages where you genuinely cannot determine ANY intent — like "ok", "hmm". NOT for actionable phrases.

For due dates: ISO format. For urgency/importance: 1-5. For effortType: deep_work, admin, health, call, errand, learning.
For goalName: Health, Learning & Growth, Life Admin, Career, General.
If fields don't apply, use empty string or 0.

## MEMORY TOOLS
You have persistent memory about this user. Use "memoryOps" to manage it:
- { action: "save", key: "preference_name", value: "detail" } — store a new fact
- { action: "update", key: "existing_key", value: "new_value" } — update a fact
- { action: "delete", key: "old_key", value: "" } — remove an outdated fact
Save important facts: preferences, habits, people mentioned, work patterns, scheduling constraints. Be selective — save what matters, not everything.
Return an empty memoryOps array if no memory changes needed.

## FOLLOW-UP SCHEDULING
Use "pulseOps" to schedule proactive follow-up messages:
- { delayMinutes: 120, context: "Check if user started the pitch deck", pulseType: "followup" }
Use when: user says "I'll do it later/after lunch/in a bit", or a contextual follow-up makes sense.
Be judicious — don't over-schedule. Return empty pulseOps array if no follow-ups needed.`;

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

    // Process memory operations in the background
    if (userId && Array.isArray(parsed.memoryOps) && parsed.memoryOps.length > 0) {
      for (const op of parsed.memoryOps) {
        try {
          if (op.action === "save" || op.action === "update") {
            await upsertCoreMemory(userId, op.key, op.value);
          } else if (op.action === "delete") {
            await deleteCoreMemory(userId, op.key);
          }
        } catch (e) {
          console.error("memoryOp failed", { op, error: e.message });
        }
      }
    }

    // Process pulse scheduling operations
    if (userId && Array.isArray(parsed.pulseOps) && parsed.pulseOps.length > 0) {
      for (const pulse of parsed.pulseOps) {
        try {
          const fireAt = new Date(Date.now() + (pulse.delayMinutes || 120) * 60 * 1000).toISOString();
          await createPulse(userId, fireAt, pulse.context || "Follow up", pulse.pulseType || "followup");
        } catch (e) {
          console.error("pulseOp failed", { pulse, error: e.message });
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
      return `${i + 1}. ${t.title} (${t.estimatedMinutes || 30}m)${postponed >= 2 ? ` — postponed ${postponed}x` : ""}`;
    })
    .join("\n");

  const overdueBlock = overdue
    .map((t) => `- ${t.title} (${Number(t.rescheduleCount || 0)} postponements)`)
    .join("\n");

  const calBlock = calendarEvents
    .map((e) => `- ${e.time || ""} ${e.summary || e.title}`)
    .join("\n");

  const recurringBlock = recurring.map((t) => `- ${t.title}`).join("\n");

  const memoryContext = await buildMemoryContext(profile?.userId);

  const prompt = `Write a concise, personal morning briefing for today (${today}). Tone: ${tone}.
${memoryContext}
Today's priorities:
${taskBlock || "No tasks scheduled."}

${overdue.length > 0 ? `Overdue tasks:\n${overdueBlock}\n` : ""}${calendarEvents.length > 0 ? `Calendar events:\n${calBlock}\n` : ""}${recurring.length > 0 ? `Recurring habits:\n${recurringBlock}\n` : ""}
Rules:
- Keep it under 200 words
- Start with a greeting appropriate to the tone
- Mention total focus time needed
- If there are overdue tasks, call them out (be direct if tone is ruthless)
- If there are calendar events, weave them into the schedule
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
      return `${i + 1}. ${t.title} — ${done ? "DONE" : "NOT DONE"}`;
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

  const prompt = `Write a short ${timeOfDay} nudge message. Tone: ${tone}.

Top pending task: "${target.title}" (${target.estimatedMinutes || 30}m)
Times postponed: ${postponed}
Total remaining tasks: ${top.length} (${totalLeft}m total)
${calendarEvents.length > 0 ? `\nUpcoming calendar events:\n${calBlock}\n` : ""}${behaviorBlock}
Rules:
- Focus on the #1 task
- If postponed 2+ times, be more direct about it
- Suggest a specific time block (e.g. "Start a 20-minute sprint")
- If there's a meeting coming up soon, suggest a shorter sprint before it or schedule the task after it${behaviorBlock ? "\n- Reference the behavioral pattern naturally (don't lecture, but be direct)" : ""}
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
