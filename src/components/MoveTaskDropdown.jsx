import { useMemo, useState } from "react";

export default function MoveTaskDropdown({ goals, currentGoalId, onSelect, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const clean = query.trim().toLowerCase();
    if (!clean) return goals;
    return goals.filter((goal) => goal.title.toLowerCase().includes(clean));
  }, [goals, query]);

  return (
    <div className="moveDropdown">
      <button
        type="button"
        className="ghostButton mini"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
      >
        Move to...
      </button>
      {open ? (
        <div className="moveDropdownMenu">
          <input
            className="textInput moveSearchInput"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search goals"
            autoFocus
          />
          <p className="moveGroupLabel">Goals</p>
          <div className="moveGoalList">
            {filtered.length === 0 ? (
              <p className="subtle">No goals found.</p>
            ) : (
              filtered.map((goal) => (
                <button
                  key={goal.id}
                  type="button"
                  className={goal.id === currentGoalId ? "moveGoalItem active" : "moveGoalItem"}
                  onClick={() => {
                    onSelect(goal.id);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  {goal.title}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
