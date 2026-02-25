import { useEffect, useMemo, useState } from "react";
import { SignedIn, SignedOut, SignIn, SignUp, UserButton, useUser } from "@clerk/clerk-react";

const STORAGE_KEY = "mini_planner_tasks_v1";
const OWNER_NAME_KEY = "mini_planner_owner_name_v1";
const MAX_GOALS = 20;
const STALE_TASK_DAYS = 3;

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
  return template.map(([text]) => ({
    id: makeId(),
    text,
    done: false,
    createdAt: Date.now(),
  }));
}

function normalizeGoals(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const tasksFromNewModel = Array.isArray(item.tasks) ? item.tasks : null;
      const tasksFromOldModel = Array.isArray(item.scope) ? item.scope : null;
      const sourceTasks = tasksFromNewModel ?? tasksFromOldModel ?? [];
      const tasks = sourceTasks.map((task) => ({
        id: task.id || makeId(),
        text: task.text || "",
        done: Boolean(task.done),
        createdAt: task.createdAt || item.createdAt || Date.now(),
      }));

      return {
        id: item.id || makeId(),
        title: item.title || "",
        tasks,
        aiLoading: Boolean(item.aiLoading),
        aiError: item.aiError || "",
        createdAt: item.createdAt || Date.now(),
      };
    })
    .filter((goal) => goal.title.trim().length > 0);
}

function loadInitialGoals() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return normalizeGoals(parsed).slice(0, MAX_GOALS);
  } catch {
    return [];
  }
}

function saveGoals(goals) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(goals));
  } catch {
    // ignore
  }
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

function getTaskSignal(task) {
  if (task.done) return { label: "Completed", tone: "signalDone" };
  const createdAt = Number(task.createdAt) || Date.now();
  const staleMs = STALE_TASK_DAYS * 24 * 60 * 60 * 1000;
  if (Date.now() - createdAt >= staleMs) {
    return { label: "Stalled", tone: "signalDelayed" };
  }
  return { label: "In progress", tone: "signalPlanned" };
}

export default function App() {
  const { user } = useUser();
  const [goals, setGoals] = useState(loadInitialGoals);
  const [ownerName, setOwnerName] = useState(loadOwnerName);
  const [isEditingOwner, setIsEditingOwner] = useState(false);
  const [newGoalTitle, setNewGoalTitle] = useState("");
  const [goalSections, setGoalSections] = useState({});
  const [goalTitleEditing, setGoalTitleEditing] = useState({});

  const loginName = user?.firstName || user?.fullName || user?.username || "";

  useEffect(() => {
    saveGoals(goals);
  }, [goals]);

  useEffect(() => {
    saveOwnerName(ownerName);
  }, [ownerName]);

  useEffect(() => {
    if (!ownerName.trim() && loginName) {
      setOwnerName(loginName);
    }
  }, [ownerName, loginName]);

  const overallStats = useMemo(() => {
    const tasks = goals.flatMap((goal) => goal.tasks);
    const total = tasks.length;
    const completed = tasks.filter((task) => task.done).length;
    const stalled = tasks.filter((task) => !task.done && getTaskSignal(task).label === "Stalled").length;
    const completedOutOf365 = Math.min(365, completed);
    const yearProgressPct = Math.min(100, Math.round((completedOutOf365 / 365) * 100));
    return { total, completed, stalled, completedOutOf365, yearProgressPct };
  }, [goals]);

  function updateGoal(goalId, updater) {
    setGoals((prev) => prev.map((goal) => (goal.id === goalId ? updater(goal) : goal)));
  }

  function handleAddGoal(e) {
    e.preventDefault();
    const title = newGoalTitle.trim();
    if (!title || goals.length >= MAX_GOALS) return;

    const nextGoal = {
      id: makeId(),
      title,
      tasks: [],
      aiLoading: false,
      aiError: "",
      createdAt: Date.now(),
    };

    setGoals((prev) => [...prev, nextGoal]);
    setNewGoalTitle("");
  }

  function addTask(goalId) {
    updateGoal(goalId, (goal) => ({
      ...goal,
      tasks: [
        ...goal.tasks,
        {
          id: makeId(),
          text: "New task",
          done: false,
          createdAt: Date.now(),
        },
      ],
    }));
  }

  function updateTask(goalId, taskId, updater) {
    updateGoal(goalId, (goal) => ({
      ...goal,
      tasks: goal.tasks.map((task) => (task.id === taskId ? updater(task) : task)),
    }));
  }

  function removeTask(goalId, taskId) {
    updateGoal(goalId, (goal) => ({
      ...goal,
      tasks: goal.tasks.filter((task) => task.id !== taskId),
    }));
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

      const tasks = data.steps.map((step) => ({
        id: makeId(),
        text: typeof step?.text === "string" ? step.text : "",
        done: false,
        createdAt: Date.now(),
      }));

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

      updateGoal(goalId, (goal) => ({
        ...goal,
        tasks: buildScopeFromTemplate(goal.title),
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
    updateGoal(goalId, (goal) => {
      const safeTitle = goal.title.trim() || "Untitled goal";
      return { ...goal, title: safeTitle };
    });
  }

  return (
    <div className="appShell">
      <div className="appFrame">
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
              <div className="summaryItem">
                <span className="summaryItemLabel">Stalled</span>
                <strong>{overallStats.stalled}</strong>
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

          <div className="goalTablesWrap">
            {goals.length === 0 ? (
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
                        onClick={() => setGoalSection(goal.id, "incomplete")}
                      >
                        Incomplete ({incompleteCount})
                      </button>
                      <button
                        type="button"
                        className={section === "all" ? "tab tabActive" : "tab"}
                        onClick={() => setGoalSection(goal.id, "all")}
                      >
                        All ({totalTasks})
                      </button>
                      <button
                        type="button"
                        className={section === "completed" ? "tab tabActive" : "tab"}
                        onClick={() => setGoalSection(goal.id, "completed")}
                      >
                        Completed ({completedCount})
                      </button>
                    </div>

                    <div className="taskTableWrapper">
                      <table className="taskTable">
                        <thead>
                          <tr>
                            <th style={{ width: 84 }}>Done</th>
                            <th>Task name</th>
                            <th style={{ width: 140 }}>Signal</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleTasks.length === 0 ? (
                            <tr>
                              <td colSpan={3} className="mutedText" style={{ padding: 10 }}>
                                No tasks in this section.
                              </td>
                            </tr>
                          ) : (
                            visibleTasks.map((task) => (
                              <tr key={task.id}>
                                <td>
                                  <button
                                    type="button"
                                    className={task.done ? "doneToggle doneToggleOn" : "doneToggle"}
                                    onClick={() =>
                                      updateTask(goal.id, task.id, (t) => ({
                                        ...t,
                                        done: !t.done,
                                      }))
                                    }
                                  >
                                    {task.done ? "Completed" : "Complete"}
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
                                  />
                                </td>
                                <td>
                                  <div className="taskRowActions">
                                    {(() => {
                                      const signal = getTaskSignal(task);
                                      return (
                                        <span className={`statusSignal ${signal.tone}`}>
                                          {signal.label}
                                        </span>
                                      );
                                    })()}
                                    <button
                                      type="button"
                                      className="deleteTaskBtn"
                                      onClick={() => removeTask(goal.id, task.id)}
                                    >
                                      Delete
                                    </button>
                                  </div>
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
