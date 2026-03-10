import {
  fetchAgentDebug,
  normalizePhone,
  resolveInboundUser,
} from "./_store.js";

function isDebugAuthorized(req) {
  const required = process.env.AGENT_DEBUG_KEY || "";
  if (!required) return true;
  const supplied = String(req.query?.key || req.headers["x-agent-debug-key"] || "");
  return supplied === required;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!isDebugAuthorized(req)) return res.status(403).json({ error: "Forbidden" });

  const userId = String(req.query?.userId || "").trim();
  const from = normalizePhone(String(req.query?.from || ""));
  let resolvedUserId = userId;

  if (!resolvedUserId && from) {
    const inbound = await resolveInboundUser(from);
    resolvedUserId = inbound?.userId || "";
  }
  if (!resolvedUserId) return res.status(400).json({ error: "Missing userId or from" });

  const data = await fetchAgentDebug(resolvedUserId, 30);
  return res.status(200).json({
    userId: resolvedUserId,
    generatedAt: new Date().toISOString(),
    ...data,
  });
}
