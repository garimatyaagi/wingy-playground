import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  "";

const DEFAULT_WORKDAY_START = "09:00";
const DEFAULT_WORKDAY_END = "18:00";
const DEFAULT_MORNING_TIME = "08:00";
const DEFAULT_MIDDAY_TIME = "12:30";
const DEFAULT_AFTERNOON_TIME = "16:00";
const DEFAULT_EVENING_TIME = "20:30";

let cachedClient = null;

function isMissingTable(error) {
  return String(error?.code || "") === "42P01";
}

function isMissingColumn(error) {
  return String(error?.code || "") === "42703";
}

function parseMaybeJson(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function safeIsoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizePhone(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withoutPrefix = raw.replace(/^whatsapp:/i, "");
  const digits = withoutPrefix.replace(/[^\d+]/g, "");
  if (!digits) return "";
  return digits.startsWith("+") ? digits : `+${digits}`;
}

export function toWhatsAppAddress(value) {
  const normalized = normalizePhone(value);
  return normalized ? `whatsapp:${normalized}` : "";
}

export function getSupabaseAdmin() {
  if (cachedClient) return cachedClient;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("agent store configuration missing", {
      hasSupabaseUrl: Boolean(SUPABASE_URL),
      hasSupabaseKey: Boolean(SUPABASE_KEY),
    });
    return null;
  }
  cachedClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return cachedClient;
}

export async function upsertAgentProfile({
  userId,
  whatsappNumber,
  timezone,
  morningBriefTime,
  middayNudgeTime,
  afternoonFollowupTime,
  eveningCheckinTime,
  workdayStart,
  workdayEnd,
  tone,
  nudgeIntensity,
  weekendsEnabled,
  autoplanEnabled,
}) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !userId) return { ok: false, reason: "missing_supabase_or_user" };

  const row = {
    user_id: userId,
    whatsapp_number: normalizePhone(whatsappNumber),
    timezone: timezone || "Asia/Kolkata",
    morning_brief_time: morningBriefTime || DEFAULT_MORNING_TIME,
    midday_nudge_time: middayNudgeTime || DEFAULT_MIDDAY_TIME,
    afternoon_followup_time: afternoonFollowupTime || DEFAULT_AFTERNOON_TIME,
    evening_checkin_time: eveningCheckinTime || DEFAULT_EVENING_TIME,
    workday_start: workdayStart || DEFAULT_WORKDAY_START,
    workday_end: workdayEnd || DEFAULT_WORKDAY_END,
    tone: tone || "firm",
    nudge_intensity: nudgeIntensity || "medium",
    weekends_enabled: weekendsEnabled ?? true,
    autoplan_enabled: autoplanEnabled ?? true,
    active: true,
    updated_at: new Date().toISOString(),
  };

  const upsert = await supabase
    .from("agent_profiles")
    .upsert(row, { onConflict: "user_id" })
    .select(
      "user_id, whatsapp_number, timezone, morning_brief_time, midday_nudge_time, afternoon_followup_time, evening_checkin_time, workday_start, workday_end, tone, nudge_intensity, weekends_enabled, autoplan_enabled, active, updated_at"
    )
    .single();
  if (!upsert.error) return { ok: true, profile: normalizeProfileRow(upsert.data) };
  if (isMissingTable(upsert.error)) {
    console.error("agent_profiles table missing", { error: upsert.error });
    return { ok: false, reason: "missing_table" };
  }
  console.error("upsertAgentProfile failed", { error: upsert.error, row });
  return { ok: false, reason: "db_error", error: upsert.error };
}

