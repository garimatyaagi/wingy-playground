import { useEffect, useMemo, useState } from "react";

export default function GoalDetailModal({
  open,
  goal,
  onClose,
  onSaveGoal,
  onArchiveGoal,
  onDeleteGoal,
  onOpenTask,
  onToggleTaskDone,
  onDeleteTask,
  onAddTask,
}) {
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [newTask, setNewTask] = useState("");

  useEffect(() => {
    if (!goal) return;
    setDraftTitle(goal.title || "");
    setDraftDescription(goal.description || "");
    setNewTask("");
  }, [goal]);

  const recurringTasks = useMemo(
    () => (goal?.tasks || []).filter((task) => task.isRecurring),
    [goal]
  );
  const oneTimeTasks = useMemo(
    () => (goal?.tasks || []).filter((task) => !task.isRecurring && !task.isNote),
    [goal]
  );
  const totalTime = useMemo(
    () =>
      (goal?.tasks || []).reduce((sum, task) => sum + (Number(task.actualMinutes || 0) / 60), 0),
    [goal]
  );
  const completed = (goal?.tasks || []).filter((task) => task.status === "done" || task.completedAt).length;
  const progressPct = (goal?.tasks || []).length
    ? Math.round((completed / (goal?.tasks || []).length) * 100)
    : 0;
  const recommended =
    [...(goal?.tasks || [])]
      .filter((task) => task.status !== "done" && !task.completedAt && !task.isNote)
      .sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0))[0] || null;

  if (!open || !goal) return null;

  return (
    <div className="taskDrawerOverlay" onClick={onClose}>
      <aside className="taskDrawer goalDetailModal" onClick={(event) => event.stopPropagation()}>
        <div className="taskDrawerHeader">
          <h3>Goal Detail</h3>
          <button type="button" className="crossButton" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="taskDrawerBlock">
          <label className="inputLabel">Goal title</label>
          <input className="textInput" value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} />
          <label className="inputLabel">Description</label>
          <textarea
            className="intakeTextarea compact"
            value={draftDescription}
            onChange={(event) => setDraftDescription(event.target.value)}
            placeholder="Why this goal matters and what success looks like"
          />
          <div className="taskDrawerActionsTop">
            <button
              type="button"
              className="primaryButton mini"
              onClick={() => onSaveGoal(goal.id, { title: draftTitle.trim(), description: draftDescription })}
              disabled={!draftTitle.trim()}
            >
              Save goal
            </button>
            <button type="button" className="ghostButton mini" onClick={() => onArchiveGoal(goal.id)}>
              {goal.status === "archived" ? "Unarchive" : "Archive"}
            </button>
            <button type="button" className="ghostButton mini danger" onClick={() => onDeleteGoal(goal.id)}>
              Delete goal
            </button>
          </div>
        </div>

        <div className="taskDrawerBlock">
          <div className="goalTop">
            <h3 style={{ fontSize: 20 }}>{goal.title}</h3>
            <span className="goalProgressText">{progressPct}%</span>
          </div>
          <div className="goalProgressBar">
            <i style={{ width: `${progressPct}%` }} />
          </div>
          <p className="subtle">
            Next milestone: {recommended ? recommended.title : "Set a next milestone"} · {Math.round(totalTime * 10) / 10}h invested
          </p>
          {recommended ? (
            <button type="button" className="textLink strong" onClick={() => onOpenTask(goal.id, recommended.id)}>
              Recommended next action: {recommended.title}
            </button>
          ) : null}
        </div>

        <div className="taskDrawerBlock">
          <label className="inputLabel">Add task</label>
          <div className="goalQuickAdd">
            <input
              className="textInput"
              value={newTask}
              onChange={(event) => setNewTask(event.target.value)}
              placeholder="Add a task under this goal"
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                onAddTask(goal.id, newTask);
                setNewTask("");
              }}
            />
            <button
              type="button"
              className="ghostButton mini"
              disabled={!newTask.trim()}
              onClick={() => {
                onAddTask(goal.id, newTask);
                setNewTask("");
              }}
            >
              Add
            </button>
          </div>
        </div>

        <div className="taskDrawerBlock">
          <label className="inputLabel">Recurring tasks</label>
          <div className="goalTaskList">
            {recurringTasks.length === 0 ? (
              <p className="subtle">No recurring tasks in this goal.</p>
            ) : (
              recurringTasks.map((task) => (
                <div key={task.id} className="goalTaskRow">
                  <button
                    type="button"
                    className={task.status === "done" || task.completedAt ? "tickButton done" : "tickButton"}
                    onClick={() => onToggleTaskDone(goal.id, task.id)}
                  >
                    ✓
                  </button>
                  <button type="button" className="goalTaskTitle" onClick={() => onOpenTask(goal.id, task.id)}>
                    {task.title}
                  </button>
                  <button type="button" className="crossButton" onClick={() => onDeleteTask(goal.id, task.id)}>
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="taskDrawerBlock">
          <label className="inputLabel">One-time tasks</label>
          <div className="goalTaskList">
            {oneTimeTasks.length === 0 ? (
              <p className="subtle">No one-time tasks in this goal.</p>
            ) : (
              oneTimeTasks.map((task) => (
                <div key={task.id} className="goalTaskRow">
                  <button
                    type="button"
                    className={task.status === "done" || task.completedAt ? "tickButton done" : "tickButton"}
                    onClick={() => onToggleTaskDone(goal.id, task.id)}
                  >
                    ✓
                  </button>
                  <button type="button" className="goalTaskTitle" onClick={() => onOpenTask(goal.id, task.id)}>
                    {task.title}
                  </button>
                  <button type="button" className="crossButton" onClick={() => onDeleteTask(goal.id, task.id)}>
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
