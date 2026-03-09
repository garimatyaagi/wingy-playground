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
  return (
    <section className="todaySurface">
      <article className="cardShell todayHero">
        <div>
          <p className="eyebrow">Today</p>
          <h2>{dateLabel}</h2>
        </div>
        <span className={`agentStatusPill ${String(agentStatus || "").toLowerCase().replace(/\s+/g, "-")}`}>
          {agentStatus}
        </span>
      </article>

      <article className="cardShell topPriorityCard">
        <div className="sectionHeader">
          <div>
            <h3>Top priorities</h3>
            <p>Only the three tasks that matter most today.</p>
          </div>
        </div>

        {topPriorities.length === 0 ? (
          <p className="subtle">No priorities selected yet.</p>
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
                  <button type="button" className="ghostButton mini" onClick={() => onSplit(task)}>
                    Split
                  </button>
                  <button type="button" className="ghostButton mini" onClick={() => onReschedule(task)}>
                    Reschedule
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </article>

      <article className="cardShell nextActionCardClean">
        <div className="sectionHeader">
          <div>
            <h3>Next action</h3>
            <p>Start this now to protect today's execution.</p>
          </div>
        </div>

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
          <p className="subtle">No next action available.</p>
        )}
      </article>

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

      <article className="cardShell latestNoteCard">
        <h3>Latest agent note</h3>
        <p>{latestNudge}</p>
      </article>
    </section>
  );
}
