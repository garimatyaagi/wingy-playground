import crypto from "crypto";
import {
  fetchAgentDebug,
  getSupabaseAdmin,
  listParsedActions,
  normalizePhone,
  resolveInboundUser,
} from "./_store.js";
import {
  buildMessageContext,
  detectBehaviorPatterns,
  parseMessageIntentWithLLM,
  recomputeDailyPlan,
} from "./_engine.js";

function isDebugAuthorized(req) {
  const required = (process.env.AGENT_DEBUG_KEY || "").trim();
  if (!required) return false; // Block ALL access if key is not configured
  const supplied = String(req.headers["x-agent-debug-key"] || "").trim();
  if (!supplied || supplied.length !== required.length) return false;
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(required));
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!isDebugAuthorized(req)) return res.status(403).json({ error: "Forbidden" });

  const action = String(req.query?.action || "").trim();

  // Check Twilio message delivery status + account info
  if (action === "twilio-check") {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_WHATSAPP_FROM || "";
    if (!accountSid || !authToken) {
      return res.status(500).json({ error: "Missing Twilio credentials" });
    }
    const authHeader = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const messageSid = String(req.query?.sid || "").trim();

    // If a specific message SID is provided, check its status
    if (messageSid) {
      const msgResp = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${messageSid}.json`,
        { headers: { Authorization: `Basic ${authHeader}` } }
      );
      const msgData = await msgResp.json().catch(() => null);
      return res.status(200).json({
        sid: messageSid,
        status: msgData?.status,
        errorCode: msgData?.error_code,
        errorMessage: msgData?.error_message,
        to: msgData?.to,
        from: msgData?.from,
        dateSent: msgData?.date_sent,
        direction: msgData?.direction,
      });
    }

    // Otherwise list recent messages
    const listResp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json?PageSize=10`,
      { headers: { Authorization: `Basic ${authHeader}` } }
    );
    const listData = await listResp.json().catch(() => null);
    const messages = (listData?.messages || []).map((m) => ({
      sid: m.sid,
      status: m.status,
      direction: m.direction,
      from: m.from,
      to: m.to,
      body: (m.body || "").slice(0, 80),
      errorCode: m.error_code,
      errorMessage: m.error_message,
      dateSent: m.date_sent,
    }));
    return res.status(200).json({ fromNumber, accountSid: accountSid.slice(0, 8) + "...", messages });
  }

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
      supabaseKeyType: "redacted",
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

  // Parse-test: test the parser with raw text
  if (action === "parse-test") {
    const text = String(req.query?.text || "").trim();
    if (!text) return res.status(400).json({ error: "Missing text param" });
    const result = await parseMessageIntentWithLLM(text, resolvedUserId, new Date());
    return res.status(200).json({ userId: resolvedUserId, input: text, result });
  }

  // Context: view the full context bundle
  if (action === "context") {
    const ctx = await buildMessageContext(resolvedUserId, new Date());
    return res.status(200).json({
      userId: resolvedUserId,
      generatedAt: new Date().toISOString(),
      openTasks: ctx.openTasks.length,
      overdueTasks: ctx.overdueTasks.length,
      dueTodayTasks: ctx.dueTodayTasks.length,
      recurringDueToday: ctx.recurringDueToday.length,
      lastNudgedTaskId: ctx.lastNudgedTaskId,
      preferredTaskIds: ctx.preferredTaskIds,
      recentCompletions: ctx.recentCompletions.length,
    });
  }

  // Actions: list parsed_message_actions audit trail
  if (action === "actions") {
    const limit = Math.min(100, Number(req.query?.limit || 20));
    const actions = await listParsedActions(resolvedUserId, limit);
    return res.status(200).json({ userId: resolvedUserId, count: actions.length, actions });
  }

  // Behavior: run behavior pattern detection
  if (action === "behavior") {
    const planState = await recomputeDailyPlan({ userId: resolvedUserId, date: new Date() });
    const behavior = detectBehaviorPatterns(planState, [], new Date().toISOString().slice(0, 10));
    return res.status(200).json({ userId: resolvedUserId, behavior });
  }

  const data = await fetchAgentDebug(resolvedUserId, 30);
  return res.status(200).json({
    userId: resolvedUserId,
    generatedAt: new Date().toISOString(),
    ...data,
  });
}
