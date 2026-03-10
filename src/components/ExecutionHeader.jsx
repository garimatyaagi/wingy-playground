import { formatFriendlyDate } from "../lib/executionEngine";

export default function ExecutionHeader({
  workspaceName,
  nightMode,
  onToggleNightMode,
  userSlot,
}) {
  return (
    <header className="execHeader">
      <div>
        <h1>{workspaceName || "My workspace"}</h1>
        <p className="subtle">{formatFriendlyDate(new Date())}</p>
      </div>
      <div className="execHeaderActions">
        <button type="button" className="ghostButton mini" onClick={onToggleNightMode}>
          {nightMode ? "Light" : "Dark"}
        </button>
        <div className="profileSlot">{userSlot}</div>
      </div>
    </header>
  );
}
