import { useEffect, useMemo, useState } from "react";
import {
  SignedIn,
  SignedOut,
  SignIn,
  SignUp,
  UserButton,
  useAuth,
  useUser,
} from "@clerk/clerk-react";
import { createClerkSupabaseClient } from "./lib/supabaseClient";

const OWNER_NAME_KEY = "mini_planner_owner_name_v1";
const MAX_GOALS = 20;
const BG_PREF_KEY = "mini_planner_bg_pref_v1";
const QUOTES_KEY = "mini_planner_quotes_v1";
const THEME_KEY = "mini_planner_theme_v1";
const LOCAL_GOALS_KEY = "mini_planner_local_goals_v1";
const COLLAGE_COLORS = [
  "#d9e4cc",
  "#d8e5f5",
  "#edd8c6",
  "#ddd5ee",
  "#d4e7df",
  "#f4d5da",
  "#f2e7be",
  "#d2e5eb",
  "#e5ddd3",
];

const AI_TEMPLATES = {
  launch: [
    ["Prepare marketing assets (screenshots, video)", 60],
    ["Draft maker comment & social copy", 45],
    ["Schedule posts on LinkedIn & X", 30],
    ["Monitor launch & engage community", 30],
  ],
  outreach: [
    ["Define target list & pull contacts", 30],
    ["Draft master outreach email", 40],
    ["Personalize emails for top contacts", 45],
    ["Send & log outreach in CRM/notes", 30],
    ["Schedule quick follow-up reminders", 20],
  ],
  design: [
    ["Clarify requirements & success criteria", 30],
    ["Collect inspiration & references", 30],
    ["Sketch rough flows / wireframes", 45],
    ["Create high-fidelity mocks in Figma", 60],
    ["Prepare exportables / handoff notes", 30],
  ],
  generic: [
    ["Clarify goal & constraints", 20],
    ["Break work into concrete steps", 25],
    ["Do initial pass", 40],
    ["Review, polish, and ship", 35],
  ],
};

function makeId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function pickTemplateKey(title) {
  const t = String(title || "").toLowerCase();
  if (t.includes("launch") || t.includes("product hunt") || t.includes("marketing")) {
    return "launch";
  }
  if (t.includes("email") || t.includes("outreach") || t.includes("reach out")) {
    return "outreach";
  }
  if (t.includes("design") || t.includes("mock") || t.includes("figma")) {
    return "design";
  }
  return "generic";
}

function buildScopeFromTemplate(title) {
  const key = pickTemplateKey(title);
  const template = AI_TEMPLATES[key] ?? AI_TEMPLATES.generic;
  return template.map(([text, minutes]) => ({
    id: makeId(),
    text,
    done: false,
    minutes: Number.isFinite(minutes) ? minutes : 15,
    createdAt: Date.now(),
  }));
}

function loadOwnerName() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(OWNER_NAME_KEY) || "";
}

function saveOwnerName(name) {
  try {
    window.localStorage.setItem(OWNER_NAME_KEY, name);
  } catch {
    // ignore
  }
}

function loadBgPref() {
  const defaultTiles = COLLAGE_COLORS.map((color) => ({ type: "color", value: color }));
  const defaultTheme = {
    primary: "#a91818",
    primaryHover: "#8f1414",
    text: "#181717",
    muted: "rgba(24, 23, 23, 0.62)",
    border: "rgba(24, 23, 23, 0.1)",
    surface: "rgba(255, 255, 255, 0.95)",
    surface2: "#f8faed",
  };
  if (typeof window === "undefined") {
    return {
      collageTiles: defaultTiles,
      selectedTile: 0,
      theme: defaultTheme,
      overlayOpacity: 20,
      boardOpacity: 94,
      boardBlur: 2,
      boardRadius: 48,
    };
  }
  try {
    const raw = window.localStorage.getItem(BG_PREF_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") {
      const parsedTiles = Array.isArray(parsed.collageTiles)
        ? parsed.collageTiles
            .filter(
              (tile) =>
                tile &&
                typeof tile === "object" &&
                (tile.type === "color" || tile.type === "image") &&
                typeof tile.value === "string" &&
                tile.value.trim()
            )
            .slice(0, 9)
        : [];
      const legacyImages = Array.isArray(parsed.imageUrls)
        ? parsed.imageUrls.filter((url) => typeof url === "string" && url.trim()).slice(0, 9)
        : [];
      const collageTiles =
        parsedTiles.length > 0
          ? [
              ...parsedTiles,
              ...defaultTiles.slice(parsedTiles.length, 9),
            ]
          : legacyImages.length > 0
            ? defaultTiles.map((tile, idx) =>
                legacyImages[idx] ? { type: "image", value: legacyImages[idx] } : tile
              )
            : defaultTiles;
      return {
        collageTiles,
        selectedTile:
          Number.isFinite(parsed.selectedTile) && parsed.selectedTile >= 0 && parsed.selectedTile < 9
            ? Math.floor(parsed.selectedTile)
            : 0,
        theme:
          parsed.theme && typeof parsed.theme === "object"
            ? {
                primary:
                  typeof parsed.theme.primary === "string"
                    ? parsed.theme.primary
                    : defaultTheme.primary,
                primaryHover:
                  typeof parsed.theme.primaryHover === "string"
                    ? parsed.theme.primaryHover
                    : defaultTheme.primaryHover,
                text:
                  typeof parsed.theme.text === "string" ? parsed.theme.text : defaultTheme.text,
                muted:
                  typeof parsed.theme.muted === "string"
                    ? parsed.theme.muted
                    : defaultTheme.muted,
                border:
                  typeof parsed.theme.border === "string"
                    ? parsed.theme.border
                    : defaultTheme.border,
                surface:
                  typeof parsed.theme.surface === "string"
                    ? parsed.theme.surface
                    : defaultTheme.surface,
                surface2:
                  typeof parsed.theme.surface2 === "string"
                    ? parsed.theme.surface2
                    : defaultTheme.surface2,
              }
            : defaultTheme,
        overlayOpacity: Number.isFinite(parsed.overlayOpacity) ? parsed.overlayOpacity : 20,
        boardOpacity: Number.isFinite(parsed.boardOpacity) ? parsed.boardOpacity : 94,
        boardBlur: Number.isFinite(parsed.boardBlur) ? parsed.boardBlur : 2,
        boardRadius: Number.isFinite(parsed.boardRadius) ? parsed.boardRadius : 48,
      };
    }
  } catch {
    // ignore
  }
  return {
    collageTiles: defaultTiles,
    selectedTile: 0,
    theme: defaultTheme,
    overlayOpacity: 20,
    boardOpacity: 94,
    boardBlur: 2,
    boardRadius: 48,
  };
}

