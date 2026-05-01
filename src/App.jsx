import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SignedIn,
  SignedOut,
  SignIn,
  SignUp,
  UserButton,
  useAuth,
  useUser,
} from "@clerk/clerk-react";
import ExecutionHeader from "./components/ExecutionHeader";
import TaskDrawer from "./components/TaskDrawer";
import TodaySurface from "./components/TodaySurface";
import InboxSurface from "./components/InboxSurface";
import GoalsSurface from "./components/GoalsSurface";
import AgentSettingsSurface from "./components/AgentSettingsSurface";
import Onboarding from "./components/Onboarding";
import useRealtimeSync from "./hooks/useRealtimeSync";
import {
  buildAccountabilityFeed,
  buildCommandCenter,
  buildDailyPlan,
  buildReplanProposal,
  computeExecutionMetrics,
  computeYearSnapshot,
  computeWeeklyMomentum,
  detectProcrastinationSignals,
  defaultAvailabilityWindows,
  defaultTaskOccurrence,
  defaultTaskModel,
  enrichTaskFromStep,
  formatFriendlyDate,
  getRecurringDueTasks,
  occurrenceKey,
  parseIntakeInput,
  prioritizeTasks,
  rebalanceFutureDays,
  taskMetaSnapshot,
} from "./lib/executionEngine";
import {
  buildEveningFollowupMessage,
  buildMorningBriefMessage,
  buildReplanMessage,
  classifyWhatsAppCapture,
  createEveningCheckinTemplate,
  pickDailyAccountabilityRule,
  skipReasonToPatch,
  summarizeCheckinOutcome,
} from "./lib/agentLoop";
import { inferBranch } from "./lib/branchConfig";
import { createClerkSupabaseClient } from "./lib/supabaseClient";
import Landing from "./pages/Landing";

const MAX_GOALS = 20;
const WORKSPACE_NAME_KEY = "365_workspace_name_v1";
const NIGHT_MODE_KEY = "365_night_mode_v1";
const TASK_META_KEY = "365_task_meta_v2";
const WORKSPACE_CACHE_KEY = "365_workspace_cache_v2";
const NOTES_KEY = "365_notes_v1";
const OCCURRENCE_KEY = "365_task_occurrences_v1";
const PLANNER_CONSTRAINTS_KEY = "365_planner_constraints_v1";
const COMMITMENTS_KEY = "365_commitments_v1";
const CHECKIN_KEY = "365_checkin_v1";
const TONE_KEY = "365_agent_tone_v1";
const WHATSAPP_FEED_KEY = "365_whatsapp_feed_v1";
const DAILY_PLAN_LOG_KEY = "365_daily_plan_log_v1";
const CHECKIN_LOG_KEY = "365_checkin_log_v1";
const AGENT_SETTINGS_KEY = "365_agent_settings_v1";

function makeId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadJson(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore local storage failures
  }
}

function loadWorkspaceName() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(WORKSPACE_NAME_KEY) || "";
}

function saveWorkspaceName(value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WORKSPACE_NAME_KEY, value);
  } catch {
    // ignore local storage failures
  }
}

function loadNightMode() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(NIGHT_MODE_KEY) === "true";
}

function saveNightMode(enabled) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NIGHT_MODE_KEY, enabled ? "true" : "false");
  } catch {
    // ignore local storage failures
  }
}

function loadAgentTone() {
  if (typeof window === "undefined") return "firm";
  const saved = window.localStorage.getItem(TONE_KEY);
  if (saved === "gentle" || saved === "firm" || saved === "ruthless") return saved;
  return "firm";
}

function saveAgentTone(value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TONE_KEY, value);
  } catch {
    // ignore local storage failures
  }
}

function loadAgentSettings() {
  const parsed = loadJson(AGENT_SETTINGS_KEY, null);
  const tone = loadAgentTone();
  return {
    morningBriefTime: parsed?.morningBriefTime || "08:00",
    middayNudgeTime: parsed?.middayNudgeTime || "12:30",
    afternoonFollowupTime: parsed?.afternoonFollowupTime || "16:00",
    eveningCheckinTime: parsed?.eveningCheckinTime || "20:30",
    workdayStart: parsed?.workdayStart || "09:00",
    workdayEnd: parsed?.workdayEnd || "18:00",
    tone: parsed?.tone || tone,
    nudgeIntensity: parsed?.nudgeIntensity || "medium",
    weekendsEnabled: parsed?.weekendsEnabled ?? true,
    timezone:
      parsed?.timezone ||
      Intl.DateTimeFormat().resolvedOptions().timeZone ||
      "Asia/Kolkata",
    autoplanEnabled: parsed?.autoplanEnabled ?? true,
    whatsAppTo:
      parsed?.whatsAppTo || import.meta.env.VITE_WHATSAPP_TO || "",
  };
}

function isLocalGoal(goalId) {
  return String(goalId).startsWith("local-");
}

function formatSupabaseError(error, fallback) {
  if (!error) return fallback;
  const msg = error.message || "";
  if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("Load failed")) {
    return "Could not connect. Check your internet and refresh.";
  }
  const combined = [msg, error.details, error.hint].filter(Boolean).join(" ");
  return combined || fallback;
}

function mergeTasks(remoteTasks, cachedTasks) {
  const taskById = new Map();
  remoteTasks.forEach((task) => taskById.set(task.id, task));
  cachedTasks.forEach((task) => {
    if (!taskById.has(task.id)) taskById.set(task.id, task);
  });
  return Array.from(taskById.values());
}

function toIsoOrNull(value) {
  if (!value) return null;
  if (typeof value === "number") {
    const fromNum = new Date(value);
    return Number.isNaN(fromNum.getTime()) ? null : fromNum.toISOString();
  }
  const fromString = new Date(value);
  return Number.isNaN(fromString.getTime()) ? null : fromString.toISOString();
}

function defaultCheckinState() {
  return {
    date: new Date().toISOString().slice(0, 10),
    workingHours: "",
    winDefinition: "",
    avoidTask: "",
    nonNegotiable: "",
  };
}

function normalizeCachedGoals(rawGoals, localMeta = {}) {
  if (!Array.isArray(rawGoals)) return [];
  return rawGoals
    .filter((goal) => goal && typeof goal === "object")
    .map((goal) => {
      const goalId = String(goal.id || `local-${makeId()}`);
      const title = String(goal.title || "Untitled goal");
      const tasks = Array.isArray(goal.tasks)
        ? goal.tasks.map((entry) => {
            const taskId = String(entry?.id || `local-task-${makeId()}`);
            const meta = localMeta[taskId] || {};
            const done = Boolean(entry?.done) || entry?.status === "done" || Boolean(entry?.completedAt);
            return defaultTaskModel({
              ...meta,
              id: taskId,
              title: String(entry?.title || entry?.text || meta.title || "Untitled task"),
              description: String(entry?.description || meta.description || ""),
              goalId,
              status: done ? "done" : entry?.status || meta.status || "active",
              type: entry?.type || meta.type || "one_time",
              isRecurring: entry?.isRecurring ?? meta.isRecurring,
              recurrenceRule: entry?.recurrenceRule || meta.recurrenceRule || null,
              estimatedMinutes:
                Number.isFinite(entry?.estimatedMinutes) && entry.estimatedMinutes > 0
                  ? entry.estimatedMinutes
                  : Number.isFinite(entry?.minutes) && entry.minutes > 0
                    ? entry.minutes
                    : meta.estimatedMinutes,
              actualMinutes:
                Number.isFinite(entry?.actualMinutes) && entry.actualMinutes >= 0
                  ? entry.actualMinutes
                  : meta.actualMinutes,
              dueDate: entry?.dueDate || meta.dueDate || null,
              scheduledDate: entry?.scheduledDate || meta.scheduledDate || null,
              scheduledStart: entry?.scheduledStart || meta.scheduledStart || null,
              scheduledEnd: entry?.scheduledEnd || meta.scheduledEnd || null,
              urgency:
                Number.isFinite(entry?.urgency) && entry.urgency > 0 ? entry.urgency : meta.urgency,
              importance:
                Number.isFinite(entry?.importance) && entry.importance > 0
                  ? entry.importance
                  : meta.importance,
              avoidanceScore:
                Number.isFinite(entry?.avoidanceScore) && entry.avoidanceScore >= 0
                  ? entry.avoidanceScore
                  : meta.avoidanceScore,
              rescheduleCount:
                Number.isFinite(entry?.rescheduleCount) && entry.rescheduleCount >= 0
                  ? entry.rescheduleCount
                  : meta.rescheduleCount,
              proofType: entry?.proofType || meta.proofType || "note",
              proofRequired: Boolean(entry?.proofRequired ?? meta.proofRequired),
              proofNote: entry?.proofNote || meta.proofNote || "",
              proofLink: entry?.proofLink || meta.proofLink || "",
              proofProvidedAt: entry?.proofProvidedAt || meta.proofProvidedAt || null,
              commitmentStatus: entry?.commitmentStatus || meta.commitmentStatus || "none",
              commitmentLevel: entry?.commitmentLevel || meta.commitmentLevel || "normal",
              escalationLevel:
                Number.isFinite(entry?.escalationLevel) && entry.escalationLevel >= 0
                  ? entry.escalationLevel
                  : meta.escalationLevel,
              isBlocked: Boolean(entry?.isBlocked ?? meta.isBlocked),
              blockedByTaskId: entry?.blockedByTaskId || meta.blockedByTaskId || null,
              nextAction: entry?.nextAction || meta.nextAction || "",
              isNote: Boolean(entry?.isNote ?? meta.isNote),
              sourceType: entry?.sourceType || meta.sourceType || "manual",
              aiConfidence:
                Number.isFinite(entry?.aiConfidence) && entry.aiConfidence > 0
                  ? entry.aiConfidence
                  : meta.aiConfidence,
              effortType: entry?.effortType || meta.effortType || "deep_work",
              completedAt: done ? toIsoOrNull(entry?.completedAt || meta.completedAt || Date.now()) : null,
              createdAt: toIsoOrNull(entry?.createdAt || meta.createdAt) || new Date().toISOString(),
              updatedAt: toIsoOrNull(entry?.updatedAt || meta.updatedAt) || new Date().toISOString(),
              subtasks: Array.isArray(entry?.subtasks) ? entry.subtasks : meta.subtasks,
            });
          })
        : [];
      return {
        id: goalId,
        title,
        description: String(goal.description || ""),
        status: goal.status || "active",
        progressType: goal.progressType || "checklist",
        targetValue: Number.isFinite(goal.targetValue) ? goal.targetValue : 100,
        currentValue: Number.isFinite(goal.currentValue) ? goal.currentValue : 0,
        color: goal.color || "#3139FB",
        archivedAt: goal.archivedAt || null,
        createdAt: toIsoOrNull(goal.createdAt) || new Date().toISOString(),
        tasks,
      };
    })
    .slice(0, MAX_GOALS);
}

function normalizeOccurrences(rawStore) {
  if (!rawStore || typeof rawStore !== "object") return {};
  return Object.entries(rawStore).reduce((acc, [key, value]) => {
    if (!value || typeof value !== "object") return acc;
    acc[key] = defaultTaskOccurrence({
      ...value,
      id: value.id || key,
      parentTaskId: value.parentTaskId || key.split(":")[0] || "",
      date: value.date || key.split(":")[1] || new Date().toISOString().slice(0, 10),
    });
    return acc;
  }, {});
}

function loadPlannerConstraints() {
  const parsed = loadJson(PLANNER_CONSTRAINTS_KEY, null);
  if (!parsed || typeof parsed !== "object") {
    return {
      dailyCapacityMinutes: 180,
      overflowRule: "push_next_day",
    };
  }
  return {
    dailyCapacityMinutes: Number.isFinite(parsed.dailyCapacityMinutes)
      ? Math.max(60, parsed.dailyCapacityMinutes)
      : 180,
    overflowRule: typeof parsed.overflowRule === "string" ? parsed.overflowRule : "push_next_day",
  };
}

async function fetchStepsWithFallback(supabase, goalIds) {
  if (goalIds.length === 0) return [];
  const richSelect =
    "id, task_id, text, done, minutes, estimate_minutes, next_action, completed_at, created_at, updated_at, due_date, urgency, importance, is_blocked, blocked_by_task_id, ai_confidence, source_type, is_note, suggested_time_slot, type, status, priority_score, effort_type, description, recurrence_rule, is_recurring, actual_minutes, scheduled_date, scheduled_start, scheduled_end, avoidance_score, reschedule_count, proof_type, proof_required, proof_note, proof_link, proof_provided_at, commitment_status, commitment_level, escalation_level";
  const basicSelect = "id, task_id, text, done, minutes, created_at";

  const first = await supabase
    .from("task_steps")
    .select(richSelect)
    .in("task_id", goalIds)
    .order("created_at", { ascending: true });
  if (!first.error) return first.data || [];
  if (String(first.error.code || "") !== "42703") throw first.error;

  const second = await supabase
    .from("task_steps")
    .select(basicSelect)
    .in("task_id", goalIds)
    .order("created_at", { ascending: true });
  if (second.error) throw second.error;
  return second.data || [];
}