function normalizeProfileRow(row = {}) {
  return {
    userId: row.user_id || "",
    whatsAppNumber: normalizePhone(row.whatsapp_number || ""),
    timezone: row.timezone || "Asia/Kolkata",
    morningBriefTime: row.morning_brief_time || DEFAULT_MORNING_TIME,
    middayNudgeTime: row.midday_nudge_time || DEFAULT_MIDDAY_TIME,
    afternoonFollowupTime: row.afternoon_followup_time || DEFAULT_AFTERNOON_TIME,
    eveningCheckinTime: row.evening_checkin_time || DEFAULT_EVENING_TIME,
    workdayStart: row.workday_start || DEFAULT_WORKDAY_START,
    workdayEnd: row.workday_end || DEFAULT_WORKDAY_END,
    tone: row.tone || "firm",
    nudgeIntensity: row.nudge_intensity || "medium",
    weekendsEnabled: row.weekends_enabled ?? true,
    autoplanEnabled: row.autoplan_enabled ?? true,
    active: row.active ?? true,
    google_refresh_token: row.google_refresh_token || "",
    googleCalendarConnected: Boolean(row.google_calendar_connected),
  };
}

export async function getAgentProfileByUserId(userId) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !userId) return null;
  const query = await supabase
    .from("agent_profiles")
    .select(
      "user_id, whatsapp_number, timezone, morning_brief_time, midday_nudge_time, afternoon_followup_time, evening_checkin_time, workday_start, workday_end, tone, nudge_intensity, weekends_enabled, autoplan_enabled, active, google_refresh_token, google_calendar_connected"
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (query.error) {
    if (!isMissingTable(query.error)) {
      console.error("getAgentProfileByUserId failed", { error: query.error, userId });
    }
    return null;
  }
  return query.data ? normalizeProfileRow(query.data) : null;
}

export async function listActiveProfiles() {
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];
  const query = await supabase
    .from("agent_profiles")
    .select(
      "user_id, whatsapp_number, timezone, morning_brief_time, midday_nudge_time, afternoon_followup_time, evening_checkin_time, workday_start, workday_end, tone, nudge_intensity, weekends_enabled, autoplan_enabled, active, google_refresh_token, google_calendar_connected"
    )
    .eq("active", true);
  if (query.error) {
    if (!isMissingTable(query.error)) {
      console.error("listActiveProfiles failed", { error: query.error });
    }
    return [];
  }
  return (query.data || []).map((row) => normalizeProfileRow(row)).filter((row) => row.userId);
}

export async function resolveInboundUser(fromValue) {
  const supabase = getSupabaseAdmin();
  const normalized = normalizePhone(fromValue);
  if (!supabase || !normalized) {
    const fallback = process.env.AGENT_DEFAULT_USER_ID || "";
    return fallback ? { userId: fallback, profile: null, fromNumber: normalized } : null;
  }
  const query = await supabase
    .from("agent_profiles")
    .select(
      "user_id, whatsapp_number, timezone, morning_brief_time, midday_nudge_time, afternoon_followup_time, evening_checkin_time, workday_start, workday_end, tone, nudge_intensity, weekends_enabled, autoplan_enabled, active"
    )
    .eq("whatsapp_number", normalized)
    .eq("active", true)
    .maybeSingle();

  if (!query.error && query.data?.user_id) {
    return {
      userId: query.data.user_id,
      profile: normalizeProfileRow(query.data),
      fromNumber: normalized,
    };
  }
  if (query.error && !isMissingTable(query.error)) {
    console.error("resolveInboundUser lookup failed", { error: query.error, normalized });
  }
  const fallback = process.env.AGENT_DEFAULT_USER_ID || "";
  if (fallback) {
    console.warn("resolveInboundUser fallback to default user", { fromNumber: normalized, fallbackUserId: fallback });
    return { userId: fallback, profile: null, fromNumber: normalized, fallback: true };
  }
  return null;
}

