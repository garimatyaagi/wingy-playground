import { logAgentMessage } from "./_store.js";
import { sendWhatsAppMessage } from "./_twilio.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { to, text, userId, type = "nudge", relatedTaskIds = [], metadata = {} } = req.body || {};
    const bodyText = String(text || "").trim();
    if (!bodyText) {
      return res.status(400).json({ error: "Missing message text" });
    }
    const sent = await sendWhatsAppMessage({ to, text: bodyText });
    if (userId) {
      await logAgentMessage({
        userId,
        type,
        body: bodyText,
        relatedTaskIds: Array.isArray(relatedTaskIds) ? relatedTaskIds : [],
        metadata: {
          ...metadata,
          transport: "twilio_whatsapp",
          sent,
        },
      });
    }
    if (!sent.ok) return res.status(502).json(sent);
    return res.status(200).json(sent);
  } catch (error) {
    console.error("whatsapp send error", { error });
    return res.status(500).json({ error: "Failed to send WhatsApp message" });
  }
}