export default function App() {
  const isLandingRoute = typeof window !== "undefined" && window.location.pathname === "/";

  const { user } = useUser();
  const { getToken } = useAuth();
  const supabase = useMemo(() => {
    try {
      return createClerkSupabaseClient(getToken);
    } catch {
      return null;
    }
  }, [getToken]);

  const [workspaceName, setWorkspaceName] = useState(loadWorkspaceName);
  const [nightMode, setNightMode] = useState(loadNightMode);
  const [goals, setGoals] = useState(() =>
    normalizeCachedGoals(loadJson(WORKSPACE_CACHE_KEY, []), loadJson(TASK_META_KEY, {}))
  );
  const [taskMetaMap, setTaskMetaMap] = useState(() => loadJson(TASK_META_KEY, {}));
  const [occurrenceStore, setOccurrenceStore] = useState(() =>
    normalizeOccurrences(loadJson(OCCURRENCE_KEY, {}))
  );
  const [plannerConstraints, setPlannerConstraints] = useState(loadPlannerConstraints);
  const [capturedNotes, setCapturedNotes] = useState(() => loadJson(NOTES_KEY, []));
  const [commitments, setCommitments] = useState(() => loadJson(COMMITMENTS_KEY, []));
  const [dailyCheckin, setDailyCheckin] = useState(() => loadJson(CHECKIN_KEY, defaultCheckinState()));
  const [checkinLog, setCheckinLog] = useState(() => loadJson(CHECKIN_LOG_KEY, []));
  const [dailyPlanLog, setDailyPlanLog] = useState(() => loadJson(DAILY_PLAN_LOG_KEY, []));
  const [whatsAppFeed, setWhatsAppFeed] = useState(() => loadJson(WHATSAPP_FEED_KEY, []));
  const [agentTone, setAgentTone] = useState(loadAgentTone);
  const [replanProposal, setReplanProposal] = useState({ needed: false, adjustments: [], summary: "" });
  const [morningBrief, setMorningBrief] = useState("");
  const [morningSending, setMorningSending] = useState(false);
  const [morningSentAt, setMorningSentAt] = useState("");
  const [whatsAppDraft, setWhatsAppDraft] = useState("");
  const [whatsAppParsing, setWhatsAppParsing] = useState(false);
  const [whatsAppPreview, setWhatsAppPreview] = useState(null);
  const [eveningItems, setEveningItems] = useState([]);
  const [eveningSummary, setEveningSummary] = useState("");
  const [eveningSubmitting, setEveningSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState("");
  const [onboardingDone, setOnboardingDone] = useState(null);
  const [toast, setToast] = useState(null);
  const [newGoalTitle, setNewGoalTitle] = useState("");
  const [activeSurface, setActiveSurface] = useState("today");
  const [selectedPlanDate, setSelectedPlanDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [inboxEditingId, setInboxEditingId] = useState(null);
  const [inboxEditDraft, setInboxEditDraft] = useState({ title: "", goalName: "" });
  const [agentSettings, setAgentSettings] = useState(loadAgentSettings);
  const [agentWhatsAppFrom, setAgentWhatsAppFrom] = useState("");
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugData, setDebugData] = useState(null);
  const [schedulerRunning, setSchedulerRunning] = useState(false);

  const [serverCaptures, setServerCaptures] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const [intakeRawText, setIntakeRawText] = useState("");
  const [intakePreview, setIntakePreview] = useState([]);
  const [intakeParsing, setIntakeParsing] = useState(false);
  const [intakeMessage, setIntakeMessage] = useState("");

  const [planSuggestions, setPlanSuggestions] = useState([]);
  const [availabilityWindows] = useState(defaultAvailabilityWindows);
  const [activeSprint, setActiveSprint] = useState(null);
  const [activeTaskTimer, setActiveTaskTimer] = useState(null);
  const [clockNow, setClockNow] = useState(Date.now());

  const [taskDrawer, setTaskDrawer] = useState({
    open: false,
    goalId: null,
    taskId: null,
    saving: false,
  });

  useEffect(() => {
    saveWorkspaceName(workspaceName);
  }, [workspaceName]);

  useEffect(() => {
    saveNightMode(nightMode);
  }, [nightMode]);

  useEffect(() => {
    saveJson(WORKSPACE_CACHE_KEY, goals);
  }, [goals]);

  useEffect(() => {
    saveJson(TASK_META_KEY, taskMetaMap);
  }, [taskMetaMap]);

  useEffect(() => {
    saveJson(OCCURRENCE_KEY, occurrenceStore);
  }, [occurrenceStore]);

  useEffect(() => {
    saveJson(PLANNER_CONSTRAINTS_KEY, plannerConstraints);
  }, [plannerConstraints]);

  useEffect(() => {
    saveJson(NOTES_KEY, capturedNotes);
  }, [capturedNotes]);

  useEffect(() => {
    saveJson(COMMITMENTS_KEY, commitments);
  }, [commitments]);

  useEffect(() => {
    saveJson(CHECKIN_KEY, dailyCheckin);
  }, [dailyCheckin]);

  useEffect(() => {
    saveJson(CHECKIN_LOG_KEY, checkinLog);
  }, [checkinLog]);

  useEffect(() => {
    saveJson(DAILY_PLAN_LOG_KEY, dailyPlanLog);
  }, [dailyPlanLog]);

  useEffect(() => {
    saveJson(WHATSAPP_FEED_KEY, whatsAppFeed);
  }, [whatsAppFeed]);

  useEffect(() => {
    saveAgentTone(agentTone);
  }, [agentTone]);

  useEffect(() => {
    saveJson(AGENT_SETTINGS_KEY, agentSettings);
  }, [agentSettings]);

  useEffect(() => {
    if (!agentSettings?.tone) return;
    if (agentTone === agentSettings.tone) return;
    setAgentTone(agentSettings.tone);
  }, [agentSettings?.tone, agentTone]);

  useEffect(() => {
    setAgentSettings((prev) => {
      if (!prev) return prev;
      if (prev.tone === agentTone) return prev;
      return { ...prev, tone: agentTone };
    });
  }, [agentTone]);

  useEffect(() => {
    if (!toast) return;
    const timeoutId = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timeoutId);
  }, [toast]);

  useEffect(() => {
    if (!activeSprint && !activeTaskTimer) return;
    const intervalId = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [activeSprint, activeTaskTimer]);

  useEffect(() => {
    if (!activeSprint) return;
    if (clockNow < activeSprint.endsAt) return;
    if (activeTaskTimer && activeTaskTimer.taskId === activeSprint.taskId) {
      const task = goals
        .flatMap((goal) => (Array.isArray(goal.tasks) ? goal.tasks : []))
        .find((entry) => entry.id === activeTaskTimer.taskId);
      if (task) {
        void addActualMinutes(task, 10);
      }
      setActiveTaskTimer(null);
    }
    setActiveSprint(null);
    setToast({ kind: "success", message: "Sprint complete. Mark progress while the context is fresh." });
  }, [activeSprint, activeTaskTimer, goals, clockNow]);

  useEffect(() => {
    let cancelled = false;

    async function loadWorkspace() {
      const cachedGoals = normalizeCachedGoals(
        loadJson(WORKSPACE_CACHE_KEY, []),
        loadJson(TASK_META_KEY, {})
      );

      if (!user || !supabase) {
        if (!cancelled) {
          setGoals(cachedGoals);
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      setDataError("");

      try {
        let goalsRows = null;
        let goalsError = null;
        const richGoalSelect =
          "id, title, description, status, progress_type, target_value, current_value, color, archived_at, created_at, branch";
        const basicGoalSelect = "id, title, created_at";
        const first = await supabase
          .from("tasks")
          .select(richGoalSelect)
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(MAX_GOALS);
        goalsRows = first.data;
        goalsError = first.error;

        if (goalsError && String(goalsError.code || "") === "42703") {
          const second = await supabase
            .from("tasks")
            .select(basicGoalSelect)
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(MAX_GOALS);
          goalsRows = second.data;
          goalsError = second.error;
        }
        if (goalsError) throw goalsError;

        const goalIds = (goalsRows || []).map((row) => row.id);
        const rows = await fetchStepsWithFallback(supabase, goalIds);
        const localMeta = loadJson(TASK_META_KEY, {});
        const byGoal = rows.reduce((acc, row) => {
          if (!acc[row.task_id]) acc[row.task_id] = [];
          acc[row.task_id].push(enrichTaskFromStep(row, row.task_id, localMeta[row.id]));
          return acc;
        }, {});

        const remoteGoals = (goalsRows || []).map((row) => ({
          id: row.id,
          title: row.title || "Untitled goal",
          description: row.description || "",
          status: row.status || "active",
          progressType: row.progress_type || "checklist",
          targetValue: Number.isFinite(row.target_value) ? row.target_value : 100,
          currentValue: Number.isFinite(row.current_value) ? row.current_value : 0,
          color: row.color || "#3139FB",
          archivedAt: row.archived_at || null,
          branch: row.branch || null,
          createdAt: row.created_at || new Date().toISOString(),
          tasks: byGoal[row.id] || [],
        }));

        const merged = new Map();
        remoteGoals.forEach((goal) => {
          const cached = cachedGoals.find((entry) => entry.id === goal.id);
          merged.set(goal.id, {
            ...(cached || {}),
            ...goal,
            tasks: cached ? mergeTasks(goal.tasks, cached.tasks || []) : goal.tasks,
          });
        });
        cachedGoals
          .filter((goal) => isLocalGoal(goal.id))
          .forEach((goal) => merged.set(goal.id, goal));

        if (!cancelled) {
          // Auto-classify goals that have no branch
          const finalGoals = Array.from(merged.values()).map((goal) => {
            if (!goal.branch) {
              return { ...goal, branch: inferBranch(goal.title) };
            }
            return goal;
          });
          // Persist branch classification for unclassified remote goals (fire-and-forget)
          if (supabase) {
            for (const goal of finalGoals) {
              const original = merged.get(goal.id);
              if (!original?.branch && goal.branch && !isLocalGoal(goal.id)) {
                supabase.from("tasks").update({ branch: goal.branch }).eq("id", goal.id).then(() => {});
              }
            }
          }
          setGoals(finalGoals);
          setLoading(false);
        }
      } catch (error) {
        if (cancelled) return;
        console.error("Workspace load failed:", { error });
        setDataError(formatSupabaseError(error, "Failed to load workspace data."));
        setGoals(cachedGoals);
        setLoading(false);
      }
    }

    loadWorkspace();
    return () => {
      cancelled = true;
    };
  }, [user?.id, supabase, refreshKey]);

  // Auto-decompose goals that have 0 tasks (once per session per goal)
  const decomposedGoalIds = useState(() => new Set())[0];
  useEffect(() => {
    if (!user?.id || loading) return;
    const bareGoals = goals.filter(
      (g) =>
        g.status !== "archived" &&
        (g.tasks || []).length === 0 &&
        !decomposedGoalIds.has(g.id) &&
        !["inbox / unassigned", "general", "inbox", "unassigned"].includes(
          (g.title || "").toLowerCase().trim()
        )
    );
    for (const g of bareGoals) {
      decomposedGoalIds.add(g.id);
      decomposeGoalInBackground(g.title).catch(() => {});
    }
  }, [goals, user?.id, loading]);

  useEffect(() => {
    if (!user?.id) return;
    void loadAgentSettingsFromServer();
  }, [user?.id]);

  const allTasks = useMemo(
    () =>
      goals.flatMap((goal) =>
        (goal.tasks || []).map((task) => ({
          ...task,
          goalId: goal.id,
          goalTitle: goal.title,
        }))
      ),
    [goals]
  );

  const todayDateKey = new Date().toISOString().slice(0, 10);
  const selectedPlanDateObj = useMemo(
    () => new Date(`${selectedPlanDate}T09:00:00`),
    [selectedPlanDate]
  );

  const prioritizedToday = useMemo(
    () =>
      prioritizeTasks(allTasks, {
        windows: availabilityWindows,
        occurrenceStore,
        date: new Date(),
      }),
    [allTasks, availabilityWindows, occurrenceStore]
  );

  const prioritizedForPlan = useMemo(
    () =>
      prioritizeTasks(allTasks, {
        windows: availabilityWindows,
        occurrenceStore,
        date: selectedPlanDateObj,
      }),
    [allTasks, availabilityWindows, occurrenceStore, selectedPlanDateObj]
  );

  const yearSchedule = useMemo(
    () =>
      rebalanceFutureDays(
        prioritizedToday,
        { dailyCapacityMinutes: plannerConstraints.dailyCapacityMinutes },
        occurrenceStore,
        new Date()
      ),
    [prioritizedToday, plannerConstraints.dailyCapacityMinutes, occurrenceStore]
  );

  const priorityById = useMemo(
    () => new Map(prioritizedToday.map((task) => [task.id, task])),
    [prioritizedToday]
  );

  const goalsForView = useMemo(
    () =>
      goals.map((goal) => ({
        ...goal,
        tasks: (goal.tasks || []).map((task) => {
          const prioritized = priorityById.get(task.id);
          const scheduledDate = task.scheduledDate || yearSchedule.taskScheduleById?.[task.id] || null;
          return prioritized
            ? {
                ...task,
                priorityScore: prioritized.priorityScore,
                why: prioritized.why,
                scheduledDate,
              }
            : { ...task, scheduledDate };
        }),
      })),
    [goals, priorityById, yearSchedule.taskScheduleById]
  );

  const activeGoals = useMemo(() => {
    const active = goalsForView.filter((goal) =>
      goal.status !== "archived" &&
      goal.tasks.some((task) => !task.isNote && task.status !== "done" && !task.completedAt)
    );
    return active.length > 0 ? active : goalsForView;
  }, [goalsForView]);

  const weeklyMomentum = useMemo(
    () => computeWeeklyMomentum(allTasks, goalsForView, { occurrenceStore }),
    [allTasks, goalsForView, occurrenceStore]
  );

  const yearSnapshot = useMemo(
    () => computeYearSnapshot(allTasks, goalsForView, occurrenceStore, new Date().getFullYear()),
    [allTasks, goalsForView, occurrenceStore]
  );

  const commandCenter = useMemo(
    () => buildCommandCenter(prioritizedToday, { date: new Date() }),
    [prioritizedToday]
  );

  const recurringDueToday = useMemo(
    () => getRecurringDueTasks(prioritizedToday, new Date(), occurrenceStore),
    [prioritizedToday, occurrenceStore]
  );

  const oneTimeToday = useMemo(
    () =>
      prioritizedToday
        .filter((task) => !task.isRecurring && task.status !== "done" && !task.completedAt)
        .filter((task) => {
          const scheduled = task.scheduledDate || yearSchedule.taskScheduleById?.[task.id] || null;
          if (!scheduled) return false;
          const asDate = new Date(scheduled);
          if (Number.isNaN(asDate.getTime())) return false;
          return asDate.toISOString().slice(0, 10) === todayDateKey;
        })
        .slice(0, 5),
    [prioritizedToday, yearSchedule.taskScheduleById, todayDateKey]
  );

  const atRiskTasks = useMemo(
    () =>
      prioritizedToday
        .filter((task) => {
          const due = task.dueDate ? new Date(task.dueDate) : null;
          return (due && due.getTime() < Date.now()) || Number(task.rescheduleCount || 0) >= 2;
        })
        .slice(0, 4),
    [prioritizedToday]
  );

  const todaysSuggestedSchedule = useMemo(
    () =>
      buildDailyPlan(prioritizedToday, availabilityWindows, {
        date: new Date(),
        occurrenceStore,
        dailyCapacityMinutes: plannerConstraints.dailyCapacityMinutes,
        yearSchedule,
      }).suggestions,
    [prioritizedToday, availabilityWindows, occurrenceStore, plannerConstraints.dailyCapacityMinutes, yearSchedule]
  );

  const executionMetrics = useMemo(
    () => computeExecutionMetrics(allTasks, commitments, { date: new Date() }),
    [allTasks, commitments]
  );

  const procrastinationSignals = useMemo(
    () =>
      detectProcrastinationSignals(prioritizedToday, {
        date: new Date(),
        dailyCapacityMinutes: plannerConstraints.dailyCapacityMinutes,
      }),
    [prioritizedToday, plannerConstraints.dailyCapacityMinutes]
  );

  const accountabilityFeed = useMemo(
    () => buildAccountabilityFeed(prioritizedToday, commitments, { date: new Date() }),
    [prioritizedToday, commitments]
  );

  const recurringLoadForSelectedDate = useMemo(
    () =>
      getRecurringDueTasks(prioritizedForPlan, selectedPlanDateObj, occurrenceStore).reduce(
        (sum, task) => sum + (Number.isFinite(task.estimatedMinutes) ? task.estimatedMinutes : 0),
        0
      ),
    [prioritizedForPlan, selectedPlanDateObj, occurrenceStore]
  );

  const oneTimeLoadForSelectedDate = useMemo(
    () => yearSchedule.oneTimeLoadMap?.[selectedPlanDate] || 0,
    [yearSchedule.oneTimeLoadMap, selectedPlanDate]
  );

  const activeDrawerGoal = useMemo(
    () => goalsForView.find((goal) => goal.id === taskDrawer.goalId) || null,
    [goalsForView, taskDrawer.goalId]
  );

  const activeDrawerTask = useMemo(() => {
    if (!activeDrawerGoal || !taskDrawer.taskId) return null;
    const found = activeDrawerGoal.tasks.find((task) => task.id === taskDrawer.taskId);
    return found ? { ...found, goalId: activeDrawerGoal.id } : null;
  }, [activeDrawerGoal, taskDrawer.taskId]);

  const sprintLabel = useMemo(() => {
    if (!activeSprint) return "";
    const ms = Math.max(0, activeSprint.endsAt - clockNow);
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    return `${mins}:${String(secs).padStart(2, "0")} left`;
  }, [activeSprint, clockNow]);

  const inboxCaptures = useMemo(() => {
    const localEntries = (Array.isArray(whatsAppFeed) ? whatsAppFeed : []).map((entry) => {
      const parsedType = entry.parsedType || entry.kind || "ambiguous";
      const confidence = Number.isFinite(entry.confidence) ? entry.confidence : 0.5;
      const requiresReview =
        Boolean(entry.requiresReview) ||
        parsedType === "ambiguous" ||
        confidence < 0.55 ||
        entry.status === "needs_follow_up";
      return {
        id: entry.id,
        sourceText: entry.sourceText || entry.text || "",
        parsedType,
        confidence,
        requiresReview,
        followUpQuestion: entry.followUpQuestion || "",
        previewTitle: entry.previewTitle || "",
        parsedPayload: entry.parsedPayload || null,
        status: entry.status || "pending",
        createdAt: entry.createdAt || new Date().toISOString(),
        source: "local",
      };
    });

    const localIds = new Set(localEntries.map((e) => e.id));
    const remoteEntries = (serverCaptures || [])
      .filter((row) => !localIds.has(String(row.id)))
      .map((row) => ({
        id: String(row.id),
        sourceText: row.raw_text || "",
        parsedType: row.parsed_intent || "unknown",
        confidence: Number.isFinite(row.parse_confidence) ? row.parse_confidence : 0,
        requiresReview: Boolean(row.clarification_requested) || row.parsed_intent === "ambiguous",
        followUpQuestion: "",
        previewTitle: row.processing_result || "",
        parsedPayload: null,
        status: row.processed ? (row.processing_result === "error" ? "error" : "processed") : "pending",
        createdAt: row.created_at || new Date().toISOString(),
        source: "whatsapp",
        createdTaskIds: row.created_task_ids || [],
        updatedTaskIds: row.updated_task_ids || [],
      }));

    return [...remoteEntries, ...localEntries].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [whatsAppFeed, serverCaptures]);

  const pendingReviewCount = useMemo(
    () => inboxCaptures.filter((item) => item.requiresReview && item.status === "pending").length,
    [inboxCaptures]
  );

  const dueTodayCount = useMemo(
    () =>
      prioritizedToday.filter((task) => {
        if (task.status === "done" || task.completedAt || task.isNote) return false;
        if (task.isRecurring) {
          return recurringDueToday.some((dueTask) => dueTask.id === task.id);
        }
        if (!task.dueDate) return false;
        const due = new Date(task.dueDate);
        if (Number.isNaN(due.getTime())) return false;
        return due.toISOString().slice(0, 10) === todayDateKey;
      }).length,
    [prioritizedToday, recurringDueToday, todayDateKey]
  );

  const overdueCount = useMemo(
    () =>
      prioritizedToday.filter((task) => {
        if (task.status === "done" || task.completedAt || task.isRecurring || task.isNote || !task.dueDate) {
          return false;
        }
        const due = new Date(task.dueDate);
        if (Number.isNaN(due.getTime())) return false;
        return due.getTime() < Date.now();
      }).length,
    [prioritizedToday]
  );

  const blockedCount = useMemo(
    () =>
      prioritizedToday.filter(
        (task) => task.status !== "done" && !task.completedAt && !task.isNote && Boolean(task.isBlocked)
      ).length,
    [prioritizedToday]
  );

  const latestAgentNote = useMemo(() => {
    if (procrastinationSignals.length > 0) {
      const lead = procrastinationSignals[0];
      return toneLine(
        lead.action || lead.message,
        lead.message || lead.action,
        lead.action || lead.message
      );
    }
    if (commandCenter?.nextTask) {
      return toneLine(
        `Keep momentum on "${commandCenter.nextTask.title}" with one short focus sprint.`,
        `"${commandCenter.nextTask.title}" is still your highest-leverage task. Start now.`,
        `No drift: "${commandCenter.nextTask.title}" goes first.`
      );
    }
    return "Capture one meaningful task and let the agent prioritize it.";
  }, [procrastinationSignals, commandCenter, agentTone]);

  const agentStatusLabel = useMemo(() => {
    if (loading) return "Waiting";
    if (pendingReviewCount > 0) return "Needs review";
    if ((commandCenter.topPriorities || []).length > 0) return "Active";
    return "Waiting";
  }, [loading, pendingReviewCount, commandCenter.topPriorities]);

  const agentConnection = useMemo(() => {
    const hasConfiguredTarget = Boolean(agentSettings.whatsAppTo || import.meta.env.VITE_WHATSAPP_TO);
    return {
      statusLabel: hasConfiguredTarget ? "Connected" : "Needs setup",
      detail: hasConfiguredTarget
        ? `Outgoing WhatsApp target: ${agentSettings.whatsAppTo || import.meta.env.VITE_WHATSAPP_TO}`
        : "Add a WhatsApp recipient in Agent Settings to send morning briefs and nudges.",
      agentWhatsAppFrom,
    };
  }, [agentSettings.whatsAppTo, agentWhatsAppFrom]);

  function showToast(message, kind = "success") {
    setToast({ kind, message });
  }

  // Handle Google Calendar OAuth callback (via postMessage from popup or query params as fallback)
  useEffect(() => {
    function handleGcalMessage(event) {
      if (event.data?.type !== "gcal_result") return;
      // Only accept messages from our own origin
      if (event.origin !== window.location.origin) return;
      if (event.data.status === "connected") {
        showToast("Google Calendar connected!");
        updateAgentSetting("googleCalendarConnected", true);
      } else {
        showToast("Calendar connection failed: " + (event.data.reason || "unknown"), "error");
      }
    }
    window.addEventListener("message", handleGcalMessage);

    // Fallback: check query params (if popup redirect lands in this tab)
    const params = new URLSearchParams(window.location.search);
    const gcal = params.get("gcal");
    if (gcal === "connected") {
      showToast("Google Calendar connected!");
      updateAgentSetting("googleCalendarConnected", true);
      window.history.replaceState({}, "", window.location.pathname);
    } else if (gcal === "error") {
      showToast("Calendar connection failed: " + (params.get("reason") || "unknown"), "error");
      window.history.replaceState({}, "", window.location.pathname);
    }

    return () => window.removeEventListener("message", handleGcalMessage);
  }, []);

  function toneLine(gentle, firm, ruthless) {
    if (agentTone === "gentle") return gentle;
    if (agentTone === "ruthless") return ruthless;
    return firm;
  }

  function resolveTaskLocation(goalId, taskId) {
    if (goalId) return { goalId, taskId };
    const foundGoal = goalsForView.find((goal) => goal.tasks.some((task) => task.id === taskId));
    if (!foundGoal) return null;
    return { goalId: foundGoal.id, taskId };
  }

  function updateCommitmentOutcome(taskId, outcomeStatus, escalationBump = 0) {
    setCommitments((prev) =>
      prev.map((entry) =>
        entry.taskId === taskId && entry.committedForDate === todayDateKey
          ? {
              ...entry,
              outcomeStatus,
              escalationLevel: Math.max(0, (entry.escalationLevel || 0) + escalationBump),
            }
          : entry
      )
    );
  }

  function markTaskAsDeferred(task) {
    updateCommitmentOutcome(task.id, "missed", 1);
  }

  function updateTaskMeta(task) {
    setTaskMetaMap((prev) => ({ ...prev, [task.id]: taskMetaSnapshot(task) }));
  }

  function replaceTaskMetaId(oldId, task) {
    setTaskMetaMap((prev) => {
      const next = { ...prev };
      delete next[oldId];
      next[task.id] = taskMetaSnapshot(task);
      return next;
    });
  }

  function removeTaskMeta(taskId) {
    setTaskMetaMap((prev) => {
      const next = { ...prev };
      delete next[taskId];
      return next;
    });
  }

  function upsertOccurrence(taskId, dateKey, patch) {
    const key = occurrenceKey(taskId, dateKey);
    setOccurrenceStore((prev) => {
      const current = prev[key] || defaultTaskOccurrence({ id: key, parentTaskId: taskId, date: dateKey });
      return {
        ...prev,
        [key]: {
          ...current,
          ...patch,
        },
      };
    });
  }

  function updateGoalTasks(goalId, updateFn) {
    setGoals((prev) =>
      prev.map((goal) => (goal.id === goalId ? { ...goal, tasks: updateFn(goal.tasks || []) } : goal))
    );
  }

  function findTask(goalId, taskId, sourceGoals = goals) {
    const goal = sourceGoals.find((entry) => entry.id === goalId);
    if (!goal) return null;
    const task = (goal.tasks || []).find((entry) => entry.id === taskId);
    if (!task) return null;
    return { goal, task };
  }

  async function saveTaskToSupabase(goalId, task) {
    if (isLocalGoal(goalId) || !supabase) return;
    const fullPatch = {
      text: task.title,
      done: task.status === "done" || Boolean(task.completedAt),
      minutes: task.estimatedMinutes,
      estimate_minutes: task.estimatedMinutes,
      next_action: task.nextAction || "",
      completed_at: task.completedAt || null,
      actual_minutes: Number.isFinite(task.actualMinutes) ? task.actualMinutes : 0,
      due_date: task.dueDate || null,
      scheduled_date: task.scheduledDate || null,
      status: task.status || "active",
      type: task.type || "one_time",
      effort_type: task.effortType || "deep_work",
      is_blocked: Boolean(task.isBlocked),
      blocked_by_task_id: task.blockedByTaskId || null,
      ai_confidence: Number.isFinite(task.aiConfidence) ? task.aiConfidence : 0.6,
      source_type: task.sourceType || "manual",
      is_note: Boolean(task.isNote),
      priority_score: Number.isFinite(task.priorityScore) ? task.priorityScore : 0,
      urgency: Number.isFinite(task.urgency) ? task.urgency : 2,
      importance: Number.isFinite(task.importance) ? task.importance : 3,
      avoidance_score: Number.isFinite(task.avoidanceScore) ? task.avoidanceScore : 0,
      reschedule_count: Number.isFinite(task.rescheduleCount) ? task.rescheduleCount : 0,
      proof_type: task.proofType || "note",
      proof_required: Boolean(task.proofRequired),
      proof_note: task.proofNote || "",
      proof_link: task.proofLink || "",
      proof_provided_at: task.proofProvidedAt || null,
      commitment_status: task.commitmentStatus || "none",
      commitment_level: task.commitmentLevel || "normal",
      escalation_level: Number.isFinite(task.escalationLevel) ? task.escalationLevel : 0,
      recurrence_rule: task.recurrenceRule || null,
      is_recurring: Boolean(task.isRecurring),
      description: task.description || "",
    };
    const first = await supabase
      .from("task_steps")
      .update(fullPatch)
      .eq("id", task.id)
      .eq("task_id", goalId);
    if (!first.error) return;
    if (String(first.error.code || "") !== "42703") throw first.error;

    const fallback = await supabase
      .from("task_steps")
      .update({
        text: task.title,
        done: task.status === "done" || Boolean(task.completedAt),
        minutes: task.estimatedMinutes,
      })
      .eq("id", task.id)
      .eq("task_id", goalId);
    if (fallback.error) throw fallback.error;
  }

  async function decomposeGoalInBackground(title) {
    const token = await getToken().catch(() => null);
    if (!token) return;
    const base = import.meta.env.VITE_API_BASE_URL?.trim()?.replace(/\/+$/, "") || "";
    const endpoints = [];
    if (base) endpoints.push(`${base}/api/ai/goal-decompose`);
    endpoints.push("/api/ai/goal-decompose");
    for (const endpoint of endpoints) {
      try {
        const resp = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ title, scope: "yearly" }),
        });
        if (resp.ok) return await resp.json();
      } catch { /* try next endpoint */ }
    }
  }

  async function createGoal(titleInput) {
    const title = String(titleInput || "").trim();
    if (!title) return null;
    const existing = goals.find((goal) => goal.title.toLowerCase() === title.toLowerCase());
    if (existing) return existing.id;

    const branch = inferBranch(title);

    if (!supabase) {
      const localId = `local-${makeId()}`;
      setGoals((prev) => [
        {
          id: localId,
          title,
          description: "",
          status: "active",
          progressType: "checklist",
          targetValue: 100,
          currentValue: 0,
          color: "#3139FB",
          archivedAt: null,
          branch,
          tasks: [],
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ]);
      return localId;
    }

    try {
      let data = null;
      let error = null;
      const first = await supabase
        .from("tasks")
        .insert({
          title,
          description: "",
          status: "active",
          progress_type: "checklist",
          target_value: 100,
          current_value: 0,
          color: "#3139FB",
          archived_at: null,
          branch,
          user_id: user?.id || null,
        })
        .select("id, title, description, status, progress_type, target_value, current_value, color, archived_at, created_at, branch")
        .single();
      data = first.data;
      error = first.error;
      if (error && String(error.code || "") === "42703") {
        const second = await supabase
          .from("tasks")
          .insert({ title, user_id: user?.id || null })
          .select("id, title, created_at")
          .single();
        data = second.data;
        error = second.error;
      }
      if (error) throw error;

      setGoals((prev) => [
        {
          id: data.id,
          title: data.title || title,
          description: data.description || "",
          status: data.status || "active",
          progressType: data.progress_type || "checklist",
          targetValue: Number.isFinite(data.target_value) ? data.target_value : 100,
          currentValue: Number.isFinite(data.current_value) ? data.current_value : 0,
          color: data.color || "#3139FB",
          archivedAt: data.archived_at || null,
          branch: data.branch || branch,
          tasks: [],
          createdAt: data.created_at || new Date().toISOString(),
        },
        ...prev,
      ]);

      // Also create in long_term_goals + decompose into milestones (non-blocking)
      decomposeGoalInBackground(title).catch((err) =>
        console.warn("Goal decomposition failed (non-blocking):", err.message)
      );

      return data.id;
    } catch (error) {
      console.error("Create goal failed:", { error, title });
      const localId = `local-${makeId()}`;
      setGoals((prev) => [
        {
          id: localId,
          title,
          description: "",
          status: "active",
          progressType: "checklist",
          targetValue: 100,
          currentValue: 0,
          color: "#3139FB",
          archivedAt: null,
          branch,
          tasks: [],
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ]);
      setDataError(formatSupabaseError(error, "Goal saved locally. Sync failed."));
      return localId;
    }
  }

  async function saveGoalChanges(goalId, patch) {
    const cleanTitle = String(patch.title || "").trim();
    if (!cleanTitle) return;
    const snapshot = goals;
    setGoals((prev) =>
      prev.map((goal) =>
        goal.id === goalId
          ? {
              ...goal,
              title: cleanTitle,
              description: String(patch.description || ""),
              status: patch.status || goal.status || "active",
              archivedAt: patch.archivedAt ?? goal.archivedAt ?? null,
            }
          : goal
      )
    );

    if (isLocalGoal(goalId) || !supabase) return;

    try {
      let error = null;
      const fullUpdate = await supabase
        .from("tasks")
        .update({
          title: cleanTitle,
          description: String(patch.description || ""),
          status: patch.status || "active",
          archived_at: patch.archivedAt || null,
        })
        .eq("id", goalId);
      error = fullUpdate.error;

      if (error && String(error.code || "") === "42703") {
        const fallback = await supabase.from("tasks").update({ title: cleanTitle }).eq("id", goalId);
        error = fallback.error;
      }
      if (error) throw error;
    } catch (error) {
      console.error("Save goal failed:", { error, goalId, patch });
      setGoals(snapshot);
      setDataError(formatSupabaseError(error, "Could not save goal updates."));
    }
  }

  async function changeBranch(goalId, branchId) {
    const snapshot = goals;
    setGoals((prev) =>
      prev.map((goal) => (goal.id === goalId ? { ...goal, branch: branchId || null } : goal))
    );
    if (isLocalGoal(goalId) || !supabase) return;
    try {
      const { error } = await supabase.from("tasks").update({ branch: branchId || null }).eq("id", goalId);
      if (error && String(error.code || "") !== "42703") throw error;
    } catch (error) {
      console.error("Change branch failed:", { error, goalId, branchId });
      setGoals(snapshot);
      setDataError(formatSupabaseError(error, "Could not update goal branch."));
    }
  }

  async function toggleArchiveGoal(goalId) {
    const goal = goals.find((entry) => entry.id === goalId);
    if (!goal) return;
    const willArchive = goal.status !== "archived";
    await saveGoalChanges(goalId, {
      title: goal.title,
      description: goal.description || "",
      status: willArchive ? "archived" : "active",
      archivedAt: willArchive ? new Date().toISOString() : null,
    });
    showToast(willArchive ? "Goal archived." : "Goal restored.");
  }

  async function deleteGoal(goalId) {
    const goal = goals.find((entry) => entry.id === goalId);
    if (!goal) return;

    const candidates = goals.filter((entry) => entry.id !== goalId && entry.status !== "archived");
    let moveTarget = null;
    if ((goal.tasks || []).length > 0 && candidates.length > 0) {
      const move = window.confirm(
        `Move ${goal.tasks.length} tasks to "${candidates[0].title}" before deleting this goal?\nPress Cancel to delete them.`
      );
      if (move) moveTarget = candidates[0];
    }

    const confirmDelete = window.confirm(`Delete goal "${goal.title}"? This cannot be undone.`);
    if (!confirmDelete) return;

    const snapshot = goals;

    if (moveTarget && isLocalGoal(goalId) && !isLocalGoal(moveTarget.id)) {
      setGoals((prev) => prev.filter((entry) => entry.id !== goalId));
      for (const task of goal.tasks || []) {
        // Insert as remote copy when moving from local to remote goal.
        await addTask(moveTarget.id, task.title, {
          ...task,
          id: undefined,
          goalId: moveTarget.id,
        });
      }
    } else if (moveTarget) {
      setGoals((prev) =>
        prev
          .filter((entry) => entry.id !== goalId)
          .map((entry) =>
            entry.id === moveTarget.id
              ? {
                  ...entry,
                  tasks: [
                    ...(entry.tasks || []),
                    ...(goal.tasks || []).map((task) => ({ ...task, goalId: moveTarget.id })),
                  ],
                }
              : entry
          )
      );
    } else {
      setGoals((prev) => prev.filter((entry) => entry.id !== goalId));
    }

    if (isLocalGoal(goalId) || !supabase) return;

    try {
      if (moveTarget && !isLocalGoal(moveTarget.id)) {
        const moveResult = await supabase
          .from("task_steps")
          .update({ task_id: moveTarget.id })
          .eq("task_id", goalId);
        if (moveResult.error) throw moveResult.error;
      } else {
        const deleteSteps = await supabase.from("task_steps").delete().eq("task_id", goalId);
        if (deleteSteps.error) throw deleteSteps.error;
      }

      const deleteGoalResult = await supabase.from("tasks").delete().eq("id", goalId);
      if (deleteGoalResult.error) throw deleteGoalResult.error;
      showToast("Goal deleted.");
    } catch (error) {
      console.error("Delete goal failed:", { error, goalId, moveTargetId: moveTarget?.id || null });
      setGoals(snapshot);
      setDataError(formatSupabaseError(error, "Could not delete goal."));
    }
  }

  async function addTask(goalId, titleInput, seed = {}) {
    const title = String(titleInput || "").trim();
    if (!title) return null;
    const activeCommitments = commitments.filter(
      (entry) =>
        entry.committedForDate === todayDateKey &&
        entry.outcomeStatus === "pending" &&
        (entry.commitmentLevel === "must" || entry.commitmentLevel === "normal")
    );
    if (seed.sourceType !== "ai_parsed" && agentTone === "ruthless" && activeCommitments.length >= 2) {
      showToast("Finish today's top commitments before adding more tasks.", "error");
      return null;
    }

    const localId = `local-task-${makeId()}`;
    const nowIso = new Date().toISOString();
    const historicalSamples = allTasks
      .filter(
        (entry) =>
          entry.effortType === (seed.effortType || "deep_work") &&
          Number.isFinite(entry.actualMinutes) &&
          entry.actualMinutes > 0
      )
      .slice(-12);
    const learnedEstimate =
      historicalSamples.length > 0
        ? Math.max(
            10,
            Math.round(
              historicalSamples.reduce((sum, entry) => sum + entry.actualMinutes, 0) /
                historicalSamples.length
            )
          )
        : null;
    const task = defaultTaskModel({
      ...seed,
      id: localId,
      title,
      goalId,
      createdAt: nowIso,
      updatedAt: nowIso,
      sourceType: seed.sourceType || "manual",
      dueDate: seed.dueDate || null,
      status: seed.status || "active",
      proofType: seed.proofType || undefined,
      proofRequired: Boolean(seed.proofRequired),
      commitmentStatus: seed.commitmentStatus || "none",
      commitmentLevel: seed.commitmentLevel || "normal",
      avoidanceScore: Number.isFinite(seed.avoidanceScore) ? seed.avoidanceScore : 0,
      rescheduleCount: Number.isFinite(seed.rescheduleCount) ? seed.rescheduleCount : 0,
      estimatedMinutes:
        Number.isFinite(seed.estimatedMinutes) && seed.estimatedMinutes > 0
          ? seed.estimatedMinutes
          : learnedEstimate || 30,
    });
    updateGoalTasks(goalId, (tasks) => [...tasks, task]);
    updateTaskMeta(task);

    if (isLocalGoal(goalId) || !supabase) return task;

    try {
      let row = null;
      let error = null;
      const first = await supabase
        .from("task_steps")
        .insert({
          task_id: goalId,
          text: task.title,
          done: false,
          minutes: task.estimatedMinutes,
          estimate_minutes: task.estimatedMinutes,
          next_action: task.nextAction || "",
          completed_at: null,
        })
        .select("id, task_id, text, done, minutes, estimate_minutes, next_action, completed_at, created_at")
        .single();
      row = first.data;
      error = first.error;

      if (error && String(error.code || "") === "42703") {
        const second = await supabase
          .from("task_steps")
          .insert({
            task_id: goalId,
            text: task.title,
            done: false,
            minutes: task.estimatedMinutes,
          })
          .select("id, task_id, text, done, minutes, created_at")
          .single();
        row = second.data;
        error = second.error;
      }
      if (error) throw error;

      const remoteTask = enrichTaskFromStep(row, goalId, taskMetaSnapshot(task));
      updateGoalTasks(goalId, (tasks) => tasks.map((entry) => (entry.id === localId ? remoteTask : entry)));
      replaceTaskMetaId(localId, remoteTask);
      return remoteTask;
    } catch (error) {
      console.error("Add task failed:", { error, goalId, title, seed });
      setDataError(formatSupabaseError(error, "Task saved locally. Sync failed."));
      return task;
    }
  }

  async function commitTaskUpdate(goalId, taskId, transformFn, fallbackMessage) {
    const found = findTask(goalId, taskId);
    if (!found) return null;
    const previous = { ...found.task };
    const nextTask = defaultTaskModel({
      ...previous,
      ...transformFn(previous),
      goalId,
      id: taskId,
      updatedAt: new Date().toISOString(),
    });

    updateGoalTasks(goalId, (tasks) => tasks.map((task) => (task.id === taskId ? nextTask : task)));
    updateTaskMeta(nextTask);

    try {
      await saveTaskToSupabase(goalId, nextTask);
      return nextTask;
    } catch (error) {
      console.error("Task update failed:", { error, goalId, taskId, nextTask });
      updateGoalTasks(goalId, (tasks) => tasks.map((task) => (task.id === taskId ? previous : task)));
      updateTaskMeta(previous);
      setDataError(formatSupabaseError(error, fallbackMessage));
      showToast("Update failed and was reverted.", "error");
      return null;
    }
  }

  async function toggleTaskDone(goalId, taskId) {
    const found = findTask(goalId, taskId, goalsForView);
    if (!found) return;
    if (found.task.isRecurring) {
      const dateKey = selectedPlanDate || new Date().toISOString().slice(0, 10);
      const key = occurrenceKey(taskId, dateKey);
      const existing = occurrenceStore[key];
      const willComplete = existing?.status !== "done";
      upsertOccurrence(taskId, dateKey, {
        status: willComplete ? "done" : "pending",
        skipped: false,
        actualMinutes: Number.isFinite(found.task.actualMinutes) ? found.task.actualMinutes : 0,
        completedAt: willComplete ? new Date().toISOString() : null,
      });
      showToast(
        willComplete
          ? `Recurring occurrence completed for ${dateKey}.`
          : `Recurring occurrence reset for ${dateKey}.`
      );
      return;
    }
    const willComplete = !(found.task.status === "done" || found.task.completedAt);
    if (
      willComplete &&
      found.task.proofRequired &&
      !String(found.task.proofNote || "").trim() &&
      !String(found.task.proofLink || "").trim() &&
      Number(found.task.actualMinutes || 0) <= 0
    ) {
      showToast("Proof required before completion. Add note/link or log timer minutes.", "error");
      openTaskDrawer(goalId, taskId);
      return;
    }
    await commitTaskUpdate(
      goalId,
      taskId,
      (task) => ({
        status: willComplete ? "done" : "active",
        completedAt: willComplete ? new Date().toISOString() : null,
        completionDate: willComplete ? new Date().toISOString() : null,
        commitmentStatus: willComplete ? "kept" : "none",
        proofProvidedAt: willComplete ? new Date().toISOString() : task.proofProvidedAt || null,
      }),
      "Could not update completion."
    );
    updateCommitmentOutcome(taskId, willComplete ? "kept" : "pending", 0);
  }

  async function saveTaskFromDrawer(task, draft) {
    setTaskDrawer((prev) => ({ ...prev, saving: true }));
    const dueDateIso = draft.dueDate ? new Date(`${draft.dueDate}T20:00:00`).toISOString() : null;
    const scheduledDateIso = draft.scheduledDate
      ? new Date(`${draft.scheduledDate}T10:00:00`).toISOString()
      : null;
    const recurrenceRule =
      draft.type === "recurring"
        ? {
            frequency: draft.recurrenceFrequency || "weekly",
            interval: Number.isFinite(draft.recurrenceInterval) ? Math.max(1, draft.recurrenceInterval) : 1,
            daysOfWeek:
              draft.recurrenceFrequency === "weekly"
                ? [Number.isFinite(Number(draft.recurrenceDay)) ? Number(draft.recurrenceDay) : 1]
                : [],
            preferredStart: selectedPlanDate,
          }
        : null;
    await commitTaskUpdate(
      task.goalId,
      task.id,
      () => ({
        title: draft.title.trim(),
        description: draft.description || "",
        nextAction: draft.nextAction || "",
        estimatedMinutes: Number.isFinite(draft.estimatedMinutes) ? draft.estimatedMinutes : 30,
        actualMinutes: Number.isFinite(draft.actualMinutes) ? draft.actualMinutes : 0,
        urgency: Number.isFinite(draft.urgency) ? draft.urgency : 2,
        importance: Number.isFinite(draft.importance) ? draft.importance : 3,
        avoidanceScore: Number.isFinite(draft.avoidanceScore) ? draft.avoidanceScore : 0,
        rescheduleCount: Number.isFinite(draft.rescheduleCount) ? draft.rescheduleCount : 0,
        proofType: draft.proofType || "note",
        proofRequired: Boolean(draft.proofRequired),
        proofNote: draft.proofNote || "",
        proofLink: draft.proofLink || "",
        proofProvidedAt:
          (draft.proofNote && draft.proofNote.trim()) || (draft.proofLink && draft.proofLink.trim())
            ? new Date().toISOString()
            : task.proofProvidedAt || null,
        commitmentLevel: draft.commitmentLevel || "normal",
        escalationLevel: Number.isFinite(draft.escalationLevel) ? draft.escalationLevel : 0,
        dueDate: dueDateIso,
        scheduledDate: scheduledDateIso,
        isNote: Boolean(draft.isNote),
        isBlocked: Boolean(draft.isBlocked),
        type: draft.type === "recurring" ? "recurring" : "one_time",
        isRecurring: draft.type === "recurring",
        recurrenceRule,
        status: draft.status || (task.status === "done" ? "done" : "active"),
      }),
      "Could not save task."
    );
    setTaskDrawer({ open: false, goalId: null, taskId: null, saving: false });
    showToast("Task updated.");
  }

  function startTaskTimer(task) {
    setActiveTaskTimer({
      taskId: task.id,
      goalId: task.goalId,
      startedAt: Date.now(),
    });
    showToast(`Timer started for "${task.title}".`);
  }

  async function stopTaskTimer(task, elapsedSeconds) {
    if (!activeTaskTimer || activeTaskTimer.taskId !== task.id) return;
    const elapsedMinutes = Math.max(1, Math.round((elapsedSeconds || 0) / 60));
    setActiveTaskTimer(null);
    if (task.isRecurring) {
      const dateKey = selectedPlanDate || new Date().toISOString().slice(0, 10);
      const key = occurrenceKey(task.id, dateKey);
      const existing = occurrenceStore[key];
      upsertOccurrence(task.id, dateKey, {
        status: existing?.status === "done" ? "done" : "pending",
        actualMinutes: Number.isFinite(existing?.actualMinutes)
          ? existing.actualMinutes + elapsedMinutes
          : elapsedMinutes,
        completedAt: existing?.completedAt || null,
      });
      showToast(`Logged ${elapsedMinutes} recurring minutes.`);
      return;
    }
    await commitTaskUpdate(
      task.goalId,
      task.id,
      (current) => ({
        actualMinutes: Number.isFinite(current.actualMinutes) ? current.actualMinutes + elapsedMinutes : elapsedMinutes,
        proofProvidedAt: new Date().toISOString(),
      }),
      "Could not save timer duration."
    );
    showToast(`Logged ${elapsedMinutes} minutes.`);
  }

  async function addActualMinutes(task, minutes) {
    const delta = Number(minutes) || 0;
    if (delta <= 0) return;
    if (task.isRecurring) {
      const dateKey = selectedPlanDate || new Date().toISOString().slice(0, 10);
      const key = occurrenceKey(task.id, dateKey);
      const existing = occurrenceStore[key];
      upsertOccurrence(task.id, dateKey, {
        status: existing?.status || "pending",
        actualMinutes: Number.isFinite(existing?.actualMinutes) ? existing.actualMinutes + delta : delta,
        completedAt: existing?.completedAt || null,
      });
      showToast(`Added ${delta} recurring minutes.`);
      return;
    }
    await commitTaskUpdate(
      task.goalId,
      task.id,
      (current) => ({
        actualMinutes: Number.isFinite(current.actualMinutes) ? current.actualMinutes + delta : delta,
        proofProvidedAt: new Date().toISOString(),
      }),
      "Could not update actual minutes."
    );
    showToast(`Added ${delta} minutes.`);
  }

  async function breakIntoSubtasks(task, draft) {
    const sourceText = String(draft?.title || task.title || "").trim();
    if (!sourceText) return;
    const parts = sourceText
      .split(/\s+(?:and then|then|and)\s+/i)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length <= 1) {
      showToast("Task already looks atomic. No subtasks created.", "info");
      return;
    }
    const baseEstimate = Math.max(10, Math.round((task.estimatedMinutes || 30) / parts.length));
    for (const part of parts) {
      await addTask(task.goalId, part, {
        ...task,
        id: undefined,
        title: part,
        isRecurring: false,
        type: "one_time",
        estimatedMinutes: baseEstimate,
        sourceType: "ai_parsed",
      });
    }
    showToast(`Created ${parts.length} subtasks.`);
  }

  async function deleteTask(goalId, taskId) {
    const snapshot = goals;
    updateGoalTasks(goalId, (tasks) => tasks.filter((task) => task.id !== taskId));
    removeTaskMeta(taskId);
    setCommitments((prev) => prev.filter((entry) => entry.taskId !== taskId));
    setOccurrenceStore((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((key) => {
        if (key.startsWith(`${taskId}:`)) delete next[key];
      });
      return next;
    });

    if (isLocalGoal(goalId) || !supabase) return;

    const { error } = await supabase
      .from("task_steps")
      .delete()
      .eq("id", taskId)
      .eq("task_id", goalId);
    if (!error) return;

    console.error("Delete task failed:", { error, goalId, taskId });
    setGoals(snapshot);
    setDataError(formatSupabaseError(error, "Could not delete task."));
  }

  async function snoozeTask(task) {
    if (task.isRecurring) {
      const fromDateKey = selectedPlanDate || new Date().toISOString().slice(0, 10);
      const toDate = new Date(`${fromDateKey}T09:00:00`);
      toDate.setDate(toDate.getDate() + 1);
      const toDateKey = toDate.toISOString().slice(0, 10);
      upsertOccurrence(task.id, fromDateKey, {
        status: "pending",
        skipped: true,
        rescheduledTo: toDateKey,
        completedAt: null,
      });
      upsertOccurrence(task.id, toDateKey, {
        status: "pending",
        skipped: false,
      });
      showToast(`Recurring occurrence moved to ${toDateKey}.`);
      return;
    }
    const due = task.dueDate ? new Date(task.dueDate) : new Date();
    due.setDate(due.getDate() + 1);
    await commitTaskUpdate(
      task.goalId,
      task.id,
      (current) => ({
        dueDate: due.toISOString(),
        rescheduleCount: Number(current.rescheduleCount || 0) + 1,
        avoidanceScore: Number(current.avoidanceScore || 0) + 1,
        escalationLevel: Math.min(5, Number(current.escalationLevel || 0) + 1),
      }),
      "Could not snooze task."
    );
    markTaskAsDeferred(task);
    showToast("Task snoozed to tomorrow.");
  }

  async function moveTaskBetweenGoals(sourceGoalId, taskId, targetGoalId) {
    if (!sourceGoalId || !taskId || !targetGoalId || sourceGoalId === targetGoalId) return;

    const sourceGoal = goals.find((goal) => goal.id === sourceGoalId);
    const targetGoal = goals.find((goal) => goal.id === targetGoalId);
    const task = sourceGoal?.tasks.find((entry) => entry.id === taskId);
    if (!sourceGoal || !targetGoal || !task) return;

    const previousGoals = goals;
    updateGoalTasks(sourceGoalId, (tasks) => tasks.filter((entry) => entry.id !== taskId));
    updateGoalTasks(targetGoalId, (tasks) => [...tasks, { ...task, goalId: targetGoalId }]);
    if (taskDrawer.open && taskDrawer.taskId === taskId) {
      setTaskDrawer((prev) => ({ ...prev, goalId: targetGoalId }));
    }
    showToast(`Moved to ${targetGoal.title}.`);

    const sourceLocal = isLocalGoal(sourceGoalId);
    const targetLocal = isLocalGoal(targetGoalId);
    if (sourceLocal && targetLocal) return;

    if (!supabase) {
      setGoals(previousGoals);
      showToast("Could not sync move.", "error");
      return;
    }

    try {
      if (!sourceLocal && !targetLocal) {
        const { error } = await supabase
          .from("task_steps")
          .update({ task_id: targetGoalId })
          .eq("id", taskId)
          .eq("task_id", sourceGoalId);
        if (error) throw error;
        return;
      }

      if (sourceLocal && !targetLocal) {
        const inserted = await addTask(targetGoalId, task.title, {
          ...task,
          id: undefined,
          sourceType: "manual",
        });
        updateGoalTasks(targetGoalId, (tasks) => tasks.filter((entry) => entry.id !== taskId));
        if (inserted) updateTaskMeta(inserted);
        return;
      }

      if (!sourceLocal && targetLocal) {
        const { error } = await supabase
          .from("task_steps")
          .delete()
          .eq("id", taskId)
          .eq("task_id", sourceGoalId);
        if (error) throw error;
      }
    } catch (error) {
      console.error("Move task failed:", { error, sourceGoalId, targetGoalId, taskId });
      setGoals(previousGoals);
      if (taskDrawer.open && taskDrawer.taskId === taskId) {
        setTaskDrawer((prev) => ({ ...prev, goalId: sourceGoalId }));
      }
      setDataError(formatSupabaseError(error, "Could not move task."));
      showToast("Move failed and was reverted.", "error");
    }
  }

  async function moveTaskToGoal(targetGoalId) {
    const sourceGoalId = taskDrawer.goalId;
    const taskId = taskDrawer.taskId;
    await moveTaskBetweenGoals(sourceGoalId, taskId, targetGoalId);
  }

  async function addGoalFromInput(event) {
    event?.preventDefault?.();
    if (!newGoalTitle.trim() || goals.length >= MAX_GOALS) return;
    await createGoal(newGoalTitle.trim());
    setNewGoalTitle("");
  }

  async function onGenerateNextAction(task, draft) {
    const title = draft.title || task.title;
    const fallback = `Open a 10-minute block and start with the first concrete step for "${title}".`;
    const base = import.meta.env.VITE_API_BASE_URL?.trim();
    const normalized = base ? base.replace(/\/+$/, "") : "";
    const endpoints = [];
    if (normalized) endpoints.push(`${normalized}/api/ai/next-action`);
    endpoints.push("/api/ai/next-action");

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, goal: activeDrawerGoal?.title || "" }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data) continue;
        const next = data.next_action || data.nextAction || data.action || "";
        if (typeof next === "string" && next.trim()) return next.trim();
      } catch (error) {
        console.error("Generate next action failed:", { endpoint, error });
      }
    }
    return fallback;
  }

  function openTaskDrawer(goalId, taskId) {
    const location = resolveTaskLocation(goalId, taskId);
    if (!location) return;
    setTaskDrawer({ open: true, goalId: location.goalId, taskId: location.taskId, saving: false });
  }

  function closeTaskDrawer() {
    setTaskDrawer({ open: false, goalId: null, taskId: null, saving: false });
  }

  function startTaskSprint(task) {
    openTaskDrawer(task.goalId, task.id);
    setActiveSprint({
      taskId: task.id,
      title: task.title,
      endsAt: Date.now() + 10 * 60 * 1000,
    });
    setActiveTaskTimer({
      taskId: task.id,
      goalId: task.goalId,
      startedAt: Date.now(),
    });
    showToast(`10-minute sprint started for "${task.title}".`);
  }

  function startTaskNow(task) {
    openTaskDrawer(task.goalId, task.id);
    setActiveSprint(null);
    setActiveTaskTimer({
      taskId: task.id,
      goalId: task.goalId,
      startedAt: Date.now(),
    });
    showToast(
      toneLine(
        `Start gently: 10 minutes on "${task.title}" now.`,
        `Start "${task.title}" now. Check in with proof when done.`,
        `Start "${task.title}" now. No more planning until progress is real.`
      )
    );
  }

  async function smartReschedule(task) {
    const next = new Date(`${selectedPlanDate || todayDateKey}T09:00:00`);
    next.setDate(next.getDate() + 1);
    await commitTaskUpdate(
      task.goalId,
      task.id,
      (current) => ({
        scheduledDate: next.toISOString(),
        status: "active",
        rescheduleCount: Number(current.rescheduleCount || 0) + 1,
        avoidanceScore: Number(current.avoidanceScore || 0) + 1,
        escalationLevel: Math.min(5, Number(current.escalationLevel || 0) + 1),
      }),
      "Could not reschedule task."
    );
    markTaskAsDeferred(task);
    showToast(`Rescheduled "${task.title}" to ${next.toISOString().slice(0, 10)}.`);
  }

  function generatePlan() {
    const { suggestions, recurringMinutes } = buildDailyPlan(prioritizedForPlan, availabilityWindows, {
      date: selectedPlanDateObj,
      occurrenceStore,
      dailyCapacityMinutes: plannerConstraints.dailyCapacityMinutes,
      yearSchedule,
    });
    setPlanSuggestions(suggestions);
    if (suggestions.length === 0) {
      showToast("No realistic slots available. Reduce active scope first.", "info");
      return;
    }
    const oneTimeLoad = suggestions
      .filter((item) => item.planType === "one_time")
      .reduce((sum, item) => sum + (item.estimatedMinutes || 0), 0);
    showToast(
      `Generated ${suggestions.length} blocks (${recurringMinutes}m recurring + ${oneTimeLoad}m one-time).`
    );
  }

  async function callAgentEndpoint(path, payload) {
    const base = import.meta.env.VITE_API_BASE_URL?.trim();
    const normalized = base ? base.replace(/\/+$/, "") : "";
    const endpoints = [];
    if (normalized) endpoints.push(`${normalized}${path}`);
    endpoints.push(path);

    const token = await getToken().catch(() => null);
    for (const endpoint of endpoints) {
      try {
        const headers = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const response = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(payload || {}),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data) {
          console.error("Agent endpoint error:", { endpoint, status: response.status, data });
          continue;
        }
        return data;
      } catch (error) {
        console.error("Agent endpoint failed:", { endpoint, error, path });
      }
    }
    return null;
  }

  function buildCaptureEntry(text, parsed) {
    const parsedType = parsed?.kind || "ambiguous";
    const confidence = Number.isFinite(parsed?.confidence) ? parsed.confidence : 0.5;
    return {
      id: `wa-${makeId()}`,
      sourceText: text,
      text,
      parsedType,
      kind: parsedType,
      confidence,
      requiresReview: parsedType === "ambiguous" || confidence < 0.55,
      followUpQuestion: parsed?.followUpQuestion || "",
      previewTitle:
        parsed?.task?.title || parsed?.goal?.title || parsed?.suggestion?.title || "",
      parsedPayload: parsed || null,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
  }

  async function applyCapturePayload(payload, sourceText = "", overrides = {}) {
    const parsed = payload || {};
    const kind = parsed.kind || "ambiguous";
    const titleOverride = String(overrides.title || "").trim();
    const goalNameOverride = String(overrides.goalName || "").trim();

    if (kind === "goal") {
      const title = titleOverride || parsed.goal?.title || "General";
      await createGoal(title);
      showToast("Goal captured from WhatsApp.");
      return true;
    }

    if (kind === "note") {
      setCapturedNotes((prev) =>
        [{ id: makeId(), text: parsed.note?.text || sourceText, createdAt: Date.now() }, ...prev].slice(0, 40)
      );
      showToast("Saved as note.");
      return true;
    }

    if (kind === "ambiguous") {
      if (!titleOverride) {
        showToast(parsed.followUpQuestion || "Need one concise action title first.", "info");
        return false;
      }
      const goalName = goalNameOverride || "General";
      let goalId =
        goalsForView.find((goal) => String(goal.title || "").toLowerCase() === goalName.toLowerCase())?.id || "";
      if (!goalId) goalId = await createGoal(goalName);
      if (!goalId) return false;
      await addTask(goalId, titleOverride, {
        sourceType: "whatsapp_capture",
        aiConfidence: Number.isFinite(parsed.confidence) ? parsed.confidence : 0.42,
        status: "needs_review",
        nextAction: "Clarify scope before scheduling.",
      });
      showToast("Added as review task.");
      return true;
    }

    if (kind === "one_time_task" || kind === "recurring_task") {
      const task = { ...(parsed.task || {}) };
      if (titleOverride) task.title = titleOverride;
      if (goalNameOverride) task.goalName = goalNameOverride;
      let targetGoalId = task.goalId || "";
      if (!targetGoalId) {
        const existing = goalsForView.find(
          (goal) => String(goal.title || "").toLowerCase() === String(task.goalName || "").toLowerCase()
        );
        if (existing) targetGoalId = existing.id;
      }
      if (!targetGoalId) {
        targetGoalId = await createGoal(task.goalName || "General");
      }
      if (!targetGoalId) return false;
      await addTask(targetGoalId, task.title || "Untitled task", {
        ...task,
        goalId: targetGoalId,
        sourceType: "whatsapp_capture",
        status: "active",
      });
      showToast("WhatsApp task captured.");
      return true;
    }

    showToast("Need clarification before applying this message.", "info");
    return false;
  }

  async function processWhatsAppCapture() {
    const text = String(whatsAppDraft || "").trim();
    if (!text) return;
    setWhatsAppParsing(true);
    try {
      const remote = await callAgentEndpoint("/api/agent/parse", { text });
      const parsed = remote || classifyWhatsAppCapture(text, goalsForView, new Date());
      const capture = buildCaptureEntry(text, parsed);
      setWhatsAppPreview(parsed);
      setWhatsAppFeed((prev) => [capture, ...(Array.isArray(prev) ? prev : [])].slice(0, 60));
      if (capture.requiresReview) {
        showToast(capture.followUpQuestion || "Needs one short follow-up before approval.", "info");
      } else {
        showToast("Message parsed. Review and approve in Inbox.");
      }
      setWhatsAppDraft("");
    } finally {
      setWhatsAppParsing(false);
    }
  }

  async function applyWhatsAppCapture() {
    if (!whatsAppPreview) return;
    const applied = await applyCapturePayload(whatsAppPreview, whatsAppDraft);
    if (!applied) return;
    setWhatsAppFeed((prev) =>
      prev.map((entry, index) => (index === 0 ? { ...entry, status: "approved", requiresReview: false } : entry))
    );
    setWhatsAppPreview(null);
    setWhatsAppDraft("");
  }

  function startEditingCapture(item) {
    if (!item) return;
    setInboxEditingId(item.id);
    setInboxEditDraft({
      title: item.previewTitle || item.parsedPayload?.task?.title || "",
      goalName:
        item.parsedPayload?.task?.goalName || item.parsedPayload?.goal?.title || "",
    });
  }

  function cancelEditingCapture() {
    setInboxEditingId(null);
    setInboxEditDraft({ title: "", goalName: "" });
  }

  function updateInboxDraft(field, value) {
    setInboxEditDraft((prev) => ({ ...prev, [field]: value }));
  }

  async function approveCapture(captureId) {
    const capture = inboxCaptures.find((item) => item.id === captureId);
    if (!capture) return;
    const applied = await applyCapturePayload(capture.parsedPayload, capture.sourceText, {
      title: inboxEditingId === captureId ? inboxEditDraft.title : "",
      goalName: inboxEditingId === captureId ? inboxEditDraft.goalName : "",
    });
    if (!applied) return;
    setWhatsAppFeed((prev) =>
      prev.map((entry) =>
        entry.id === captureId ? { ...entry, status: "approved", requiresReview: false } : entry
      )
    );
    cancelEditingCapture();
  }

  function rejectCapture(captureId) {
    setWhatsAppFeed((prev) =>
      prev.map((entry) => (entry.id === captureId ? { ...entry, status: "rejected" } : entry))
    );
    if (inboxEditingId === captureId) cancelEditingCapture();
    showToast("Capture rejected.");
  }

  async function generateMorningBrief() {
    const rule = pickDailyAccountabilityRule({
      topPriorities: commandCenter.topPriorities,
      signals: procrastinationSignals,
      tone: agentTone,
    });
    const payload = {
      topPriorities: commandCenter.topPriorities,
      recurringDue: recurringDueToday,
      oneTimeSelected: oneTimeToday,
      atRisk: atRiskTasks,
      suggestedSchedule: todaysSuggestedSchedule,
      accountabilityRule: rule,
    };
    const localMessage = buildMorningBriefMessage({
      ...payload,
      schedule: todaysSuggestedSchedule,
    });
    const remote = await callAgentEndpoint("/api/agent/dispatch", { action: "morning_brief", ...payload });
    const message = remote?.message || localMessage;
    setMorningBrief(message);
    setDailyPlanLog((prev) =>
      [
        {
          id: `plan-${makeId()}`,
          date: todayDateKey,
          topPriorities: commandCenter.topPriorities.map((task) => task.id),
          recurringDue: recurringDueToday.map((task) => task.id),
          oneTimeSelected: oneTimeToday.map((task) => task.id),
          suggestedSchedule: todaysSuggestedSchedule.map((entry) => ({
            taskId: entry.taskId,
            timeSlot: entry.timeSlot,
          })),
          accountabilityRule: rule,
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ].slice(0, 40)
    );
    showToast("Morning brief generated.");
    return message;
  }

  async function sendMorningBriefToWhatsApp() {
    const text = morningBrief || (await generateMorningBrief());
    if (!text) return;
    setMorningSending(true);
    try {
      const targetNumber = agentSettings.whatsAppTo || import.meta.env.VITE_WHATSAPP_TO || "";
      const response = await callAgentEndpoint("/api/agent/whatsapp-send", {
        text,
        to: targetNumber,
      });
      if (!response) {
        showToast("Could not send morning brief.", "error");
        return;
      }
      setMorningSentAt(new Date().toISOString());
      setWhatsAppFeed((prev) =>
        [
          {
            id: `wa-out-${makeId()}`,
            sourceText: "Morning brief sent",
            text: "Morning brief sent",
            parsedType: "morning_brief",
            kind: "morning_brief",
            confidence: 1,
            requiresReview: false,
            status: response.sent ? "sent" : response.mock ? "mock_preview_only" : "queued",
            createdAt: new Date().toISOString(),
          },
          ...prev,
        ].slice(0, 60)
      );
      if (response.sent) showToast("Morning brief sent to WhatsApp.");
      else showToast("Twilio credentials missing. Brief generated in preview mode.", "info");
    } finally {
      setMorningSending(false);
    }
  }

  async function prepareEveningCheckin() {
    const committedTaskIds = commitments
      .filter((entry) => entry.committedForDate === todayDateKey)
      .map((entry) => entry.taskId);
    const committedTasks = committedTaskIds
      .map((taskId) => prioritizedToday.find((task) => task.id === taskId))
      .filter(Boolean);
    const source = committedTasks.length > 0 ? committedTasks : commandCenter.topPriorities;
    const template = createEveningCheckinTemplate(source);
    setEveningItems(template);
    const fallback = buildEveningFollowupMessage(template);
    const remote = await callAgentEndpoint("/api/agent/dispatch", { action: "evening_followup", items: template });
    const followupText = remote?.message || fallback;
    setEveningSummary(followupText);
    showToast("Evening check-in prepared.");
  }

  async function sendLatestNudgeToWhatsApp() {
    setMorningSending(true);
    try {
      const targetNumber = agentSettings.whatsAppTo || import.meta.env.VITE_WHATSAPP_TO || "";
      const response = await callAgentEndpoint("/api/agent/whatsapp-send", {
        text: latestAgentNote,
        to: targetNumber,
      });
      if (!response) {
        showToast("Could not send nudge.", "error");
        return;
      }
      setWhatsAppFeed((prev) =>
        [
          {
            id: `wa-out-${makeId()}`,
            sourceText: "Nudge sent",
            text: "Nudge sent",
            parsedType: "nudge",
            kind: "nudge",
            confidence: 1,
            requiresReview: false,
            status: response.sent ? "sent" : response.mock ? "mock_preview_only" : "queued",
            createdAt: new Date().toISOString(),
          },
          ...prev,
        ].slice(0, 60)
      );
      if (response.sent) showToast("Nudge sent to WhatsApp.");
      else showToast("Twilio credentials missing. Nudge generated in preview mode.", "info");
    } finally {
      setMorningSending(false);
    }
  }

  async function sendEveningCheckinToWhatsApp() {
    let text = eveningSummary;
    if (!text) {
      const committedTaskIds = commitments
        .filter((entry) => entry.committedForDate === todayDateKey)
        .map((entry) => entry.taskId);
      const committedTasks = committedTaskIds
        .map((taskId) => prioritizedToday.find((task) => task.id === taskId))
        .filter(Boolean);
      const source = committedTasks.length > 0 ? committedTasks : commandCenter.topPriorities;
      const template = createEveningCheckinTemplate(source);
      setEveningItems(template);
      const fallback = buildEveningFollowupMessage(template);
      const remote = await callAgentEndpoint("/api/agent/dispatch", { action: "evening_followup", items: template });
      text = remote?.message || fallback;
      setEveningSummary(text);
    }
    if (!text) return;
    setMorningSending(true);
    try {
      const targetNumber = agentSettings.whatsAppTo || import.meta.env.VITE_WHATSAPP_TO || "";
      const response = await callAgentEndpoint("/api/agent/whatsapp-send", {
        text,
        to: targetNumber,
      });
      if (!response) {
        showToast("Could not send evening check-in.", "error");
        return;
      }
      setWhatsAppFeed((prev) =>
        [
          {
            id: `wa-out-${makeId()}`,
            sourceText: "Evening check-in sent",
            text: "Evening check-in sent",
            parsedType: "evening_followup",
            kind: "evening_followup",
            confidence: 1,
            requiresReview: false,
            status: response.sent ? "sent" : response.mock ? "mock_preview_only" : "queued",
            createdAt: new Date().toISOString(),
          },
          ...prev,
        ].slice(0, 60)
      );
      if (response.sent) showToast("Evening check-in sent to WhatsApp.");
      else showToast("Twilio credentials missing. Evening check-in generated in preview mode.", "info");
    } finally {
      setMorningSending(false);
    }
  }

  function updateEveningItem(taskId, patch) {
    setEveningItems((prev) =>
      prev.map((item) => (item.taskId === taskId ? { ...item, ...patch } : item))
    );
  }

  async function submitEveningCheckin() {
    if (eveningItems.length === 0) return;
    setEveningSubmitting(true);
    const nowIso = new Date().toISOString();
    const tomorrow = new Date(`${todayDateKey}T09:00:00`);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const skippedItems = [];
    const partialItems = [];

    try {
      for (const item of eveningItems) {
        const task = prioritizedToday.find((entry) => entry.id === item.taskId);
        if (!task) continue;

        if (item.status === "done") {
          await commitTaskUpdate(
            task.goalId,
            task.id,
            () => ({
              status: "done",
              completedAt: nowIso,
              completionDate: nowIso,
              commitmentStatus: "kept",
              proofNote: item.note || task.proofNote || "",
              proofProvidedAt: nowIso,
            }),
            "Could not mark task done."
          );
          updateCommitmentOutcome(task.id, "kept", 0);
          continue;
        }

        if (item.status === "partial") {
          partialItems.push({ taskId: task.id, title: task.title });
          await commitTaskUpdate(
            task.goalId,
            task.id,
            (current) => ({
              status: "active",
              scheduledDate: tomorrow.toISOString(),
              estimatedMinutes: Math.max(10, Math.round(Number(current.estimatedMinutes || 30) * 0.6)),
              proofNote: item.note || current.proofNote || "",
              rescheduleCount: Number(current.rescheduleCount || 0) + 1,
              escalationLevel: Math.min(5, Number(current.escalationLevel || 0) + 1),
              commitmentStatus: "partial",
            }),
            "Could not update partial completion."
          );
          updateCommitmentOutcome(task.id, "partial", 1);
          continue;
        }

        const skipReason = item.skipReason || "underestimated_time";
        const reasonPatch = skipReasonToPatch(skipReason);
        skippedItems.push({ taskId: task.id, title: task.title, reason: skipReason });
        await commitTaskUpdate(
          task.goalId,
          task.id,
          (current) => ({
            status: reasonPatch.status || "active",
            isBlocked: reasonPatch.isBlocked ?? current.isBlocked,
            scheduledDate: reasonPatch.status === "archived" ? current.scheduledDate : tomorrow.toISOString(),
            nextAction: reasonPatch.nextAction || current.nextAction || "",
            estimatedMinutes: reasonPatch.estimateScale
              ? Math.min(180, Math.round(Number(current.estimatedMinutes || 30) * reasonPatch.estimateScale))
              : current.estimatedMinutes,
            rescheduleCount: Number(current.rescheduleCount || 0) + 1,
            avoidanceScore: Number(current.avoidanceScore || 0) + Number(reasonPatch.avoidanceDelta || 1),
            escalationLevel: Math.min(5, Number(current.escalationLevel || 0) + 1),
            commitmentStatus: "missed",
            proofNote: item.note || current.proofNote || "",
          }),
          "Could not update skipped task."
        );
        updateCommitmentOutcome(task.id, "missed", 1);
      }

      const replanFromApi = await callAgentEndpoint("/api/agent/dispatch", {
        action: "replan",
        skippedItems,
        partialItems,
      });
      if (replanFromApi) setReplanProposal(replanFromApi);
      const summaryText = summarizeCheckinOutcome(eveningItems, agentTone);
      const replanText = buildReplanMessage(replanFromApi || replanProposal, agentTone);
      const finalText = `${summaryText}\n${replanText}`;
      setEveningSummary(finalText);
      setCheckinLog((prev) =>
        [
          {
            id: `checkin-${makeId()}`,
            date: todayDateKey,
            completedTasks: eveningItems.filter((item) => item.status === "done").map((item) => item.taskId),
            skippedTasks: eveningItems.filter((item) => item.status === "skipped").map((item) => item.taskId),
            skipReasons: eveningItems
              .filter((item) => item.status === "skipped")
              .map((item) => ({ taskId: item.taskId, reason: item.skipReason || "" })),
            generatedReplan: replanFromApi || null,
            createdAt: new Date().toISOString(),
          },
          ...prev,
        ].slice(0, 60)
      );
      showToast("Evening check-in submitted and replan prepared.");
    } finally {
      setEveningSubmitting(false);
    }
  }

  function updateCheckinField(field, value) {
    setDailyCheckin((prev) => ({ ...prev, date: todayDateKey, [field]: value }));
  }

  function updateAgentSetting(field, value) {
    setAgentSettings((prev) => ({ ...prev, [field]: value }));
  }

  async function saveAgentSettings() {
    setAgentTone(agentSettings.tone || "firm");
    if (!user?.id) {
      showToast("Agent settings saved locally.");
      return;
    }
    const payload = {
      userId: user.id,
      ...agentSettings,
    };
    const response = await callAgentEndpoint("/api/agent/settings", payload);
    if (!response?.ok && !response?.profile) {
      const errDetail = response?.error || response?.reason || "";
      showToast(`Server sync failed${errDetail ? ": " + errDetail : ""}. Check console for details.`, "error");
      return;
    }
    if (response?.profile) {
      setAgentSettings((prev) => ({
        ...prev,
        ...response.profile,
        whatsAppTo: response.profile.whatsAppNumber || prev.whatsAppTo,
      }));
    }
    showToast("Agent settings saved.");
  }

  async function loadAgentSettingsFromServer() {
    if (!user?.id) return;
    try {
      const token = await getToken().catch(() => null);
      const headers = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const response = await fetch(`/api/agent/settings?userId=${encodeURIComponent(user.id)}`, { headers });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.profile) {
        // No profile yet = new user, needs onboarding
        setOnboardingDone(false);
        return;
      }
      setAgentSettings((prev) => ({
        ...prev,
        ...data.profile,
        whatsAppTo: data.profile.whatsAppNumber || prev.whatsAppTo,
      }));
      if (data.agentWhatsAppNumber) setAgentWhatsAppFrom(data.agentWhatsAppNumber);
      if (data.profile?.tone) setAgentTone(data.profile.tone);
      setOnboardingDone(data.profile.onboardingCompleted ?? false);
    } catch (error) {
      console.error("loadAgentSettingsFromServer failed", { error });
      setOnboardingDone(false);
    }
  }

  async function runSchedulerNow() {
    setSchedulerRunning(true);
    try {
      const token = await getToken().catch(() => null);
      const headers = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const response = await fetch("/api/agent/scheduler", {
        method: "POST",
        headers,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        showToast("Scheduler trigger failed.", "error");
        return;
      }
      const sentCount = Array.isArray(data?.report)
        ? data.report.reduce((sum, item) => sum + (item.actions?.length || 0), 0)
        : 0;
      showToast(`Scheduler ran. ${sentCount} agent message(s) attempted.`);
    } catch (error) {
      console.error("runSchedulerNow failed", { error });
      showToast("Scheduler trigger failed.", "error");
    } finally {
      setSchedulerRunning(false);
    }
  }

  async function loadAgentDebug() {
    if (!user?.id) return;
    setDebugLoading(true);
    try {
      const token = await getToken().catch(() => null);
      const headers = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const response = await fetch(`/api/agent/debug?userId=${encodeURIComponent(user.id)}`, { headers });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) {
        showToast("Could not load agent debug logs.", "error");
        return;
      }
      setDebugData(data);
      showToast("Agent debug logs loaded.");
    } catch (error) {
      console.error("loadAgentDebug failed", { error });
      showToast("Could not load agent debug logs.", "error");
    } finally {
      setDebugLoading(false);
    }
  }

  const refreshWorkspace = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const loadServerCaptures = useCallback(async () => {
    if (!supabase || !user?.id) return;
    try {
      const { data, error } = await supabase
        .from("message_captures")
        .select("id, user_id, raw_text, parsed_intent, parse_confidence, processed, processing_result, clarification_requested, created_task_ids, updated_task_ids, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) {
        console.error("loadServerCaptures failed:", error);
        return;
      }
      setServerCaptures(data || []);
    } catch (err) {
      console.error("loadServerCaptures error:", err);
    }
  }, [supabase, user?.id]);

  /* ── Realtime sync: replaces old 30s setInterval polling ── */
  useRealtimeSync(supabase, user?.id, {
    onTaskChange: refreshWorkspace,
    onCaptureChange: loadServerCaptures,
  });

  function commitTopPriorities() {
    const top = commandCenter.topPriorities || [];
    if (top.length === 0) {
      showToast("No priorities available to commit.", "info");
      return;
    }

    setCommitments((prev) => {
      const next = [...prev];
      top.forEach((task, index) => {
        const exists = next.some(
          (entry) => entry.taskId === task.id && entry.committedForDate === todayDateKey
        );
        if (exists) return;
        next.push({
          id: `commit-${makeId()}`,
          taskId: task.id,
          committedForDate: todayDateKey,
          commitmentLevel: index === 0 ? "must" : "normal",
          proofRequired: Boolean(task.proofRequired),
          escalationLevel: 0,
          outcomeStatus: "pending",
        });
      });
      return next;
    });

    top.forEach((task, index) => {
      void commitTaskUpdate(
        task.goalId,
        task.id,
        (current) => ({
          commitmentStatus: "committed",
          commitmentLevel: index === 0 ? "must" : "normal",
          escalationLevel: Math.max(0, Number(current.escalationLevel || 0)),
        }),
        "Could not save commitment state."
      );
    });

    showToast(
      toneLine(
        "Priorities committed. Keep it simple and finish one meaningful block first.",
        "Top priorities committed. Finish them before adding more work.",
        "Commitment locked. No new tasks until top priorities move."
      )
    );
  }

  function generateReplan() {
    const proposal = buildReplanProposal(prioritizedForPlan, {
      date: selectedPlanDateObj,
      dailyCapacityMinutes: plannerConstraints.dailyCapacityMinutes,
      commitments,
      scheduleMap: yearSchedule.taskScheduleById,
    });
    setReplanProposal(proposal);
    if (!proposal.needed) {
      showToast("No replan needed right now.", "info");
      return;
    }
    showToast("Replan ready. Review and apply adjustments.");
  }

  async function applyReplanAdjustment(adjustment) {
    const fromView = prioritizedToday.find((task) => task.id === adjustment.taskId);
    if (!fromView) return;
    if (adjustment.action === "move_to_tomorrow") {
      const next = new Date(`${selectedPlanDate || todayDateKey}T09:00:00`);
      next.setDate(next.getDate() + 1);
      await commitTaskUpdate(
        fromView.goalId,
        fromView.id,
        (current) => ({
          scheduledDate: next.toISOString(),
          rescheduleCount: Number(current.rescheduleCount || 0) + 1,
          avoidanceScore: Number(current.avoidanceScore || 0) + 1,
          escalationLevel: Math.min(5, Number(current.escalationLevel || 0) + 1),
        }),
        "Could not move task."
      );
      markTaskAsDeferred(fromView);
    }
    if (adjustment.action === "reduce_scope") {
      await commitTaskUpdate(
        fromView.goalId,
        fromView.id,
        (current) => ({
          estimatedMinutes: adjustment.toMinutes || Math.max(15, Math.round(Number(current.estimatedMinutes || 30) * 0.5)),
          nextAction: current.nextAction || "Do only the first constrained deliverable today.",
          avoidanceScore: Math.max(0, Number(current.avoidanceScore || 0) - 1),
        }),
        "Could not reduce scope."
      );
    }
    setReplanProposal((prev) => ({
      ...prev,
      adjustments: (prev.adjustments || []).filter(
        (entry) => !(entry.taskId === adjustment.taskId && entry.action === adjustment.action)
      ),
    }));
    showToast("Replan adjustment applied.");
  }

  async function applyTaskPatch(taskId, patch, errorMessage) {
    const fromView = prioritizedToday.find((task) => task.id === taskId);
    if (!fromView) return;
    await commitTaskUpdate(fromView.goalId, fromView.id, () => patch, errorMessage);
  }

  async function acceptPlanSuggestion(suggestion) {
    await applyTaskPatch(
      suggestion.taskId,
      {
        suggestedTimeSlot: suggestion.timeSlot,
        status: "scheduled",
        scheduledDate: new Date(`${suggestion.date || selectedPlanDate}T09:00:00`).toISOString(),
        scheduledStart: suggestion.timeSlot?.split("-")?.[0]?.trim() || null,
        scheduledEnd: suggestion.timeSlot?.split("-")?.[1]?.trim() || null,
      },
      "Could not accept plan suggestion."
    );
    setPlanSuggestions((prev) => prev.filter((entry) => entry.id !== suggestion.id));
    showToast("Suggestion accepted.");
  }

  async function moveSuggestionLater(suggestion) {
    const fromDate = new Date(`${suggestion.date || selectedPlanDate}T09:00:00`);
    fromDate.setDate(fromDate.getDate() + 1);
    const task = prioritizedToday.find((entry) => entry.id === suggestion.taskId);
    await applyTaskPatch(
      suggestion.taskId,
      {
        scheduledDate: fromDate.toISOString(),
        status: "active",
        rescheduleCount: Number(task?.rescheduleCount || 0) + 1,
        avoidanceScore: Number(task?.avoidanceScore || 0) + 1,
        escalationLevel: Math.min(5, Number(task?.escalationLevel || 0) + 1),
      },
      "Could not move task to a later day."
    );
    if (task) markTaskAsDeferred(task);
    setPlanSuggestions((prev) => prev.filter((entry) => entry.id !== suggestion.id));
    showToast(`Moved "${suggestion.title}" to tomorrow.`);
  }

  async function skipSuggestion(suggestion) {
    if (suggestion.planType === "recurring") {
      const dateKey = suggestion.date || selectedPlanDate;
      upsertOccurrence(suggestion.taskId, dateKey, {
        status: "pending",
        skipped: true,
        completedAt: null,
      });
    } else {
      const task = prioritizedToday.find((entry) => entry.id === suggestion.taskId);
      await applyTaskPatch(
        suggestion.taskId,
        {
          scheduledDate: null,
          status: "active",
          rescheduleCount: Number(task?.rescheduleCount || 0) + 1,
          avoidanceScore: Number(task?.avoidanceScore || 0) + 1,
          escalationLevel: Math.min(5, Number(task?.escalationLevel || 0) + 1),
        },
        "Could not skip task."
      );
      if (task) markTaskAsDeferred(task);
    }
    setPlanSuggestions((prev) => prev.filter((entry) => entry.id !== suggestion.id));
  }

  async function reduceSuggestionScope(suggestion) {
    const task = prioritizedToday.find((entry) => entry.id === suggestion.taskId);
    if (!task) return;
    const reduced = Math.max(10, Math.round(task.estimatedMinutes * 0.65));
    await applyTaskPatch(
      task.id,
      {
        estimatedMinutes: reduced,
        nextAction: task.nextAction || "Break into a smaller first pass and complete only that.",
        avoidanceScore: Math.max(0, Number(task.avoidanceScore || 0) - 1),
      },
      "Could not reduce scope."
    );
    showToast(`Reduced scope to ${reduced} minutes.`);
  }

  function parseIntakePreview() {
    setIntakeParsing(true);
    try {
      const parsed = parseIntakeInput(intakeRawText);
      const normalized = parsed.map((item) => {
        const matchingGoal = goals.find(
          (goal) => item.goalName && goal.title.toLowerCase() === item.goalName.toLowerCase()
        );
        return {
          ...item,
          selected: item.kind !== "note",
          goalId: matchingGoal?.id || "",
        };
      });
      setIntakePreview(normalized);
      setIntakeMessage(
        `${normalized.filter((item) => item.kind === "task").length} tasks parsed, ${
          normalized.filter((item) => item.kind === "needs_review").length
        } need review.`
      );
    } finally {
      setIntakeParsing(false);
    }
  }

  async function applyIntakePreview() {
    const selected = intakePreview.filter((item) => item.selected);
    if (selected.length === 0) return;
    let tasksAdded = 0;
    let notesAdded = 0;

    for (const item of selected) {
      if (item.kind === "note") {
        notesAdded += 1;
        setCapturedNotes((prev) => [{ id: makeId(), text: item.source, createdAt: Date.now() }, ...prev].slice(0, 20));
        continue;
      }

      let targetGoalId = item.goalId;
      if (!targetGoalId) {
        targetGoalId = await createGoal(item.goalName || "General");
      }
      if (!targetGoalId) continue;

      await addTask(targetGoalId, item.title, {
        description: item.description || "",
        estimatedMinutes: item.estimatedMinutes || 30,
        dueDate: item.dueDate || null,
        scheduledDate: null,
        urgency: item.urgency || 2,
        importance: item.importance || 3,
        effortType: item.effortType || "deep_work",
        aiConfidence: item.confidence || 0.5,
        sourceType: "ai_parsed",
        status: item.kind === "needs_review" ? "needs_review" : "active",
        type: item.taskType || (item.isRecurring ? "recurring" : "one_time"),
        isRecurring: Boolean(item.isRecurring),
        recurrenceRule: item.recurrenceRule || null,
        proofType: item.proofType || "note",
        proofRequired: Number(item.importance || 0) >= 4,
        nextAction: item.kind === "needs_review" ? "Clarify scope before scheduling." : "",
      });
      tasksAdded += 1;
    }

    setIntakePreview([]);
    setIntakeRawText("");
    setIntakeMessage(
      `Added ${tasksAdded} tasks${notesAdded > 0 ? ` and captured ${notesAdded} notes` : ""}.`
    );
    showToast("Intake applied.");
  }

  function onIntakeUpload(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === "string" ? reader.result : "";
      setIntakeRawText((prev) => [prev.trim(), content.trim()].filter(Boolean).join("\n"));
    };
    reader.readAsText(file);
  }

  useEffect(() => {
    setPlanSuggestions((prev) =>
      prev.filter((suggestion) => prioritizedToday.some((task) => task.id === suggestion.taskId))
    );
  }, [prioritizedToday]);

  useEffect(() => {
    if (!taskDrawer.open) return;
    const exists = goalsForView.some(
      (goal) => goal.id === taskDrawer.goalId && goal.tasks.some((task) => task.id === taskDrawer.taskId)
    );
    if (!exists) closeTaskDrawer();
  }, [goalsForView, taskDrawer.open, taskDrawer.goalId, taskDrawer.taskId]);

  useEffect(() => {
    if (!activeTaskTimer) return;
    const exists = allTasks.some((task) => task.id === activeTaskTimer.taskId);
    if (!exists) setActiveTaskTimer(null);
  }, [allTasks, activeTaskTimer]);

  useEffect(() => {
    if (dailyCheckin?.date === todayDateKey) return;
    setDailyCheckin((prev) => ({ ...defaultCheckinState(), ...prev, date: todayDateKey }));
  }, [dailyCheckin?.date, todayDateKey]);

  useEffect(() => {
    setCommitments((prev) =>
      prev.map((entry) => {
        if (entry.outcomeStatus !== "pending") return entry;
        if (String(entry.committedForDate) >= todayDateKey) return entry;
        return {
          ...entry,
          outcomeStatus: "missed",
          escalationLevel: Math.max(1, Number(entry.escalationLevel || 0) + 1),
        };
      })
    );
  }, [todayDateKey]);

  const userDisplayName = user?.firstName || user?.fullName || "Your";

  if (isLandingRoute) {
    return <Landing />;
  }

  return (
    <div className={nightMode ? "execApp nightMode" : "execApp"}>
      <SignedOut>
        <AuthPage />
      </SignedOut>

      <SignedIn>
        {onboardingDone === null ? (
          <main className="execMain">
            <section className="cardShell loadingCard">
              <p className="subtle">Loading...</p>
            </section>
          </main>
        ) : onboardingDone === false ? (
          <Onboarding
            userId={user?.id}
            getToken={getToken}
            agentWhatsAppFrom={agentWhatsAppFrom}
            onComplete={() => {
              setOnboardingDone(true);
              loadAgentSettingsFromServer();
            }}
          />
        ) : (
        <>
        <main className="execMain">
          <ExecutionHeader
            workspaceName={workspaceName || `${userDisplayName}'s workspace`}
            nightMode={nightMode}
            onToggleNightMode={() => setNightMode((prev) => !prev)}
            userSlot={<UserButton />}
          />

          {activeSprint ? <p className="sprintBadge">Sprint running: {activeSprint.title} · {sprintLabel}</p> : null}

          {dataError ? <div className="errorBanner">{dataError}</div> : null}

          {loading ? (
            <section className="cardShell loadingCard">
              <p className="subtle">Setting things up...</p>
            </section>
          ) : goals.length === 0 && activeSurface === "today" ? (
            <section className="appSurfaceArea" key="welcome">
              <article className="cardShell welcomeCard">
                <h2>Welcome to 365 Tasks</h2>
                <p>Your AI-powered daily execution system. Here's how to get started:</p>
                <div className="welcomeSteps">
                  <div className="welcomeStep">
                    <span className="welcomeStepNum">1</span>
                    <div>
                      <strong>Create a goal</strong>
                      <p>Head to Goals and add what you're working toward.</p>
                    </div>
                  </div>
                  <div className="welcomeStep">
                    <span className="welcomeStepNum">2</span>
                    <div>
                      <strong>Add tasks</strong>
                      <p>Break each goal into concrete tasks with time estimates.</p>
                    </div>
                  </div>
                  <div className="welcomeStep">
                    <span className="welcomeStepNum">3</span>
                    <div>
                      <strong>Let AI plan your day</strong>
                      <p>Come back to Today and see your priorities, nudges, and next actions.</p>
                    </div>
                  </div>
                </div>
                <button type="button" className="primaryButton" onClick={() => setActiveSurface("goals")}>
                  Create your first goal
                </button>
              </article>
            </section>
          ) : (
            <section className="appSurfaceArea" key={activeSurface}>
              {activeSurface === "today" ? (
                <TodaySurface
                  dateLabel={formatFriendlyDate(new Date())}
                  agentStatus={agentStatusLabel}
                  topPriorities={commandCenter.topPriorities || []}
                  nextTask={commandCenter.nextTask || null}
                  dueTodayCount={dueTodayCount}
                  overdueCount={overdueCount}
                  blockedCount={blockedCount}
                  latestNudge={latestAgentNote}
                  onOpenTask={openTaskDrawer}
                  onDone={(task) => void toggleTaskDone(task.goalId, task.id)}
                  onSnooze={(task) => void snoozeTask(task)}
                  onSplit={(task) => void breakIntoSubtasks(task, { title: task.title })}
                  onReschedule={(task) => void smartReschedule(task)}
                  onStartNow={startTaskNow}
                  onStartSprint={startTaskSprint}
                />
              ) : null}

              {activeSurface === "inbox" ? (
                <InboxSurface
                  simulateText={whatsAppDraft}
                  onSimulateTextChange={setWhatsAppDraft}
                  onSimulate={() => void processWhatsAppCapture()}
                  processing={whatsAppParsing}
                  captures={inboxCaptures}
                  editingId={inboxEditingId}
                  editDraft={inboxEditDraft}
                  onStartEdit={startEditingCapture}
                  onEditDraftChange={updateInboxDraft}
                  onApprove={(id) => void approveCapture(id)}
                  onReject={rejectCapture}
                  onCancelEdit={cancelEditingCapture}
                />
              ) : null}

              {activeSurface === "goals" ? (
                <GoalsSurface
                  goals={goalsForView.filter((goal) => goal.status !== "archived")}
                  yearSnapshot={yearSnapshot}
                  newGoalTitle={newGoalTitle}
                  onNewGoalTitleChange={setNewGoalTitle}
                  onCreateGoal={() => void addGoalFromInput()}
                  onEditGoal={(goalId, title) => {
                    const currentGoal = goalsForView.find((goal) => goal.id === goalId);
                    void saveGoalChanges(goalId, {
                      title,
                      description: currentGoal?.description || "",
                      status: currentGoal?.status || "active",
                      archivedAt: currentGoal?.archivedAt || null,
                    });
                  }}
                  onArchiveGoal={(goalId) => void toggleArchiveGoal(goalId)}
                  onDeleteGoal={(goalId) => void deleteGoal(goalId)}
                  onAddTask={(goalId, title) => void addTask(goalId, title)}
                  onOpenTask={openTaskDrawer}
                  onToggleTaskDone={(goalId, taskId) => void toggleTaskDone(goalId, taskId)}
                  onDeleteTask={(goalId, taskId) => void deleteTask(goalId, taskId)}
                  onSnoozeTask={(task) => void snoozeTask(task)}
                  onMoveTask={(sourceGoalId, taskId, targetGoalId) =>
                    void moveTaskBetweenGoals(sourceGoalId, taskId, targetGoalId)
                  }
                  onChangeBranch={(goalId, branchId) => void changeBranch(goalId, branchId)}
                />
              ) : null}

              {activeSurface === "settings" ? (
                <AgentSettingsSurface
                  settings={agentSettings}
                  userId={user?.id || ""}
                  onSettingChange={updateAgentSetting}
                  onSave={saveAgentSettings}
                  onSendMorning={() => void sendMorningBriefToWhatsApp()}
                  onSendNudge={() => void sendLatestNudgeToWhatsApp()}
                  onSendEvening={() => void sendEveningCheckinToWhatsApp()}
                  onRunScheduler={runSchedulerNow}
                  onLoadDebug={loadAgentDebug}
                  debugData={debugData}
                  debugLoading={debugLoading}
                  schedulerRunning={schedulerRunning}
                  sending={morningSending}
                  connection={agentConnection}
                />
              ) : null}
            </section>
          )}
        </main>

        <TaskDrawer
          open={taskDrawer.open}
          task={activeDrawerTask}
          goals={goalsForView}
          currentGoalName={activeDrawerGoal?.title || ""}
          onClose={closeTaskDrawer}
          onSave={saveTaskFromDrawer}
          onMove={(goalId) => void moveTaskToGoal(goalId)}
          onGenerateNextAction={onGenerateNextAction}
          onToggleComplete={(task) => void toggleTaskDone(task.goalId, task.id)}
          onSnooze={(task) => void snoozeTask(task)}
          onDeleteTask={(task) => void deleteTask(task.goalId, task.id)}
          onBreakIntoSubtasks={(task, draft) => void breakIntoSubtasks(task, draft)}
          onStartTimer={startTaskTimer}
          onStopTimer={(task, elapsedSeconds) => void stopTaskTimer(task, elapsedSeconds)}
          onAddActualMinutes={(task, minutes) => void addActualMinutes(task, minutes)}
          timer={activeTaskTimer}
          saving={taskDrawer.saving}
        />

        <nav className="bottomNav">
          <button
            type="button"
            className={activeSurface === "today" ? "bottomNavTab active" : "bottomNavTab"}
            onClick={() => { setActiveSurface("today"); refreshWorkspace(); }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="3" y1="10" x2="21" y2="10" />
              <line x1="9" y1="2" x2="9" y2="6" />
              <line x1="15" y1="2" x2="15" y2="6" />
            </svg>
            <span>Today</span>
          </button>
          <button
            type="button"
            className={activeSurface === "inbox" ? "bottomNavTab active" : "bottomNavTab"}
            onClick={() => { setActiveSurface("inbox"); refreshWorkspace(); loadServerCaptures(); }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12h-6l-2 3H10l-2-3H2" />
              <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
            </svg>
            <span>Inbox</span>
          </button>
          <button
            type="button"
            className={activeSurface === "goals" ? "bottomNavTab active" : "bottomNavTab"}
            onClick={() => setActiveSurface("goals")}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <circle cx="12" cy="12" r="6" />
              <circle cx="12" cy="12" r="2" />
            </svg>
            <span>Goals</span>
          </button>
          <button
            type="button"
            className={activeSurface === "settings" ? "bottomNavTab active" : "bottomNavTab"}
            onClick={() => setActiveSurface("settings")}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
            <span>Settings</span>
          </button>
        </nav>

        {toast ? (
          <div className={toast.kind === "error" ? "toast toastError" : "toast"}>{toast.message}</div>
        ) : null}
        </>
        )}
      </SignedIn>
    </div>
  );
}

function AuthPage() {
  const [mode, setMode] = useState("sign-in");

  const appearance = {
    variables: {
      colorPrimary: "#3139FB",
      colorText: "#1A1A2E",
      colorBackground: "#FFFFFF",
      borderRadius: "10px",
      fontFamily: "Paper Mono, ui-monospace, monospace",
    },
  };

  return (
    <div className="authShell">
      <div className="authPanel">
        <p className="eyebrow">365 Tasks</p>
        <h2>Sign in to your execution workspace</h2>
        <p>AI planning and daily execution live inside your private workspace.</p>
      </div>
      <div className="authPanel form">
        <div className="authTabs">
          <button
            type="button"
            className={mode === "sign-in" ? "ghostButton mini active" : "ghostButton mini"}
            onClick={() => setMode("sign-in")}
          >
            Sign in
          </button>
          <button
            type="button"
            className={mode === "sign-up" ? "ghostButton mini active" : "ghostButton mini"}
            onClick={() => setMode("sign-up")}
          >
            Sign up
          </button>
        </div>
        {mode === "sign-in" ? (
          <SignIn routing="virtual" appearance={appearance} />
        ) : (
          <SignUp routing="virtual" appearance={appearance} />
        )}
      </div>
    </div>
  );
}