async function listGoalsForUserRaw(supabase, userId) {
  const rich = await supabase
    .from("tasks")
    .select("id, title, status, created_at, user_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (!rich.error) return rich.data || [];
  if (isMissingColumn(rich.error)) {
    const fallback = await supabase
      .from("tasks")
      .select("id, title, status, created_at")
      .order("created_at", { ascending: true });
    if (!fallback.error) return fallback.data || [];
    throw fallback.error;
  }
  throw rich.error;
}

export async function findOrCreateGoal(userId, goalName) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !userId) return null;
  const normalizedName = String(goalName || "Inbox / Unassigned").trim() || "Inbox / Unassigned";
  try {
    const goals = await listGoalsForUserRaw(supabase, userId);
    const existing = goals.find(
      (goal) => String(goal.title || "").toLowerCase() === normalizedName.toLowerCase()
    );
    if (existing?.id) return existing;

    const fullInsert = await supabase
      .from("tasks")
      .insert({
        title: normalizedName,
        description: "",
        status: "active",
        progress_type: "checklist",
        target_value: 100,
        current_value: 0,
        color: "#8a2f2a",
        user_id: userId,
      })
      .select("id, title, status, created_at")
      .single();
    if (!fullInsert.error) return fullInsert.data;
    if (isMissingColumn(fullInsert.error)) {
      const fallback = await supabase
        .from("tasks")
        .insert({ title: normalizedName })
        .select("id, title, status, created_at")
        .single();
      if (!fallback.error) return fallback.data;
      throw fallback.error;
    }
    throw fullInsert.error;
  } catch (error) {
    console.error("findOrCreateGoal failed", { error, userId, goalName: normalizedName });
    return null;
  }
}

export async function listOpenTasks(userId) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !userId) return [];
  try {
    const goals = await listGoalsForUserRaw(supabase, userId);
    const goalMap = new Map(goals.map((goal) => [goal.id, goal]));
    const goalIds = goals.map((goal) => goal.id).filter(Boolean);
    if (goalIds.length === 0) return [];

    const richSelect =
      "id, task_id, text, done, minutes, estimate_minutes, next_action, completed_at, created_at, updated_at, due_date, urgency, importance, is_blocked, blocked_by_task_id, ai_confidence, source_type, is_note, suggested_time_slot, type, status, priority_score, effort_type, description, recurrence_rule, is_recurring, actual_minutes, scheduled_date, scheduled_start, scheduled_end, avoidance_score, reschedule_count";
    const first = await supabase
      .from("task_steps")
      .select(richSelect)
      .in("task_id", goalIds)
      .not("status", "in", '("archived","cancelled","done")')
      .order("created_at", { ascending: false });
    let rows = [];
    if (!first.error) {
      rows = first.data || [];
    } else if (isMissingColumn(first.error)) {
      const fallback = await supabase
        .from("task_steps")
        .select("id, task_id, text, done, minutes, created_at")
        .in("task_id", goalIds)
        .order("created_at", { ascending: false });
      if (fallback.error) throw fallback.error;
      rows = fallback.data || [];
    } else {
      throw first.error;
    }

    return rows.map((row) => {
      const done = Boolean(row.done) || row.status === "done" || Boolean(row.completed_at);
      const estimate =
        Number.isFinite(row.estimate_minutes) && row.estimate_minutes > 0
          ? row.estimate_minutes
          : Number.isFinite(row.minutes) && row.minutes > 0
            ? row.minutes
            : 30;
      const recurrenceRule = parseMaybeJson(row.recurrence_rule, null);
      return {
        id: row.id,
        goalId: row.task_id,
        goalTitle: goalMap.get(row.task_id)?.title || "Unassigned",
        title: row.text || "",
        normalizedTitle: String(row.text || "").toLowerCase().trim(),
        status: done ? "completed" : row.status || "open",
        done,
        dueDate: safeIsoDate(row.due_date),
        scheduledDate: safeIsoDate(row.scheduled_date),
        estimatedMinutes: estimate,
        actualMinutes: Number.isFinite(row.actual_minutes) ? row.actual_minutes : 0,
        urgency: Number.isFinite(row.urgency) ? row.urgency : 2,
        importance: Number.isFinite(row.importance) ? row.importance : 3,
        isRecurring: Boolean(row.is_recurring) || row.type === "recurring",
        recurrenceRule,
        rescheduleCount: Number.isFinite(row.reschedule_count) ? row.reschedule_count : 0,
        avoidanceScore: Number.isFinite(row.avoidance_score) ? row.avoidance_score : 0,
        blockedByTaskId: row.blocked_by_task_id || null,
        isBlocked: Boolean(row.is_blocked),
        source: row.source_type || "manual",
        createdAt: safeIsoDate(row.created_at) || new Date().toISOString(),
        updatedAt: safeIsoDate(row.updated_at) || new Date().toISOString(),
        completedAt: safeIsoDate(row.completed_at),
      };
    });
  } catch (error) {
    console.error("listOpenTasks failed", { error, userId });
    return [];
  }
}

