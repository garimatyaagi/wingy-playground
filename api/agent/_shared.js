function cleanText(value) {
  return String(value || "").trim();
}

function detectRecurring(text) {
  const lower = text.toLowerCase();
  if (/\b(every day|daily|each day)\b/.test(lower)) {
    return { isRecurring: true, recurrenceRule: { frequency: "daily", interval: 1 } };
  }
  const weekly = lower.match(/every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i);
  if (weekly) {
    const idxMap = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
    };
    return {
      isRecurring: true,
      recurrenceRule: { frequency: "weekly", interval: 1, daysOfWeek: [idxMap[weekly[1].toLowerCase()] || 1] },
    };
  }
  if (/\b(weekly|every week)\b/.test(lower)) {
    return { isRecurring: true, recurrenceRule: { frequency: "weekly", interval: 1 } };
  }
  if (/\b(monthly|every month)\b/.test(lower)) {
    return { isRecurring: true, recurrenceRule: { frequency: "monthly", interval: 1 } };
  }
  return { isRecurring: false, recurrenceRule: null };
}

function inferEffortType(text) {
  const lower = text.toLowerCase();
  if (/\b(email|reply|invoice|submit|form|document|admin)\b/.test(lower)) return "admin";
  if (/\b(workout|run|walk|yoga|health)\b/.test(lower)) return "health";
  if (/\b(call|meeting|discuss|sync)\b/.test(lower)) return "call";
  if (/\b(renew|bank|passport|visit|buy|pickup)\b/.test(lower)) return "errand";
  if (/\b(study|learn|read|practice|course)\b/.test(lower)) return "learning";
  return "deep_work";
}

function inferGoalName(text) {
  const lower = text.toLowerCase();
  if (/\b(health|workout|run|sleep|diet)\b/.test(lower)) return "Health";
  if (/\b(read|learn|study|course|practice)\b/.test(lower)) return "Learning & Growth";
  if (/\b(passport|tax|bank|renew|insurance|home)\b/.test(lower)) return "Life Admin";
  if (/\b(client|deck|proposal|launch|business|career)\b/.test(lower)) return "Career";
  return "General";
}

function inferEstimatedMinutes(text, effortType) {
  const lower = text.toLowerCase();
  const explicit = lower.match(/(\d{1,3})\s*(min|mins|minutes|hour|hours|hr|hrs)/i);
  if (explicit) {
    const n = Number(explicit[1]);
    if (!Number.isFinite(n) || n <= 0) return 30;
    return explicit[2].toLowerCase().startsWith("h") ? Math.min(240, n * 60) : Math.min(240, n);
  }
  if (effortType === "admin") return 20;
  if (effortType === "health") return 45;
  if (effortType === "errand") return 45;
  if (effortType === "call") return 30;
  return 45;
}

function inferDueDate(text, now = new Date()) {
  const lower = text.toLowerCase();
  if (/\btoday\b/.test(lower)) {
    const due = new Date(now);
    due.setHours(23, 59, 0, 0);
    return due.toISOString();
  }
  if (/\btomorrow\b/.test(lower)) {
    const due = new Date(now);
    due.setDate(due.getDate() + 1);
    due.setHours(23, 59, 0, 0);
    return due.toISOString();
  }
  if (/\bthis month\b/.test(lower)) {
    const due = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 0, 0);
    return due.toISOString();
  }
  return null;
}

function inferUrgency(text, dueDateIso) {
  const lower = text.toLowerCase();
  if (/\b(asap|urgent|immediately|critical)\b/.test(lower)) return 5;
  if (!dueDateIso) return 2;
  const due = new Date(dueDateIso);
  const hours = (due.getTime() - Date.now()) / 36e5;
  if (hours <= 24) return 5;
  if (hours <= 72) return 4;
  if (hours <= 168) return 3;
  return 2;
}

function inferImportance(text) {
  const lower = text.toLowerCase();
  if (/\b(strategy|client|launch|proposal|exam|revenue|interview)\b/.test(lower)) return 5;
  if (/\b(deck|presentation|review|career|health)\b/.test(lower)) return 4;
  if (/\b(admin|clean|organize|routine)\b/.test(lower)) return 2;
  return 3;
}

function inferProofType(text) {
  const lower = text.toLowerCase();
  if (/\b(send|submit|upload|publish)\b/.test(lower)) return "link";
  if (/\b(write|draft|design|build|deck)\b/.test(lower)) return "screenshot";
  if (/\b(workout|run|practice|study|call)\b/.test(lower)) return "timer";
  return "note";
}

