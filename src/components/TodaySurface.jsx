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

function streakLabel(days) {
  if (days >= 7) return "On fire";
  if (days >= 3) return "Building";
  return "";
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
  weeklyMomentum,
  executionMetrics,
  atRiskTasks,
  procrastinationSignals,
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

  const totalFocusMinutes = allTasks.reduce((s, t) => s + (t.estimatedMinutes || 30), 0);
  const chronicallyAvoided = allTasks.filter((t) => Number(t.rescheduleCount || 0) >= 3);

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

      {/* Weekly Momentum Banner */}
      {weeklyMomentum && (
        <article className="cardShell todayMomentumBanner">
          <div className="momentumRow">
            <div className="momentumStat">
              <strong>{weeklyMomentum.completedThisWeek}</strong>
              <span>done this week</span>
            </div>
            <div className="momentumStat">
              <strong>{weeklyMomentum.deepWorkHours}h</strong>
              <span>deep work</span>
            </div>
            <div className="momentumStat">
              <strong>{weeklyMomentum.goalsAdvanced}</strong>
              <span>goals moved</span>
            </div>
            {executionMetrics?.recurringConsistency != null && (
              <div className="momentumStat">
                <strong>{Math.round(executionMetrics.recurringConsistency * 100)}%</strong>
                <span>habit rate</span>
              </div>
            )}
          </div>
          {weeklyMomentum.insight && (
            <p className="momentumInsight">{weeklyMomentum.insight}</p>
          )}
        </article>
      )}

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
        {totalFocusMinutes > 0 && (
          <div className="todayStat">
            <strong>{totalFocusMinutes}m</strong>
            <span>focus needed</span>
          </div>
        )}
      </article>

      {/* Avoidance Alerts */}
      {chronicallyAvoided.length > 0 && (
        <article className="cardShell todayAvoidanceCard">
          <h3>You keep pushing these</h3>
          {chronicallyAvoided.slice(0, 3).map((task) => (
            <div key={task.id} className="avoidanceRow">
              <div className="avoidanceInfo">
                <button
                  type="button"
                  className="avoidanceTitle"
                  onClick={() => onOpenTask(task.goalId, task.id)}
                >
                  {task.title}
                </button>
                <span className="avoidanceCount">postponed {task.rescheduleCount}x</span>
              </div>
              <div className="avoidanceActions">
                <button type="button" className="ghostButton mini accent" onClick={() => onStartNow(task)}>
                  10 min now
                </button>
              </div>
            </div>
          ))}
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
            {allTasks.slice(0, 5).map((task, index) => {
              const postponed = Number(task.rescheduleCount || 0);
              return (
                <div key={task.id} className={`todayTaskRow${postponed >= 3 ? " taskAvoided" : ""}`}>
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
                      {postponed >= 2 && (
                        <span className="todayTaskPostponed">pushed {postponed}x</span>
                      )}
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
              );
            })}
          </div>
        )}
      </article>

      {/* Procrastination Signals */}
      {procrastinationSignals?.length > 0 && (
        <article className="cardShell todaySignalsCard">
          <h3>Patterns detected</h3>
          {procrastinationSignals.slice(0, 2).map((signal, i) => (
            <div key={signal.id || i} className="signalItem">
              <p className="signalText">{signal.message || signal}</p>
              {signal.action && <p className="signalAction">{signal.action}</p>}
            </div>
          ))}
        </article>
      )}
    </section>
  );
}
