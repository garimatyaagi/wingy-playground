import { parseMessageIntent } from "./_engine.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { text } = req.body || {};
    const parsed = parseMessageIntent(text || "");
    const primaryTask = parsed.tasks?.[0] || null;
    const kindMap = {
      create_task: "one_time_task",
      create_recurring_task: "recurring_task",
      complete_task: "complete_task",
      reschedule_task: "reschedule_task",
      archive_task: "archive_task",
      note: "note",
      goal: "goal",
      ambiguous: "ambiguous",
    };
    return res.status(200).json({
      ...parsed,
      kind: kindMap[parsed.intent] || parsed.intent || "ambiguous",
      task: primaryTask,
    });
  } catch (error) {
    console.error("agent parse error", { error });
    return res.status(500).json({ error: "Could not parse message" });
  }
}
