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

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function timeContextLine(totalMinutes) {
  const hour = new Date().getHours();
  if (totalMinutes <= 0) return null;
  if (hour >= 21) return `${totalMinutes} min total \u00b7 pick 1 for tonight, move the rest`;
  if (hour >= 17) return `${totalMinutes} min total \u00b7 fits in your evening`;
  if (hour >= 12) return `${totalMinutes} min total \u00b7 plenty of afternoon left`;
  return `${totalMinutes} min total \u00b7 solid morning ahead`;
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
  weeklyMomentum,
  executionMetrics,
  atRiskTasks,
  procrastinationSignals,
}) {
  const now = new Date();
  const weekday = WEEKDAYS[now.getDay()];
  const month = MONTHS[now.getMonth()];
  const dayNum = now.getDate();

  const allTasks = [...topPriorities];
  if (nextTask && !allTasks.find((t) => t.id === nextTask.id)) {
    allTasks.push(nextTask);
  }

  const totalFocusMinutes = allTasks.reduce((s, t) => s + (t.estimatedMinutes || 30), 0);
  const chronicallyAvoided = allTasks.filter((t) => Number(t.rescheduleCount || 0) >= 3);

  // Determine if urgency badges add value (2+ distinct levels visible)
  const visibleTasks = allTasks.slice(0, 5);
  const urgencyLevels = new Set(visibleTasks.map((t) => urgencyLabel(t.urgency)));
  const showUrgency = urgencyLevels.size >= 2;

  // Momentum: only show when there's actual progress
  const hasProgress = weeklyMomentum && (
    weeklyMomentum.completedThisWeek > 0 ||
    weeklyMomentum.deepWorkHours > 0 ||
    weeklyMomentum.goalsAdvanced > 0
  );
  const habitRate = executionMetrics?.recurringConsistency != null
    ? Math.round(executionMetrics.recurringConsistency * 100)
    : null;

  // Build inline stats summary
  const statParts = [];
  if (dueTodayCount > 0) statParts.push(`${dueTodayCount} due`);
  if (overdueCount > 0) statParts.push(`${overdueCount} overdue`);
  if (blockedCount > 0) statParts.push(`${blockedCount} blocked`);
  if (totalFocusMinutes > 0) statParts.push(`${totalFocusMinutes}m`);
  const statsSummary = statParts.join(" \u00b7 ");

  // Show at most 1 behavioral nudge
  const showAvoidance = chronicallyAvoided.length > 0;
  const showSignals = !showAvoidance && procrastinationSignals?.length > 0;

  // Split tasks: first = "up next", rest = "also today"
  const upNext = visibleTasks[0] || null;
  const alsoToday = visibleTasks.slice(1);

  const timeCtx = timeContextLine(totalFocusMinutes);

  return (
    <section className="todaySurface">
      {/* ─── Unified greeting ─── */}
      <div className="todayGreetingBlock">
        <div className="todayGreetingLeft">
          <h2 className="todayGreeting">{getGreeting()}</h2>
          <p className="todayFullDate">{weekday}, {month} {dayNum}</p>
        </div>
        {statsSummary && (
          <span className="todayInlineStats">{statsSummary}</span>
        )}
      </div>

      {/* ─── Momentum (only when there's progress) ─── */}
      {hasProgress && (
        <p className="todayMomentumLine">
          {weeklyMomentum.completedThisWeek > 0 && (
            <span>{weeklyMomentum.completedThisWeek} done this week</span>
          )}
          {weeklyMomentum.deepWorkHours > 0 && (
            <span>{weeklyMomentum.deepWorkHours}h deep work</span>
          )}
          {weeklyMomentum.goalsAdvanced > 0 && (
            <span>{weeklyMomentum.goalsAdvanced} goal{weeklyMomentum.goalsAdvanced !== 1 ? "s" : ""} moved</span>
          )}
          {habitRate > 0 && (
            <span>{habitRate}% habits</span>
          )}
        </p>
      )}

      {/* ─── Fresh week prompt (all zeros) ─── */}
      {weeklyMomentum && !hasProgress && allTasks.length > 0 && (
        <p className="todayFreshWeek">Fresh week. Start with one.</p>
      )}

      {/* ─── Actionable insight ─── */}
      {weeklyMomentum?.insight && (
        <div className="todayInsightNudge">
          <p>{weeklyMomentum.insight}</p>
        </div>
      )}

      {/* ─── Avoidance alert (max 1 nudge type) ─── */}
      {showAvoidance && (
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

      {/* ─── Priorities ─── */}
      <article className="cardShell todayPrioritiesCard">
        {allTasks.length === 0 ? (
          <div className="emptyHint">
            <p>Nothing on deck for today.</p>
            <p className="subtle">Add tasks with due dates and they'll show up here.</p>
          </div>
        ) : (
          <>
            {/* Up Next — elevated primary task */}
            {upNext && (
              <div className="todayUpNext">
                <span className="todayUpNextLabel">Up next</span>
                <div className={`todayUpNextRow${Number(upNext.rescheduleCount || 0) >= 3 ? " taskAvoided" : ""}`}>
                  <button
                    type="button"
                    className="todayTaskCheck"
                    onClick={() => onDone(upNext)}
                    aria-label="Mark done"
                  >
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                      <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                  </button>
                  <div className="todayUpNextContent">
                    <button
                      type="button"
                      className="todayUpNextTitle"
                      onClick={() => onOpenTask(upNext.goalId, upNext.id)}
                    >
                      {upNext.title}
                    </button>
                    <div className="todayTaskMeta">
                      {upNext.goalTitle && <span className="todayTaskGoal">{upNext.goalTitle}</span>}
                      {upNext.estimatedMinutes && <span>{upNext.estimatedMinutes}m</span>}
                      {showUrgency && (
                        <span className={`todayTaskUrgency ${urgencyColor(upNext.urgency)}`}>
                          {urgencyLabel(upNext.urgency)}
                        </span>
                      )}
                    </div>
                  </div>
                  <button type="button" className="primaryButton mini" onClick={() => onStartNow(upNext)}>
                    Start
                  </button>
                </div>
              </div>
            )}

            {/* Also today — secondary tasks */}
            {alsoToday.length > 0 && (
              <div className="todayAlsoToday">
                <span className="todayAlsoLabel">Also today</span>
                <div className="todayTaskList">
                  {alsoToday.map((task) => {
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
                            {task.goalTitle && <span className="todayTaskGoal">{task.goalTitle}</span>}
                            {task.estimatedMinutes && <span>{task.estimatedMinutes}m</span>}
                            {showUrgency && (
                              <span className={`todayTaskUrgency ${urgencyColor(task.urgency)}`}>
                                {urgencyLabel(task.urgency)}
                              </span>
                            )}
                            {postponed >= 2 && (
                              <span className="todayTaskPostponed">pushed {postponed}x</span>
                            )}
                          </div>
                        </div>
                        <button type="button" className="ghostButton mini" onClick={() => onSnooze(task)}>
                          Later
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Time context */}
            {timeCtx && (
              <p className="todayTimeContext">{timeCtx}</p>
            )}
          </>
        )}
      </article>

      {/* ─── Procrastination signals (only if no avoidance card shown) ─── */}
      {showSignals && (
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
