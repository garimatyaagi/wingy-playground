import {
  getAgentProfileByUserId,
  upsertAgentProfile,
} from "./_store.js";

export default async function handler(req, res) {
  if (req.method === "GET") {
    const userId = String(req.query?.userId || "").trim();
    if (!userId) return res.status(400).json({ error: "Missing userId" });
    const profile = await getAgentProfileByUserId(userId);
    return res.status(200).json({ profile });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body || {};
  const userId = String(body.userId || "").trim();
  if (!userId) return res.status(400).json({ error: "Missing userId" });

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
