import { useEffect, useMemo, useState } from "react";
import {
  SignedIn,
  SignedOut,
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/clerk-react";

const STORAGE_KEY = "mini_planner_tasks_v1";

const PRIORITIES = ["High", "Medium", "Low"];

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
    ["Create high‑fidelity mocks in Figma", 60],
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

function loadInitialTasks() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function saveTasks(tasks) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch {
    // ignore
  }
}

function priorityRank(priority) {
  if (priority === "High") return 0;
  if (priority === "Medium") return 1;
  if (priority === "Low") return 2;
  return 3;
}

function formatDateLabel(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "2-digit",
  });
}

function formatDuration(totalMinutes) {
  if (!totalMinutes || totalMinutes <= 0) return "0m";
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours && mins) return `${hours}h ${mins}m`;
  if (hours) return `${hours}h`;
  return `${mins}m`;
}

function computeTaskTotalMinutes(task) {
  if (!task.scope || task.scope.length === 0) return 0;
  return task.scope.reduce(
    (sum, item) => sum + (Number.isFinite(item.minutes) ? item.minutes : 0),
    0
  );
}

function syncStatusFromScope(task) {
  if (!Array.isArray(task.scope) || task.scope.length === 0) {
    return task;
  }
  const allDone = task.scope.every((s) => s.done);
  const anyDone = task.scope.some((s) => s.done);
  if (allDone && task.status !== "Completed") {
    return { ...task, status: "Completed" };
  }
  if (!allDone && anyDone && task.status === "Completed") {
    return { ...task, status: "Pending" };
  }
  return task;
}

function pickTemplateKey(title) {
  const t = title.toLowerCase();
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
    minutes,
    done: false,
  }));
}

function buildDayPlan(tasks, startHour = 9, startMinute = 0, maxBlockMinutes = 50) {
  const pendingItems = [];
  tasks.forEach((task) => {
    if (task.status === "Completed") return;
    if (!Array.isArray(task.scope)) return;
    task.scope.forEach((scope) => {
      if (scope.done) return;
      const minutes = Number(scope.minutes) || 0;
      if (minutes <= 0) return;
      pendingItems.push({ task, scope, minutes });
    });
  });

  pendingItems.sort((a, b) => {
    const pa = priorityRank(a.task.priority);
    const pb = priorityRank(b.task.priority);
    if (pa !== pb) return pa - pb;

    const da = a.task.dueDate ? new Date(a.task.dueDate).getTime() : Infinity;
    const db = b.task.dueDate ? new Date(b.task.dueDate).getTime() : Infinity;
    if (da !== db) return da - db;

    return a.minutes - b.minutes;
  });

  const result = [];
  let cursorMinutes = startHour * 60 + startMinute;

  pendingItems.forEach(({ task, scope, minutes }) => {
    let remaining = minutes;
    let partIndex = 0;
    while (remaining > 0) {
      const blockMinutes = Math.min(maxBlockMinutes, remaining);
      const start = cursorMinutes;
      const end = cursorMinutes + blockMinutes;
      cursorMinutes = end;
      remaining -= blockMinutes;
      partIndex += 1;

      result.push({
        id: `${task.id}-${scope.id}-${partIndex}`,
        taskId: task.id,
        scopeId: scope.id,
        minutes: blockMinutes,
        label: task.title || "Untitled task",
        subLabel:
          remaining <= 0 && partIndex === 1
            ? scope.text
            : `${scope.text} (part ${partIndex})`,
        timeRange: `${formatTimeOfDay(start)}–${formatTimeOfDay(end)}`,
      });
    }
  });

  return result;
}

