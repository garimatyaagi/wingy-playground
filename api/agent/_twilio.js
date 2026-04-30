import crypto from "crypto";
import { toWhatsAppAddress } from "./_store.js";

function cleanText(value) {
  return String(value || "").trim();
}

export function twimlMessage(text) {
  const safe = String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
}

export function bodyToForm(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    const params = new URLSearchParams(req.body);
    return Object.fromEntries(params.entries());
  }
  return {};
}

function buildAbsoluteUrl(req) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto || "https";
  const host = req.headers.host || "";
  const path = req.url || "";
  return `${protocol}://${host}${path}`;
}

export function validateTwilioSignature(req, formBody) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const signature = req.headers["x-twilio-signature"];
  if (!authToken || !signature) return { checked: false, valid: false };

  const url = buildAbsoluteUrl(req);
  const params = Object.entries(formBody || {})
    .filter(([key]) => key)
    .sort(([a], [b]) => a.localeCompare(b));
  let data = url;
  params.forEach(([key, value]) => {
    data += `${key}${value}`;
  });

  const computed = crypto.createHmac("sha1", authToken).update(data).digest("base64");
  const valid =
    computed.length === signature.length &&
    crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
  if (!valid) {
    console.error("twilio signature mismatch");
  }
  return { checked: true, valid };
}

export async function sendWhatsAppMessage({ to, text }) {
  const bodyText = cleanText(text);
  const toAddress = toWhatsAppAddress(to || process.env.WHATSAPP_TO || "");
  if (!toAddress || !bodyText) {
    return {
      ok: false,
      sent: false,
      error: "missing_to_or_text",
    };
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromAddress = toWhatsAppAddress(process.env.TWILIO_WHATSAPP_FROM || "");

  if (!accountSid || !authToken || !fromAddress) {
    return {
      ok: true,
      sent: false,
      mock: true,
      reason: "missing_twilio_credentials",
      to: toAddress,
      preview: bodyText.slice(0, 600),
    };
  }

  const form = new URLSearchParams({
    To: toAddress,
    From: fromAddress,
    Body: bodyText,
  });
  const authHeader = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${authHeader}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    }
  );

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    console.error("sendWhatsAppMessage failed", { status: response.status, payload });
    return {
      ok: false,
      sent: false,
      error: "twilio_send_failed",
      status: response.status,
      details: payload,
    };
  }

  return {
    ok: true,
    sent: true,
    sid: payload?.sid || "",
    status: payload?.status || "",
    to: payload?.to || toAddress,
  };
}
