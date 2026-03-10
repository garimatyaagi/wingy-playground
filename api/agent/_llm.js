import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function stripCodeFences(s) {
  return s
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

// ─── Structured output schema for message parsing ───

const ParseSchema = {
  name: "message_parse",
  strict: true,
  schema: {
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
          "goal",
          "note",
          "ambiguous",
        ],
      },
      confidence: { type: "number" },
      taskTitle: { type: "string" },
      dueDate: { type: ["string", "null"] },
      goalName: { type: "string" },
      estimatedMinutes: { type: "integer" },
      urgency: { type: "integer" },
      importance: { type: "integer" },
      effortType: { type: "string" },
      isRecurring: { type: "boolean" },
      recurrenceRule: { type: ["string", "null"] },
      completionTarget: { type: "string" },
      rescheduleDays: { type: "integer" },
      noteText: { type: "string" },
      goalTitle: { type: "string" },
      followUpQuestion: { type: "string" },
    },
    required: [
      "intent",
      "confidence",
      "taskTitle",
      "dueDate",
      "goalName",
      "estimatedMinutes",
      "urgency",
      "importance",
      "effortType",
      "isRecurring",
      "recurrenceRule",
      "completionTarget",
      "rescheduleDays",
      "noteText",
      "goalTitle",
      "followUpQuestion",
    ],
  },
};

// ─── LLM Parse Message ───

export async function llmParseMessage(rawText, contextMessages = [], openTasks = []) {
  if (!process.env.OPENAI_API_KEY) return null;

  const taskList = openTasks
    .slice(0, 15)
    .map((t) => `- "${t.title}" (id: ${t.id}, due: ${t.dueDate || "none"})`)
    .join("\n");

  const recentContext = contextMessages
    .slice(0, 8)
    .map((m) => `[${m.direction || m.type}]: ${m.text || m.body || m.raw_text || ""}`)
    .join("\n");

  const today = new Date().toISOString().split("T")[0];

  const systemPrompt = `You are a personal task assistant parsing WhatsApp messages. Today is ${today}.

The user's open tasks:
${taskList || "(none)"}

Recent conversation:
${recentContext || "(none)"}

Parse the user's message and determine their intent. Be smart about context:
- If they say "done with X" or "finished X" or "completed X", match X to an existing open task (use completionTarget).
- If they say "move X to tomorrow" or "postpone X", it's a reschedule (rescheduleDays = number of days to push).
- If they mention a new action to do, create a task with a clear title, realistic time estimate, and appropriate urgency/importance.
- "need to", "have to", "gotta", "must", "should" all indicate task creation.
- If it's a life reflection, journal entry, or thought — it's a note.
- If it's a long-term aspiration ("I want to run a marathon") — it's a goal.
- If ambiguous, set intent to "ambiguous" and provide a followUpQuestion.

For due dates, use ISO format (${today}T23:59:00.000Z for today). "tomorrow" = next day. "next week" = 7 days.
For urgency: 1-5 (5=ASAP). For importance: 1-5 (5=critical).
For effortType: deep_work, admin, health, call, errand, learning.
For goalName: Health, Learning & Growth, Life Admin, Career, General.
If fields don't apply (e.g. completionTarget for create_task), use empty string or 0.`;

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
          json_schema: ParseSchema,
        },
      },
    });

    const cleaned = stripCodeFences((response.output_text || "").trim());
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("llmParseMessage error:", err.message);
    return null;
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

  const prompt = `Write a concise, personal morning briefing for today (${today}). Tone: ${tone}.

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

export async function llmNudge(tasks, messageType = "midday_nudge", profile = {}, calendarEvents = []) {
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

  const prompt = `Write a short ${timeOfDay} nudge message. Tone: ${tone}.

Top pending task: "${target.title}" (${target.estimatedMinutes || 30}m)
Times postponed: ${postponed}
Total remaining tasks: ${top.length} (${totalLeft}m total)
${calendarEvents.length > 0 ? `\nUpcoming calendar events:\n${calBlock}\n` : ""}
Rules:
- Focus on the #1 task
- If postponed 2+ times, be more direct about it
- Suggest a specific time block (e.g. "Start a 20-minute sprint")
- If there's a meeting coming up soon, suggest a shorter sprint before it or schedule the task after it
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
