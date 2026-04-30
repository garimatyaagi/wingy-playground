import {
  getAgentProfileByUserId,
  upsertAgentProfile,
} from "./_store.js";
import { getAuthUrl } from "./_calendar.js";
import { requireAuth } from "./_auth.js";

export default async function handler(req, res) {
  if (req.method === "GET") {
    // Handle Google Calendar auth redirect
    if (req.query?.gcal_auth === "1") {
      const requestedUserId = String(req.query?.userId || "").trim();
      const authedUserId = await requireAuth(req, res, requestedUserId);
      if (!authedUserId) return;
      const authUrl = getAuthUrl(authedUserId);
      if (!authUrl) {
        return res.status(500).json({ error: "Google Calendar not configured." });
      }
      return res.redirect(authUrl);
    }

    const requestedUserId = String(req.query?.userId || "").trim();
    if (!requestedUserId) return res.status(400).json({ error: "Missing userId" });
    const userId = await requireAuth(req, res, requestedUserId);
    if (!userId) return;
    const profile = await getAgentProfileByUserId(userId);
    // Expose the agent's WhatsApp number so the frontend can build a wa.me connect link
    const agentWhatsAppNumber = (process.env.TWILIO_WHATSAPP_FROM || "").replace(/^whatsapp:/, "");
    return res.status(200).json({ profile, agentWhatsAppNumber });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body || {};
  const requestedUserId = String(body.userId || "").trim();
  if (!requestedUserId) return res.status(400).json({ error: "Missing userId" });
  const userId = await requireAuth(req, res, requestedUserId);
  if (!userId) return;

  const result = await upsertAgentProfile({
    userId,
    whatsappNumber: body.whatsAppTo || "",
    timezone: body.timezone || "Asia/Kolkata",
    morningBriefTime: body.morningBriefTime,
    middayNudgeTime: body.middayNudgeTime,
    afternoonFollowupTime: body.afternoonFollowupTime,
    eveningCheckinTime: body.eveningCheckinTime,
    workdayStart: body.workdayStart,
    workdayEnd: body.workdayEnd,
    tone: body.tone || "firm",
    nudgeIntensity: body.nudgeIntensity || "medium",
    weekendsEnabled: body.weekendsEnabled ?? true,
    autoplanEnabled: body.autoplanEnabled ?? true,
  });

  if (!result.ok) {
    return res.status(500).json({ error: "Could not save agent settings", reason: result.reason || "unknown" });
  }
  return res.status(200).json({ ok: true, profile: result.profile });
}
