import {
  morningBriefFromPayload,
  eveningFollowupFromPayload,
  replanFromPayload,
} from "./_shared.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { action, ...payload } = req.body || {};
  if (!action) return res.status(400).json({ error: "Missing action parameter" });

  try {
    switch (action) {
      case "morning_brief": {
        const message = morningBriefFromPayload(payload);
        return res.status(200).json({ message });
      }
      case "evening_followup": {
        const message = eveningFollowupFromPayload(payload);
        return res.status(200).json({ message });
      }
      case "replan": {
        const proposal = replanFromPayload(payload);
        return res.status(200).json(proposal);
      }
      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (error) {
    console.error(`dispatch error (${action}):`, error);
    return res.status(500).json({ error: `Could not process action: ${action}` });
  }
}