export async function createTaskStep(userId, taskPayload) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !userId) return null;

  // Idempotency: check for same normalized title by same user within 60s
  const normalizedTitle = (taskPayload.normalizedTitle || taskPayload.title || "").toLowerCase().trim();
  if (normalizedTitle) {
    const cutoff = new Date(Date.now() - 60_000).toISOString();
    const { data: existing } = await supabase
      .from("task_steps")
      .select("id, task_id, text, due_date, is_recurring, recurrence_rule, created_at, status")
      .eq("user_id", userId)
      .eq("normalized_title", normalizedTitle)
      .gte("created_at", cutoff)
      .limit(1)
      .maybeSingle();
    if (existing?.id) {
      console.warn("createTaskStep idempotency hit", { userId, normalizedTitle, existingId: existing.id });
      return { ...existing, goalId: null, goalTitle: null };
    }
  }

  const goal = await findOrCreateGoal(userId, taskPayload.goalName || "Inbox / Unassigned");
  if (!goal?.id) return null;
  const isRecurring = Boolean(taskPayload.isRecurring);
  const status = taskPayload.status || "open";

  const fullPayload = {
    task_id: goal.id,
    user_id: userId,
    text: taskPayload.title,
    done: status === "completed" || status === "done",
    minutes: Number.isFinite(taskPayload.estimatedMinutes) ? taskPayload.estimatedMinutes : 30,
    estimate_minutes: Number.isFinite(taskPayload.estimatedMinutes) ? taskPayload.estimatedMinutes : 30,
    next_action: taskPayload.nextAction || "",
    completed_at: null,
    due_date: taskPayload.dueDate || null,
    urgency: Number.isFinite(taskPayload.urgency) ? taskPayload.urgency : 2,
    importance: Number.isFinite(taskPayload.importance) ? taskPayload.importance : 3,
    ai_confidence: Number.isFinite(taskPayload.aiConfidence) ? taskPayload.aiConfidence : 0.72,
    source_type: taskPayload.source || "whatsapp",
    is_note: false,
    type: isRecurring ? "recurring" : "one_time",
    status: status === "completed" ? "done" : "active",
    priority_score: Number.isFinite(taskPayload.priorityScore) ? taskPayload.priorityScore : 0,
    effort_type: taskPayload.effortType || "deep_work",
    description: taskPayload.description || "",
    recurrence_rule: taskPayload.recurrenceRule || null,
    is_recurring: isRecurring,
    actual_minutes: Number.isFinite(taskPayload.actualMinutes) ? taskPayload.actualMinutes : 0,
    scheduled_date: taskPayload.scheduledDate || null,
    avoidance_score: Number.isFinite(taskPayload.avoidanceScore) ? taskPayload.avoidanceScore : 0,
    reschedule_count: Number.isFinite(taskPayload.rescheduleCount) ? taskPayload.rescheduleCount : 0,
    normalized_title: taskPayload.normalizedTitle || taskPayload.title.toLowerCase().trim(),
    raw_source_text: taskPayload.rawSourceText || "",
    source: taskPayload.source || "whatsapp",
    completion_confidence: Number.isFinite(taskPayload.completionConfidence)
      ? taskPayload.completionConfidence
      : null,
  };

  const first = await supabase
    .from("task_steps")
    .insert(fullPayload)
    .select("id, task_id, text, due_date, is_recurring, recurrence_rule, created_at, status")
    .single();
  if (!first.error) {
    return {
      ...first.data,
      goalId: goal.id,
      goalTitle: goal.title,
    };
  }

  if (isMissingColumn(first.error)) {
    const fallback = await supabase
      .from("task_steps")
      .insert({
        task_id: goal.id,
        user_id: userId,
        text: taskPayload.title,
        done: false,
        minutes: Number.isFinite(taskPayload.estimatedMinutes) ? taskPayload.estimatedMinutes : 30,
      })
      .select("id, task_id, text, created_at")
      .single();
    if (!fallback.error) {
      return {
        ...fallback.data,
        goalId: goal.id,
        goalTitle: goal.title,
      };
    }
    console.error("createTaskStep fallback failed", { error: fallback.error, userId, taskPayload });
    return null;
  }

  console.error("createTaskStep failed", { error: first.error, userId, taskPayload });
  return null;
}