function formatTimeOfDay(totalMinutesFromMidnight) {
  const hours = Math.floor(totalMinutesFromMidnight / 60);
  const minutes = totalMinutesFromMidnight % 60;
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function App() {
  const [tasks, setTasks] = useState(loadInitialTasks);
  const [activePage, setActivePage] = useState("tasks"); // "tasks" | "plan"
  const [taskFilter, setTaskFilter] = useState("all"); // "all" | "pending" | "completed"
  const [newTitle, setNewTitle] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {
    saveTasks(tasks);
  }, [tasks]);

  useEffect(() => {
    if (!selectedTaskId && tasks.length > 0) {
      setSelectedTaskId(tasks[0].id);
    } else if (
      selectedTaskId &&
      tasks.length > 0 &&
      !tasks.some((t) => t.id === selectedTaskId)
    ) {
      setSelectedTaskId(tasks[0].id);
    }
  }, [tasks, selectedTaskId]);

  const counts = useMemo(() => {
    const pending = tasks.filter((t) => t.status !== "Completed").length;
    const completed = tasks.filter((t) => t.status === "Completed").length;
    return { all: tasks.length, pending, completed };
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    if (taskFilter === "pending") {
      return tasks.filter((t) => t.status !== "Completed");
    }
    if (taskFilter === "completed") {
      return tasks.filter((t) => t.status === "Completed");
    }
    return tasks;
  }, [tasks, taskFilter]);

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;

  function updateTask(id, updater, { syncStatus } = { syncStatus: false }) {
    setTasks((prev) =>
      prev.map((task) => {
        if (task.id !== id) return task;
        let next = updater(task);
        if (syncStatus) {
          next = syncStatusFromScope(next);
        }
        return next;
      })
    );
  }

  function handleAddTask(e) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    const task = {
      id: makeId(),
      title,
      status: "Pending",
      priority: "Medium",
      dueDate: "",
      assignee: "",
      scopeLocked: false,
      scope: [],
      createdAt: Date.now(),
    };
    setTasks((prev) => [task, ...prev]);
    setNewTitle("");
    setSelectedTaskId(task.id);
  }

  function handleSaveDraft() {
    saveTasks(tasks);
    setSaveMessage("Saved to this browser.");
    window.setTimeout(() => setSaveMessage(""), 2000);
  }

  const dayPlan = useMemo(() => buildDayPlan(tasks), [tasks]);

  return (
    <div className="appShell">
      <div className="appFrame">
        <div className="topBar">
          <div className="brand">
            <h1>Mini Planner</h1>
            <span className="sub">Lightweight day planner for makers</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className="nav" role="tablist" aria-label="Mini Planner pages">
              <button
                type="button"
                className={
                  activePage === "tasks" ? "navBtn navBtnActive" : "navBtn"
                }
                onClick={() => setActivePage("tasks")}
                role="tab"
                aria-selected={activePage === "tasks"}
              >
                Tasks
              </button>
              <button
                type="button"
                className={
                  activePage === "plan" ? "navBtn navBtnActive" : "navBtn"
                }
                onClick={() => setActivePage("plan")}
                role="tab"
                aria-selected={activePage === "plan"}
              >
                Plan My Day
              </button>
            </div>
            <SignedOut>
              <div style={{ display: "flex", gap: 6 }}>
                <SignInButton mode="modal" />
                <SignUpButton mode="modal" />
              </div>
            </SignedOut>
            <SignedIn>
              <UserButton />
            </SignedIn>
          </div>
        </div>

        <SignedOut>
          <div className="card" style={{ gridColumn: "1 / -1" }}>
            <p className="mutedText">
              Sign in to save your Mini Planner and sync tasks across sessions.
            </p>
            <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
              <SignInButton mode="modal">
                <button type="button" className="button">
                  Sign in
                </button>
              </SignInButton>
              <SignUpButton mode="modal">
                <button type="button" className="buttonLight">
                  Create account
                </button>
              </SignUpButton>
            </div>
          </div>
        </SignedOut>

        <SignedIn>
          {activePage === "tasks" ? (
            <>
              <div className="card">
                <form onSubmit={handleAddTask}>
                  <div className="row">
                    <input
                      className="input"
                      placeholder="Capture a task…"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                    />
                    <button
                      className="button"
                      type="submit"
                      disabled={!newTitle.trim()}
                    >
                      Create task
                    </button>
                  </div>
                </form>

                <div className="tabs" role="tablist" aria-label="Task filters">
                  <TaskFilterTab
                    label={`All (${counts.all})`}
                    active={taskFilter === "all"}
                    onClick={() => setTaskFilter("all")}
                  />
                  <TaskFilterTab
                    label={`Pending (${counts.pending})`}
                    active={taskFilter === "pending"}
                    onClick={() => setTaskFilter("pending")}
                  />
                  <TaskFilterTab
                    label={`Completed (${counts.completed})`}
                    active={taskFilter === "completed"}
                    onClick={() => setTaskFilter("completed")}
                  />
                </div>

                <ul className="list">
                  {filteredTasks.length === 0 ? (
                    <li className="mutedText">
                      {taskFilter === "completed"
                        ? "No completed tasks yet."
                        : "No tasks here yet. Start by creating one above."}
                    </li>
                  ) : (
                    filteredTasks.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        selected={task.id === selectedTaskId}
                        onSelect={() => setSelectedTaskId(task.id)}
                      />
                    ))
                  )}
                </ul>
              </div>

              <div className="sidePanel">
                <div className="card">
                  <TaskDetailPanel
                    task={selectedTask}
                    onMetaChange={(field, value) => {
                      if (!selectedTask) return;
                      updateTask(selectedTask.id, (t) => ({ ...t, [field]: value }));
                    }}
                    onToggleScopeDone={(scopeId) => {
                      if (!selectedTask) return;
                      updateTask(
                        selectedTask.id,
                        (t) => ({
                          ...t,
                          scope: (t.scope ?? []).map((s) =>
                            s.id === scopeId ? { ...s, done: !s.done } : s
                          ),
                        }),
                        { syncStatus: true }
                      );
                    }}
                    onScopeTextChange={(scopeId, text) => {
                      if (!selectedTask) return;
                      updateTask(selectedTask.id, (t) => ({
                        ...t,
                        scope: (t.scope ?? []).map((s) =>
                          s.id === scopeId ? { ...s, text } : s
                        ),
                      }));
                    }}
                    onScopeMinutesChange={(scopeId, minutes) => {
                      if (!selectedTask) return;
                      const safeMinutes = Number.isNaN(minutes) ? 0 : minutes;
                      updateTask(selectedTask.id, (t) => ({
                        ...t,
                        scope: (t.scope ?? []).map((s) =>
                          s.id === scopeId ? { ...s, minutes: safeMinutes } : s
                        ),
                      }));
                    }}
                    onAddScopeItem={() => {
                      if (!selectedTask) return;
                      updateTask(selectedTask.id, (t) => ({
                        ...t,
                        scope: [
                          ...(t.scope ?? []),
                          {
                            id: makeId(),
                            text: "New subtask",
                            minutes: 15,
                            done: false,
                          },
                        ],
                      }));
                    }}
                    onRemoveScopeItem={(scopeId) => {
                      if (!selectedTask) return;
                      updateTask(
                        selectedTask.id,
                        (t) => ({
                          ...t,
                          scope: (t.scope ?? []).filter((s) => s.id !== scopeId),
                        }),
                        { syncStatus: true }
                      );
                    }}
                    onGenerateScope={() => {
                      if (!selectedTask) return;
                      updateTask(
                        selectedTask.id,
                        (t) => ({
                          ...t,
                          scope: buildScopeFromTemplate(t.title ?? ""),
                          scopeLocked: false,
                        }),
                        { syncStatus: true }
                      );
                    }}
                    onAcceptScope={() => {
                      if (!selectedTask) return;
                      updateTask(
                        selectedTask.id,
                        (t) => ({ ...t, scopeLocked: true }),
                        {
                          syncStatus: true,
                        }
                      );
                    }}
                    onEditScope={() => {
                      if (!selectedTask) return;
                      updateTask(
                        selectedTask.id,
                        (t) => ({ ...t, scopeLocked: false }),
                        {
                          syncStatus: true,
                        }
                      );
                    }}
                    onSaveDraft={handleSaveDraft}
                    saveMessage={saveMessage}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="card" style={{ gridColumn: "1 / -1" }}>
              <PlanMyDayView
                plan={dayPlan}
                onDone={(item) => {
                  updateTask(
                    item.taskId,
                    (t) => ({
                      ...t,
                      scope: (t.scope ?? []).map((s) =>
                        s.id === item.scopeId ? { ...s, done: true } : s
                      ),
                    }),
                    { syncStatus: true }
                  );
                }}
              />
            </div>
          )}
        </SignedIn>
      </div>
    </div>
  );
}

