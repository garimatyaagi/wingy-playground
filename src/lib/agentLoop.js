import { parseIntakeInput } from "./executionEngine";

export const CHECKIN_STATUS_OPTIONS = ["done", "partial", "skipped"];
export const SKIP_REASON_OPTIONS = [
  "underestimated_time",
  "avoided_it",
  "blocked_by_dependency",
  "too_tired",
  "no_longer_relevant",
];

function cleanText(value) {
  return String(value || "").trim();
}

function toDateLabel(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function normalizeLineArray(value) {
  return Array.isArray(value) ? value : [];
}

export function classifyWhatsAppCapture(message, goals = [], now = new Date()) {
  const raw = cleanText(message);
  if (!raw) {
    return {
      kind: "ambiguous",
      confidence: 0.2,
      followUpQuestion: "What exactly should I capture from that message?",
      raw,
    };
  }

  const lower = raw.toLowerCase();
  const goalIntent =
    /^i\s+want\s+to\b/.test(lower) ||
    /^goal\s*:\s*/.test(lower) ||
    /\bthis\s+year\b/.test(lower);

  if (goalIntent) {
    const title = raw
      .replace(/^goal\s*:\s*/i, "")
      .replace(/^i\s+want\s+to\s+/i, "")
      .replace(/\s+this\s+year\b/i, "")
      .trim();
    return {
      kind: "goal",
      confidence: title ? 0.83 : 0.46,
      goal: {
        title: title || raw,
        description: "",
      },
      raw,
    };
  }

  const preview = parseIntakeInput(raw, now);
  const first = preview[0];

  if (!first) {
    return {
      kind: "ambiguous",
      confidence: 0.31,
      followUpQuestion: "Should I save this as a task, goal, or note?",
      raw,
    };
  }

  if (first.kind === "note") {
    return {
      kind: "note",
      confidence: first.confidence || 0.82,
      note: {
        text: raw,
      },
      raw,
    };
  }

  if (first.kind === "needs_review") {
    return {
      kind: "ambiguous",
      confidence: first.confidence || 0.45,
      suggestion: {
        title: first.title,
      },
      followUpQuestion: "What is the exact action and deadline for this?",
      raw,
    };
  }

  const goalMatch = goals.find(
    (goal) => first.goalName && String(goal.title || "").toLowerCase() === String(first.goalName || "").toLowerCase()
  );

  const recurring = Boolean(first.isRecurring) || first.taskType === "recurring";
  return {
    kind: recurring ? "recurring_task" : "one_time_task",
    confidence: first.confidence || 0.72,
    task: {
      title: first.title,
      description: first.description || "",
      goalName: first.goalName || goalMatch?.title || "General",
      goalId: goalMatch?.id || "",
      dueDate: first.dueDate || null,
      estimatedMinutes: first.estimatedMinutes || 30,
      effortType: first.effortType || "deep_work",
      urgency: first.urgency || 2,
      importance: first.importance || 3,
      aiConfidence: first.confidence || 0.72,
      isRecurring: recurring,
      recurrenceRule: recurring ? first.recurrenceRule || null : null,
      type: recurring ? "recurring" : "one_time",
      proofType: first.proofType || "note",
      status: "active",
    },
    raw,
  };
}

export function pickDailyAccountabilityRule({ topPriorities = [], signals = [], tone = "firm" }) {
  if (signals.some((signal) => signal.id === "admin-shielding")) {
    return tone === "gentle"
      ? "Start one deep-work task before touching admin today."
      : "No admin before your top deep-work priority is complete.";
  }
  if (signals.some((signal) => signal.id === "overbooked")) {
    return "Do not add new tasks today. Finish top commitments first.";
  }
  if (topPriorities.length > 0) {
    return `Task #1 must be started in the first focus block (${topPriorities[0].estimatedMinutes} min).`;
  }
  return "Capture only high-value work today.";
}

export function buildMorningBriefMessage({
  topPriorities = [],
  recurringDue = [],
  oneTimeSelected = [],
  atRisk = [],
  schedule = [],
  accountabilityRule = "",
}) {
  const lines = ["Good morning. Here is your execution plan.", ""];

  lines.push("Top 3:");
  if (topPriorities.length === 0) {
    lines.push("- No priorities selected yet.");
  } else {
    topPriorities.slice(0, 3).forEach((task, index) => {
      lines.push(`${index + 1}. ${task.title} - ${task.estimatedMinutes} min`);
    });
  }

  lines.push("");
  lines.push("Recurring due today:");
  if (recurringDue.length === 0) {
    lines.push("- None due.");
  } else {
    recurringDue.slice(0, 6).forEach((task) => lines.push(`- ${task.title}`));
  }

  lines.push("");
  lines.push("One-time selected for today:");
  if (oneTimeSelected.length === 0) {
    lines.push("- None selected yet.");
  } else {
    oneTimeSelected.slice(0, 5).forEach((task) => lines.push(`- ${task.title}`));
  }

  lines.push("");
  lines.push("At risk:");
  if (atRisk.length === 0) {
    lines.push("- No at-risk items right now.");
  } else {
    atRisk.slice(0, 3).forEach((task) => {
      const due = toDateLabel(task.dueDate);
      const suffix = due ? ` (due ${due})` : "";
      lines.push(`- ${task.title}${suffix}`);
    });
  }

  lines.push("");
  lines.push("Suggested schedule:");
  if (schedule.length === 0) {
    lines.push("- No realistic slots yet. Reduce active scope first.");
  } else {
    schedule.slice(0, 5).forEach((slot) => {
      lines.push(`- ${slot.timeSlot}: ${slot.title}`);
    });
  }

  lines.push("");
  lines.push("Today's rule:");
  lines.push(accountabilityRule || "Finish your top priority before adding new tasks.");

  return lines.join("\n");
}

export function createEveningCheckinTemplate(tasks = []) {
  return normalizeLineArray(tasks)
    .slice(0, 6)
    .map((task) => ({
      id: `check-${task.id}`,
      taskId: task.id,
      title: task.title,
      status: "partial",
      skipReason: "",
      note: "",
    }));
}

export function buildEveningFollowupMessage(items = []) {
  const lines = ["Evening check-in.", "Reply with done, partial, or skipped for each:", ""];
  if (!Array.isArray(items) || items.length === 0) {
    lines.push("No committed priorities were tracked today.");
    return lines.join("\n");
  }
  items.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.title}`);
  });
  lines.push("");
  lines.push("If skipped, add reason: underestimated_time / avoided_it / blocked_by_dependency / too_tired / no_longer_relevant.");
  return lines.join("\n");
}

export function summarizeCheckinOutcome(items = [], tone = "firm") {
  const safe = Array.isArray(items) ? items : [];
  const done = safe.filter((item) => item.status === "done").length;
  const partial = safe.filter((item) => item.status === "partial").length;
  const skipped = safe.filter((item) => item.status === "skipped").length;

  if (tone === "gentle") {
    return `Today: ${done} done, ${partial} partial, ${skipped} skipped. We will rebalance tomorrow with smaller steps.`;
  }
  if (tone === "ruthless") {
    return `Execution score tonight: ${done} done, ${partial} partial, ${skipped} skipped. Tomorrow is re-optimized with tighter scope.`;
  }
  return `Check-in logged: ${done} done, ${partial} partial, ${skipped} skipped. Replan will protect top priorities.`;
}

export function skipReasonToPatch(reason) {
  if (reason === "blocked_by_dependency") {
    return {
      isBlocked: true,
      nextAction: "Resolve dependency first, then resume.",
    };
  }
  if (reason === "no_longer_relevant") {
    return {
      status: "archived",
      nextAction: "Archived after relevance review.",
    };
  }
  if (reason === "avoided_it") {
    return {
      avoidanceDelta: 2,
      nextAction: "Start with a 15-minute entry block tomorrow.",
    };
  }
  if (reason === "underestimated_time") {
    return {
      estimateScale: 1.3,
      nextAction: "Increase estimate and split into chunks.",
    };
  }
  if (reason === "too_tired") {
    return {
      nextAction: "Move to earlier focus window tomorrow.",
    };
  }
  return {};
}

export function buildReplanMessage(proposal = {}, tone = "firm") {
  if (!proposal?.needed) return "No major replan needed. Keep momentum tomorrow.";

  const header = tone === "ruthless" ? "Replan enforced:" : "Replan prepared:";
  const lines = [header, proposal.summary || "Adjusted tomorrow based on today."];

  (proposal.adjustments || []).slice(0, 4).forEach((adj) => {
    if (adj.action === "move_to_tomorrow") {
      lines.push(`- Moved ${adj.title} to tomorrow.`);
    } else if (adj.action === "reduce_scope") {
      lines.push(`- Reduced ${adj.title} to ${adj.toMinutes || 20} minutes.`);
    } else {
      lines.push(`- ${adj.title}: ${adj.action}`);
    }
  });

  if (proposal.protectedTasks?.length) {
    lines.push(`Protected: ${proposal.protectedTasks.map((task) => task.title).join(", ")}.`);
  }

  return lines.join("\n");
}
