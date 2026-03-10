import { generateNudge } from "./engine.js";
import { logAgentMessage } from "./store.js";
import { sendWhatsAppMessage } from "./twilio.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const userId = String(req.body?.userId || "").trim();
  const to = String(req.body?.to || "").trim();
  if (!userId) return res.status(400).json({ error: "Missing userId" });

  const tone = req.body?.tone || "firm";
  const nudge = await generateNudge({
    userId,
    tone,
    now: new Date(),
  });
  const sent = await sendWhatsAppMessage({
    to,
    text: nudge.body,
  });

  await logAgentMessage({
    userId,
    type: "nudge",
    body: nudge.body,
    relatedTaskIds: nudge.relatedTaskIds || [],
    metadata: {
      reason: nudge.reason || "manual_nudge",
      sent,
    },
  });

  return res.status(200).json({
    ok: true,
    nudge,
    sent,
  });
}
