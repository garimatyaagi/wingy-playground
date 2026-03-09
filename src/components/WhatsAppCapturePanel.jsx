function kindLabel(kind) {
  if (kind === "goal") return "Goal";
  if (kind === "one_time_task") return "One-time task";
  if (kind === "recurring_task") return "Recurring task";
  if (kind === "note") return "Note";
  return "Needs follow-up";
}

export default function WhatsAppCapturePanel({
  draft,
  onDraftChange,
  onProcess,
  onApply,
  processing,
  preview,
  messageFeed,
}) {
  return (
    <section className="cardShell whatsappCapturePanel">
      <div className="sectionHeader">
        <div>
          <h2>WhatsApp Capture</h2>
          <p>Primary intake channel. Send free-form text, agent structures it into execution objects.</p>
        </div>
      </div>

      <textarea
        className="intakeTextarea"
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        placeholder="Type exactly what you would send on WhatsApp..."
      />

      <div className="intakeActions">
        <button type="button" className="ghostButton" disabled={!draft.trim() || processing} onClick={onProcess}>
          {processing ? "Processing..." : "Process message"}
        </button>
        <button
          type="button"
          className="primaryButton"
          disabled={!preview || preview.kind === "ambiguous" || processing}
          onClick={onApply}
        >
          Apply to system
        </button>
      </div>

      {preview ? (
        <article className="whatsPreviewCard">
          <div className="whatsPreviewTop">
            <span className="previewKind previewKindtask">{kindLabel(preview.kind)}</span>
            <span className="subtle">Confidence {Math.round((preview.confidence || 0) * 100)}%</span>
          </div>

          {preview.kind === "goal" ? (
            <p><strong>{preview.goal?.title}</strong></p>
          ) : null}

          {preview.kind === "one_time_task" || preview.kind === "recurring_task" ? (
            <>
              <p><strong>{preview.task?.title}</strong></p>
              <p className="subtle">
                {preview.task?.goalName || "General"} · {preview.task?.estimatedMinutes || 30} min · {preview.task?.effortType || "deep_work"}
              </p>
            </>
          ) : null}

          {preview.kind === "note" ? <p>{preview.note?.text}</p> : null}

          {preview.kind === "ambiguous" ? (
            <p className="subtle">Follow-up: {preview.followUpQuestion || "Could you clarify this message?"}</p>
          ) : null}
        </article>
      ) : null}

      <div className="whatsFeed">
        <h3>Recent incoming messages</h3>
        {messageFeed.length === 0 ? (
          <p className="subtle">No messages captured yet.</p>
        ) : (
          <div className="feedList">
            {messageFeed.slice(0, 6).map((item) => (
              <article key={item.id} className="feedItem">
                <span className="feedTag">{item.kind || "captured"}</span>
                <div>
                  <p className="feedTitle">{item.text}</p>
                  <p className="subtle">{item.status || "processed"}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
