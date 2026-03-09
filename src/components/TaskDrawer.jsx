import { useEffect, useState } from "react";
import MoveTaskDropdown from "./MoveTaskDropdown";

const ESTIMATES = [10, 20, 30, 45, 60, 90, 120];
const PROOF_TYPES = ["note", "link", "screenshot", "timer"];

function recurrenceToLabel(rule) {
  if (!rule || typeof rule !== "object") return "none";
  return rule.frequency || "none";
}

export default function TaskDrawer({
  open,
  task,
  goals,
  currentGoalName,
  onClose,
  onSave,
  onMove,
  onGenerateNextAction,
  onToggleComplete,
  onSnooze,
  onDeleteTask,
  onBreakIntoSubtasks,
  onStartTimer,
  onStopTimer,
  onAddActualMinutes,
  timer,
  saving = false,
}) {
  const [draft, setDraft] = useState(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!task) return;
    setDraft({
      title: task.title || "",
      description: task.description || "",
      nextAction: task.nextAction || "",
      estimatedMinutes: task.estimatedMinutes || 30,
      actualMinutes: task.actualMinutes || 0,
      urgency: task.urgency || 2,
      importance: task.importance || 3,
      avoidanceScore: task.avoidanceScore || 0,
      rescheduleCount: task.rescheduleCount || 0,
      proofType: task.proofType || "note",
      proofRequired: Boolean(task.proofRequired),
      proofNote: task.proofNote || "",
      proofLink: task.proofLink || "",
      commitmentLevel: task.commitmentLevel || "normal",
      escalationLevel: task.escalationLevel || 0,
      dueDate: task.dueDate ? task.dueDate.slice(0, 10) : "",
      scheduledDate: task.scheduledDate ? task.scheduledDate.slice(0, 10) : "",
      isNote: Boolean(task.isNote),
      type: task.isRecurring || task.type === "recurring" ? "recurring" : "one_time",
      recurrenceFrequency: recurrenceToLabel(task.recurrenceRule),
      recurrenceInterval: task.recurrenceRule?.interval || 1,
      recurrenceDay:
        Array.isArray(task.recurrenceRule?.daysOfWeek) && task.recurrenceRule.daysOfWeek.length > 0
          ? String(task.recurrenceRule.daysOfWeek[0])
          : "1",
      status: task.status || "active",
      isBlocked: Boolean(task.isBlocked),
    });
    setGenerating(false);
  }, [task]);

  if (!open || !task || !draft) return null;

  const done = task.status === "done" || Boolean(task.completedAt);
  const timerRunning = timer?.taskId === task.id;
  const timerSeconds = timerRunning ? Math.max(0, Math.floor((Date.now() - timer.startedAt) / 1000)) : 0;
  const timerMinutes = Math.floor(timerSeconds / 60);
  const timerLabel = `${timerMinutes}:${String(timerSeconds % 60).padStart(2, "0")}`;
  const variance = Number(draft.actualMinutes || 0) - Number(draft.estimatedMinutes || 0);

  return (
    <div className="taskDrawerOverlay" onClick={onClose}>
      <aside className="taskDrawer" onClick={(event) => event.stopPropagation()}>
        <div className="taskDrawerHeader">
          <h3>Task Detail</h3>
          <button type="button" className="crossButton" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="taskDrawerActionsTop">
          <button
            type="button"
            className={done ? "ghostButton mini" : "primaryButton mini"}
            onClick={() => onToggleComplete(task)}
          >
            {done ? "Mark active" : "Complete"}
          </button>
          <button type="button" className="ghostButton mini" onClick={() => onSnooze(task)}>
            Snooze +1 day
          </button>
          <button
            type="button"
            className="ghostButton mini"
            onClick={() => onBreakIntoSubtasks(task, draft)}
          >
            Break into subtasks
          </button>
          <MoveTaskDropdown goals={goals} currentGoalId={task.goalId} onSelect={onMove} disabled={saving} />
        </div>

        <div className="taskDrawerBlock">
          <label className="inputLabel">Title</label>
          <input
            className="textInput"
            value={draft.title}
            onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
          />
          <label className="inputLabel">Description</label>
          <textarea
            className="intakeTextarea compact"
            value={draft.description}
            onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))}
          />
        </div>

        <div className="taskDrawerBlock">
          <label className="inputLabel">Current goal</label>
          <span className="drawerGoalPill">{currentGoalName || "Unassigned"}</span>
        </div>

        <div className="taskDrawerBlock">
          <label className="inputLabel">Next action</label>
          <textarea
            className="intakeTextarea compact"
            value={draft.nextAction}
            onChange={(event) => setDraft((prev) => ({ ...prev, nextAction: event.target.value }))}
          />
          <button
            type="button"
            className="ghostButton mini"
            disabled={generating}
            onClick={async () => {
              setGenerating(true);
              try {
                const next = await onGenerateNextAction(task, draft);
                if (typeof next === "string" && next.trim()) {
                  setDraft((prev) => ({ ...prev, nextAction: next.trim() }));
                }
              } finally {
                setGenerating(false);
              }
            }}
          >
            {generating ? "Generating..." : "Generate next action"}
          </button>
        </div>

        <div className="taskDrawerGrid">
          <label className="taskDrawerBlock">
            <span className="inputLabel">Commitment level</span>
            <select
              className="select"
              value={draft.commitmentLevel}
              onChange={(event) => setDraft((prev) => ({ ...prev, commitmentLevel: event.target.value }))}
            >
              <option value="none">None</option>
              <option value="light">Light</option>
              <option value="normal">Normal</option>
              <option value="must">Must finish</option>
            </select>
          </label>
          <label className="taskDrawerBlock">
            <span className="inputLabel">Proof type</span>
            <select
              className="select"
              value={draft.proofType}
              onChange={(event) => setDraft((prev) => ({ ...prev, proofType: event.target.value }))}
            >
              {PROOF_TYPES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label className="taskDrawerBlock">
            <span className="inputLabel">Task type</span>
            <select
              className="select"
              value={draft.type}
              onChange={(event) => setDraft((prev) => ({ ...prev, type: event.target.value }))}
            >
              <option value="one_time">One-time</option>
              <option value="recurring">Recurring</option>
            </select>
          </label>

          <label className="taskDrawerBlock">
            <span className="inputLabel">Estimate</span>
            <select
              className="select"
              value={draft.estimatedMinutes}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, estimatedMinutes: Number(event.target.value) }))
              }
            >
              {ESTIMATES.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes} min
                </option>
              ))}
            </select>
          </label>

          <label className="taskDrawerBlock">
            <span className="inputLabel">Actual minutes</span>
            <input
              type="number"
              min="0"
              className="textInput"
              value={draft.actualMinutes}
              onChange={(event) => setDraft((prev) => ({ ...prev, actualMinutes: Number(event.target.value) || 0 }))}
            />
          </label>

          <div className="taskDrawerBlock">
            <span className="inputLabel">Timer</span>
            <div className="taskDrawerActionsTop">
              {timerRunning ? (
                <button type="button" className="primaryButton mini" onClick={() => onStopTimer(task, timerSeconds)}>
                  Stop ({timerLabel})
                </button>
              ) : (
                <button type="button" className="ghostButton mini" onClick={() => onStartTimer(task)}>
                  Start timer
                </button>
              )}
              <button type="button" className="ghostButton mini" onClick={() => onAddActualMinutes(task, 10)}>
                +10 min
              </button>
            </div>
          </div>
          <label className="taskDrawerBlock">
            <span className="inputLabel">Avoidance score</span>
            <input
              type="range"
              min="0"
              max="6"
              value={draft.avoidanceScore}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, avoidanceScore: Number(event.target.value) }))
              }
            />
          </label>
          <label className="taskDrawerBlock">
            <span className="inputLabel">Escalation level</span>
            <input
              type="number"
              min="0"
              max="5"
              className="textInput"
              value={draft.escalationLevel}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, escalationLevel: Number(event.target.value) || 0 }))
              }
            />
          </label>

          <label className="taskDrawerBlock">
            <span className="inputLabel">Due date</span>
            <input
              type="date"
              className="textInput"
              value={draft.dueDate}
              onChange={(event) => setDraft((prev) => ({ ...prev, dueDate: event.target.value }))}
            />
          </label>

          <label className="taskDrawerBlock">
            <span className="inputLabel">Scheduled date</span>
            <input
              type="date"
              className="textInput"
              value={draft.scheduledDate}
              onChange={(event) => setDraft((prev) => ({ ...prev, scheduledDate: event.target.value }))}
            />
          </label>
        </div>

        {draft.type === "recurring" ? (
          <div className="taskDrawerGrid">
            <label className="taskDrawerBlock">
              <span className="inputLabel">Frequency</span>
              <select
                className="select"
                value={draft.recurrenceFrequency}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, recurrenceFrequency: event.target.value }))
                }
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
            <label className="taskDrawerBlock">
              <span className="inputLabel">Interval</span>
              <input
                type="number"
                min="1"
                className="textInput"
                value={draft.recurrenceInterval}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, recurrenceInterval: Number(event.target.value) || 1 }))
                }
              />
            </label>
            {draft.recurrenceFrequency === "weekly" ? (
              <label className="taskDrawerBlock">
                <span className="inputLabel">Weekday</span>
                <select
                  className="select"
                  value={draft.recurrenceDay}
                  onChange={(event) => setDraft((prev) => ({ ...prev, recurrenceDay: event.target.value }))}
                >
                  <option value="0">Sun</option>
                  <option value="1">Mon</option>
                  <option value="2">Tue</option>
                  <option value="3">Wed</option>
                  <option value="4">Thu</option>
                  <option value="5">Fri</option>
                  <option value="6">Sat</option>
                </select>
              </label>
            ) : null}
          </div>
        ) : null}

        <div className="taskDrawerGrid">
          <label className="taskDrawerBlock">
            <span className="inputLabel">Urgency</span>
            <input
              type="range"
              min="1"
              max="5"
              value={draft.urgency}
              onChange={(event) => setDraft((prev) => ({ ...prev, urgency: Number(event.target.value) }))}
            />
          </label>
          <label className="taskDrawerBlock">
            <span className="inputLabel">Importance</span>
            <input
              type="range"
              min="1"
              max="5"
              value={draft.importance}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, importance: Number(event.target.value) }))
              }
            />
          </label>
        </div>

        <label className="taskDrawerBlock noteToggle">
          <input
            type="checkbox"
            checked={draft.isNote}
            onChange={(event) => setDraft((prev) => ({ ...prev, isNote: event.target.checked }))}
          />
          Treat as note (excluded from planning)
        </label>

        <label className="taskDrawerBlock noteToggle">
          <input
            type="checkbox"
            checked={draft.isBlocked}
            onChange={(event) => setDraft((prev) => ({ ...prev, isBlocked: event.target.checked }))}
          />
          Mark as blocked
        </label>

        <label className="taskDrawerBlock noteToggle">
          <input
            type="checkbox"
            checked={draft.proofRequired}
            onChange={(event) => setDraft((prev) => ({ ...prev, proofRequired: event.target.checked }))}
          />
          Proof required for completion
        </label>

        <div className="taskDrawerBlock">
          <label className="inputLabel">Proof note</label>
          <textarea
            className="intakeTextarea compact"
            value={draft.proofNote}
            onChange={(event) => setDraft((prev) => ({ ...prev, proofNote: event.target.value }))}
            placeholder="What proof will you provide when done?"
          />
          {(draft.proofType === "link" || draft.proofType === "screenshot") ? (
            <>
              <label className="inputLabel">Proof link</label>
              <input
                className="textInput"
                value={draft.proofLink}
                onChange={(event) => setDraft((prev) => ({ ...prev, proofLink: event.target.value }))}
                placeholder="https://..."
              />
            </>
          ) : null}
        </div>

        <div className="taskDrawerReasoning">
          <label className="inputLabel">AI reasoning</label>
          <p className="subtle">
            Ranking combines deadline pressure, strategic importance, dependency unlocks, recurrence
            obligations, and daily capacity fit.
          </p>
          <p className="subtle">
            Planned vs actual variance: {variance >= 0 ? "+" : ""}
            {variance} min
          </p>
          <p className="subtle">
            Rescheduled: {draft.rescheduleCount} times.
          </p>
        </div>

        <div className="taskDrawerBottom">
          <button
            type="button"
            className="primaryButton"
            disabled={!draft.title.trim() || saving}
            onClick={() => onSave(task, draft)}
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
          <button type="button" className="ghostButton danger" onClick={() => onDeleteTask(task)}>
            Delete task
          </button>
          <button type="button" className="ghostButton" onClick={onClose}>
            Close
          </button>
        </div>
      </aside>
    </div>
  );
}
