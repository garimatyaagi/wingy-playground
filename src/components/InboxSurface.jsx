function prettyType(value) {
  return String(value || "unknown").replace(/_/g, " ");
}

function prettyTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
  } catch {
    return "";
  }
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
  const whatsappCaptures = captures.filter((item) => item.source === "whatsapp");
  const localCaptures = captures.filter((item) => item.source !== "whatsapp");
  const hasCaptures = whatsappCaptures.length > 0 || localCaptures.length > 0;

  return (
    <section className="inboxSurface">
      <article className="cardShell inboxSimCard">
        <h2>Inbox</h2>
        <p className="subtle">Messages from WhatsApp and manual input appear here for review.</p>

        <textarea
          className="inboxSimInput"
          value={simulateText}
          onChange={(event) => onSimulateTextChange(event.target.value)}
          placeholder="Type or paste a message to process..."
        />
        <div className="inboxSimActions">
          <button type="button" className="primaryButton" onClick={onSimulate} disabled={!simulateText.trim() || processing}>
            {processing ? "Processing..." : "Process message"}
          </button>
        </div>
      </article>

      {pendingReview.length > 0 ? (
        <article className="cardShell reviewQueueCard">
          <h3>Needs review ({pendingReview.length})</h3>
          <div className="inboxCardList">
            {pendingReview.map((item) => (
              <div key={item.id} className="inboxCaptureCard review">
                <p className="captureText">{item.sourceText}</p>
                <p className="subtle">{item.followUpQuestion || "What should this become?"}</p>
                <div className="captureActions">
                  <button type="button" className="ghostButton mini" onClick={() => onStartEdit(item)}>
                    Edit
                  </button>
                  <button type="button" className="ghostButton mini" onClick={() => onReject(item.id)}>
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </article>
      ) : null}

      {!hasCaptures && pendingReview.length === 0 ? (
        <article className="cardShell">
          <div className="emptyHint">
            <p>No messages yet.</p>
            <p className="subtle">Send a WhatsApp message to your number, or type one above to test.</p>
          </div>
        </article>
      ) : null}

      {whatsappCaptures.length > 0 ? (
        <article className="cardShell capturesCard">
          <h3>WhatsApp ({whatsappCaptures.length})</h3>
          <div className="inboxCardList">
            {whatsappCaptures.map((item) => (
              <div key={item.id} className="inboxCaptureCard">
                <div className="captureTopRow">
                  <span className="captureType">{prettyType(item.parsedType)}</span>
                  <span className="subtle">{Math.round((item.confidence || 0) * 100)}%</span>
                </div>
                <p className="captureText">{item.sourceText}</p>
                <p className="subtle">
                  {item.previewTitle || "Processing..."}
                  {item.createdTaskIds?.length ? ` · ${item.createdTaskIds.length} task(s) created` : ""}
                  {item.updatedTaskIds?.length ? ` · ${item.updatedTaskIds.length} task(s) updated` : ""}
                </p>
                <p className="subtle">{prettyTime(item.createdAt)}</p>
              </div>
            ))}
          </div>
        </article>
      ) : null}

      {localCaptures.length > 0 ? (
        <article className="cardShell capturesCard">
          <h3>Manual ({localCaptures.length})</h3>
          <div className="inboxCardList">
            {localCaptures.map((item) => {
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
                      Dismiss
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </article>
      ) : null}
    </section>
  );
}
