import { classifyIncomingText } from "./_shared.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { text } = req.body || {};
    const parsed = classifyIncomingText(text || "");
    return res.status(200).json(parsed);
  } catch (error) {
    console.error("agent parse error", { error });
    return res.status(500).json({ error: "Could not parse message" });
  }
}
