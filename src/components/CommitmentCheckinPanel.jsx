export default function CommitmentCheckinPanel({
  checkin,
  onChange,
  onGeneratePlan,
  onCommit,
  committedCount,
}) {
  return (
    <section className="cardShell commitmentPanel">
      <div className="sectionHeader">
        <div>
          <h2>Commitment Check-In</h2>
          <p>Set your working boundaries. Then commit to what must be done.</p>
        </div>
        <p className="subtle">Committed today: {committedCount}</p>
      </div>

      <div className="commitmentGrid">
        <label>
          <span className="inputLabel">Working hours today</span>
          <input
            className="textInput"
            placeholder="e.g. 10:00-18:00"
            value={checkin.workingHours}
            onChange={(event) => onChange("workingHours", event.target.value)}
          />
        </label>
        <label>
          <span className="inputLabel">What counts as a win today?</span>
          <input
            className="textInput"
            placeholder="One sentence outcome"
            value={checkin.winDefinition}
            onChange={(event) => onChange("winDefinition", event.target.value)}
          />
        </label>
        <label>
          <span className="inputLabel">Task I might avoid</span>
          <input
            className="textInput"
            placeholder="Name the task"
            value={checkin.avoidTask}
            onChange={(event) => onChange("avoidTask", event.target.value)}
          />
        </label>
        <label>
          <span className="inputLabel">Non-negotiable</span>
          <input
            className="textInput"
            placeholder="Must complete today"
            value={checkin.nonNegotiable}
            onChange={(event) => onChange("nonNegotiable", event.target.value)}
          />
        </label>
      </div>

      <div className="commitmentActions">
        <button type="button" className="ghostButton" onClick={onGeneratePlan}>
          Generate realistic day plan
        </button>
        <button type="button" className="primaryButton" onClick={onCommit}>
          Commit to top priorities
        </button>
      </div>
    </section>
  );
}
