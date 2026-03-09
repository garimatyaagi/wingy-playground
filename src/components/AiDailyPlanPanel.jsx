export default function AiDailyPlanPanel({
  planSuggestions,
  selectedDate,
  onChangeDate,
  dailyCapacityMinutes,
  onChangeCapacity,
  recurringLoadMinutes,
  oneTimeLoadMinutes,
  onGeneratePlan,
  onAccept,
  onMoveLater,
  onSkip,
  onReduceScope,
  onOpenTask,
}) {
  return (
    <section className="cardShell planPanel">
      <div className="sectionHeader">
        <div>
          <h2>AI Plan For Today</h2>
          <p>Only realistic blocks based on your current available windows.</p>
        </div>
        <button type="button" className="ghostButton" onClick={onGeneratePlan}>
          Generate plan
        </button>
      </div>

      <div className="planControlsRow">
        <label>
          <span className="inputLabel">Plan date</span>
          <input
            type="date"
            className="textInput"
            value={selectedDate}
            onChange={(event) => onChangeDate(event.target.value)}
          />
        </label>
        <label>
          <span className="inputLabel">Daily capacity (min)</span>
          <input
            type="number"
            min="60"
            step="15"
            className="textInput"
            value={dailyCapacityMinutes}
            onChange={(event) => onChangeCapacity(Number(event.target.value) || 60)}
          />
        </label>
        <div className="planCapacityStatus">
          <p>
            Recurring load: <strong>{recurringLoadMinutes}m</strong>
          </p>
          <p>
            One-time load: <strong>{oneTimeLoadMinutes}m</strong>
          </p>
        </div>
      </div>

      {planSuggestions.length === 0 ? (
        <div className="emptyState">
          No valid suggestions yet. Add unscheduled tasks and generate a plan.
        </div>
      ) : (
        <div className="planSuggestionList">
          {planSuggestions.map((suggestion) => (
            <article key={suggestion.id} className="planSuggestionCard">
              <div className="planSuggestionTop">
                <span>{suggestion.timeSlot}</span>
                <span>{suggestion.windowLabel}</span>
              </div>

              <button
                type="button"
                className="focusTaskButton"
                onClick={() => onOpenTask(suggestion.goalId, suggestion.taskId)}
              >
                {suggestion.title}
              </button>

              <p className="planReason">
                Why task: {suggestion.whyTask}. Why this time: {suggestion.whyTime}.
              </p>
              {suggestion.deprioritized.length > 0 ? (
                <p className="planDeprioritized">
                  Deprioritized: {suggestion.deprioritized.join(", ")}
                </p>
              ) : null}

              <div className="planActions">
                <button type="button" className="primaryButton mini" onClick={() => onAccept(suggestion)}>
                  Accept
                </button>
                <button type="button" className="ghostButton mini" onClick={() => onMoveLater(suggestion)}>
                  Move
                </button>
                <button type="button" className="ghostButton mini" onClick={() => onSkip(suggestion)}>
                  Skip
                </button>
                <button type="button" className="ghostButton mini" onClick={() => onReduceScope(suggestion)}>
                  Reduce scope
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
