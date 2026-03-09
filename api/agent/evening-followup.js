import { eveningFollowupFromPayload } from "./_shared.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const message = eveningFollowupFromPayload(req.body || {});
    return res.status(200).json({ message });
  } catch (error) {
    console.error("evening followup error", { error });
    return res.status(500).json({ error: "Could not generate evening follow-up" });
  }
}
