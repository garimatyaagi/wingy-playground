function urgencyLabel(level) {
  if (level >= 5) return "Critical";
  if (level >= 4) return "High";
  if (level >= 3) return "Medium";
  return "Low";
}

export default function TodayFocusPanel({
  priorities,
  onOpenTask,
  onStartNextTask,
  quickWins,
  atRisk,
  recurringDueToday,
  oneTimeToday,
}) {
  const nextTask = priorities[0] || null;

  return (
    <section className="cardShell focusPanel">
      <div className="sectionHeader">
        <div>
          <h2>Today Focus</h2>
          <p>Top priorities chosen for completion impact, not task count.</p>
        </div>
        <button
          type="button"
          className="primaryButton"
          disabled={!nextTask}
          onClick={() => {
            if (!nextTask) return;
            onStartNextTask(nextTask);
          }}
        >
          Start next task
        </button>
      </div>

      <div className="focusPriorityGrid">
        {priorities.length === 0 ? (
          <div className="emptyState">
            No actionable priorities yet. Add tasks from the intake box below.
          </div>
        ) : (
          priorities.map((task, index) => (
            <article key={task.id} className="focusPriorityCard">
              <div className="focusPriorityTop">
                <span className="focusRank">#{index + 1}</span>
                <span className="focusUrgency">{urgencyLabel(task.urgency)}</span>
              </div>
              <button
                type="button"
                className="focusTaskButton"
                onClick={() => onOpenTask(task.goalId, task.id)}
              >
                {task.title}
              </button>
              <p className="focusMeta">
                {task.goalTitle} · {task.estimatedMinutes} min · {task.effortType.replace("_", " ")}
              </p>
              <p className="focusReason">{task.why}</p>
            </article>
          ))
        )}
      </div>

      <div className="focusBottomRow">
        <div>
          <h3>Recurring due today</h3>
          {recurringDueToday.length === 0 ? (
            <p className="subtle">No recurring obligations due today.</p>
          ) : (
            <ul>
              {recurringDueToday.map((task) => (
                <li key={task.id}>
                  <button type="button" className="textLink" onClick={() => onOpenTask(task.goalId, task.id)}>
                    {task.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3>One-time selected for today</h3>
          {oneTimeToday.length === 0 ? (
            <p className="subtle">No one-time tasks selected for today.</p>
          ) : (
            <ul>
              {oneTimeToday.map((task) => (
                <li key={task.id}>
                  <button type="button" className="textLink" onClick={() => onOpenTask(task.goalId, task.id)}>
                    {task.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="focusBottomRow">
        <div>
          <h3>Quick wins</h3>
          {quickWins.length === 0 ? (
            <p className="subtle">None right now.</p>
          ) : (
            <ul>
              {quickWins.map((task) => (
                <li key={task.id}>
                  <button type="button" className="textLink" onClick={() => onOpenTask(task.goalId, task.id)}>
                    {task.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3>At-risk this week</h3>
          {atRisk.length === 0 ? (
            <p className="subtle">No slipping items detected.</p>
          ) : (
            <ul>
              {atRisk.map((task) => (
                <li key={task.id}>
                  <button type="button" className="textLink" onClick={() => onOpenTask(task.goalId, task.id)}>
                    {task.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
