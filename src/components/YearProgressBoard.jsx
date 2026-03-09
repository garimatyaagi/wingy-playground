const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

export default function YearProgressBoard({ snapshot }) {
  const maxMonthly = Math.max(1, ...snapshot.monthlyCompletions);

  return (
    <section className="cardShell yearBoard">
      <div className="sectionHeader">
        <div>
          <h2>Year Snapshot</h2>
          <p>Progress across goals, recurring consistency, and yearly pacing.</p>
        </div>
      </div>

      <div className="yearStatsGrid">
        <div className="metricCard">
          <span>Total goals</span>
          <strong>{snapshot.totalGoals}</strong>
        </div>
        <div className="metricCard">
          <span>Active goals</span>
          <strong>{snapshot.activeGoals}</strong>
        </div>
        <div className="metricCard">
          <span>Completed goals</span>
          <strong>{snapshot.completedGoals}</strong>
        </div>
        <div className="metricCard">
          <span>One-time completed</span>
          <strong>
            {snapshot.oneTimeCompleted}/{snapshot.oneTimeTotal}
          </strong>
        </div>
        <div className="metricCard">
          <span>Recurring consistency</span>
          <strong>{snapshot.recurringCompletionRate}%</strong>
        </div>
        <div className="metricCard">
          <span>Execution score</span>
          <strong>{snapshot.executionScore}</strong>
        </div>
        <div className="metricCard">
          <span>Recurring streak</span>
          <strong>{snapshot.recurringStreak} days</strong>
        </div>
        <div className="metricCard">
          <span>Total hours</span>
          <strong>{snapshot.totalHoursSpent}</strong>
        </div>
        <div className="metricCard">
          <span>At-risk goals</span>
          <strong>{snapshot.atRiskGoals.length}</strong>
        </div>
        <div className="metricCard">
          <span>Overdue load</span>
          <strong>{snapshot.overdueLoad}</strong>
        </div>
      </div>

      <div className="yearGoalProgressList">
        {snapshot.goalProgress.length === 0 ? (
          <p className="subtle">No goals to report yet.</p>
        ) : (
          snapshot.goalProgress.map((goal) => (
            <div key={goal.goalId} className="yearGoalProgressItem">
              <div className="yearGoalProgressTop">
                <strong>{goal.goalTitle}</strong>
                <span>{goal.progressPct}%</span>
              </div>
              <div className="goalProgressBar">
                <i style={{ width: `${goal.progressPct}%` }} />
              </div>
              <p className="subtle">
                {goal.oneTimeCompleted}/{goal.oneTimeTotal} one-time ·{" "}
                {goal.recurringCompleted}/{goal.recurringExpected} recurring · {goal.hours}h
              </p>
            </div>
          ))
        )}
      </div>

      <div className="monthlyTrend">
        <h3>Monthly completion trend</h3>
        <div className="monthlyBars">
          {snapshot.monthlyCompletions.map((count, index) => (
            <div key={`${MONTHS[index]}-${index}`} className="monthlyBarWrap">
              <div className="monthlyBarTrack">
                <i
                  className="monthlyBar"
                  style={{ height: `${Math.max(6, Math.round((count / maxMonthly) * 100))}%` }}
                />
              </div>
              <span>{MONTHS[index]}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