export async function updateTaskStep(taskId, goalId, patch) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !taskId || !goalId) return { ok: false };
  const fullPatch = {
    text: patch.title,
    done: patch.done,
    minutes: patch.estimatedMinutes,
    estimate_minutes: patch.estimatedMinutes,
    next_action: patch.nextAction,
    completed_at: patch.completedAt,
    due_date: patch.dueDate,
    urgency: patch.urgency,
    importance: patch.importance,
    ai_confidence: patch.aiConfidence,
    source_type: patch.source,
    type: patch.type,
    status: patch.status,
    priority_score: patch.priorityScore,
    effort_type: patch.effortType,
    description: patch.description,
    recurrence_rule: patch.recurrenceRule,
    is_recurring: patch.isRecurring,
    actual_minutes: patch.actualMinutes,
    scheduled_date: patch.scheduledDate,
    avoidance_score: patch.avoidanceScore,
    reschedule_count: patch.rescheduleCount,
    completion_confidence: patch.completionConfidence,
    updated_at: new Date().toISOString(),
  };
  const first = await supabase.from("task_steps").update(fullPatch).eq("id", taskId).eq("task_id", goalId);
  if (!first.error) return { ok: true };
  if (isMissingColumn(first.error)) {
    const fallback = await supabase
      .from("task_steps")
      .update({
        text: patch.title,
        done: patch.done,
        minutes: patch.estimatedMinutes,
        completed_at: patch.completedAt,
      })
      .eq("id", taskId)
      .eq("task_id", goalId);
    if (!fallback.error) return { ok: true };
    console.error("updateTaskStep fallback failed", { error: fallback.error, taskId, goalId, patch });
    return { ok: false, error: fallback.error };
  }
  console.error("updateTaskStep failed", { error: first.error, taskId, goalId, patch });
  return { ok: false, error: first.error };
}

export async function findCaptureByMessageSid(messageSid) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !messageSid) return null;
  const { data, error } = await supabase
    .from("message_captures")
    .select("id, processed, processing_result")
    .eq("message_sid", messageSid)
    .maybeSingle();
  if (error) {
    if (!isMissingColumn(error) && !isMissingTable(error)) {
      console.error("findCaptureByMessageSid failed", { error, messageSid });
    }
    return null;
  }
  return data || null;
}

export async function logMessageCapture({
  userId,
  rawText,
  messageSid,
  normalizedText,
  fromNumber,
  parsedIntent,
  parseConfidence,
  parseMethod,
  parseDurationMs,
  processed = false,
  createdTaskIds = [],
  updatedTaskIds = [],
  clarificationRequested = false,
  processingResult = "",
  contextSnapshot,
  errorDetail,
}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;
  const payload = {
    user_id: userId || null,
    channel: "whatsapp",
    raw_text: rawText || "",
    message_sid: messageSid || null,
    normalized_text: normalizedText || null,
    from_number: fromNumber || null,
    parsed_intent: parsedIntent || "unknown",
    parse_confidence: Number.isFinite(parseConfidence) ? parseConfidence : 0,
    parse_method: parseMethod || null,
    parse_duration_ms: parseDurationMs || null,
    processed,
    created_task_ids: createdTaskIds,
    updated_task_ids: updatedTaskIds,
    clarification_requested: clarificationRequested,
    processing_result: processingResult,
    context_snapshot: contextSnapshot || null,
    error_detail: errorDetail || null,
    created_at: new Date().toISOString(),
  };
  const first = await supabase
    .from("message_captures")
    .insert(payload)
    .select("id")
    .single();
  if (!first.error) return first.data?.id || null;
  if (isMissingColumn(first.error)) {
    const fallback = await supabase
      .from("message_captures")
      .insert({
        user_id: userId || null,
        channel: "whatsapp",
        raw_text: rawText || "",
        parsed_intent: parsedIntent || "unknown",
      })
      .select("id")
      .single();
    if (!fallback.error) return fallback.data?.id || null;
  }
  if (!isMissingTable(first.error)) {
    console.error("logMessageCapture failed", { error: first.error, payload });
  }
  return null;
}

