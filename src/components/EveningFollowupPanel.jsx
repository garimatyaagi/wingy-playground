import { SKIP_REASON_OPTIONS } from "../lib/agentLoop";

export default function EveningFollowupPanel({
  items,
  onCreate,
  onChangeStatus,
  onChangeReason,
  onChangeNote,
  onSubmit,
  submitting,
  summary,
}) {
  return (
    <section className="cardShell eveningPanel">
      <div className="sectionHeader">
        <div>
          <h2>Evening Follow-Up</h2>
          <p>Mark each committed task: done, partial, or skipped. Skips require a reason.</p>
        </div>
        <button type="button" className="ghostButton" onClick={onCreate}>
          Prepare check-in
        </button>
      </div>

      {items.length === 0 ? (
        <p className="subtle">No check-in template yet. Click “Prepare check-in”.</p>
      ) : (
        <div className="checkinList">
          {items.map((item) => (
            <article key={item.id} className="checkinCard">
              <p className="checkinTitle">{item.title}</p>
              <div className="checkinControls">
                <select
                  className="select"
                  value={item.status}
                  onChange={(event) => onChangeStatus(item.taskId, event.target.value)}
                >
                  <option value="done">done</option>
                  <option value="partial">partial</option>
                  <option value="skipped">skipped</option>
                </select>

                {item.status === "skipped" ? (
                  <select
                    className="select"
                    value={item.skipReason || ""}
                    onChange={(event) => onChangeReason(item.taskId, event.target.value)}
                  >
                    <option value="">Reason</option>
                    {SKIP_REASON_OPTIONS.map((reason) => (
                      <option key={reason} value={reason}>
                        {reason}
                      </option>
                    ))}
                  </select>
                ) : null}

                <input
                  className="textInput"
                  value={item.note || ""}
                  onChange={(event) => onChangeNote(item.taskId, event.target.value)}
                  placeholder="Proof / update"
                />
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="briefActions">
        <button
          type="button"
          className="primaryButton"
          disabled={items.length === 0 || submitting}
          onClick={onSubmit}
        >
          {submitting ? "Submitting..." : "Submit check-in + auto-replan"}
        </button>
      </div>

      {summary ? <p className="momentumInsight">{summary}</p> : null}
    </section>
  );
}
