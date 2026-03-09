import {
  classifyIncomingText,
  twimlMessage,
} from "./_shared.js";

function bodyToForm(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    const params = new URLSearchParams(req.body);
    return Object.fromEntries(params.entries());
  }
  return {};
}

function responseTextForClassification(parsed) {
  if (!parsed) return "I could not parse that. Send a clearer action or goal.";
  if (parsed.kind === "goal") {
    return `Captured goal: ${parsed.goal?.title || "Untitled goal"}.`;
  }
  if (parsed.kind === "note") {
    return "Saved as note. It will not clutter your active plan.";
  }
  if (parsed.kind === "one_time_task" || parsed.kind === "recurring_task") {
    return `Captured ${parsed.kind === "recurring_task" ? "recurring" : "one-time"} task: ${parsed.task?.title || "Untitled task"}.`;
  }
  return parsed.followUpQuestion || "I need one more detail: what exactly should be done and by when?";
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, endpoint: "whatsapp-webhook" });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const form = bodyToForm(req);
    const text = form.Body || form.body || "";
    const from = form.From || form.from || "";

    const parsed = classifyIncomingText(text);

    // Optional forwarding for processing pipelines.
    if (process.env.WHATSAPP_FORWARD_URL) {
      try {
        await fetch(process.env.WHATSAPP_FORWARD_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from, text, parsed, source: "whatsapp-webhook" }),
        });
      } catch (error) {
        console.error("whatsapp forward failed", { error });
      }
    }

    const reply = responseTextForClassification(parsed);
    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(twimlMessage(reply));
  } catch (error) {
    console.error("whatsapp webhook error", { error });
    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(twimlMessage("I had trouble processing that message. Please try again."));
  }
}
