function labelForType(type) {
  if (type === "kept") return "Kept";
  if (type === "pending") return "Pending";
  if (type === "overdue") return "Overdue";
  if (type === "rescheduled") return "Rescheduled";
  if (type === "proof") return "Proof";
  return "Info";
}

export default function AccountabilityFeedPanel({ feedItems, signals, onOpenTask }) {
  const hasFeed = feedItems.length > 0;

  return (
    <section className="cardShell accountabilityPanel">
      <div className="sectionHeader">
        <div>
          <h2>Accountability Feed</h2>
          <p>What you committed to, what slipped, and what needs proof.</p>
        </div>
      </div>

      <div className="accountabilityColumns">
        <div>
          <h3>Execution signals</h3>
          {signals.length === 0 ? (
            <p className="subtle">No major procrastination signals right now.</p>
          ) : (
            <div className="signalList">
              {signals.map((signal) => (
                <article key={signal.id} className={`signalCard ${signal.level || "medium"}`}>
                  <p className="signalTitle">{signal.title}</p>
                  <p>{signal.message}</p>
                  <p className="subtle">Action: {signal.action}</p>
                  {signal.taskId ? (
                    <button type="button" className="textLink" onClick={() => onOpenTask(null, signal.taskId)}>
                      Open task
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </div>

        <div>
          <h3>Feed</h3>
          {!hasFeed ? (
            <p className="subtle">No accountability events yet.</p>
          ) : (
            <div className="feedList">
              {feedItems.map((item) => (
                <article key={item.id} className="feedItem">
                  <span className={`feedTag ${item.type || "info"}`}>{labelForType(item.type)}</span>
                  <div>
                    <p className="feedTitle">{item.title}</p>
                    <p className="subtle">{item.message}</p>
                    {item.taskId ? (
                      <button type="button" className="textLink" onClick={() => onOpenTask(null, item.taskId)}>
                        Open task
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