export async function updateMessageCapture(captureId, patch = {}) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !captureId) return;
  const payload = {
    parsed_intent: patch.parsedIntent,
    parse_confidence: patch.parseConfidence,
    parse_method: patch.parseMethod,
    parse_duration_ms: patch.parseDurationMs,
    processed: patch.processed,
    created_task_ids: patch.createdTaskIds,
    updated_task_ids: patch.updatedTaskIds,
    clarification_requested: patch.clarificationRequested,
    processing_result: patch.processingResult,
    context_snapshot: patch.contextSnapshot,
    error_detail: patch.errorDetail,
  };
  // Remove undefined keys so Supabase doesn't null-out fields we didn't pass
  Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);
  const first = await supabase.from("message_captures").update(payload).eq("id", captureId);
  if (!first.error) return;
  if (isMissingColumn(first.error)) {
    await supabase
      .from("message_captures")
      .update({
        parsed_intent: patch.parsedIntent,
        processed: patch.processed,
      })
      .eq("id", captureId);
    return;
  }
  if (!isMissingTable(first.error)) {
    console.error("updateMessageCapture failed", { error: first.error, captureId, patch });
  }
}

export async function logParsedAction({
  captureId,
  userId,
  actionType,
  actionPayload = {},
  targetTaskId,
  result,
  errorDetail,
  confidence = 0,
}) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !userId || !actionType) return null;
  const payload = {
    capture_id: captureId || null,
    user_id: userId,
    action_type: actionType,
    action_payload: actionPayload,
    target_task_id: targetTaskId || null,
    result: result || null,
    error_detail: errorDetail || null,
    confidence: Number.isFinite(confidence) ? confidence : 0,
    created_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from("parsed_message_actions")
    .insert(payload)
    .select("id")
    .single();
  if (error) {
    if (!isMissingTable(error)) {
      console.error("logParsedAction failed", { error, payload });
    }
    return null;
  }
  return data?.id || null;
}

export async function listParsedActions(userId, limit = 20) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !userId) return [];
  const { data, error } = await supabase
    .from("parsed_message_actions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (!isMissingTable(error)) {
      console.error("listParsedActions failed", { error, userId });
    }
    return [];
  }
  return data || [];
}

export async function logTaskEvent(taskId, eventType, metadata = {}) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !taskId || !eventType) return;
  const payload = {
    task_id: taskId,
    event_type: eventType,
    metadata,
    created_at: new Date().toISOString(),
  };
  const first = await supabase.from("task_events").insert(payload);
  if (!first.error || isMissingTable(first.error)) return;
  if (isMissingColumn(first.error)) {
    await supabase.from("task_events").insert({
      task_id: taskId,
      event_type: eventType,
    });
    return;
  }
  console.error("logTaskEvent failed", { error: first.error, payload });
}

export async function fetchLastAgentMessage(userId) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !userId) return null;
  const { data, error } = await supabase
    .from("agent_messages")
    .select("id, type, body, related_task_ids, metadata, sent_at")
    .eq("user_id", userId)
    .order("sent_at", { ascending: false })
    .limit(1)
    .single();
  if (error && !isMissingTable(error)) {
    console.error("fetchLastAgentMessage failed", { error, userId });
  }
  return data || null;
}

export async function fetchLastUserCapture(userId) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !userId) return null;
  const { data, error } = await supabase
    .from("message_captures")
    .select("id, raw_text, parsed_intent, clarification_requested, processing_result, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (error && !isMissingTable(error)) {
    console.error("fetchLastUserCapture failed", { error, userId });
  }
  return data || null;
}

