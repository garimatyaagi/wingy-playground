// Life Branches — the 6 categories that goals are organized under

export const LIFE_BRANCHES = [
  { id: "finance",       label: "Finance",          icon: "\uD83D\uDCB0", color: "#10B981" },
  { id: "growth",        label: "Personal Growth",  icon: "\u2728",       color: "#8B5CF6" },
  { id: "career",        label: "Career",           icon: "\uD83D\uDCBC", color: "#3B82F6" },
  { id: "health",        label: "Health",           icon: "\u2764\uFE0F", color: "#EF4444" },
  { id: "relationships", label: "Relationships",    icon: "\uD83D\uDC9B", color: "#F59E0B" },
  { id: "creativity",    label: "Creativity & Fun", icon: "\uD83C\uDFA8", color: "#EC4899" },
];

const BRANCH_KEYWORDS = {
  finance: ["finance", "money", "budget", "invest", "save", "saving", "savings", "bill", "tax", "bank", "insurance", "income", "debt", "loan", "crypto", "stock", "401k", "rent", "mortgage"],
  growth: ["learn", "read", "study", "course", "book", "meditat", "journal", "habit", "mindful", "skill", "practice", "grow", "growth", "self-improvement", "knowledge", "wisdom"],
  career: ["career", "work", "job", "client", "deck", "proposal", "launch", "product", "business", "resume", "interview", "promotion", "network", "linkedin", "portfolio", "freelance", "side project", "startup"],
  health: ["health", "workout", "run", "exercise", "gym", "yoga", "sleep", "meal", "diet", "weight", "walk", "swim", "strength", "cardio", "nutrition", "water", "step", "stretch", "mental health"],
  relationships: ["family", "friend", "partner", "parents", "relationship", "date", "birthday", "gift", "call mom", "call dad", "social", "community", "volunteer", "mentor"],
  creativity: ["art", "paint", "draw", "music", "write", "creative", "photo", "design", "craft", "hobby", "travel", "cook", "garden", "play", "fun", "game", "movie", "dance", "sing"],
};

export function inferBranch(title) {
  const clean = String(title || "").toLowerCase();
  let bestMatch = null;
  let bestCount = 0;

  for (const [branchId, keywords] of Object.entries(BRANCH_KEYWORDS)) {
    const count = keywords.filter((kw) => clean.includes(kw)).length;
    if (count > bestCount) {
      bestCount = count;
      bestMatch = branchId;
    }
  }

  return bestMatch || "growth"; // default to Personal Growth
}

export function getBranch(id) {
  return LIFE_BRANCHES.find((b) => b.id === id) || LIFE_BRANCHES[1]; // fallback to growth
}

export function computeBranchStats(goals, branchId) {
  const branchGoals = goals.filter((g) => g.branch === branchId);
  let totalTasks = 0;
  let doneTasks = 0;

  for (const goal of branchGoals) {
    const meaningful = (goal.tasks || []).filter((t) => !t.isNote);
    totalTasks += meaningful.length;
    doneTasks += meaningful.filter((t) => t.status === "done" || t.completedAt).length;
  }

  return {
    goalCount: branchGoals.length,
    progress: totalTasks === 0 ? 0 : Math.round((doneTasks / totalTasks) * 100),
    activeTasks: totalTasks - doneTasks,
    doneTasks,
  };
}

export function groupGoalsByBranch(goals) {
  const grouped = {};
  for (const branch of LIFE_BRANCHES) {
    grouped[branch.id] = [];
  }
  grouped._uncategorized = [];

  for (const goal of goals) {
    if (goal.branch && grouped[goal.branch]) {
      grouped[goal.branch].push(goal);
    } else if (!goal.branch) {
      grouped._uncategorized.push(goal);
    } else {
      grouped._uncategorized.push(goal);
    }
  }
  return grouped;
}
