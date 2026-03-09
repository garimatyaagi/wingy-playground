export default function WeeklyMomentumPanel({ momentum, executionMetrics }) {
  return (
    <section className="cardShell momentumPanel">
      <div className="sectionHeader">
        <div>
          <h2>Weekly Momentum</h2>
          <p>Only metrics that drive decisions this week.</p>
        </div>
      </div>

      <div className="momentumGrid">
        <div className="metricCard">
          <span>Completed</span>
          <strong>{momentum.completedThisWeek}</strong>
        </div>
        <div className="metricCard">
          <span>Promises kept</span>
          <strong>
            {executionMetrics.promisesKept}/{executionMetrics.promisesTotal}
          </strong>
        </div>
        <div className="metricCard">
          <span>Deep work hours</span>
          <strong>{momentum.deepWorkHours}</strong>
        </div>
        <div className="metricCard">
          <span>Goals advanced</span>
          <strong>{momentum.goalsAdvanced}</strong>
        </div>
        <div className="metricCard">
          <span>Overdue</span>
          <strong>{momentum.overdue}</strong>
        </div>
        <div className="metricCard">
          <span>Top-priority completion</span>
          <strong>{executionMetrics.topPriorityCompletionRate}%</strong>
        </div>
        <div className="metricCard">
          <span>Execution score</span>
          <strong>{executionMetrics.executionScore}</strong>
        </div>
      </div>

      <div className="momentumInsight">{momentum.insight}</div>
    </section>
  );
}