function saveBgPref(pref) {
  try {
    window.localStorage.setItem(BG_PREF_KEY, JSON.stringify(pref));
  } catch {
    // ignore
  }
}

function loadQuotes() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(QUOTES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, 10);
  } catch {
    return [];
  }
}

function saveQuotes(quotes) {
  try {
    window.localStorage.setItem(QUOTES_KEY, JSON.stringify(quotes.slice(0, 10)));
  } catch {
    // ignore
  }
}

function loadNightMode() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(THEME_KEY) === "night";
}

function saveNightMode(enabled) {
  try {
    window.localStorage.setItem(THEME_KEY, enabled ? "night" : "day");
  } catch {
    // ignore
  }
}

function loadLocalGoals() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_GOALS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((goal) => goal && typeof goal === "object" && String(goal.id || "").startsWith("local-"))
      .map((goal) => ({
        id: String(goal.id),
        title: typeof goal.title === "string" ? goal.title : "Untitled goal",
        tasks: Array.isArray(goal.tasks)
          ? goal.tasks.map((task) => ({
              id: typeof task.id === "string" ? task.id : `local-task-${makeId()}`,
              text: typeof task.text === "string" ? task.text : "",
              done: Boolean(task.done),
              minutes: Number.isFinite(task.minutes) ? task.minutes : 15,
              createdAt: Number.isFinite(task.createdAt) ? task.createdAt : Date.now(),
            }))
          : [],
        aiLoading: false,
        aiError: "",
        createdAt: Number.isFinite(goal.createdAt) ? goal.createdAt : Date.now(),
      }))
      .slice(0, MAX_GOALS);
  } catch {
    return [];
  }
}

function saveLocalGoals(goals) {
  if (typeof window === "undefined") return;
  const localOnly = goals
    .filter((goal) => String(goal.id || "").startsWith("local-"))
    .map((goal) => ({
      id: goal.id,
      title: goal.title,
      createdAt: goal.createdAt,
      tasks: Array.isArray(goal.tasks)
        ? goal.tasks.map((task) => ({
            id: task.id,
            text: task.text,
            done: Boolean(task.done),
            minutes: Number.isFinite(task.minutes) ? task.minutes : 15,
            createdAt: Number.isFinite(task.createdAt) ? task.createdAt : Date.now(),
          }))
        : [],
    }));
  try {
    window.localStorage.setItem(LOCAL_GOALS_KEY, JSON.stringify(localOnly));
  } catch {
    // ignore
  }
}

function parseCssColor(input) {
  if (typeof input !== "string") return null;
  const value = input.trim();
  const hexMatch = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    const fullHex = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
    const int = Number.parseInt(fullHex, 16);
    return {
      r: (int >> 16) & 255,
      g: (int >> 8) & 255,
      b: int & 255,
      a: 1,
    };
  }
  const rgbMatch = value.match(
    /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})(?:\s*[,/]\s*(\d*\.?\d+))?\s*\)$/i
  );
  if (rgbMatch) {
    return {
      r: Math.max(0, Math.min(255, Number(rgbMatch[1]))),
      g: Math.max(0, Math.min(255, Number(rgbMatch[2]))),
      b: Math.max(0, Math.min(255, Number(rgbMatch[3]))),
      a: rgbMatch[4] != null ? Math.max(0, Math.min(1, Number(rgbMatch[4]))) : 1,
    };
  }
  return null;
}

