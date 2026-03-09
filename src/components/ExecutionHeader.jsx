import { formatFriendlyDate } from "../lib/executionEngine";

export default function ExecutionHeader({
  workspaceName,
  nightMode,
  onToggleNightMode,
  userSlot,
}) {
  return (
    <header className="execHeader cardShell">
      <div>
        <p className="eyebrow">365 Tasks</p>
        <h1>{workspaceName || "Execution Workspace"}</h1>
        <p className="subtle">{formatFriendlyDate(new Date())}</p>
      </div>
      <div className="execHeaderActions">
        <button type="button" className="ghostButton" onClick={onToggleNightMode}>
          {nightMode ? "Day mode" : "Night mode"}
        </button>
        <div className="profileSlot">{userSlot}</div>
      </div>
    </header>
  );
}
