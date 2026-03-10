function urgencyLabel(value) {
  if (value >= 5) return "Critical";
  if (value >= 4) return "High";
  if (value >= 3) return "Medium";
  return "Low";
}

export default function TodaySurface({
  dateLabel,
  agentStatus,
  topPriorities,
  nextTask,
  dueTodayCount,
  overdueCount,
  blockedCount,
  latestNudge,
  onOpenTask,
  onDone,
  onSnooze,
  onSplit,
  onReschedule,
  onStartNow,
  onStartSprint,
}) {
  const hasWork = topPriorities.length > 0 || nextTask;

  return (
    <section className="todaySurface">
      <article className="cardShell todayHero">
        <div>
          <h2>{dateLabel}</h2>
        </div>
        <span className={`agentStatusPill ${String(agentStatus || "").toLowerCase().replace(/\s+/g, "-")}`}>
          {agentStatus}
        </span>
      </article>

      <article className="cardShell topPriorityCard">
        <h3>Top priorities</h3>

        {topPriorities.length === 0 ? (
          <div className="emptyHint">
            <p>No priorities yet for today.</p>
            <p className="subtle">Add tasks to your goals and they'll appear here ranked by urgency.</p>
          </div>
        ) : (
          <div className="priorityListClean">
            {topPriorities.slice(0, 3).map((task, index) => (
              <div key={task.id} className="priorityCleanRow">
                <div>
                  <button type="button" className="textLink strong" onClick={() => onOpenTask(task.goalId, task.id)}>
                    {index + 1}. {task.title}
                  </button>
                  <p className="subtle">
                    {task.goalTitle} · {task.estimatedMinutes} min · {urgencyLabel(task.urgency)}
                  </p>
                </div>
                <div className="priorityRowActions">
                  <button type="button" className="ghostButton mini" onClick={() => onDone(task)}>
                    Done
                  </button>
                  <button type="button" className="ghostButton mini" onClick={() => onSnooze(task)}>
                    Snooze
                  </button>
                  <button type="button" className="ghostButton mini" onClick={() => onReschedule(task)}>
                    Move
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </article>

      <article className="cardShell nextActionCardClean">
        <h3>Next action</h3>

        {nextTask ? (
          <>
            <button
              type="button"
              className="focusTaskButton nextActionTitle"
              onClick={() => onOpenTask(nextTask.goalId, nextTask.id)}
            >
              {nextTask.title}
            </button>
            <p className="subtle">{nextTask.goalTitle} · {nextTask.estimatedMinutes} min</p>
            <p className="nextActionWhy">{nextTask.why || "Highest impact task for today."}</p>
            <div className="nextActionButtons">
              <button type="button" className="primaryButton" onClick={() => onStartNow(nextTask)}>
                Start now
              </button>
              <button type="button" className="ghostButton" onClick={() => onStartSprint(nextTask)}>
                15 min sprint
              </button>
            </div>
          </>
        ) : (
          <div className="emptyHint">
            <p>Nothing queued up yet.</p>
            <p className="subtle">Once you have tasks with due dates, your next action will appear here.</p>
          </div>
        )}
      </article>

      {hasWork ? (
        <article className="cardShell dueStripCard">
          <div className="dueStrip">
            <div>
              <span>Due today</span>
              <strong>{dueTodayCount}</strong>
            </div>
            <div>
              <span>Overdue</span>
              <strong>{overdueCount}</strong>
            </div>
            <div>
              <span>Blocked</span>
              <strong>{blockedCount}</strong>
            </div>
          </div>
        </article>
      ) : null}

      {latestNudge ? (
        <article className="cardShell latestNoteCard">
          <h3>Latest note</h3>
          <p>{latestNudge}</p>
        </article>
      ) : null}
    </section>
  );
}
