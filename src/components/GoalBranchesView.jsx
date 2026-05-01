import { useState } from "react";
import { LIFE_BRANCHES, computeBranchStats } from "../lib/branchConfig";

export default function GoalBranchesView({ goals, onSelectBranch, onSelectGoal }) {
  const [expandedBranch, setExpandedBranch] = useState(null);

  const toggleBranch = (id) => setExpandedBranch((prev) => (prev === id ? null : id));

  const activeBranch = LIFE_BRANCHES.find((b) => b.id === expandedBranch);
  const expandedGoals = expandedBranch
    ? goals.filter((g) => g.branch === expandedBranch)
    : [];

  return (
    <div className="branchTree">
      {/* Horizontal branch chips */}
      <div className="branchRow">
        {LIFE_BRANCHES.map((branch) => {
          const stats = computeBranchStats(goals, branch.id);
          const isActive = expandedBranch === branch.id;
          return (
            <button
              key={branch.id}
              type="button"
              className={`branchChip ${isActive ? "branchChipActive" : ""}`}
              style={{ "--branch-color": branch.color }}
              onClick={() => toggleBranch(branch.id)}
            >
              <span className="branchChipDot" />
              <span className="branchChipLabel">{branch.label}</span>
              <span className="branchChipMeta">{stats.goalCount}</span>
            </button>
          );
        })}
      </div>

      {/* Vertical expansion — goals under selected branch */}
      {expandedBranch && activeBranch ? (
        <div className="branchExpansion" style={{ "--branch-color": activeBranch.color }}>
          <div className="branchExpansionHeader">
            <span className="branchExpansionDot" />
            <span className="branchExpansionLabel">{activeBranch.label}</span>
            <span className="branchExpansionStats">
              {expandedGoals.length} goal{expandedGoals.length !== 1 ? "s" : ""}
            </span>
          </div>

          {expandedGoals.length === 0 ? (
            <p className="subtle branchExpansionEmpty">No goals here yet.</p>
          ) : (
            <ul className="branchGoalList">
              {expandedGoals.map((goal) => {
                const tasks = (goal.tasks || []).filter((t) => !t.isNote);
                const done = tasks.filter((t) => t.status === "done" || t.completedAt).length;
                const total = tasks.length;
                const pct = total === 0 ? 0 : Math.round((done / total) * 100);
                return (
                  <li key={goal.id} className="branchGoalItem">
                    <button
                      type="button"
                      className="branchGoalNode"
                      onClick={() => onSelectGoal(expandedBranch, goal.id)}
                    >
                      <span className="branchGoalTitle">{goal.title}</span>
                      <span className="branchGoalMeta">
                        {total > 0 ? `${done}/${total}` : "no tasks"}
                        {pct > 0 ? <span className="branchGoalPct"> &middot; {pct}%</span> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
