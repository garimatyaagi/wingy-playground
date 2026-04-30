function urgencyLabel(value) {
  if (value >= 5) return "Critical";
  if (value >= 4) return "High";
  if (value >= 3) return "Medium";
  return "Low";
}

function urgencyColor(value) {
  if (value >= 5) return "urgCritical";
  if (value >= 4) return "urgHigh";
  if (value >= 3) return "urgMedium";
  return "urgLow";
}

function getTimeOfDay() {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

function getGreeting() {
  const tod = getTimeOfDay();
  if (tod === "morning") return "Good morning";
  if (tod === "afternoon") return "Good afternoon";
  return "Good evening";
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

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
  const now = new Date();
  const dayNum = now.getDate();
  const weekday = WEEKDAYS[now.getDay()];
  const month = MONTHS[now.getMonth()];
  const timeOfDay = getTimeOfDay();

  const allTasks = [...topPriorities];
  if (nextTask && !allTasks.find((t) => t.id === nextTask.id)) {
    allTasks.push(nextTask);
  }

  return (
    <section className="todaySurface">
      <article className="todayDateCard">
        <div className="todayDateLeft">
          <span className="todayDayNumber">{dayNum}</span>
        </div>
        <div className="todayDateRight">
          <p className="todayGreeting">{getGreeting()}</p>
          <p className="todayFullDate">{weekday}, {month} {dayNum}</p>
          <div className="todayTimeChip">
            <span className={`todayTimeDot ${timeOfDay}`} />
            <span>{timeOfDay.charAt(0).toUpperCase() + timeOfDay.slice(1)}</span>
          </div>
        </div>
      </article>

      {(dueTodayCount > 0 || overdueCount > 0 || blockedCount > 0) && (
        <article className="todayStatsRow">
          {dueTodayCount > 0 && (
            <div className="todayStat">
              <strong>{dueTodayCount}</strong>
              <span>due today</span>
            </div>
          )}
          {overdueCount > 0 && (
            <div className="todayStat overdue">
              <strong>{overdueCount}</strong>
              <span>overdue</span>
            </div>
          )}
          {blockedCount > 0 && (
            <div className="todayStat blocked">
              <strong>{blockedCount}</strong>
              <span>blocked</span>
            </div>
          )}
        </article>
      )}

      <article className="cardShell todayPrioritiesCard">
        <h3>Priorities</h3>

        {allTasks.length === 0 ? (
          <div className="emptyHint">
            <p>Nothing on deck for today.</p>
            <p className="subtle">Add tasks with due dates and they'll show up here.</p>
          </div>
        ) : (
          <div className="todayTaskList">
            {allTasks.slice(0, 5).map((task, index) => (
              <div key={task.id} className="todayTaskRow">
                <button
                  type="button"
                  className="todayTaskCheck"
                  onClick={() => onDone(task)}
                  aria-label="Mark done"
                >
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <circle cx="9" cy="9" r="8" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                </button>
                <div className="todayTaskContent">
                  <button
                    type="button"
                    className="todayTaskTitle"
                    onClick={() => onOpenTask(task.goalId, task.id)}
                  >
                    {task.title}
                  </button>
                  <div className="todayTaskMeta">
                    <span className="todayTaskGoal">{task.goalTitle}</span>
                    {task.estimatedMinutes && <span>{task.estimatedMinutes}m</span>}
                    <span className={`todayTaskUrgency ${urgencyColor(task.urgency)}`}>
                      {urgencyLabel(task.urgency)}
                    </span>
                  </div>
                </div>
                <div className="todayTaskActions">
                  <button type="button" className="ghostButton mini" onClick={() => onStartNow(task)}>
                    Start
                  </button>
                  <button type="button" className="ghostButton mini" onClick={() => onSnooze(task)}>
                    Later
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}
