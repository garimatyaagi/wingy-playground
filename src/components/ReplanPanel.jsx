export default function ReplanPanel({ proposal, onGenerate, onApply, onOpenTask }) {
  return (
    <section className="cardShell replanPanel">
      <div className="sectionHeader">
        <div>
          <h2>AI Replan</h2>
          <p>When you slip, the system protects critical work and rebalances the week.</p>
        </div>
        <button type="button" className="ghostButton" onClick={onGenerate}>
          Replan now
        </button>
      </div>

      {!proposal || !proposal.needed ? (
        <p className="subtle">{proposal?.summary || "No replan required yet."}</p>
      ) : (
        <>
          <p className="replanSummary">{proposal.summary}</p>
          <div className="replanAdjustments">
            {proposal.adjustments.map((adjustment) => (
              <article key={`${adjustment.action}-${adjustment.taskId}`} className="replanCard">
                <div>
                  <p className="replanTitle">{adjustment.title}</p>
                  <p className="subtle">{adjustment.reason}</p>
                </div>
                <div className="replanActions">
                  <button type="button" className="ghostButton mini" onClick={() => onOpenTask(null, adjustment.taskId)}>
                    Open
                  </button>
                  <button type="button" className="primaryButton mini" onClick={() => onApply(adjustment)}>
                    Apply
                  </button>
                </div>
              </article>
            ))}
          </div>
          {proposal.protectedTasks?.length ? (
            <p className="subtle">Protected priorities: {proposal.protectedTasks.map((task) => task.title).join(", ")}.</p>
          ) : null}
        </>
      )}
    </section>
  );
}
