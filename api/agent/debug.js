import {
  fetchAgentDebug,
  getSupabaseAdmin,
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

  const action = String(req.query?.action || "").trim();

  if (action === "test-create") {
    const userId = String(req.query?.userId || "").trim();
    if (!userId) return res.status(400).json({ error: "Missing userId" });
    const supabase = getSupabaseAdmin();
    if (!supabase) return res.status(500).json({ error: "No supabase client" });

    const goalResult = await supabase
      .from("tasks")
      .select("id, title, status, created_at, user_id")
      .limit(5);
    const goalInsert = await supabase
      .from("tasks")
      .insert({ title: "Debug test goal", user_id: userId })
      .select("id, title")
      .single();
    let stepInsert = null;
    if (goalInsert.data?.id) {
      stepInsert = await supabase
        .from("task_steps")
        .insert({ task_id: goalInsert.data.id, text: "Debug test step", done: false, minutes: 15 })
        .select("id, task_id, text")
        .single();
    }
    return res.status(200).json({
      goalSelect: { data: goalResult.data, error: goalResult.error },
      goalInsert: { data: goalInsert.data, error: goalInsert.error },
      stepInsert: stepInsert ? { data: stepInsert.data, error: stepInsert.error } : "skipped_no_goal",
      supabaseKeyType: process.env.SUPABASE_SERVICE_ROLE_KEY ? "service_role" : "anon_or_vite",
    });
  }

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
