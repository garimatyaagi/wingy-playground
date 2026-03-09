import { useState } from "react";

export default function GoalCard({
  goal,
  onOpenTask,
  onToggleTaskDone,
  onDeleteTask,
  onAddTask,
  onOpenGoalDetail,
  onArchiveGoal,
  onDeleteGoal,
}) {
  const [draft, setDraft] = useState("");
  const activeTasks = goal.tasks.filter((task) => !task.completedAt && task.status !== "done" && !task.isNote);
  const recurringTasks = goal.tasks.filter((task) => task.isRecurring && !task.isNote);
  const oneTimeTasks = goal.tasks.filter((task) => !task.isRecurring && !task.isNote);
  const completedTasks = goal.tasks.filter((task) => task.completedAt || task.status === "done");
  const overdueTasks = activeTasks.filter((task) => task.dueDate && new Date(task.dueDate).getTime() < Date.now());
  const totalTimeHours = goal.tasks.reduce((sum, task) => sum + Number(task.actualMinutes || 0) / 60, 0);
  const progressPct =
    goal.progressType === "time_invested"
      ? Math.min(100, Math.round((totalTimeHours / Math.max(1, goal.targetValue || 10)) * 100))
      : goal.progressType === "target_count"
        ? Math.min(100, Math.round((completedTasks.length / Math.max(1, goal.targetValue || 10)) * 100))
        : goal.tasks.length === 0
          ? 0
          : Math.round((completedTasks.length / Math.max(goal.tasks.length, 1)) * 100);
  const recommended = [...activeTasks].sort((a, b) => b.priorityScore - a.priorityScore)[0] || null;

  return (
    <article className="cardShell goalCard">
      <div className="goalTop">
        <button type="button" className="textLink strong goalTitleBtn" onClick={() => onOpenGoalDetail(goal.id)}>
          {goal.title}
        </button>
        <div className="goalHeaderMeta">
          {goal.status === "archived" ? <span className="goalStatusBadge">Archived</span> : null}
          <span className="goalProgressText">{progressPct}%</span>
        </div>
      </div>
      <div className="goalProgressBar">
        <i style={{ width: `${progressPct}%` }} />
      </div>

      <div className="goalStats">
        <span>{activeTasks.length} active</span>
        <span>{overdueTasks.length} overdue</span>
        <span>{recurringTasks.length} recurring</span>
        <span>{oneTimeTasks.length} one-time</span>
        <span>{Math.round(totalTimeHours * 10) / 10}h</span>
      </div>

      <p className="goalMilestone">
        Next milestone:{" "}
        {recommended ? `${recommended.title} (${recommended.estimatedMinutes} min)` : "Define next milestone"}
      </p>

      {recommended ? (
        <button type="button" className="textLink strong" onClick={() => onOpenTask(goal.id, recommended.id)}>
          Recommended next action: {recommended.title}
        </button>
      ) : (
        <p className="subtle">No active tasks yet.</p>
      )}

      <div className="goalCardActions">
        <button type="button" className="ghostButton mini" onClick={() => onOpenGoalDetail(goal.id)}>
          Details
        </button>
        <button type="button" className="ghostButton mini" onClick={() => onArchiveGoal(goal.id)}>
          {goal.status === "archived" ? "Unarchive" : "Archive"}
        </button>
        <button type="button" className="ghostButton mini danger" onClick={() => onDeleteGoal(goal.id)}>
          Delete
        </button>
      </div>

      <div className="goalQuickAdd">
        <input
          className="textInput"
          value={draft}
          placeholder="Add task to this goal"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            onAddTask(goal.id, draft);
            setDraft("");
          }}
        />
        <button
          type="button"
          className="ghostButton mini"
          onClick={() => {
            onAddTask(goal.id, draft);
            setDraft("");
          }}
          disabled={!draft.trim()}
        >
          Add
        </button>
      </div>

      <details className="goalTaskListWrap">
        <summary>Show tasks</summary>
        <div className="goalTaskList">
          {goal.tasks.length === 0 ? (
            <p className="subtle">No tasks in this goal.</p>
          ) : (
            goal.tasks.slice(0, 10).map((task) => (
              <div key={task.id} className="goalTaskRow">
                <button
                  type="button"
                  className={task.completedAt || task.status === "done" ? "tickButton done" : "tickButton"}
                  onClick={() => onToggleTaskDone(goal.id, task.id)}
                  aria-label="Mark complete"
                >
                  ✓
                </button>
                <button type="button" className="goalTaskTitle" onClick={() => onOpenTask(goal.id, task.id)}>
                  {task.title}
                </button>
                <button
                  type="button"
                  className="crossButton"
                  onClick={() => onDeleteTask(goal.id, task.id)}
                  aria-label="Delete task"
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      </details>
    </article>
  );
}