function TaskFilterTab({ label, active, onClick }) {
  return (
    <button
      type="button"
      className={active ? "tab tabActive" : "tab"}
      onClick={onClick}
      role="tab"
      aria-selected={active}
    >
      {label}
    </button>
  );
}

function TaskRow({ task, selected, onSelect }) {
  const totalMinutes = computeTaskTotalMinutes(task);
  const doneCount = Array.isArray(task.scope)
    ? task.scope.filter((s) => s.done).length
    : 0;
  const totalCount = Array.isArray(task.scope) ? task.scope.length : 0;

  return (
    <li
      className="taskRow"
      onClick={onSelect}
      style={selected ? { borderColor: "#111827" } : undefined}
    >
      <div>
        <h3 className="taskTitle">{task.title || "Untitled task"}</h3>
        <div className="metaLine">
          <span className="pill pillMuted">{task.status}</span>
          <span className="pill">
            {formatDuration(totalMinutes)} total
          </span>
          <span className="pill pillMuted">Priority: {task.priority}</span>
          {task.dueDate ? (
            <span className="pill pillMuted">
              Due {formatDateLabel(task.dueDate)}
            </span>
          ) : null}
          {totalCount > 0 ? (
            <span className="pill pillMuted">
              {doneCount}/{totalCount} subtasks
            </span>
          ) : (
            <span className="pill pillMuted">No scope yet</span>
          )}
        </div>
      </div>
    </li>
  );
}