export function classifyIncomingText(text, now = new Date()) {
  const raw = cleanText(text);
  if (!raw) {
    return {
      kind: "ambiguous",
      confidence: 0.2,
      followUpQuestion: "What should I capture from that message?",
    };
  }

  const lower = raw.toLowerCase();
  const goalIntent = /^i\s+want\s+to\b/.test(lower) || /\bthis year\b/.test(lower) || /^goal\s*:/i.test(raw);
  if (goalIntent) {
    const title = raw
      .replace(/^goal\s*:\s*/i, "")
      .replace(/^i\s+want\s+to\s+/i, "")
      .replace(/\s+this\s+year\b/i, "")
      .trim();
    return {
      kind: "goal",
      confidence: title ? 0.84 : 0.45,
      goal: {
        title: title || raw,
      },
    };
  }

  const noteLike = /\b(i think|i feel|memory|journal|today i|falafel|amazing)\b/.test(lower);
  if (noteLike && !/\b(by|before|send|submit|finish|renew|book|call|schedule|do)\b/.test(lower)) {
    return {
      kind: "note",
      confidence: 0.9,
      note: { text: raw },
    };
  }

  const actionLike = /\b(send|submit|finish|renew|book|call|schedule|do|complete|prepare|finalize|read|workout|exercise|plan)\b/.test(lower);
  if (!actionLike) {
    return {
      kind: "ambiguous",
      confidence: 0.4,
      followUpQuestion: "Is this a task, goal, or note? Please be specific.",
      suggestion: { title: raw },
    };
  }

  const effortType = inferEffortType(raw);
  const dueDate = inferDueDate(raw, now);
  const recurrence = detectRecurring(raw);
  const title = raw
    .replace(/\b(this month|today|tomorrow|every day|daily|weekly|monthly)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return {
    kind: recurrence.isRecurring ? "recurring_task" : "one_time_task",
    confidence: 0.72,
    task: {
      title: title || raw,
      description: "",
      goalName: inferGoalName(raw),
      dueDate,
      estimatedMinutes: inferEstimatedMinutes(raw, effortType),
      effortType,
      urgency: inferUrgency(raw, dueDate),
      importance: inferImportance(raw),
      isRecurring: recurrence.isRecurring,
      recurrenceRule: recurrence.recurrenceRule,
      type: recurrence.isRecurring ? "recurring" : "one_time",
      proofType: inferProofType(raw),
      aiConfidence: 0.72,
    },
  };
}

export function morningBriefFromPayload(payload = {}) {
  const top = Array.isArray(payload.topPriorities) ? payload.topPriorities : [];
  const recurring = Array.isArray(payload.recurringDue) ? payload.recurringDue : [];
  const oneTime = Array.isArray(payload.oneTimeSelected) ? payload.oneTimeSelected : [];
  const risk = Array.isArray(payload.atRisk) ? payload.atRisk : [];
  const schedule = Array.isArray(payload.suggestedSchedule) ? payload.suggestedSchedule : [];
  const rule = cleanText(payload.accountabilityRule) || "Do not add new tasks before top priorities are done.";

  const lines = ["Good morning. Here is today's plan.", "", "Top 3:"];
  if (top.length === 0) {
    lines.push("- No priorities selected yet.");
  } else {
    top.slice(0, 3).forEach((task, index) => {
      lines.push(`${index + 1}. ${task.title} - ${task.estimatedMinutes || 30} min`);
    });
  }

  lines.push("", "Recurring due today:");
  if (recurring.length === 0) lines.push("- None.");
  else recurring.slice(0, 6).forEach((task) => lines.push(`- ${task.title}`));

  lines.push("", "One-time selected today:");
  if (oneTime.length === 0) lines.push("- None.");
  else oneTime.slice(0, 6).forEach((task) => lines.push(`- ${task.title}`));

  lines.push("", "At risk:");
  if (risk.length === 0) lines.push("- No urgent risk.");
  else risk.slice(0, 3).forEach((task) => lines.push(`- ${task.title}`));

  lines.push("", "Suggested schedule:");
  if (schedule.length === 0) lines.push("- No schedule generated yet.");
  else schedule.slice(0, 5).forEach((slot) => lines.push(`- ${slot.timeSlot || slot.slot}: ${slot.title}`));

  lines.push("", "Today's rule:", rule);

  return lines.join("\n");
}

export function eveningFollowupFromPayload(payload = {}) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const lines = ["Evening check-in.", "Reply with done / partial / skipped for each:", ""];
  if (items.length === 0) {
    lines.push("No committed tasks found for today.");
    return lines.join("\n");
  }
  items.slice(0, 8).forEach((item, index) => {
    lines.push(`${index + 1}. ${item.title}`);
  });
  lines.push("", "If skipped, share reason: underestimated_time, avoided_it, blocked_by_dependency, too_tired, no_longer_relevant.");
  return lines.join("\n");
}

export function replanFromPayload(payload = {}) {
  const skipped = Array.isArray(payload.skippedItems) ? payload.skippedItems : [];
  const partial = Array.isArray(payload.partialItems) ? payload.partialItems : [];
  const adjustments = [];

  skipped.forEach((item) => {
    if (!item?.taskId) return;
    if (item.reason === "avoided_it") {
      adjustments.push({ taskId: item.taskId, action: "reduce_scope", toMinutes: 20, reason: "Repeated avoidance." });
      return;
    }
    if (item.reason === "no_longer_relevant") {
      adjustments.push({ taskId: item.taskId, action: "archive", reason: "No longer relevant." });
      return;
    }
    adjustments.push({ taskId: item.taskId, action: "move_to_tomorrow", reason: item.reason || "Not completed." });
  });

  partial.forEach((item) => {
    if (!item?.taskId) return;
    adjustments.push({ taskId: item.taskId, action: "move_to_tomorrow", reason: "Carry forward remaining scope." });
  });

  return {
    needed: adjustments.length > 0,
    adjustments,
    summary:
      adjustments.length > 0
        ? "Tomorrow was rebalanced: low-impact work moved, avoided tasks reduced to starter blocks."
        : "No replan needed.",
  };
}

export function toWhatsAppAddress(value) {
  const raw = cleanText(value);
  if (!raw) return "";
  if (raw.startsWith("whatsapp:")) return raw;
  const digits = raw.startsWith("+") ? raw : `+${raw.replace(/[^\d]/g, "")}`;
  return `whatsapp:${digits}`;
}

export function twimlMessage(text) {
  const safe = String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
}
