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
const GRADIENT_PRESETS = [
  {
    id: "sage-dawn",
    name: "Sage Dawn",
    start: "236,239,222",
    end: "223,229,208",
  },
  {
    id: "sky-mist",
    name: "Sky Mist",
    start: "223,233,246",
    end: "203,217,240",
  },
  {
    id: "sunset-cream",
    name: "Sunset Cream",
    start: "248,229,210",
    end: "240,213,192",
  },
  {
    id: "lavender-fog",
    name: "Lavender Fog",
    start: "229,224,241",
    end: "214,206,232",
  },
  {
    id: "mint-cloud",
    name: "Mint Cloud",
    start: "225,241,235",
    end: "205,229,220",
  },
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
  if (typeof window === "undefined") {
    return {
      mode: "gradient",
      gradientId: "sage-dawn",
      imageUrl: "",
      imageLabel: "",
      overlayOpacity: 20,
      boardOpacity: 92,
      boardBlur: 2,
      boardRadius: 48,
    };
  }
  try {
    const raw = window.localStorage.getItem(BG_PREF_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") {
      return {
        mode: parsed.mode === "image" ? "image" : "gradient",
        gradientId:
          typeof parsed.gradientId === "string" ? parsed.gradientId : "sage-dawn",
        imageUrl: typeof parsed.imageUrl === "string" ? parsed.imageUrl : "",
        imageLabel: typeof parsed.imageLabel === "string" ? parsed.imageLabel : "",
        overlayOpacity: Number.isFinite(parsed.overlayOpacity) ? parsed.overlayOpacity : 20,
        boardOpacity: Number.isFinite(parsed.boardOpacity) ? parsed.boardOpacity : 92,
        boardBlur: Number.isFinite(parsed.boardBlur) ? parsed.boardBlur : 2,
        boardRadius: Number.isFinite(parsed.boardRadius) ? parsed.boardRadius : 48,
      };
    }
  } catch {
    // ignore
  }
  return {
    mode: "gradient",
    gradientId: "sage-dawn",
    imageUrl: "",
    imageLabel: "",
    overlayOpacity: 20,
    boardOpacity: 92,
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

export default function App() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const [goals, setGoals] = useState([]);
  const [ownerName, setOwnerName] = useState(loadOwnerName);
  const [isEditingOwner, setIsEditingOwner] = useState(false);
  const [newGoalTitle, setNewGoalTitle] = useState("");
  const [goalSections, setGoalSections] = useState({});
  const [goalTitleEditing, setGoalTitleEditing] = useState({});
  const [bgPref, setBgPref] = useState(loadBgPref);
  const [showImageUrlInput, setShowImageUrlInput] = useState(false);
  const [loadingGoals, setLoadingGoals] = useState(true);
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
          setGoals([]);
          setLoadingGoals(false);
        }
        return;
      }
      if (!supabase) {
        if (!cancelled) {
          setGoals([]);
          setLoadingGoals(false);
          setDataError("Supabase is not configured. Check environment variables.");
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
          setGoals(
            (tasksData || []).map((row) => ({
              id: row.id,
              title: row.title || "Untitled goal",
              tasks: stepsByTask[row.id] || [],
              aiLoading: false,
              aiError: "",
              createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
            }))
          );
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Supabase tasks load error:", error);
          setDataError(formatSupabaseError(error, "Failed to load tasks from Supabase."));
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

  const appBackgroundStyle = useMemo(() => {
    const selectedGradient =
      GRADIENT_PRESETS.find((g) => g.id === bgPref.gradientId) || GRADIENT_PRESETS[0];
    const baseGradient = `linear-gradient(135deg, rgb(${selectedGradient.start}), rgb(${selectedGradient.end}))`;
    const overlay = `linear-gradient(rgba(255,255,255,${Math.max(
      0,
      Math.min(100, bgPref.overlayOpacity)
    ) / 100}), rgba(255,255,255,${Math.max(0, Math.min(100, bgPref.overlayOpacity)) / 100}))`;

    if (bgPref.mode === "image" && bgPref.imageUrl) {
      return {
        backgroundImage: `${overlay}, ${baseGradient}, url("${bgPref.imageUrl}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      };
    }
    return {
      backgroundImage: `${overlay}, ${baseGradient}`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
  }, [bgPref]);

  const appFrameStyle = useMemo(
    () => ({
      background: `rgba(248, 250, 237, ${Math.max(0, Math.min(100, bgPref.boardOpacity)) / 100})`,
      backdropFilter: `blur(${Math.max(0, Math.min(20, bgPref.boardBlur))}px)`,
      borderRadius: `${Math.max(16, Math.min(64, bgPref.boardRadius))}px`,
    }),
    [bgPref]
  );

  function updateGoal(goalId, updater) {
    setGoals((prev) => prev.map((goal) => (goal.id === goalId ? updater(goal) : goal)));
  }

  async function handleAddGoal(e) {
    e.preventDefault();
    const title = newGoalTitle.trim();
    if (!title || goals.length >= MAX_GOALS || !supabase) return;
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
      console.error("Supabase add goal error:", error);
      setDataError(formatSupabaseError(error, "Could not add goal."));
    }
  }

  async function addTask(goalId) {
    if (!supabase) return;
    setDataError("");
    try {
      const { data, error } = await supabase
        .from("task_steps")
        .insert({
          task_id: goalId,
          text: "New task",
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

  function updateTask(goalId, taskId, updater) {
    updateGoal(goalId, (goal) => ({
      ...goal,
      tasks: goal.tasks.map((task) => (task.id === taskId ? updater(task) : task)),
    }));
  }

  async function persistStep(goalId, taskId, patch) {
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
      if (!supabase) throw new Error("Supabase client not ready.");
      const payload = data.steps.map((step) => ({
        task_id: goalId,
        text: typeof step?.text === "string" ? step.text : "",
        done: false,
        minutes: Number.isFinite(step?.minutes) ? step.minutes : 15,
      }));
      await supabase.from("task_steps").delete().eq("task_id", goalId);
      const { data: insertedRows, error: insertError } = await supabase
        .from("task_steps")
        .insert(payload)
        .select("id, task_id, text, done, minutes, created_at");
      if (insertError) throw insertError;
      const tasks = (insertedRows || []).map(normalizeTaskStepRow);

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
      if (supabase) {
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
    if (!supabase || !safeTitle) return;
    void supabase.from("tasks").update({ title: safeTitle }).eq("id", goalId);
  }

  function setGradientBackground(gradientId) {
    setBgPref((prev) => ({ ...prev, mode: "gradient", gradientId }));
  }

  function setImageBackground(imageUrl) {
    if (!imageUrl.trim()) {
      setBgPref((prev) => ({ ...prev, mode: "gradient", imageUrl: "", imageLabel: "" }));
      return;
    }
    setBgPref((prev) => ({
      ...prev,
      mode: "image",
      imageUrl: imageUrl.trim(),
      imageLabel: "Custom URL image",
    }));
  }

  function onUploadBackground(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result) return;
      setBgPref((prev) => ({
        ...prev,
        mode: "image",
        imageUrl: result,
        imageLabel: file.name || "Uploaded image",
      }));
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="appShell" style={appBackgroundStyle}>
      <div className="appFrame" style={appFrameStyle}>
        <div className="topBar">
          <div className="brand">
            <h1>2026 Progress Tracker</h1>
            <span className="sub">Build daily consistency across your goals.</span>
          </div>
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

          <div className="card bgPersonalizeCard" style={{ gridColumn: "1 / -1" }}>
            <div className="bgPanelHeader">
              <div>
                <div className="bgPanelTitle">Background Style</div>
                <div className="bgPanelSub">Pick a visual mood and tune details only if needed.</div>
              </div>
              <button
                type="button"
                className="buttonLight bgResetBtn"
                onClick={() =>
                  setBgPref((prev) => ({
                    ...prev,
                    mode: "gradient",
                    gradientId: "sage-dawn",
                    imageUrl: "",
                    imageLabel: "",
                    overlayOpacity: 20,
                    boardOpacity: 92,
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
                <div className="bgLabel">Theme</div>
                <div className="bgColorSet">
                  {GRADIENT_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className={
                        bgPref.gradientId === preset.id
                          ? "bgGradientSwatch bgGradientSwatchActive"
                          : "bgGradientSwatch"
                      }
                      style={{
                        backgroundImage: `linear-gradient(135deg, rgb(${preset.start}), rgb(${preset.end}))`,
                      }}
                      onClick={() => setGradientBackground(preset.id)}
                      aria-label={`Set gradient ${preset.name}`}
                      title={preset.name}
                    />
                  ))}
                </div>
              </div>

              <div className="bgQuickBlock">
                <div className="bgLabel">Image</div>
                <div className="bgActionRow">
                  <label className="buttonLight fileUploadBtn">
                    Upload
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => onUploadBackground(e.target.files?.[0])}
                      style={{ display: "none" }}
                    />
                  </label>
                  <button
                    type="button"
                    className="buttonLight"
                    onClick={() => setShowImageUrlInput((prev) => !prev)}
                  >
                    {showImageUrlInput ? "Hide URL" : "Image URL"}
                  </button>
                  {bgPref.mode === "image" && bgPref.imageUrl ? (
                    <button
                      type="button"
                      className="buttonLight"
                      onClick={() =>
                        setBgPref((prev) => ({
                          ...prev,
                          mode: "gradient",
                          imageUrl: "",
                          imageLabel: "",
                        }))
                      }
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            {showImageUrlInput ? (
              <div className="bgPersonalizeRow" style={{ marginTop: 10 }}>
                <input
                  className="input bgImageInput"
                  placeholder="Paste background image URL"
                  defaultValue={bgPref.mode === "image" ? bgPref.imageUrl : ""}
                  onBlur={(e) => setImageBackground(e.target.value)}
                />
              </div>
            ) : null}
            {bgPref.mode === "image" && bgPref.imageUrl ? (
              <div className="bgStatusRow">
                <span className="bgStatusPill">
                  Image applied{bgPref.imageLabel ? `: ${bgPref.imageLabel}` : ""}
                </span>
              </div>
            ) : null}
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
              </div>
            </details>
          </div>

	          <div className="card" style={{ gridColumn: "1 / -1" }}>
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
            <div className="card" style={{ gridColumn: "1 / -1" }}>
              <div className="errorText">{dataError}</div>
            </div>
          ) : null}

	          <div className="goalTablesWrap">
	            {loadingGoals ? (
                <div className="card" style={{ gridColumn: "1 / -1" }}>
                  <p className="mutedText" style={{ margin: 0 }}>
                    Loading tasks...
                  </p>
                </div>
              ) : goals.length === 0 ? (
	              <div className="card" style={{ gridColumn: "1 / -1" }}>
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
                  <div className="card goalTableCard" key={goal.id}>
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
                            void loadStepsForTask(goal.id);
                          }}
                        >
                          Incomplete ({incompleteCount})
                        </button>
                        <button
                          type="button"
                          className={section === "all" ? "tab tabActive" : "tab"}
                          onClick={() => {
                            setGoalSection(goal.id, "all");
                            void loadStepsForTask(goal.id);
                          }}
                        >
                          All ({totalTasks})
                        </button>
                        <button
                          type="button"
                          className={section === "completed" ? "tab tabActive" : "tab"}
                          onClick={() => {
                            setGoalSection(goal.id, "completed");
                            void loadStepsForTask(goal.id);
                          }}
                        >
                          Completed ({completedCount})
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