function TaskDetailPanel({
  task,
  onMetaChange,
  onToggleScopeDone,
  onScopeTextChange,
  onScopeMinutesChange,
  onAddScopeItem,
  onRemoveScopeItem,
  onGenerateScope,
  onAcceptScope,
  onEditScope,
  onSaveDraft,
  saveMessage,
}) {
  if (!task) {
    return (
      <div>
        <div className="sideHeader">
          <h2>No task selected</h2>
        </div>
        <p className="mutedText">
          Create a task on the left, then click it to open the detail panel.
        </p>
      </div>
    );
  }

  const totalMinutes = computeTaskTotalMinutes(task);
  const scope = task.scope ?? [];
  const locked = Boolean(task.scopeLocked);

  return (
    <div>
      <div className="sideHeader">
        <h2>{task.title || "Untitled task"}</h2>
        <button
          type="button"
          className="iconBtn"
          onClick={onSaveDraft}
          aria-label="Save draft"
        >
          💾
        </button>
      </div>

      <div className="sectionTitle">
        <span>AI Suggested Scope</span>
      </div>

      <div className="scopeBox">
        <ul className="scopeList">
          {scope.length === 0 ? (
            <li className="mutedText">
              No breakdown yet. Generate one or add your own subtasks.
            </li>
          ) : (
            scope.map((item) => (
              <li key={item.id} className="scopeItem">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={Boolean(item.done)}
                  onChange={() => onToggleScopeDone(item.id)}
                />
                <div>
                  <input
                    className="textInput"
                    value={item.text}
                    disabled={locked}
                    onChange={(e) => onScopeTextChange(item.id, e.target.value)}
                  />
                </div>
                <div style={{ textAlign: "right" }}>
                  <input
                    type="number"
                    min="0"
                    className="textInput"
                    style={{ width: 80 }}
                    disabled={locked}
                    value={item.minutes ?? 0}
                    onChange={(e) =>
                      onScopeMinutesChange(item.id, Number(e.target.value))
                    }
                  />
                  <div className="mins">{formatDuration(item.minutes ?? 0)}</div>
                  {!locked && (
                    <button
                      type="button"
                      className="iconBtn"
                      style={{ marginTop: 6 }}
                      onClick={() => onRemoveScopeItem(item.id)}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </li>
            ))
          )}
        </ul>

        <div className="controls">
          <button
            type="button"
            className="button"
            onClick={onGenerateScope}
          >
            Generate AI breakdown
          </button>
          <button
            type="button"
            className="buttonLight"
            onClick={locked ? onEditScope : onAcceptScope}
          >
            {locked ? "Edit Breakdown" : "Accept Scope"}
          </button>
          {!locked && (
            <button
              type="button"
              className="buttonLight"
              onClick={onAddScopeItem}
            >
              Add subtask
            </button>
          )}
        </div>

        <div className="bigStat">
          <div className="label">
            <span>Total Est. Effort</span>
          </div>
          <div className="value">{formatDuration(totalMinutes)}</div>
        </div>
      </div>

      <div className="sectionTitle">Details</div>
      <div className="fieldGrid">
        <div className="field">
          <label htmlFor="status">Status</label>
          <select
            id="status"
            className="select"
            value={task.status}
            onChange={(e) => onMetaChange("status", e.target.value)}
          >
            <option value="Pending">Pending</option>
            <option value="Completed">Completed</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="assignee">Assignee</label>
          <input
            id="assignee"
            className="textInput"
            value={task.assignee ?? ""}
            onChange={(e) => onMetaChange("assignee", e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="dueDate">Due Date</label>
          <input
            id="dueDate"
            type="date"
            className="dateInput"
            value={task.dueDate ?? ""}
            onChange={(e) => onMetaChange("dueDate", e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="priority">Priority</label>
          <select
            id="priority"
            className="select"
            value={task.priority}
            onChange={(e) => onMetaChange("priority", e.target.value)}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="footerBar">
        <div className="mutedText">
          {saveMessage || "Changes are stored in this browser."}
        </div>
        <button type="button" className="buttonLight" onClick={onSaveDraft}>
          Save draft
        </button>
      </div>
    </div>
  );
}

function PlanMyDayView({ plan, onDone }) {
  return (
    <div>
      <div className="sideHeader">
        <h2>Plan My Day</h2>
      </div>
      {plan.length === 0 ? (
        <p className="mutedText">
          No pending subtasks to plan. Add scope to your tasks and mark them as
          pending to see a suggested day plan.
        </p>
      ) : (
        <ul className="planList">
          {plan.map((item) => (
            <li key={item.id} className="planBlock">
              <div className="time">{item.timeRange}</div>
              <div>
                <p className="blockTitle">{item.label}</p>
                <p className="blockSub">
                  {item.subLabel} • {formatDuration(item.minutes)}
                </p>
              </div>
              <button
                type="button"
                className="buttonLight"
                onClick={() => onDone(item)}
              >
                Done
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}