function toRelativeLuminance({ r, g, b }) {
  const channel = (c) => {
    const scaled = c / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(colorA, colorB) {
  const lumA = toRelativeLuminance(colorA);
  const lumB = toRelativeLuminance(colorB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

function ensureReadableText(textColor, backgroundColor) {
  const fg = parseCssColor(textColor);
  const bg = parseCssColor(backgroundColor);
  if (!fg || !bg) return textColor;
  if (contrastRatio(fg, bg) >= 4.5) return textColor;
  const black = { r: 12, g: 12, b: 12, a: 1 };
  const white = { r: 245, g: 245, b: 245, a: 1 };
  return contrastRatio(black, bg) >= contrastRatio(white, bg) ? "#0c0c0c" : "#f5f5f5";
}

export default function App() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const [goals, setGoals] = useState([]);
  const [ownerName, setOwnerName] = useState(loadOwnerName);
  const [isEditingOwner, setIsEditingOwner] = useState(false);
  const [newGoalTitle, setNewGoalTitle] = useState("");
  const [goalSections, setGoalSections] = useState({});
  const [goalTitleEditing, setGoalTitleEditing] = useState({});
  const [taskDrafts, setTaskDrafts] = useState({});
  const [bgPref, setBgPref] = useState(loadBgPref);
  const [quotes, setQuotes] = useState(loadQuotes);
  const [quoteInput, setQuoteInput] = useState("");
  const [nightMode, setNightMode] = useState(loadNightMode);
  const [loadingGoals, setLoadingGoals] = useState(true);
  const [goalsHydrated, setGoalsHydrated] = useState(false);
  const [dataError, setDataError] = useState("");

  const loginName = user?.firstName || user?.fullName || user?.username || "";
  const supabase = useMemo(() => {
    try {
      return createClerkSupabaseClient(getToken);
    } catch {
      return null;
    }
  }, [getToken]);

  useEffect(() => {
    saveOwnerName(ownerName);
  }, [ownerName]);

  useEffect(() => {
    saveBgPref(bgPref);
  }, [bgPref]);

  useEffect(() => {
    saveQuotes(quotes);
  }, [quotes]);

  useEffect(() => {
    saveNightMode(nightMode);
  }, [nightMode]);

  useEffect(() => {
    if (!goalsHydrated) return;
    saveLocalGoals(goals);
  }, [goals, goalsHydrated]);

  useEffect(() => {
    if (!ownerName.trim() && loginName) {
      setOwnerName(loginName);
    }
  }, [ownerName, loginName]);

  const overallStats = useMemo(() => {
    const tasks = goals.flatMap((goal) => goal.tasks);
    const total = tasks.length;
    const completed = tasks.filter((task) => task.done).length;
    const completedOutOf365 = Math.min(365, completed);
    const yearProgressPct = Math.min(100, Math.round((completedOutOf365 / 365) * 100));
    return { total, completed, completedOutOf365, yearProgressPct };
  }, [goals]);

  function formatSupabaseError(err, fallback) {
    if (!err) return fallback;
    const message = [err.message, err.details, err.hint].filter(Boolean).join(" ");
    return message || fallback;
  }

  function normalizeTaskStepRow(row) {
    return {
      id: row.id,
      text: row.text || "",
      done: Boolean(row.done),
      minutes: Number.isFinite(row.minutes) ? row.minutes : 15,
      createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    };
  }

  async function loadStepsForTask(taskId) {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("task_steps")
      .select("id, task_id, text, done, minutes, created_at")
      .eq("task_id", taskId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    const nextSteps = (data || []).map(normalizeTaskStepRow);
    setGoals((prev) =>
      prev.map((goal) => (goal.id === taskId ? { ...goal, tasks: nextSteps } : goal))
    );
  }
  useEffect(() => {
    let cancelled = false;
    async function loadGoalsFromSupabase() {
      if (!user) {
        if (!cancelled) {
          setGoals(loadLocalGoals());
          setLoadingGoals(false);
          setGoalsHydrated(true);
        }
        return;
      }
      if (!supabase) {
        if (!cancelled) {
          setGoals(loadLocalGoals());
          setLoadingGoals(false);
          setDataError("Supabase is not configured. Check environment variables.");
          setGoalsHydrated(true);
        }
        return;
      }
      setLoadingGoals(true);
      setDataError("");
      try {
        let tasksData = null;
        let tasksError = null;

        // Preferred: per-user rows via user_id (matches Clerk user id text).
        const first = await supabase
          .from("tasks")
          .select("id, title, created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(MAX_GOALS);
        tasksData = first.data;
        tasksError = first.error;

        // Fallback for projects that don't yet have user_id column.
        if (tasksError && String(tasksError.code || "") === "42703") {
          const second = await supabase
            .from("tasks")
            .select("id, title, created_at")
            .order("created_at", { ascending: false })
            .limit(MAX_GOALS);
          tasksData = second.data;
          tasksError = second.error;
        }

        if (tasksError) throw tasksError;

        const taskIds = (tasksData || []).map((row) => row.id);
        let stepsByTask = {};
        if (taskIds.length > 0) {
          const { data: stepsData, error: stepsError } = await supabase
            .from("task_steps")
            .select("id, task_id, text, done, minutes, created_at")
            .in("task_id", taskIds)
            .order("created_at", { ascending: true });
          if (stepsError) throw stepsError;

          stepsByTask = (stepsData || []).reduce((acc, row) => {
            const key = row.task_id;
            if (!acc[key]) acc[key] = [];
            acc[key].push(normalizeTaskStepRow(row));
            return acc;
          }, {});
        }

        if (!cancelled) {
          const remoteGoals = (tasksData || []).map((row) => ({
            id: row.id,
            title: row.title || "Untitled goal",
            tasks: stepsByTask[row.id] || [],
            aiLoading: false,
            aiError: "",
            createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
          }));
          const localGoals = loadLocalGoals();
          const mergedById = new Map();
          [...localGoals, ...remoteGoals].forEach((goal) => {
            mergedById.set(goal.id, goal);
          });
          setGoals(Array.from(mergedById.values()).slice(0, MAX_GOALS));
          setGoalsHydrated(true);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Supabase tasks load error:", error);
          setGoals(loadLocalGoals());
          setDataError(formatSupabaseError(error, "Failed to load tasks from Supabase."));
          setGoalsHydrated(true);
        }
      } finally {
        if (!cancelled) {
          setLoadingGoals(false);
        }
      }
    }
    loadGoalsFromSupabase();
    return () => {
      cancelled = true;
    };
  }, [user?.id, supabase]);

  const collageTiles = useMemo(() => {
    const defaults = COLLAGE_COLORS.map((color) => ({ type: "color", value: color }));
    const parsedTiles = Array.isArray(bgPref.collageTiles) ? bgPref.collageTiles.slice(0, 9) : [];
    return [...parsedTiles, ...defaults.slice(parsedTiles.length, 9)].slice(0, 9);
  }, [bgPref.collageTiles]);

  const appFrameStyle = useMemo(
    () => ({
      backdropFilter: `blur(${Math.max(0, Math.min(20, bgPref.boardBlur))}px)`,
    }),
    [bgPref]
  );
  const appThemeStyle = useMemo(
    () => {
      const surface = bgPref.theme?.surface || "rgba(255, 255, 255, 0.95)";
      const text = ensureReadableText(bgPref.theme?.text || "#181717", surface);
      const muted = ensureReadableText(bgPref.theme?.muted || "rgba(24, 23, 23, 0.62)", surface);
      return {
        "--primary": bgPref.theme?.primary || "#a91818",
        "--primaryHover": bgPref.theme?.primaryHover || "#8f1414",
        "--text": text,
        "--muted": muted,
        "--border": bgPref.theme?.border || "rgba(24, 23, 23, 0.1)",
        "--surface": surface,
        "--surface2": bgPref.theme?.surface2 || "#f8faed",
      };
    },
    [bgPref.theme]
  );

  function updateGoal(goalId, updater) {
    setGoals((prev) => prev.map((goal) => (goal.id === goalId ? updater(goal) : goal)));
  }

  function isLocalGoal(goalId) {
    return String(goalId).startsWith("local-");
  }

  function isRlsError(error) {
    const code = String(error?.code || "");
    const message = String(error?.message || "").toLowerCase();
    return code === "42501" || message.includes("row-level security");
  }

  async function handleAddGoal(e) {
    e.preventDefault();
    const title = newGoalTitle.trim();
    if (!title || goals.length >= MAX_GOALS) return;
    if (!supabase) {
      const localGoal = {
        id: `local-${makeId()}`,
        title,
        tasks: [],
        aiLoading: false,
        aiError: "",
        createdAt: Date.now(),
      };
      setGoals((prev) => [localGoal, ...prev]);
      setNewGoalTitle("");
      return;
    }
    setDataError("");
    try {
      let data = null;
      let error = null;

      // Preferred insert with ownership column.
      const first = await supabase
        .from("tasks")
        .insert({ title, user_id: user?.id || null })
        .select("id, title, created_at")
        .single();
      data = first.data;
      error = first.error;

      // Fallback for projects without user_id column.
      if (error && String(error.code || "") === "42703") {
        const second = await supabase
          .from("tasks")
          .insert({ title })
          .select("id, title, created_at")
          .single();
        data = second.data;
        error = second.error;
      }

      if (error) throw error;
      const nextGoal = {
        id: data.id,
        title: data.title || title,
        tasks: [],
        aiLoading: false,
        aiError: "",
        createdAt: data.created_at ? new Date(data.created_at).getTime() : Date.now(),
      };
      setGoals((prev) => [nextGoal, ...prev]);
      setNewGoalTitle("");
    } catch (error) {
      if (isRlsError(error)) {
        const localGoal = {
          id: `local-${makeId()}`,
          title,
          tasks: [],
          aiLoading: false,
          aiError: "",
          createdAt: Date.now(),
        };
        setGoals((prev) => [localGoal, ...prev]);
        setNewGoalTitle("");
        setDataError("");
        return;
      }
      console.error("Supabase add goal error:", error);
      setDataError(formatSupabaseError(error, "Could not add goal."));
    }
  }

  async function addTask(goalId, customText = "New task") {
    const safeText = String(customText || "").trim() || "New task";
    if (isLocalGoal(goalId)) {
      const nextStep = {
        id: `local-task-${makeId()}`,
        text: safeText,
        done: false,
        minutes: 15,
        createdAt: Date.now(),
      };
      updateGoal(goalId, (goal) => ({ ...goal, tasks: [...goal.tasks, nextStep] }));
      return;
    }
    if (!supabase) return;
    setDataError("");
    try {
      const { data, error } = await supabase
        .from("task_steps")
        .insert({
          task_id: goalId,
          text: safeText,
          done: false,
          minutes: 15,
        })
        .select("id, task_id, text, done, minutes, created_at")
        .single();
      if (error) throw error;
      const nextStep = normalizeTaskStepRow(data);
      updateGoal(goalId, (goal) => ({ ...goal, tasks: [...goal.tasks, nextStep] }));
    } catch (error) {
      console.error("Supabase add step error:", error);
      setDataError(formatSupabaseError(error, "Could not add task."));
    }
  }

  async function addTaskFromDraft(goalId) {
    const draft = (taskDrafts[goalId] || "").trim();
    if (!draft) return;
    await addTask(goalId, draft);
    setTaskDrafts((prev) => ({ ...prev, [goalId]: "" }));
  }

  function updateTask(goalId, taskId, updater) {
    updateGoal(goalId, (goal) => ({
      ...goal,
      tasks: goal.tasks.map((task) => (task.id === taskId ? updater(task) : task)),
    }));
  }

  async function persistStep(goalId, taskId, patch) {
    if (isLocalGoal(goalId)) return;
    if (!supabase) return;
    const { error } = await supabase
      .from("task_steps")
      .update(patch)
      .eq("id", taskId)
      .eq("task_id", goalId);
    if (error) {
      throw error;
    }
  }

  async function removeTask(goalId, taskId) {
    if (isLocalGoal(goalId)) {
      updateGoal(goalId, (goal) => ({
        ...goal,
        tasks: goal.tasks.filter((task) => task.id !== taskId),
      }));
      return;
    }
    if (!supabase) return;
    setDataError("");
    const previousGoals = goals;
    updateGoal(goalId, (goal) => ({
      ...goal,
      tasks: goal.tasks.filter((task) => task.id !== taskId),
    }));
    try {
      const { error } = await supabase
        .from("task_steps")
        .delete()
        .eq("id", taskId)
        .eq("task_id", goalId);
      if (error) throw error;
    } catch (error) {
      console.error("Supabase delete step error:", error);
      setGoals(previousGoals);
      setDataError(formatSupabaseError(error, "Could not delete task."));
    }
  }

  async function removeGoal(goalId) {
    if (isLocalGoal(goalId)) {
      setGoals((prev) => prev.filter((goal) => goal.id !== goalId));
      return;
    }
    if (!supabase) return;
    setDataError("");
    const previousGoals = goals;
    setGoals((prev) => prev.filter((goal) => goal.id !== goalId));
    setGoalSections((prev) => {
      const next = { ...prev };
      delete next[goalId];
      return next;
    });
    setGoalTitleEditing((prev) => {
      const next = { ...prev };
      delete next[goalId];
      return next;
    });
    try {
      const { error: stepsDeleteError } = await supabase
        .from("task_steps")
        .delete()
        .eq("task_id", goalId);
      if (stepsDeleteError) throw stepsDeleteError;

      const { error: taskDeleteError } = await supabase
        .from("tasks")
        .delete()
        .eq("id", goalId);
      if (taskDeleteError) throw taskDeleteError;
    } catch (error) {
      console.error("Supabase delete goal error:", error);
      setGoals(previousGoals);
      setDataError(formatSupabaseError(error, "Could not delete goal."));
    }
  }

  function getBreakdownEndpoints() {
    const base = import.meta.env.VITE_API_BASE_URL?.trim();
    const normalizedBase = base ? base.replace(/\/+$/, "") : "";
    const endpoints = [];
    if (normalizedBase) {
      endpoints.push(`${normalizedBase}/api/ai/breakdown`);
    }
    endpoints.push("/api/ai/breakdown");
    return endpoints;
  }

  async function fetchAIBreakdown(payload) {
    const endpoints = getBreakdownEndpoints();
    let lastError = null;

    for (const endpoint of endpoints) {
      try {
        console.log("Calling /api/ai/breakdown", payload.title);
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const data = await response.json().catch(() => null);
        if (!response.ok) {
          const message =
            data && typeof data.error === "string"
              ? data.error
              : "Could not generate AI breakdown right now.";
          throw new Error(message);
        }

        if (!data || !Array.isArray(data.steps)) {
          throw new Error("AI response was invalid.");
        }

        return data;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("Could not reach AI breakdown endpoint.");
  }

  async function regenerateScopeWithAI(goalId, title, description = "") {
    updateGoal(goalId, (goal) => ({ ...goal, aiLoading: true, aiError: "" }));

    try {
      const data = await fetchAIBreakdown({ title, description });
      const payload = data.steps.map((step) => ({
        task_id: goalId,
        text: typeof step?.text === "string" ? step.text : "",
        done: false,
        minutes: Number.isFinite(step?.minutes) ? step.minutes : 15,
      }));
      let tasks = payload.map((step) => ({
        id: `local-task-${makeId()}`,
        text: step.text,
        done: false,
        minutes: step.minutes,
        createdAt: Date.now(),
      }));

      if (!isLocalGoal(goalId) && supabase) {
        await supabase.from("task_steps").delete().eq("task_id", goalId);
        const { data: insertedRows, error: insertError } = await supabase
          .from("task_steps")
          .insert(payload)
          .select("id, task_id, text, done, minutes, created_at");
        if (insertError) throw insertError;
        tasks = (insertedRows || []).map(normalizeTaskStepRow);
      }

      updateGoal(goalId, (goal) => ({
        ...goal,
        tasks,
        aiLoading: false,
        aiError: "",
      }));
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? `AI breakdown failed: ${error.message}`
          : "AI breakdown failed. Try again.";

      let fallbackTasks = buildScopeFromTemplate(title);
      if (supabase && !isLocalGoal(goalId)) {
        try {
          const payload = fallbackTasks.map((step) => ({
            task_id: goalId,
            text: step.text,
            done: false,
            minutes: Number.isFinite(step.minutes) ? step.minutes : 15,
          }));
          await supabase.from("task_steps").delete().eq("task_id", goalId);
          const { data: insertedRows } = await supabase
            .from("task_steps")
            .insert(payload)
            .select("id, task_id, text, done, minutes, created_at");
          fallbackTasks = (insertedRows || []).map(normalizeTaskStepRow);
        } catch {
          setDataError("AI failed and fallback steps could not be saved.");
        }
      }

      updateGoal(goalId, (goal) => ({
        ...goal,
        tasks: fallbackTasks,
        aiLoading: false,
        aiError: message,
      }));
    }
  }

  function getGoalSection(goalId) {
    return goalSections[goalId] || "incomplete";
  }

  function setGoalSection(goalId, section) {
    setGoalSections((prev) => ({ ...prev, [goalId]: section }));
  }

  function startGoalTitleEdit(goalId) {
    setGoalTitleEditing((prev) => ({ ...prev, [goalId]: true }));
  }

  function stopGoalTitleEdit(goalId) {
    setGoalTitleEditing((prev) => ({ ...prev, [goalId]: false }));
    let safeTitle = "";
    updateGoal(goalId, (goal) => {
      safeTitle = goal.title.trim() || "Untitled goal";
      return { ...goal, title: safeTitle };
    });
    if (isLocalGoal(goalId) || !supabase || !safeTitle) return;
    void supabase.from("tasks").update({ title: safeTitle }).eq("id", goalId);
  }

  function fileToDataUrl(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve(typeof reader.result === "string" ? reader.result : "");
      };
      reader.readAsDataURL(file);
    });
  }

  async function onUploadBackground(fileList) {
    const files = Array.from(fileList || []).filter(Boolean);
    if (files.length === 0) return;
    const urls = (await Promise.all(files.map((file) => fileToDataUrl(file)))).filter(Boolean);
    if (urls.length === 0) return;
    setBgPref((prev) => {
      const nextTiles = Array.isArray(prev.collageTiles)
        ? [...prev.collageTiles]
        : COLLAGE_COLORS.map((color) => ({ type: "color", value: color }));
      const baseIndex =
        Number.isFinite(prev.selectedTile) && prev.selectedTile >= 0 && prev.selectedTile < 9
          ? prev.selectedTile
          : 0;
      urls.slice(0, 9).forEach((url, idx) => {
        const tileIndex = (baseIndex + idx) % 9;
        nextTiles[tileIndex] = { type: "image", value: url };
      });
      return {
        ...prev,
        collageTiles: nextTiles.slice(0, 9),
      };
    });
  }

  function selectCollageTile(index) {
    setBgPref((prev) => ({ ...prev, selectedTile: index }));
  }

  function setSelectedTileColor(color) {
    const isHex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(color || "").trim());
    if (!isHex) return;
    setBgPref((prev) => {
      const index =
        Number.isFinite(prev.selectedTile) && prev.selectedTile >= 0 && prev.selectedTile < 9
          ? prev.selectedTile
          : 0;
      const nextTiles = Array.isArray(prev.collageTiles)
        ? [...prev.collageTiles]
        : COLLAGE_COLORS.map((entry) => ({ type: "color", value: entry }));
      nextTiles[index] = { type: "color", value: color };
      return { ...prev, collageTiles: nextTiles.slice(0, 9) };
    });
  }

  function clearSelectedTileImage() {
    setBgPref((prev) => {
      const index =
        Number.isFinite(prev.selectedTile) && prev.selectedTile >= 0 && prev.selectedTile < 9
          ? prev.selectedTile
          : 0;
      const nextTiles = Array.isArray(prev.collageTiles)
        ? [...prev.collageTiles]
        : COLLAGE_COLORS.map((entry) => ({ type: "color", value: entry }));
      const fallbackColor = COLLAGE_COLORS[index % COLLAGE_COLORS.length];
      nextTiles[index] = { type: "color", value: fallbackColor };
      return { ...prev, collageTiles: nextTiles.slice(0, 9) };
    });
  }

  function setThemeColor(key, value) {
    const clean = String(value || "").trim();
    const isHex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(clean);
    if (!isHex && !["surface", "surface2", "border", "muted"].includes(key)) return;
    setBgPref((prev) => ({
      ...prev,
      theme: {
        ...(prev.theme || {}),
        [key]: clean,
      },
    }));
  }

  function addQuote(e) {
    e.preventDefault();
    const text = quoteInput.trim();
    if (!text) return;
    setQuotes((prev) => [text, ...prev].slice(0, 10));
    setQuoteInput("");
  }

  function removeQuote(index) {
    setQuotes((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <div className={nightMode ? "appShell nightMode" : "appShell"} style={appThemeStyle}>
      <div className="collageBackdrop">
        {collageTiles.map((tile, index) => (
          <div
            key={`collage-${index}`}
            className="collageTile"
            style={
              tile.type === "image"
                ? { backgroundImage: `url("${tile.value}")` }
                : { backgroundColor: tile.value }
            }
          />
        ))}
      </div>
      <div className="appFrame" style={appFrameStyle}>
        <div className="topBar">
          <div className="brand">
            <h1>2026 Progress Tracker</h1>
            <span className="sub">Build daily consistency across your goals.</span>
          </div>
          <button
            type="button"
            className="buttonLight themeToggleBtn"
            onClick={() => setNightMode((prev) => !prev)}
          >
            {nightMode ? "Day view" : "Night view"}
          </button>
        </div>

        <SignedOut>
          <AuthPage />
        </SignedOut>

        <SignedIn>
          <div className="mainHeaderRow" style={{ gridColumn: "1 / -1", marginBottom: 0 }}>
            <div className="trackerTitleWrap">
              {isEditingOwner || !ownerName.trim() ? (
                <input
                  className="input"
                  value={ownerName}
                  placeholder="Name of person"
                  autoFocus
                  onChange={(e) => setOwnerName(e.target.value)}
                  onBlur={() => setIsEditingOwner(false)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setIsEditingOwner(false);
                    }
                  }}
                  style={{ maxWidth: 260 }}
                />
              ) : (
                <h2 className="trackerTitle editableTitle" onDoubleClick={() => setIsEditingOwner(true)}>
                  {ownerName.trim() || loginName || "Your"} To Do
                </h2>
              )}
            </div>
            <div className="headerUser">
              <UserButton />
            </div>
          </div>

          <div className="card progressSummary" style={{ gridColumn: "1 / -1" }}>
            <div className="progressSummaryRow">
              <div className="summaryItem">
                <span className="summaryItemLabel">Tasks logged</span>
                <strong>{overallStats.total}</strong>
              </div>
              <div className="summaryItem">
                <span className="summaryItemLabel">Completed</span>
                <strong>{overallStats.completed}</strong>
              </div>
              <div className="summaryItem summaryItemWide">
                <span className="summaryItemLabel">Year progress</span>
                <strong>📅 {overallStats.completedOutOf365}/365</strong>
                <div className="yearMeter">
                  <span
                    className="yearMeterFill"
                    style={{ width: `${overallStats.yearProgressPct}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="card goalSectionCard quotesCard" style={{ gridColumn: "1 / -1" }}>
            <div className="quotesHeader">
              <span className="quotesTitle">Motivation Quotes</span>
            </div>
            <form className="quotesForm" onSubmit={addQuote}>
              <input
                className="input"
                value={quoteInput}
                onChange={(e) => setQuoteInput(e.target.value)}
                placeholder="Add a quote that keeps you going"
              />
              <button type="submit" className="button" disabled={!quoteInput.trim()}>
                Add quote
              </button>
            </form>
            {quotes.length > 0 ? (
              <div className="quotesList">
                {quotes.map((quote, index) => (
                  <div className="quoteItem" key={`${quote}-${index}`}>
                    <span>{quote}</span>
                    <button
                      type="button"
                      className="buttonLight quoteDeleteBtn"
                      onClick={() => removeQuote(index)}
                      aria-label="Delete quote"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mutedText quotesEmpty">No quotes yet. Add one above.</p>
            )}
          </div>

          <details className="card bgPersonalizeCard goalSectionCard" style={{ gridColumn: "1 / -1" }}>
            <summary className="visionSummary">
              <span>Vision board collage</span>
            </summary>
            <div className="bgPanelHeader">
              <div>
                <div className="bgPanelSub">Select a block, then set a color or image for it.</div>
              </div>
              <button
                type="button"
                className="buttonLight bgResetBtn"
                onClick={() =>
                  setBgPref((prev) => ({
                    ...prev,
                    collageTiles: COLLAGE_COLORS.map((color) => ({ type: "color", value: color })),
                    selectedTile: 0,
                    theme: {
                      primary: "#a91818",
                      primaryHover: "#8f1414",
                      text: "#181717",
                      muted: "rgba(24, 23, 23, 0.62)",
                      border: "rgba(24, 23, 23, 0.1)",
                      surface: "rgba(255, 255, 255, 0.95)",
                      surface2: "#f8faed",
                    },
                    overlayOpacity: 20,
                    boardOpacity: 94,
                    boardBlur: 2,
                    boardRadius: 48,
                  }))
                }
              >
                Reset
              </button>
            </div>

            <div className="bgQuickRow">
              <div className="bgQuickBlock">
                <div className="bgLabel">Collage Blocks</div>
                <div className="collageSelectorGrid">
                  {collageTiles.map((tile, index) => (
                    <button
                      key={`selector-${index}`}
                      type="button"
                      className={
                        bgPref.selectedTile === index
                          ? "collageSelectorTile collageSelectorTileActive"
                          : "collageSelectorTile"
                      }
                      onClick={() => selectCollageTile(index)}
                      style={
                        tile.type === "image"
                          ? { backgroundImage: `url("${tile.value}")` }
                          : { backgroundColor: tile.value }
                      }
                      aria-label={`Select collage block ${index + 1}`}
                      title={`Block ${index + 1}`}
                    />
                  ))}
                </div>
              </div>

              <div className="bgQuickBlock">
                <div className="bgLabel">Block Controls</div>
                <div className="bgActionRow">
                  <label className="buttonLight colorPickerBtn">
                    Color
                    <input
                      type="color"
                      value={
                        collageTiles[bgPref.selectedTile]?.type === "color"
                          ? collageTiles[bgPref.selectedTile]?.value
                          : "#d9e4cc"
                      }
                      onChange={(e) => setSelectedTileColor(e.target.value)}
                      style={{ display: "none" }}
                    />
                  </label>
                  <input
                    className="input hexInput"
                    key={`tile-hex-${bgPref.selectedTile}`}
                    defaultValue={
                      collageTiles[bgPref.selectedTile]?.type === "color"
                        ? collageTiles[bgPref.selectedTile]?.value
                        : ""
                    }
                    placeholder="#d9e4cc"
                    onBlur={(e) => setSelectedTileColor(e.target.value)}
                  />
                  <label className="buttonLight fileUploadBtn">
                    Upload image
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        onUploadBackground(e.target.files);
                        e.target.value = "";
                      }}
                      style={{ display: "none" }}
                    />
                  </label>
                  <button
                    type="button"
                    className="buttonLight"
                    onClick={clearSelectedTileImage}
                  >
                    Clear image
                  </button>
                </div>
                <div className="bgStatusRow">
                  <span className="bgStatusPill">Editing block {Number(bgPref.selectedTile || 0) + 1}</span>
                </div>
              </div>
            </div>

            <details className="bgAdvanced">
              <summary>Advanced controls</summary>
              <div className="bgControlsGrid">
                <label className="bgControl">
                  <span>Overlay</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={bgPref.overlayOpacity}
                    onChange={(e) =>
                      setBgPref((prev) => ({ ...prev, overlayOpacity: Number(e.target.value) }))
                    }
                  />
                </label>
                <label className="bgControl">
                  <span>Board Opacity</span>
                  <input
                    type="range"
                    min="60"
                    max="100"
                    value={bgPref.boardOpacity}
                    onChange={(e) =>
                      setBgPref((prev) => ({ ...prev, boardOpacity: Number(e.target.value) }))
                    }
                  />
                </label>
                <label className="bgControl">
                  <span>Blur</span>
                  <input
                    type="range"
                    min="0"
                    max="20"
                    value={bgPref.boardBlur}
                    onChange={(e) =>
                      setBgPref((prev) => ({ ...prev, boardBlur: Number(e.target.value) }))
                    }
                  />
                </label>
                <label className="bgControl">
                  <span>Corner Radius</span>
                  <input
                    type="range"
                    min="16"
                    max="64"
                    value={bgPref.boardRadius}
                    onChange={(e) =>
                      setBgPref((prev) => ({ ...prev, boardRadius: Number(e.target.value) }))
                    }
                  />
                </label>
                <label className="bgControl">
                  <span>Primary Hex</span>
                  <input
                    className="input hexInput"
                    defaultValue={bgPref.theme?.primary || "#a91818"}
                    onBlur={(e) => setThemeColor("primary", e.target.value)}
                  />
                </label>
                <label className="bgControl">
                  <span>Primary Hover Hex</span>
                  <input
                    className="input hexInput"
                    defaultValue={bgPref.theme?.primaryHover || "#8f1414"}
                    onBlur={(e) => setThemeColor("primaryHover", e.target.value)}
                  />
                </label>
                <label className="bgControl">
                  <span>Text Hex</span>
                  <input
                    className="input hexInput"
                    defaultValue={bgPref.theme?.text || "#181717"}
                    onBlur={(e) => setThemeColor("text", e.target.value)}
                  />
                </label>
                <label className="bgControl">
                  <span>Muted Color</span>
                  <input
                    className="input hexInput"
                    defaultValue={bgPref.theme?.muted || "rgba(24, 23, 23, 0.62)"}
                    onBlur={(e) => setThemeColor("muted", e.target.value)}
                  />
                </label>
                <label className="bgControl">
                  <span>Card Surface</span>
                  <input
                    className="input hexInput"
                    defaultValue={bgPref.theme?.surface || "rgba(255, 255, 255, 0.95)"}
                    onBlur={(e) => setThemeColor("surface", e.target.value)}
                  />
                </label>
                <label className="bgControl">
                  <span>Page Surface</span>
                  <input
                    className="input hexInput"
                    defaultValue={bgPref.theme?.surface2 || "#f8faed"}
                    onBlur={(e) => setThemeColor("surface2", e.target.value)}
                  />
                </label>
                <label className="bgControl">
                  <span>Border Color</span>
                  <input
                    className="input hexInput"
                    defaultValue={bgPref.theme?.border || "rgba(24, 23, 23, 0.1)"}
                    onBlur={(e) => setThemeColor("border", e.target.value)}
                  />
                </label>
              </div>
            </details>
          </details>

	          <div className="card goalSectionCard" style={{ gridColumn: "1 / -1" }}>
            <form onSubmit={handleAddGoal} className="goalAddForm">
              <input
                className="input"
                value={newGoalTitle}
                onChange={(e) => setNewGoalTitle(e.target.value)}
                placeholder="Add a 2026 goal table (example: Goal A - Fitness)"
              />
              <button
                type="submit"
                className="button"
                disabled={!newGoalTitle.trim() || goals.length >= MAX_GOALS}
              >
                Add goal table
              </button>
            </form>
	            {goals.length >= MAX_GOALS ? (
	              <div className="mutedText" style={{ marginTop: 8 }}>
	                Goal table limit reached (20).
	              </div>
	            ) : null}
	          </div>

          {dataError ? (
            <div className="card goalSectionCard" style={{ gridColumn: "1 / -1" }}>
              <div className="errorText">{dataError}</div>
            </div>
          ) : null}

	          <div className="goalTablesWrap">
	            {loadingGoals ? (
                <div className="card goalSectionCard" style={{ gridColumn: "1 / -1" }}>
                  <p className="mutedText" style={{ margin: 0 }}>
                    Loading tasks...
                  </p>
                </div>
              ) : goals.length === 0 ? (
	              <div className="card goalSectionCard" style={{ gridColumn: "1 / -1" }}>
	                <p className="mutedText" style={{ margin: 0 }}>
	                  No goal tables yet. Add your first 2026 goal to get started.
                </p>
              </div>
            ) : (
              goals.map((goal) => {
                const section = getGoalSection(goal.id);
                const totalTasks = goal.tasks.length;
                const incompleteCount = goal.tasks.filter((task) => !task.done).length;
                const completedCount = goal.tasks.filter((task) => task.done).length;
                const visibleTasks = goal.tasks.filter((task) => {
                  if (section === "completed") return task.done;
                  if (section === "incomplete") return !task.done;
                  return true;
                });

                return (
                  <div className="card goalTableCard goalSectionCard" key={goal.id}>
                    <div className="goalHeader">
                      <div className="goalTitleRow">
                        {goalTitleEditing[goal.id] ? (
                          <input
                            className="textInput goalTitleInput"
                            autoFocus
                            value={goal.title}
                            onChange={(e) =>
                              updateGoal(goal.id, (g) => ({ ...g, title: e.target.value }))
                            }
                            onBlur={() => stopGoalTitleEdit(goal.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                stopGoalTitleEdit(goal.id);
                              }
                            }}
                          />
                        ) : (
                          <h3
                            className="goalTitleStatic"
                            onDoubleClick={() => startGoalTitleEdit(goal.id)}
                          >
                            {goal.title}
                          </h3>
                        )}
                        {!goalTitleEditing[goal.id] ? (
                          <div className="goalHeaderIcons">
                            <button
                              type="button"
                              className="iconBtn iconMiniBtn"
                              aria-label="Edit goal"
                              title="Edit goal"
                              onClick={() => startGoalTitleEdit(goal.id)}
                            >
                              ✎
                            </button>
                            <button
                              type="button"
                              className="iconBtn iconMiniBtn deleteMiniBtn"
                              aria-label="Delete goal"
                              title="Delete goal"
                              onClick={() => removeGoal(goal.id)}
                            >
                              ✕
                            </button>
                          </div>
                        ) : null}
                      </div>
                      <div className="goalHeaderActions">
                        <button
                          type="button"
                          className="button"
                          onClick={() => regenerateScopeWithAI(goal.id, goal.title)}
                          disabled={goal.aiLoading || !goal.title.trim()}
                        >
                          {goal.aiLoading
                            ? "Generating..."
                            : goal.tasks.length > 0
                              ? "Regenerate AI breakdown"
                              : "Generate AI breakdown"}
                        </button>
                        <button
                          type="button"
                          className="buttonLight"
                          onClick={() => addTask(goal.id)}
                        >
                          Add task
                        </button>
                      </div>
                    </div>

                    {goal.aiError ? <div className="errorText">{goal.aiError}</div> : null}

                    <div className="goalSectionTabs">
                        <button
                          type="button"
                          className={section === "incomplete" ? "tab tabActive" : "tab"}
                          onClick={() => {
                            setGoalSection(goal.id, "incomplete");
                            if (!isLocalGoal(goal.id)) {
                              void loadStepsForTask(goal.id);
                            }
                          }}
                        >
                          Incomplete ({incompleteCount})
                        </button>
                        <button
                          type="button"
                          className={section === "all" ? "tab tabActive" : "tab"}
                          onClick={() => {
                            setGoalSection(goal.id, "all");
                            if (!isLocalGoal(goal.id)) {
                              void loadStepsForTask(goal.id);
                            }
                          }}
                        >
                          All ({totalTasks})
                        </button>
                        <button
                          type="button"
                          className={section === "completed" ? "tab tabActive" : "tab"}
                          onClick={() => {
                            setGoalSection(goal.id, "completed");
                            if (!isLocalGoal(goal.id)) {
                              void loadStepsForTask(goal.id);
                            }
                          }}
                        >
                          Completed ({completedCount})
                        </button>
                    </div>

                    <div className="goalQuickAdd">
                      <input
                        className="input"
                        value={taskDrafts[goal.id] || ""}
                        onChange={(e) =>
                          setTaskDrafts((prev) => ({ ...prev, [goal.id]: e.target.value }))
                        }
                        placeholder="Quick add task and press Enter"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void addTaskFromDraft(goal.id);
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="buttonLight"
                        disabled={!String(taskDrafts[goal.id] || "").trim()}
                        onClick={() => void addTaskFromDraft(goal.id)}
                      >
                        Add
                      </button>
                    </div>

                    <div className="taskTableWrapper">
                      <table className="taskTable">
                        <thead>
                          <tr>
                            <th style={{ width: 96 }}>Actions</th>
                            <th>Task name</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleTasks.length === 0 ? (
                            <tr>
                              <td colSpan={2} className="mutedText" style={{ padding: 10 }}>
                                No tasks in this section.
                              </td>
                            </tr>
                          ) : (
                            visibleTasks.map((task) => (
                              <tr key={task.id}>
                                <td>
                                  <button
                                    type="button"
                                    className={task.done ? "taskIconBtn taskIconBtnDone" : "taskIconBtn"}
                                    onClick={async () => {
                                      const nextDone = !task.done;
                                      updateTask(goal.id, task.id, (t) => ({
                                        ...t,
                                        done: nextDone,
                                      }));
                                      try {
                                        await persistStep(goal.id, task.id, {
                                          done: nextDone,
                                          minutes: Number.isFinite(task.minutes) ? task.minutes : 15,
                                        });
                                      } catch (error) {
                                        console.error("Supabase update step done error:", error);
                                        setDataError(formatSupabaseError(error, "Could not update task."));
                                        void loadStepsForTask(goal.id);
                                      }
                                    }}
                                    aria-label={task.done ? "Mark task incomplete" : "Mark task complete"}
                                    title={task.done ? "Completed" : "Complete"}
                                  >
                                    ✓
                                  </button>
                                  <button
                                    type="button"
                                    className="taskIconBtn taskIconBtnDelete"
                                    onClick={() => removeTask(goal.id, task.id)}
                                    aria-label="Delete task"
                                    title="Delete task"
                                  >
                                    ✕
                                  </button>
                                </td>
                                <td>
                                  <input
                                    className="textInput"
                                    value={task.text}
                                    onChange={(e) =>
                                      updateTask(goal.id, task.id, (t) => ({
                                        ...t,
                                        text: e.target.value,
                                      }))
                                    }
                                    onBlur={async () => {
                                      try {
                                        await persistStep(goal.id, task.id, {
                                          text: task.text,
                                          done: task.done,
                                          minutes: Number.isFinite(task.minutes) ? task.minutes : 15,
                                        });
                                      } catch (error) {
                                        console.error("Supabase update step text error:", error);
                                        setDataError(
                                          formatSupabaseError(error, "Could not update task text.")
                                        );
                                        void loadStepsForTask(goal.id);
                                      }
                                    }}
                                  />
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </SignedIn>
      </div>
    </div>
  );
}

function AuthPage() {
  const [mode, setMode] = useState("sign-in");

  const appearance = {
    variables: {
      colorPrimary: "#105666",
      colorText: "#0a3323",
      colorBackground: "#ffffff",
      borderRadius: "14px",
      fontSize: "14px",
    },
  };

  return (
    <div className="authShell">
      <div className="authHero">
        <div>
          <h2>Track your progress with intention.</h2>
          <p>Sign in to keep your 2026 goals and tasks synced to your account.</p>
        </div>
        <p style={{ fontSize: 12, marginTop: 16 }}>
          Build momentum by reviewing your tasks each day.
        </p>
      </div>
      <div className="authCard">
        <div className="authTabs">
          <button
            type="button"
            className={mode === "sign-in" ? "authTabBtn authTabBtnActive" : "authTabBtn"}
            onClick={() => setMode("sign-in")}
          >
            Sign in
          </button>
          <button
            type="button"
            className={mode === "sign-up" ? "authTabBtn authTabBtnActive" : "authTabBtn"}
            onClick={() => setMode("sign-up")}
          >
            Create account
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
