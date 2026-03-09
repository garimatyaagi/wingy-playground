function kindLabel(kind) {
  if (kind === "note") return "Note";
  if (kind === "needs_review") return "Needs review";
  return "Task";
}

export default function TaskIntakePanel({
  rawText,
  onRawTextChange,
  onUpload,
  onParsePreview,
  previewItems,
  onToggleSelection,
  onGoalChange,
  goals,
  onApplyPreview,
  parsing,
  message,
}) {
  return (
    <section className="cardShell intakePanel">
      <div className="sectionHeader">
        <div>
          <h2>Inbox Intake</h2>
          <p>Paste messy input. AI cleans, splits, and flags low-confidence lines before adding.</p>
        </div>
      </div>

      <textarea
        className="intakeTextarea"
        value={rawText}
        onChange={(event) => onRawTextChange(event.target.value)}
        placeholder={`Paste tasks or notes here...
finish pitch deck and send it to Neha by Friday
I've been thinking of the falafel bowl I had...`}
      />

      <div className="intakeActions">
        <label className="ghostButton fileUploadButton">
          Upload text
          <input
            type="file"
            accept=".txt,text/plain"
            onChange={(event) => {
              onUpload(event.target.files?.[0] || null);
              event.target.value = "";
            }}
            style={{ display: "none" }}
          />
        </label>
        <button
          type="button"
          className="primaryButton"
          disabled={!rawText.trim() || parsing}
          onClick={onParsePreview}
        >
          {parsing ? "Parsing..." : "Preview with AI"}
        </button>
      </div>

      {message ? <p className="subtle">{message}</p> : null}

      {previewItems.length > 0 ? (
        <>
          <div className="previewHeader">
            <h3>Review before adding</h3>
            <button type="button" className="ghostButton mini" onClick={onApplyPreview}>
              Add selected
            </button>
          </div>
          <div className="previewList">
            {previewItems.map((item) => (
              <article key={item.id} className="previewItem">
                <label className="previewSelect">
                  <input
                    type="checkbox"
                    checked={item.selected}
                    onChange={(event) => onToggleSelection(item.id, event.target.checked)}
                  />
                  <span className={`previewKind previewKind${item.kind.replace("_", "")}`}>
                    {kindLabel(item.kind)}
                  </span>
                </label>
                <div className="previewMain">
                  <strong>{item.title}</strong>
                  {item.description ? <p>{item.description}</p> : null}
                  <div className="previewMeta">
                    <span>Conf {Math.round((item.confidence || 0) * 100)}%</span>
                    {item.estimatedMinutes ? <span>{item.estimatedMinutes} min</span> : null}
                    {item.taskType ? <span>{item.taskType.replace("_", " ")}</span> : null}
                    {item.isRecurring ? <span>recurring</span> : null}
                    {item.dueDate ? <span>Due {new Date(item.dueDate).toLocaleDateString()}</span> : null}
                  </div>
                </div>
                {item.kind === "task" || item.kind === "needs_review" ? (
                  <select
                    className="select goalSelect"
                    value={item.goalId || ""}
                    onChange={(event) => onGoalChange(item.id, event.target.value)}
                  >
                    <option value="">Choose goal</option>
                    {goals.map((goal) => (
                      <option key={goal.id} value={goal.id}>
                        {goal.title}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="noteHint">Store as note</span>
                )}
              </article>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
