function riskLabel(risk) {
  if (risk === "overdue") return "Overdue";
  if (risk === "high") return "High risk";
  if (risk === "medium") return "Medium risk";
  return "Normal";
}

export default function CommandCenterPanel({
  commandCenter,
  tone,
  onToneChange,
  onOpenTask,
  onStartNow,
  onStartSprint,
  onSmartReschedule,
}) {
  const priorities = commandCenter?.topPriorities || [];
  const nextTask = commandCenter?.nextTask || null;

  return (
    <section className="cardShell commandCenterPanel">
      <div className="sectionHeader">
        <div>
          <h2>Today's Command Center</h2>
          <p>Do this now. Everything else is secondary.</p>
        </div>
        <div className="toneSwitch" role="group" aria-label="Accountability tone">
          {["gentle", "firm", "ruthless"].map((mode) => (
            <button
              key={mode}
              type="button"
              className={tone === mode ? "ghostButton mini active" : "ghostButton mini"}
              onClick={() => onToneChange(mode)}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {nextTask ? (
        <div className="nextTaskCard">
          <div>
            <p className="eyebrow">Next best task</p>
            <button
              type="button"
              className="focusTaskButton commandTitle"
              onClick={() => onOpenTask(nextTask.goalId, nextTask.id)}
            >
              {nextTask.title}
            </button>
            <p className="commandMeta">
              {nextTask.goalTitle} · {nextTask.estimatedMinutes} min · {nextTask.effortType.replace("_", " ")}
            </p>
            <p className="commandReason">{nextTask.why || "Strategic and time-sensitive."}</p>
            <p className="commandConsequence">
              If delayed: {commandCenter?.whatSuffers?.length ? commandCenter.whatSuffers.join(", ") : "downstream priorities slip"}.
            </p>
          </div>
          <div className="commandActions">
            <button type="button" className="primaryButton" onClick={() => onStartNow(nextTask)}>
              Start now
            </button>
            <button type="button" className="ghostButton" onClick={() => onStartSprint(nextTask)}>
              Start {nextTask.startSprintMinutes} min sprint
            </button>
            <button type="button" className="ghostButton" onClick={() => onSmartReschedule(nextTask)}>
              Reschedule intelligently
            </button>
          </div>
        </div>
      ) : (
        <div className="emptyState">No actionable tasks yet. Use Quick Capture to load work, then commit top priorities.</div>
      )}

      <div className="priorityRow">
        {priorities.map((task, index) => (
          <article key={task.id} className="priorityMiniCard">
            <div className="priorityMiniTop">
              <span>#{index + 1}</span>
              <span className={`riskPill ${task.dueRisk || "normal"}`}>{riskLabel(task.dueRisk)}</span>
            </div>
            <button type="button" className="textLink strong" onClick={() => onOpenTask(task.goalId, task.id)}>
              {task.title}
            </button>
            <p className="subtle">{task.estimatedMinutes} min · unlocks {task.unlockImpact || 0} points</p>
          </article>
        ))}
      </div>
    </section>
  );
}
