import { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "today_tasks_v1";

function formatToday() {
  return new Date().toLocaleDateString(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

function makeId() {
  return crypto?.randomUUID?.() ?? String(Date.now() + Math.random());
}

export default function App() {
  const [tasks, setTasks] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const [filter, setFilter] = useState("pending"); // "all" | "pending" | "completed"
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  }, [tasks]);

  const counts = useMemo(() => {
    const pending = tasks.filter((t) => !t.done).length;
    const completed = tasks.length - pending;
    return { all: tasks.length, pending, completed };
  }, [tasks]);

  const visibleTasks = useMemo(() => {
    if (filter === "pending") return tasks.filter((t) => !t.done);
    if (filter === "completed") return tasks.filter((t) => t.done);
    return tasks;
  }, [tasks, filter]);

  function addTask() {
    const trimmed = text.trim();
    if (!trimmed) {
      setError("Type a task first.");
      return;
    }
    setError("");
    const newTask = {
      id: makeId(),
      text: trimmed,
      done: false,
      createdAt: Date.now(),
    };
    setTasks((prev) => [newTask, ...prev]);
    setText("");
    setFilter("pending");
  }

  function toggleDone(id) {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
    );
  }

  function clearCompleted() {
    setTasks((prev) => prev.filter((t) => !t.done));
  }

  function onSubmit(e) {
    e.preventDefault();
    addTask();
  }

  return (
    <div className="container">
      <div className="card">
        <div className="header">
          <h1 className="title">Today</h1>
          <div className="subtitle">{formatToday()}</div>
        </div>

        <form onSubmit={onSubmit}>
          <div className="row">
            <input
              className="input"
              placeholder="Add a task for today…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onFocus={() => setError("")}
            />
            <button className="button" type="submit">
              Add
            </button>
          </div>
          {error ? <div className="error">{error}</div> : null}
        </form>

        <div className="tabs" role="tablist" aria-label="Filters">
          <Tab
            label={`All (${counts.all})`}
            active={filter === "all"}
            onClick={() => setFilter("all")}
          />
          <Tab
            label={`Pending (${counts.pending})`}
            active={filter === "pending"}
            onClick={() => setFilter("pending")}
          />
          <Tab
            label={`Completed (${counts.completed})`}
            active={filter === "completed"}
            onClick={() => setFilter("completed")}
          />
        </div>

        <ul className="list">
          {visibleTasks.length === 0 ? (
            <li className="subtitle" style={{ padding: "8px 2px" }}>
              {filter === "completed"
                ? "No completed tasks yet."
                : filter === "pending"
                ? "No pending tasks. Add one above."
                : "No tasks yet. Add one above."}
            </li>
          ) : (
            visibleTasks.map((t) => (
              <TaskItem key={t.id} task={t} onToggle={() => toggleDone(t.id)} />
            ))
          )}
        </ul>

        <div className="footer">
          <div>
            {counts.pending} pending • {counts.completed} done
          </div>
          <div>
            {counts.completed > 0 ? (
              <button className="linkBtn" onClick={clearCompleted}>
                Clear completed
              </button>
            ) : (
              <span />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Tab({ label, active, onClick }) {
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

function TaskItem({ task, onToggle }) {
  return (
    <li className="item">
      <span className={task.done ? "dot dotDone" : "dot"} aria-hidden="true">
        {task.done ? "✓" : ""}
      </span>

      <div className={task.done ? "text textDone" : "text"}>{task.text}</div>

      <button className="smallBtn" onClick={onToggle}>
        {task.done ? "Undo" : "Done"}
      </button>
    </li>
  );
}