import { replanFromPayload } from "./_shared.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const proposal = replanFromPayload(req.body || {});
    return res.status(200).json(proposal);
  } catch (error) {
    console.error("agent replan error", { error });
    return res.status(500).json({ error: "Could not build replan" });
  }
}
