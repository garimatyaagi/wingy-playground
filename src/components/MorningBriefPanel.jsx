export default function MorningBriefPanel({
  briefText,
  onGenerate,
  onSend,
  sending,
  lastSentAt,
}) {
  return (
    <section className="cardShell morningBriefPanel">
      <div className="sectionHeader">
        <div>
          <h2>Morning Brief</h2>
          <p>Daily WhatsApp brief with top priorities, risk, schedule, and rule of the day.</p>
        </div>
        <p className="subtle">{lastSentAt ? `Last sent ${new Date(lastSentAt).toLocaleString()}` : "Not sent yet"}</p>
      </div>

      <div className="briefCard">
        {briefText ? <pre>{briefText}</pre> : <p className="subtle">Generate today's brief to preview it.</p>}
      </div>

      <div className="briefActions">
        <button type="button" className="ghostButton" onClick={onGenerate}>
          Generate morning brief
        </button>
        <button type="button" className="primaryButton" disabled={!briefText || sending} onClick={onSend}>
          {sending ? "Sending..." : "Send to WhatsApp"}
        </button>
      </div>
    </section>
  );
}
