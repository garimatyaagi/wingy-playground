import BranchCard from "./BranchCard";
import { LIFE_BRANCHES, computeBranchStats } from "../lib/branchConfig";

export default function GoalBranchesView({ goals, onSelectBranch }) {
  return (
    <div className="branchTreeWrap">
      <div className="branchGrid">
        {LIFE_BRANCHES.map((branch) => {
          const stats = computeBranchStats(goals, branch.id);
          return (
            <BranchCard
              key={branch.id}
              branch={branch}
              stats={stats}
              onClick={() => onSelectBranch(branch.id)}
            />
          );
        })}
      </div>
    </div>
  );
}