export async function logAgentMessage({
  userId,
  type,
  body,
  relatedTaskIds = [],
  metadata = {},
}) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !userId || !type || !body) return null;
  const payload = {
    user_id: userId,
    type,
    body,
    related_task_ids: relatedTaskIds,
    metadata,
    sent_at: new Date().toISOString(),
  };
  const first = await supabase
    .from("agent_messages")
    .insert(payload)
    .select("id, sent_at")
    .single();
  if (!first.error) return first.data || null;
  if (isMissingColumn(first.error)) {
    const fallback = await supabase
      .from("agent_messages")
      .insert({
        user_id: userId,
        type,
        body,
      })
      .select("id, sent_at")
      .single();
    if (!fallback.error) return fallback.data || null;
  }
  if (!isMissingTable(first.error)) {
    console.error("logAgentMessage failed", { error: first.error, payload });
  }
  return null;
}

export async function saveDailyPlan({
  userId,
  date,
  topPriorityTaskIds,
  nextBestTaskId,
  dueTodayTaskIds,
  overdueTaskIds,
  nudgeCandidateTaskIds,
  deferredTaskIds,
  planSummary,
  version,
}) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !userId || !date) return null;
  const payload = {
    user_id: userId,
    date,
    top_priority_task_ids: topPriorityTaskIds || [],
    next_best_task_id: nextBestTaskId || null,
    due_today_task_ids: dueTodayTaskIds || [],
    overdue_task_ids: overdueTaskIds || [],
    nudge_candidate_task_ids: nudgeCandidateTaskIds || [],
    deferred_task_ids: deferredTaskIds || [],
    plan_summary: planSummary || "",
    plan_version: version || null,
    updated_at: new Date().toISOString(),
  };

  const first = await supabase
    .from("daily_plans")
    .upsert(payload, { onConflict: "user_id,date" })
    .select(
      "id, user_id, date, top_priority_task_ids, next_best_task_id, due_today_task_ids, overdue_task_ids, nudge_candidate_task_ids, deferred_task_ids, plan_summary, updated_at"
    )
    .single();
  if (!first.error) return first.data || null;

  if (isMissingColumn(first.error)) {
    const fallback = await supabase
      .from("daily_plans")
      .upsert(
        {
          user_id: userId,
          date,
          top_priority_task_ids: topPriorityTaskIds || [],
          next_best_task_id: nextBestTaskId || null,
        },
        { onConflict: "user_id,date" }
      )
      .select("id, user_id, date, top_priority_task_ids, next_best_task_id, updated_at")
      .single();
    if (!fallback.error) return fallback.data || null;
  }
  if (!isMissingTable(first.error)) {
    console.error("saveDailyPlan failed", { error: first.error, payload });
  }
  return null;
}

export async function getDailyPlan(userId, date) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !userId || !date) return null;
  const first = await supabase
    .from("daily_plans")
    .select(
      "id, user_id, date, top_priority_task_ids, next_best_task_id, due_today_task_ids, overdue_task_ids, nudge_candidate_task_ids, deferred_task_ids, plan_summary, updated_at"
    )
    .eq("user_id", userId)
    .eq("date", date)
    .maybeSingle();
  if (first.error) {
    if (!isMissingTable(first.error)) {
      console.error("getDailyPlan failed", { error: first.error, userId, date });
    }
    return null;
  }
  return first.data || null;
}

export async function saveTaskOccurrence({
  parentTaskId,
  date,
  status,
  actualMinutes,
  skipped,
  completedAt,
  rescheduledTo,
}) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !parentTaskId || !date) return null;
  const payload = {
    parent_task_id: parentTaskId,
    date,
    status: status || "pending",
    actual_minutes: Number.isFinite(actualMinutes) ? actualMinutes : 0,
    skipped: Boolean(skipped),
    completed_at: completedAt || null,
    rescheduled_to: rescheduledTo || null,
    updated_at: new Date().toISOString(),
  };
  const upsert = await supabase
    .from("task_occurrences")
    .upsert(payload, { onConflict: "parent_task_id,date" })
    .select("id, parent_task_id, date, status, actual_minutes, skipped, completed_at")
    .single();
  if (!upsert.error) return upsert.data || null;
  if (!isMissingTable(upsert.error)) {
    console.error("saveTaskOccurrence failed", { error: upsert.error, payload });
  }
  return null;
}

