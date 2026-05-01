export default function BranchCard({ branch, stats, onClick }) {
  const { label, icon, color } = branch;
  const { goalCount, progress } = stats;

  return (
    <button
      type="button"
      className="branchCard"
      style={{ "--branch-color": color }}
      onClick={onClick}
    >
      {/* Progress ring */}
      <div className="branchProgressRing" style={{ "--progress": progress }}>
        <span className="branchIcon">{icon}</span>
      </div>

      <h3 className="branchLabel">{label}</h3>

      <span className="branchGoalCount">
        {goalCount} goal{goalCount !== 1 ? "s" : ""}
      </span>

      <span className="branchPct">{progress}%</span>
    </button>
  );
}
