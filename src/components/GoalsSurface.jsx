import { useState } from "react";
import GoalBranchesView from "./GoalBranchesView";
import { LIFE_BRANCHES, getBranch, computeBranchStats } from "../lib/branchConfig";

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

function taskStatus(task) {
  if (task.status === "done" || task.completedAt) return "done";
  if (task.scheduledDate && new Date(task.scheduledDate).toDateString() === new Date().toDateString()) return "today";
  if (task.dueDate && new Date(task.dueDate).getTime() < Date.now()) return "overdue";
  return "pending";
}

function statusIcon(status) {
  switch (status) {
    case "done": return "checkCircle";
    case "today": return "active";
    case "overdue": return "overdue";
    default: return "pending";
  }
}

function statusLabel(task) {
  const s = taskStatus(task);
  if (s === "done") return "Done";
  if (s === "today") return "Today";
  if (s === "overdue") return "Overdue";
  if (task.estimatedMinutes) return `${task.estimatedMinutes} min`;
  return "Pending";
}

function GoalAccordion({
  goal,
  goals,
  expanded,
  onToggle,
  onEditGoal,
  onArchiveGoal,
  onDeleteGoal,
  onAddTask,
  onOpenTask,
  onToggleTaskDone,
  onDeleteTask,
  onSnoozeTask,
  onMoveTask,
  onChangeBranch,
}) {
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(goal.title || "");
  const [newTask, setNewTask] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);

  const allTasks = (goal.tasks || []).filter((t) => !t.isNote);
  const activeTasks = allTasks.filter((t) => t.status !== "done" && !t.completedAt);
  const completedTasks = allTasks.filter((t) => t.status === "done" || t.completedAt);
  const progress = goalProgress(goal);
  const next = recommendedTask(goal);

  return (
    <article className={`cardShell goalAccordion ${expanded ? "goalAccordionOpen" : ""}`}>
      {/* Collapsed header — always visible */}
      <button type="button" className="goalAccordionHeader" onClick={onToggle}>
        <div className="goalAccordionLeft">
          <span className={`goalChevron ${expanded ? "goalChevronOpen" : ""}`}>&#9654;</span>
          {editing ? (
            <input
              className="textInput goalTitleInput"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onEditGoal(goal.id, titleDraft);
                  setEditing(false);
                }
              }}
            />
          ) : (
            <h3 className="goalAccordionTitle">{goal.title}</h3>
          )}
        </div>
        <div className="goalAccordionRight">
          <span className="goalTaskCount">{activeTasks.length} task{activeTasks.length !== 1 ? "s" : ""}</span>
          <div className="goalProgressBarSmall">
            <i style={{ width: `${progress}%` }} />
          </div>
          <span className="goalProgressPct">{progress}%</span>
        </div>
      </button>

      {/* Next action teaser — shown when collapsed */}
      {!expanded && next ? (
        <div className="goalNextTeaser">
          <span className="goalNextLabel">Next</span>
          <button type="button" className="textLink" onClick={() => onOpenTask(goal.id, next.id)}>
            {next.title}
          </button>
        </div>
      ) : null}

      {/* Expanded body */}
      {expanded ? (
        <div className="goalAccordionBody">
          {/* Action bar */}
          <div className="goalActionBar">
            {editing ? (
              <button
                type="button"
                className="ghostButton mini"
                onClick={() => { onEditGoal(goal.id, titleDraft); setEditing(false); }}
                disabled={!titleDraft.trim()}
              >
                Save
              </button>
            ) : (
              <button type="button" className="ghostButton mini" onClick={(e) => { e.stopPropagation(); setEditing(true); }}>
                Edit
              </button>
            )}
            <button type="button" className="ghostButton mini" onClick={() => onArchiveGoal(goal.id)}>
              {goal.status === "archived" ? "Restore" : "Archive"}
            </button>
            <button type="button" className="ghostButton mini danger" onClick={() => onDeleteGoal(goal.id)}>
              Delete
            </button>
            {onChangeBranch ? (
              <select
                className="select miniSelect branchPicker"
                value={goal.branch || ""}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => onChangeBranch(goal.id, e.target.value)}
              >
                <option value="">Uncategorized</option>
                {LIFE_BRANCHES.map((b) => (
                  <option key={b.id} value={b.id}>{b.icon} {b.label}</option>
                ))}
              </select>
            ) : null}
          </div>

          {/* Task decomposition tree */}
          <div className="goalDecompTree">
            {activeTasks.length === 0 && completedTasks.length === 0 ? (
              <p className="subtle goalEmptyTree">No tasks yet — add one below to start breaking this goal down.</p>
            ) : (
              <>
                {activeTasks.map((task, idx) => {
                  const status = taskStatus(task);
                  const isLast = idx === activeTasks.length - 1 && completedTasks.length === 0;
                  return (
                    <div key={task.id} className={`goalTreeNode ${isLast ? "goalTreeNodeLast" : ""}`}>
                      <div className="goalTreeConnector">
                        <span className={`goalTreeDot goalTreeDot--${statusIcon(status)}`} />
                      </div>
                      <div className="goalTreeContent">
                        <div className="goalTreeTaskRow">
                          <button type="button" className="textLink goalTreeTaskTitle" onClick={() => onOpenTask(goal.id, task.id)}>
                            {task.title}
                          </button>
                          <span className={`goalTreeBadge goalTreeBadge--${status}`}>{statusLabel(task)}</span>
                        </div>
                        <div className="goalTreeActions">
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
                              onChange={(e) => onMoveTask(goal.id, task.id, e.target.value)}
                            >
                              {goals.map((g) => (
                                <option key={g.id} value={g.id}>{g.title}</option>
                              ))}
                            </select>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Completed tasks — collapsed by default */}
                {completedTasks.length > 0 ? (
                  <div className="goalCompletedSection">
                    <button
                      type="button"
                      className="goalCompletedToggle"
                      onClick={() => setShowCompleted(!showCompleted)}
                    >
                      <span className={`goalChevron goalChevronSmall ${showCompleted ? "goalChevronOpen" : ""}`}>&#9654;</span>
                      {completedTasks.length} completed
                    </button>
                    {showCompleted ? (
                      <div className="goalCompletedList">
                        {completedTasks.map((task) => (
                          <div key={task.id} className="goalTreeNode goalTreeNodeDone">
                            <div className="goalTreeConnector">
                              <span className="goalTreeDot goalTreeDot--checkCircle" />
                            </div>
                            <div className="goalTreeContent">
                              <span className="goalTreeTaskDone">{task.title}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>

          {/* Quick-add task */}
          <div className="goalQuickAddRow">
            <input
              className="textInput"
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              placeholder="Add a task to this goal..."
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (!newTask.trim()) return;
                onAddTask(goal.id, newTask);
                setNewTask("");
              }}
            />
            <button
              type="button"
              className="primaryButton mini"
              onClick={() => { onAddTask(goal.id, newTask); setNewTask(""); }}
              disabled={!newTask.trim()}
            >
              Add
            </button>
          </div>
        </div>
      ) : null}
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
  onChangeBranch,
}) {
  const [expandedId, setExpandedId] = useState(null);
  const [selectedBranch, setSelectedBranch] = useState(null);

  const toggleGoal = (id) => setExpandedId((prev) => (prev === id ? null : id));

  const totalActive = goals.reduce((sum, g) => {
    return sum + (g.tasks || []).filter((t) => !t.isNote && t.status !== "done" && !t.completedAt).length;
  }, 0);

  const totalDone = goals.reduce((sum, g) => {
    return sum + (g.tasks || []).filter((t) => !t.isNote && (t.status === "done" || t.completedAt)).length;
  }, 0);

  // Filter goals for the selected branch
  const branchGoals = selectedBranch
    ? goals.filter((g) => g.branch === selectedBranch)
    : goals;

  const activeBranch = selectedBranch ? getBranch(selectedBranch) : null;
  const branchStats = selectedBranch ? computeBranchStats(goals, selectedBranch) : null;

  return (
    <section className="goalsSurface">
      {/* Header */}
      <article className="cardShell goalsHeaderCard">
        <div className="goalsHeaderTop">
          <div>
            {selectedBranch ? (
              <>
                <button
                  type="button"
                  className="branchBackButton"
                  onClick={() => { setSelectedBranch(null); setExpandedId(null); }}
                >
                  &#8592; All Branches
                </button>
                <h2 className="branchDrilldownTitle">
                  <span className="branchDrilldownIcon">{activeBranch.icon}</span>
                  {activeBranch.label}
                </h2>
              </>
            ) : (
              <>
                <h2>Your Life Branches</h2>
                <p className="subtle">Goals organized by what matters most.</p>
              </>
            )}
          </div>
          {selectedBranch && branchStats ? (
            <div className="goalsHeaderStats">
              <span><strong>{branchStats.goalCount}</strong> goal{branchStats.goalCount !== 1 ? "s" : ""}</span>
              <span className="goalStatDivider" />
              <span><strong>{branchStats.activeTasks}</strong> active</span>
              <span className="goalStatDivider" />
              <span><strong>{branchStats.doneTasks}</strong> done</span>
            </div>
          ) : !selectedBranch && goals.length > 0 ? (
            <div className="goalsHeaderStats">
              <span><strong>{goals.length}</strong> goal{goals.length !== 1 ? "s" : ""}</span>
              <span className="goalStatDivider" />
              <span><strong>{totalActive}</strong> active</span>
              <span className="goalStatDivider" />
              <span><strong>{totalDone}</strong> done</span>
            </div>
          ) : null}
        </div>
        <div className="goalQuickAddRow">
          <input
            className="textInput"
            value={newGoalTitle}
            onChange={(e) => onNewGoalTitleChange(e.target.value)}
            placeholder="What's your next goal?"
            onKeyDown={(e) => {
              if (e.key === "Enter" && newGoalTitle.trim()) {
                e.preventDefault();
                onCreateGoal();
              }
            }}
          />
          <button type="button" className="primaryButton" onClick={onCreateGoal} disabled={!newGoalTitle.trim()}>
            Add goal
          </button>
        </div>
      </article>

      {/* Branch overview OR drilled-down goal list */}
      {!selectedBranch ? (
        <GoalBranchesView
          goals={goals}
          onSelectBranch={(branchId) => { setSelectedBranch(branchId); setExpandedId(null); }}
          onSelectGoal={(branchId, goalId) => { setSelectedBranch(branchId); setExpandedId(goalId); }}
        />
      ) : (
        <div className="goalAccordionList">
          {branchGoals.length === 0 ? (
            <article className="cardShell">
              <div className="emptyHint">
                <p>No goals in {activeBranch.label} yet.</p>
                <p className="subtle">Add a goal above — it will be auto-categorized here.</p>
              </div>
            </article>
          ) : (
            branchGoals.map((goal) => (
              <GoalAccordion
                key={goal.id}
                goal={goal}
                goals={branchGoals}
                expanded={expandedId === goal.id}
                onToggle={() => toggleGoal(goal.id)}
                onEditGoal={onEditGoal}
                onArchiveGoal={onArchiveGoal}
                onDeleteGoal={onDeleteGoal}
                onAddTask={onAddTask}
                onOpenTask={onOpenTask}
                onToggleTaskDone={onToggleTaskDone}
                onDeleteTask={onDeleteTask}
                onSnoozeTask={onSnoozeTask}
                onMoveTask={onMoveTask}
                onChangeBranch={onChangeBranch}
              />
            ))
          )}
        </div>
      )}
    </section>
  );
}