export async function saveAgentNote({ userId, text, rawText }) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !userId || !text) return null;
  const first = await supabase
    .from("agent_notes")
    .insert({
      user_id: userId,
      text,
      raw_source_text: rawText || text,
      source: "whatsapp",
      created_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (!first.error) return first.data?.id || null;
  if (!isMissingTable(first.error) && !isMissingColumn(first.error)) {
    console.error("saveAgentNote failed", { error: first.error, userId });
  }
  return null;
}

export async function fetchRecentContext(userId, limit = 12) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !userId) {
    return { recentMessages: [], recentCaptures: [] };
  }
  const [messagesResult, capturesResult] = await Promise.all([
    supabase
      .from("agent_messages")
      .select("id, type, body, related_task_ids, sent_at")
      .eq("user_id", userId)
      .order("sent_at", { ascending: false })
      .limit(limit),
    supabase
      .from("message_captures")
      .select("id, raw_text, parsed_intent, parse_confidence, processed, created_task_ids, updated_task_ids, clarification_requested, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);

  if (messagesResult.error && !isMissingTable(messagesResult.error)) {
    console.error("fetchRecentContext messages failed", { error: messagesResult.error, userId });
  }
  if (capturesResult.error && !isMissingTable(capturesResult.error)) {
    console.error("fetchRecentContext captures failed", { error: capturesResult.error, userId });
  }
  return {
    recentMessages: messagesResult.data || [],
    recentCaptures: capturesResult.data || [],
  };
}

export async function listAgentMessagesForDate(userId, dateKey) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !userId || !dateKey) return [];
  const fromIso = `${dateKey}T00:00:00.000Z`;
  const toIso = `${dateKey}T23:59:59.999Z`;
  const query = await supabase
    .from("agent_messages")
    .select("id, type, body, related_task_ids, sent_at")
    .eq("user_id", userId)
    .gte("sent_at", fromIso)
    .lte("sent_at", toIso)
    .order("sent_at", { ascending: true });
  if (query.error) {
    if (!isMissingTable(query.error)) {
      console.error("listAgentMessagesForDate failed", { error: query.error, userId, dateKey });
    }
    return [];
  }
  return query.data || [];
}

export async function fetchAgentDebug(userId, limit = 30) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !userId) {
    return {
      captures: [],
      agentMessages: [],
      taskEvents: [],
      dailyPlans: [],
      openTasks: [],
    };
  }
  const [captures, messages, events, plans] = await Promise.all([
    supabase
      .from("message_captures")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("agent_messages")
      .select("*")
      .eq("user_id", userId)
      .order("sent_at", { ascending: false })
      .limit(limit),
    supabase
      .from("task_events")
      .select("id, task_id, event_type, metadata, created_at")
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("daily_plans")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(10),
  ]);
  const openTasks = await listOpenTasks(userId);

  return {
    captures: captures.data || [],
    agentMessages: messages.data || [],
    taskEvents: events.data || [],
    dailyPlans: plans.data || [],
    openTasks,
  };
}

export async function fetchOverdueTasks(userId) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !userId) return [];
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("task_steps")
    .select("*")
    .eq("user_id", userId)
    .eq("done", false)
    .not("due_date", "is", null)
    .lt("due_date", now)
    .order("due_date", { ascending: true })
    .limit(20);
  if (error) {
    console.error("fetchOverdueTasks error:", error);
    return [];
  }
  return data || [];
}

export async function fetchTaskPostponeCount(taskId) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !taskId) return 0;
  const { count, error } = await supabase
    .from("task_events")
    .select("id", { count: "exact", head: true })
    .eq("task_id", taskId)
    .eq("event_type", "rescheduled");
  if (error) return 0;
  return count || 0;
}
