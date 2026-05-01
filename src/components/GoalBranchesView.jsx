import { useState } from "react";
import { LIFE_BRANCHES, computeBranchStats } from "../lib/branchConfig";

function BranchNode({ branch, stats, expanded, onToggle, goals, onSelectGoal }) {
  return (
    <li className="treeItem">
      <button
        type="button"
        className={`treeNode treeNodeBranch ${expanded ? "treeNodeExpanded" : ""}`}
        style={{ "--branch-color": branch.color }}
        onClick={onToggle}
      >
        <span className="treeNodeDot" />
        <span className="treeNodeLabel">{branch.label}</span>
        <span className="treeNodeMeta">
          {stats.goalCount} goal{stats.goalCount !== 1 ? "s" : ""}
          {stats.progress > 0 ? <span className="treeNodePct" style={{ color: branch.color }}> &middot; {stats.progress}%</span> : null}
        </span>
      </button>

      {/* Goal children */}
      {expanded && goals.length > 0 ? (
        <ul className="treeChildren">
          {goals.map((goal) => {
            const tasks = (goal.tasks || []).filter((t) => !t.isNote);
            const done = tasks.filter((t) => t.status === "done" || t.completedAt).length;
            const total = tasks.length;
            return (
              <li key={goal.id} className="treeItem">
                <button
                  type="button"
                  className="treeNode treeNodeGoal"
                  style={{ "--branch-color": branch.color }}
                  onClick={() => onSelectGoal(goal.id)}
                >
                  <span className="treeNodeLabel">{goal.title}</span>
                  <span className="treeNodeMeta">
                    {total > 0 ? `${done}/${total}` : "0 tasks"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}

export default function GoalBranchesView({ goals, onSelectBranch, onSelectGoal }) {
  const [expandedBranch, setExpandedBranch] = useState(null);

  const toggleBranch = (id) => setExpandedBranch((prev) => (prev === id ? null : id));

  return (
    <div className="branchTree">
      {/* Root node */}
      <div className="treeRoot">
        <div className="treeNode treeNodeRoot">
          <span className="treeNodeLabel">Your Goals</span>
        </div>
      </div>

      {/* Branch children */}
      <ul className="treeChildren treeChildrenRoot">
        {LIFE_BRANCHES.map((branch) => {
          const stats = computeBranchStats(goals, branch.id);
          const branchGoals = goals.filter((g) => g.branch === branch.id);
          return (
            <BranchNode
              key={branch.id}
              branch={branch}
              stats={stats}
              expanded={expandedBranch === branch.id}
              onToggle={() => toggleBranch(branch.id)}
              goals={branchGoals}
              onSelectGoal={(goalId) => onSelectGoal(branch.id, goalId)}
            />
          );
        })}
      </ul>
    </div>
  );
}
