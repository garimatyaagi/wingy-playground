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

  const activeTasks = (goal.tasks || []).filter(
    (task) => task.status !== "done" && !task.completedAt && !task.isNote
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
            {goal.status === "archived" ? "Restore" : "Archive"}
          </button>
          <button type="button" className="ghostButton mini danger" onClick={() => onDeleteGoal(goal.id)}>
            Delete
          </button>
        </div>
      </div>

      <div className="goalProgressBar">
        <i style={{ width: `${progress}%` }} />
      </div>
      <p className="subtle">{progress}% complete · {activeTasks.length} active task{activeTasks.length !== 1 ? "s" : ""}</p>

      {next ? (
        <p className="goalMilestoneLine">
          Next up: {next.title} ({next.estimatedMinutes || "?"} min)
        </p>
      ) : null}

      <div className="goalQuickAddRow">
        <input
          className="textInput"
          value={newTask}
          onChange={(event) => setNewTask(event.target.value)}
          placeholder="Add a task..."
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
        {activeTasks.slice(0, 5).map((task) => (
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
              {goals.length > 1 ? (
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
              ) : null}
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
  const hasStats = yearSnapshot.totalGoals > 0;

  return (
    <section className="goalsSurface">
      <article className="cardShell goalsHeaderCard">
        <h2>Goals</h2>
        <p className="subtle">Define what you're working toward, then break each goal into tasks.</p>
        <div className="goalQuickAddRow">
          <input
            className="textInput"
            value={newGoalTitle}
            onChange={(event) => onNewGoalTitleChange(event.target.value)}
            placeholder="What's your next goal?"
            onKeyDown={(event) => {
              if (event.key === "Enter" && newGoalTitle.trim()) {
                event.preventDefault();
                onCreateGoal();
              }
            }}
          />
          <button type="button" className="primaryButton" onClick={onCreateGoal} disabled={!newGoalTitle.trim()}>
            Add goal
          </button>
        </div>
      </article>

      {hasStats ? (
        <article className="cardShell yearMiniBoard">
          <div className="yearMiniStats">
            <div><span>Active</span><strong>{yearSnapshot.activeGoals}</strong></div>
            <div><span>Completed</span><strong>{yearSnapshot.completedGoals}</strong></div>
            <div><span>Execution</span><strong>{yearSnapshot.executionScore}</strong></div>
            <div><span>Overdue</span><strong>{yearSnapshot.overdueLoad}</strong></div>
          </div>
        </article>
      ) : null}

      <div className="goalCompactGrid">
        {goals.length === 0 ? (
          <article className="cardShell">
            <div className="emptyHint">
              <p>No goals yet.</p>
              <p className="subtle">Type a goal name above and press Enter or click Add.</p>
            </div>
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
