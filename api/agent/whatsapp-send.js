import { toWhatsAppAddress } from "./_shared.js";

function resolveRawBody(req) {
  if (typeof req.body === "string") return req.body;
  if (req.body && typeof req.body === "object") return JSON.stringify(req.body);
  return "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { to, text } = req.body || {};
    const bodyText = String(text || "").trim();
    const toAddress = toWhatsAppAddress(to || process.env.WHATSAPP_TO || "");

    if (!toAddress) {
      return res.status(400).json({ error: "Missing WhatsApp destination number" });
    }
    if (!bodyText) {
      return res.status(400).json({ error: "Missing message text" });
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromAddress = toWhatsAppAddress(process.env.TWILIO_WHATSAPP_FROM || "");

    if (!accountSid || !authToken || !fromAddress) {
      return res.status(200).json({
        ok: true,
        sent: false,
        mock: true,
        reason: "Missing Twilio WhatsApp credentials",
        to: toAddress,
        preview: bodyText.slice(0, 500),
      });
    }

    const form = new URLSearchParams({
      To: toAddress,
      From: fromAddress,
      Body: bodyText,
    });

    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });

    const payload = await response.json().catch(() => ({ raw: resolveRawBody(req) }));
    if (!response.ok) {
      console.error("whatsapp send failed", { status: response.status, payload });
      return res.status(502).json({ error: "Twilio send failed", details: payload });
    }

    return res.status(200).json({
      ok: true,
      sent: true,
      sid: payload.sid,
      status: payload.status,
      to: payload.to,
    });
  } catch (error) {
    console.error("whatsapp send error", { error });
    return res.status(500).json({ error: "Failed to send WhatsApp message" });
  }
}
