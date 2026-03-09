import { useState } from "react";

function goalProgress(goal) {
  const tasks = goal.tasks || [];
  const meaningful = tasks.filter((task) => !task.isNote);
  const done = meaningful.filter((task) => task.status === "done" || task.completedAt).length;
  if (meaningful.length === 0) return 0;
  return Math.round((done / meaningful.length) * 100);
}

function recommendedTask(goal) {
  const active = (goal.tasks || []).filter((task) => !task.isNote && task.status !== "done" && !task.completedAt);
  if (active.length === 0) return null;
  return [...active].sort((a, b) => Number(b.priorityScore || 0) - Number(a.priorityScore || 0))[0];
}

function GoalCardCompact({
  goal,
  goals,
  onEditGoal,
  onArchiveGoal,
  onDeleteGoal,
  onAddTask,
  onOpenTask,
  onToggleTaskDone,
  onDeleteTask,
  onSnoozeTask,
  onMoveTask,
}) {
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(goal.title || "");
  const [newTask, setNewTask] = useState("");

  const activeRecurring = (goal.tasks || []).filter(
    (task) => task.isRecurring && task.status !== "done" && !task.completedAt && !task.isNote
  );
  const activeOneTime = (goal.tasks || []).filter(
    (task) => !task.isRecurring && task.status !== "done" && !task.completedAt && !task.isNote
  );
  const progress = goalProgress(goal);
  const next = recommendedTask(goal);

  return (
    <article className="cardShell goalCompactCard">
      <div className="goalCompactTop">
        {editing ? (
          <input className="textInput" value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} />
        ) : (
          <h3>{goal.title}</h3>
        )}
        <div className="goalCompactActions">
          {editing ? (
            <button
              type="button"
              className="ghostButton mini"
              onClick={() => {
                onEditGoal(goal.id, titleDraft);
                setEditing(false);
              }}
              disabled={!titleDraft.trim()}
            >
              Save
            </button>
          ) : (
            <button type="button" className="ghostButton mini" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
          <button type="button" className="ghostButton mini" onClick={() => onArchiveGoal(goal.id)}>
            {goal.status === "archived" ? "Unarchive" : "Archive"}
          </button>
          <button type="button" className="ghostButton mini danger" onClick={() => onDeleteGoal(goal.id)}>
            Delete
          </button>
        </div>
      </div>

      <div className="goalProgressBar">
        <i style={{ width: `${progress}%` }} />
      </div>
      <p className="subtle">Progress {progress}%</p>

      <p className="goalMilestoneLine">
        Next milestone: {next ? next.title : "Define the next concrete milestone"}
      </p>
      <p className="subtle">Recommended next task: {next ? `${next.title} (${next.estimatedMinutes} min)` : "None"}</p>

      <div className="goalCountsRow">
        <span>Recurring active: {activeRecurring.length}</span>
        <span>One-time active: {activeOneTime.length}</span>
      </div>

      <div className="goalQuickAddRow">
        <input
          className="textInput"
          value={newTask}
          onChange={(event) => setNewTask(event.target.value)}
          placeholder="Add task"
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            onAddTask(goal.id, newTask);
            setNewTask("");
          }}
        />
        <button
          type="button"
          className="primaryButton mini"
          onClick={() => {
            onAddTask(goal.id, newTask);
            setNewTask("");
          }}
          disabled={!newTask.trim()}
        >
          Add
        </button>
      </div>

      <div className="goalTaskPreviewList">
        {[...activeOneTime, ...activeRecurring].slice(0, 6).map((task) => (
          <div key={task.id} className="goalTaskPreviewRow">
            <button type="button" className="textLink" onClick={() => onOpenTask(goal.id, task.id)}>
              {task.title}
            </button>
            <div className="goalTaskPreviewActions">
              <button type="button" className="ghostButton mini" onClick={() => onToggleTaskDone(goal.id, task.id)}>
                Done
              </button>
              <button type="button" className="ghostButton mini" onClick={() => onSnoozeTask(task)}>
                Snooze
              </button>
              <select
                className="select miniSelect"
                value={goal.id}
                onChange={(event) => onMoveTask(goal.id, task.id, event.target.value)}
              >
                {goals.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.title}
                  </option>
                ))}
              </select>
              <button type="button" className="ghostButton mini" onClick={() => onDeleteTask(goal.id, task.id)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

export default function GoalsSurface({
  goals,
  yearSnapshot,
  newGoalTitle,
  onNewGoalTitleChange,
  onCreateGoal,
  onEditGoal,
  onArchiveGoal,
  onDeleteGoal,
  onAddTask,
  onOpenTask,
  onToggleTaskDone,
  onDeleteTask,
  onSnoozeTask,
  onMoveTask,
}) {
  return (
    <section className="goalsSurface">
      <article className="cardShell goalsHeaderCard">
        <div className="sectionHeader">
          <div>
            <h2>Goals</h2>
            <p>Compact goals with progress, milestones, and recommended next actions.</p>
          </div>
        </div>
        <div className="goalQuickAddRow">
          <input
            className="textInput"
            value={newGoalTitle}
            onChange={(event) => onNewGoalTitleChange(event.target.value)}
            placeholder="Add goal"
          />
          <button type="button" className="primaryButton" onClick={onCreateGoal} disabled={!newGoalTitle.trim()}>
            Add goal
          </button>
        </div>
      </article>

      <article className="cardShell yearMiniBoard">
        <h3>Year progress board</h3>
        <div className="yearMiniStats">
          <div><span>Total goals</span><strong>{yearSnapshot.totalGoals}</strong></div>
          <div><span>Active</span><strong>{yearSnapshot.activeGoals}</strong></div>
          <div><span>Completed</span><strong>{yearSnapshot.completedGoals}</strong></div>
          <div><span>Execution score</span><strong>{yearSnapshot.executionScore}</strong></div>
          <div><span>Recurring consistency</span><strong>{yearSnapshot.recurringCompletionRate}%</strong></div>
          <div><span>Overdue load</span><strong>{yearSnapshot.overdueLoad}</strong></div>
        </div>
      </article>

      <div className="goalCompactGrid">
        {goals.length === 0 ? (
          <article className="cardShell">
            <p className="subtle">No goals yet. Create your first goal.</p>
          </article>
        ) : (
          goals.map((goal) => (
            <GoalCardCompact
              key={goal.id}
              goal={goal}
              goals={goals}
              onEditGoal={onEditGoal}
              onArchiveGoal={onArchiveGoal}
              onDeleteGoal={onDeleteGoal}
              onAddTask={onAddTask}
              onOpenTask={onOpenTask}
              onToggleTaskDone={onToggleTaskDone}
              onDeleteTask={onDeleteTask}
              onSnoozeTask={onSnoozeTask}
              onMoveTask={onMoveTask}
            />
          ))
        )}
      </div>
    </section>
  );
}
