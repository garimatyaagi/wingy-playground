function prettyType(value) {
  return String(value || "unknown").replace(/_/g, " ");
}

export default function InboxSurface({
  simulateText,
  onSimulateTextChange,
  onSimulate,
  processing,
  captures,
  editingId,
  editDraft,
  onStartEdit,
  onEditDraftChange,
  onApprove,
  onReject,
  onCancelEdit,
}) {
  const pendingReview = captures.filter((item) => item.requiresReview && item.status === "pending");

  return (
    <section className="inboxSurface">
      <article className="cardShell inboxSimCard">
        <div className="sectionHeader">
          <div>
            <h2>Inbox</h2>
            <p>Review captured WhatsApp messages and approve only what belongs in execution.</p>
          </div>
        </div>

        <textarea
          className="inboxSimInput"
          value={simulateText}
          onChange={(event) => onSimulateTextChange(event.target.value)}
          placeholder="Simulate incoming WhatsApp message for testing"
        />
        <div className="inboxSimActions">
          <button type="button" className="primaryButton" onClick={onSimulate} disabled={!simulateText.trim() || processing}>
            {processing ? "Processing..." : "Process message"}
          </button>
        </div>
      </article>

      <article className="cardShell reviewQueueCard">
        <h3>Needs review ({pendingReview.length})</h3>
        {pendingReview.length === 0 ? (
          <p className="subtle">No low-confidence items right now.</p>
        ) : (
          <div className="inboxCardList">
            {pendingReview.map((item) => (
              <div key={item.id} className="inboxCaptureCard review">
                <p className="captureText">{item.sourceText}</p>
                <p className="subtle">Follow-up: {item.followUpQuestion || "Clarify the action."}</p>
                <div className="captureActions">
                  <button type="button" className="ghostButton mini" onClick={() => onStartEdit(item)}>
                    Edit
                  </button>
                  <button type="button" className="ghostButton mini" onClick={() => onReject(item.id)}>
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </article>

      <article className="cardShell capturesCard">
        <h3>Recent WhatsApp captures</h3>
        {captures.length === 0 ? (
          <p className="subtle">No captured messages yet.</p>
        ) : (
          <div className="inboxCardList">
            {captures.map((item) => {
              const editing = editingId === item.id;
              return (
                <div key={item.id} className="inboxCaptureCard">
                  <div className="captureTopRow">
                    <span className="captureType">{prettyType(item.parsedType)}</span>
                    <span className="subtle">{Math.round((item.confidence || 0) * 100)}%</span>
                  </div>

                  <p className="captureText">{item.sourceText}</p>

                  {editing ? (
                    <div className="captureEditBox">
                      <input
                        className="textInput"
                        value={editDraft.title || ""}
                        onChange={(event) => onEditDraftChange("title", event.target.value)}
                        placeholder="Edit title"
                      />
                      <input
                        className="textInput"
                        value={editDraft.goalName || ""}
                        onChange={(event) => onEditDraftChange("goalName", event.target.value)}
                        placeholder="Goal name"
                      />
                    </div>
                  ) : (
                    <p className="subtle">
                      {item.previewTitle ? `Parsed: ${item.previewTitle}` : "Awaiting review"}
                    </p>
                  )}

                  <div className="captureActions">
                    <button type="button" className="primaryButton mini" onClick={() => onApprove(item.id)}>
                      Approve
                    </button>
                    <button
                      type="button"
                      className="ghostButton mini"
                      onClick={() => (editing ? onCancelEdit() : onStartEdit(item))}
                    >
                      {editing ? "Cancel" : "Edit"}
                    </button>
                    <button type="button" className="ghostButton mini" onClick={() => onReject(item.id)}>
                      Reject
                    </button>
                  </div>

                  <p className="subtle">Status: {item.status}</p>
                </div>
              );
            })}
          </div>
        )}
      </article>
    </section>
  );
}
