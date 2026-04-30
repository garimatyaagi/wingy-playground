// ─── Calendar-Aware Day Optimizer ───
// Given tasks + calendar events, produces an optimal time-blocked schedule.
//
// Algorithm:
//   1. Extract free slots from calendar events within working hours
//   2. Score every (task, slot, position) triple
//   3. Greedy best-first placement
//   4. Local search (pairwise swap) to escape local optima
//   5. Output: ordered schedule with start/end times per task

// ─── Energy Model ───
// Circadian energy curve — returns 0..1 multiplier for a given hour.
// Based on typical ultradian rhythms: peak 9-11am, dip 1-3pm, secondary peak 4-6pm.

const ENERGY_CURVE = {
  6: 0.4,
  7: 0.6,
  8: 0.8,
  9: 1.0,
  10: 1.0,
  11: 0.9,
  12: 0.7,
  13: 0.5,
  14: 0.5,
  15: 0.6,
  16: 0.8,
  17: 0.75,
  18: 0.6,
  19: 0.5,
  20: 0.4,
  21: 0.3,
  22: 0.2,
};

function energyAt(hour) {
  const floored = Math.floor(Math.max(6, Math.min(22, hour)));
  const frac = hour - floored;
  const current = ENERGY_CURVE[floored] ?? 0.4;
  const next = ENERGY_CURVE[Math.min(22, floored + 1)] ?? current;
  return current + (next - current) * frac;
}

// Energy demand by effort type — how much energy does this task need?
const ENERGY_DEMAND = {
  deep_work: 0.9,
  learning: 0.75,
  call: 0.5,
  admin: 0.3,
  errand: 0.4,
  health: 0.6,
};

function energyDemand(effortType) {
  return ENERGY_DEMAND[effortType] || 0.6;
}

// ─── Context Switching Cost ───
// Same category = 0, related = 0.5, unrelated = 1.0
const CATEGORY_GROUPS = {
  deep_work: "cognitive",
  learning: "cognitive",
  call: "social",
  admin: "admin",
  errand: "physical",
  health: "physical",
};

function contextSwitchCost(typeA, typeB) {
  if (!typeA || !typeB) return 0;
  if (typeA === typeB) return 0;
  const groupA = CATEGORY_GROUPS[typeA] || typeA;
  const groupB = CATEGORY_GROUPS[typeB] || typeB;
  return groupA === groupB ? 0.3 : 1.0;
}

// ─── Slot Extraction ───

function parseTime(dateStr) {
  return new Date(dateStr).getTime();
}

function hourOfDay(timestamp, timezone) {
  const date = new Date(timestamp);
  // Use Intl to get the correct hour in the user's timezone
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    }).formatToParts(date);
    const hour = Number(parts.find((p) => p.type === "hour")?.value || 0);
    const minute = Number(parts.find((p) => p.type === "minute")?.value || 0);
    return hour + minute / 60;
  } catch {
    return date.getHours() + date.getMinutes() / 60;
  }
}

function todayAtHour(hour, minute, timezone, dateKey) {
  // Build a Date for dateKey at HH:MM in the given timezone
  const [yyyy, mm, dd] = dateKey.split("-").map(Number);
  const h = Math.floor(hour);
  const m = minute ?? Math.round((hour - h) * 60);
  // Create in UTC and adjust — simpler: create an ISO string with offset
  // For serverless, just use a rough approach
  const utcDate = new Date(Date.UTC(yyyy, mm - 1, dd, h, m, 0));
  // Adjust for timezone offset (approximate)
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    // We want dateKey at h:m in the timezone → figure out UTC offset
    // Use iterative approach: create date, check what hour it shows in tz, adjust
    const testDate = new Date(`${dateKey}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`);
    const parts = formatter.formatToParts(testDate);
    const shownHour = Number(parts.find((p) => p.type === "hour")?.value || 0);
    const diff = shownHour - h;
    if (Math.abs(diff) <= 12) {
      return new Date(testDate.getTime() - diff * 3600000);
    }
    return testDate;
  } catch {
    return utcDate;
  }
}

function parseWorkHour(timeStr) {
  const [h, m] = (timeStr || "09:00").split(":").map(Number);
  return { hour: h || 9, minute: m || 0 };
}

/**
 * Extract free time slots from calendar events.
 * @param {Array} calendarEvents - Events with {start, end, allDay}
 * @param {string} workdayStart - "HH:MM"
 * @param {string} workdayEnd - "HH:MM"
 * @param {string} timezone
 * @param {string} dateKey - "YYYY-MM-DD"
 * @returns {Array<{start: number, end: number, durationMin: number}>} Free slots (timestamps)
 */
export function extractFreeSlots(calendarEvents, workdayStart, workdayEnd, timezone, dateKey) {
  const ws = parseWorkHour(workdayStart);
  const we = parseWorkHour(workdayEnd);
  const dayStart = todayAtHour(ws.hour, ws.minute, timezone, dateKey).getTime();
  const dayEnd = todayAtHour(we.hour, we.minute, timezone, dateKey).getTime();

  // Collect busy intervals (non-allday events only)
  const busy = (calendarEvents || [])
    .filter((e) => !e.allDay && e.start && e.end)
    .map((e) => ({
      start: parseTime(e.start),
      end: parseTime(e.end),
    }))
    .filter((b) => b.end > dayStart && b.start < dayEnd)
    .sort((a, b) => a.start - b.start);

  // Merge overlapping busy blocks
  const merged = [];
  for (const block of busy) {
    const clamped = {
      start: Math.max(block.start, dayStart),
      end: Math.min(block.end, dayEnd),
    };
    if (merged.length > 0 && clamped.start <= merged[merged.length - 1].end) {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, clamped.end);
    } else {
      merged.push({ ...clamped });
    }
  }

  // Extract gaps
  const slots = [];
  let cursor = dayStart;
  const BUFFER_MS = 5 * 60 * 1000; // 5-minute buffer around meetings

  for (const block of merged) {
    const slotStart = cursor;
    const slotEnd = block.start - BUFFER_MS;
    if (slotEnd - slotStart >= 10 * 60 * 1000) {
      // At least 10 minutes
      slots.push({
        start: slotStart,
        end: slotEnd,
        durationMin: Math.floor((slotEnd - slotStart) / 60000),
      });
    }
    cursor = block.end + BUFFER_MS;
  }

  // Final slot after last meeting
  if (dayEnd - cursor >= 10 * 60 * 1000) {
    slots.push({
      start: cursor,
      end: dayEnd,
      durationMin: Math.floor((dayEnd - cursor) / 60000),
    });
  }

  return slots;
}

// ─── Task-Slot Scoring ───

/**
 * Score placing a task in a specific slot at a specific position.
 * Higher = better fit.
 */
function scoreTaskInSlot(task, slot, position, prevTaskType, timezone) {
  let score = 0;

  const startHour = hourOfDay(slot.start, timezone);
  const taskStartHour = startHour + position / 60;

  // 1. Energy match (0-30 points)
  // High-demand tasks should go in high-energy windows
  const energy = energyAt(taskStartHour);
  const demand = energyDemand(task.effortType);
  const energyMatch = 1 - Math.abs(energy - demand);
  score += energyMatch * 30;

  // Bonus: deep work in peak energy (9-11am)
  if (task.effortType === "deep_work" && taskStartHour >= 9 && taskStartHour <= 11) {
    score += 15;
  }

  // Bonus: admin/calls in low-energy windows (1-3pm)
  if ((task.effortType === "admin" || task.effortType === "call") && taskStartHour >= 13 && taskStartHour <= 15) {
    score += 10;
  }

  // 2. Priority score pass-through (0-25 points)
  // Higher priority tasks should be scheduled earlier and get better slots
  score += Math.min(25, (task.priorityScore || 0) / 5);

  // 3. Deadline pressure (0-20 points)
  // Tasks due today get massive boost for earlier placement
  if (task.isDueToday || task.isOverdue) {
    score += 20 - (taskStartHour - 8) * 1.5; // Earlier = more points
  }

  // 4. Context switching cost (0 to -10 points)
  if (prevTaskType) {
    score -= contextSwitchCost(prevTaskType, task.effortType) * 10;
  }

  // 5. Duration fit (0-15 points)
  // Task fits well in this slot without wasting space
  const slotMinutes = slot.durationMin - position;
  const taskMinutes = task.estimatedMinutes || 30;
  if (taskMinutes <= slotMinutes) {
    // Fits — bonus for tighter fit (less wasted space)
    const utilization = taskMinutes / slotMinutes;
    score += utilization * 10;
    score += 5; // Fits at all
  } else {
    // Doesn't fit — heavy penalty
    score -= 20;
  }

  // 6. Avoid scheduling health/exercise too late
  if (task.effortType === "health" && taskStartHour > 19) {
    score -= 10;
  }

  // 7. Recurring tasks get a small boost (they're expected at regular times)
  if (task.recurringDueToday) {
    score += 5;
  }

  return score;
}

// ─── Optimizer Core ───

/**
 * Build an optimized time-blocked schedule.
 *
 * @param {Object} params
 * @param {Array} params.tasks - Scored tasks from recomputeDailyPlan (topPriorities + extras)
 * @param {Array} params.calendarEvents - Google Calendar events for today
 * @param {string} params.workdayStart - "HH:MM"
 * @param {string} params.workdayEnd - "HH:MM"
 * @param {string} params.timezone - e.g. "Asia/Kolkata"
 * @param {string} params.dateKey - "YYYY-MM-DD"
 * @returns {Object} { schedule: Array<{task, slotIndex, startTime, endTime}>, totalScore, unscheduled }
 */
export function optimizeSchedule({
  tasks,
  calendarEvents = [],
  workdayStart = "09:00",
  workdayEnd = "18:00",
  timezone = "Asia/Kolkata",
  dateKey,
}) {
  if (!tasks || tasks.length === 0) {
    return { schedule: [], totalScore: 0, unscheduled: [], freeSlots: [] };
  }

  const freeSlots = extractFreeSlots(calendarEvents, workdayStart, workdayEnd, timezone, dateKey);

  if (freeSlots.length === 0) {
    return {
      schedule: [],
      totalScore: 0,
      unscheduled: tasks.map((t) => ({ task: t, reason: "no_free_slots" })),
      freeSlots: [],
    };
  }

  // Phase 1: Greedy best-first placement
  const schedule = greedyPlace(tasks, freeSlots, timezone);

  // Phase 2: Local search — try pairwise swaps to improve
  const improved = localSearchSwap(schedule, freeSlots, timezone, 50);

  // Compute final score
  let totalScore = 0;
  for (const entry of improved.placed) {
    totalScore += entry.score;
  }

  // Format output with human-readable times
  const formattedSchedule = improved.placed.map((entry) => ({
    task: entry.task,
    taskId: entry.task.id,
    taskTitle: entry.task.title,
    effortType: entry.task.effortType,
    estimatedMinutes: entry.task.estimatedMinutes || 30,
    slotIndex: entry.slotIndex,
    startTime: new Date(entry.startTimestamp).toISOString(),
    endTime: new Date(entry.endTimestamp).toISOString(),
    startHour: formatHour(entry.startTimestamp, timezone),
    endHour: formatHour(entry.endTimestamp, timezone),
    score: Math.round(entry.score * 10) / 10,
    energyMatch: Math.round(energyAt(hourOfDay(entry.startTimestamp, timezone)) * 100),
  }));

  return {
    schedule: formattedSchedule,
    totalScore: Math.round(totalScore * 10) / 10,
    unscheduled: improved.unscheduled.map((t) => ({ task: t, reason: "no_fitting_slot" })),
    freeSlots: freeSlots.map((s) => ({
      start: new Date(s.start).toISOString(),
      end: new Date(s.end).toISOString(),
      durationMin: s.durationMin,
      startHour: formatHour(s.start, timezone),
      endHour: formatHour(s.end, timezone),
    })),
  };
}

function formatHour(timestamp, timezone) {
  try {
    return new Date(timestamp).toLocaleTimeString("en-IN", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    const d = new Date(timestamp);
    const h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, "0");
    return `${h > 12 ? h - 12 : h}:${m} ${h >= 12 ? "pm" : "am"}`;
  }
}

/**
 * Greedy placement: sort tasks by priority, place each in the best-scoring position.
 */
function greedyPlace(tasks, freeSlots, timezone) {
  // Sort tasks by priority (highest first)
  const sorted = [...tasks].sort(
    (a, b) => (b.priorityScore || 0) - (a.priorityScore || 0)
  );

  // Track used time per slot: array of {start, end} intervals used
  const slotUsage = freeSlots.map(() => []);
  const placed = [];
  const unscheduled = [];

  for (const task of sorted) {
    const taskMin = task.estimatedMinutes || 30;
    let bestScore = -Infinity;
    let bestPlacement = null;

    for (let si = 0; si < freeSlots.length; si++) {
      const slot = freeSlots[si];
      // Find available positions within this slot
      const positions = findAvailablePositions(slot, slotUsage[si], taskMin);

      for (const pos of positions) {
        // What's the previous task ending right before this position?
        const prevType = findPreviousTaskType(placed, si, pos.start);
        const score = scoreTaskInSlot(
          task,
          slot,
          (pos.start - slot.start) / 60000,
          prevType,
          timezone
        );

        if (score > bestScore) {
          bestScore = score;
          bestPlacement = {
            task,
            slotIndex: si,
            startTimestamp: pos.start,
            endTimestamp: pos.start + taskMin * 60000,
            score,
          };
        }
      }
    }

    if (bestPlacement) {
      placed.push(bestPlacement);
      slotUsage[bestPlacement.slotIndex].push({
        start: bestPlacement.startTimestamp,
        end: bestPlacement.endTimestamp,
      });
      // Sort usage for correct gap detection
      slotUsage[bestPlacement.slotIndex].sort((a, b) => a.start - b.start);
    } else {
      unscheduled.push(task);
    }
  }

  return { placed, unscheduled };
}

/**
 * Find available positions (start timestamps) where a task of given duration can fit.
 */
function findAvailablePositions(slot, usage, taskMinutes) {
  const taskMs = taskMinutes * 60000;
  const positions = [];
  const sorted = [...usage].sort((a, b) => a.start - b.start);

  let cursor = slot.start;
  for (const block of sorted) {
    if (block.start - cursor >= taskMs) {
      positions.push({ start: cursor });
    }
    cursor = Math.max(cursor, block.end);
  }
  // After last block
  if (slot.end - cursor >= taskMs) {
    positions.push({ start: cursor });
  }

  return positions;
}

function findPreviousTaskType(placed, slotIndex, startTimestamp) {
  let closest = null;
  let closestEnd = 0;
  for (const entry of placed) {
    if (entry.slotIndex === slotIndex && entry.endTimestamp <= startTimestamp) {
      if (entry.endTimestamp > closestEnd) {
        closestEnd = entry.endTimestamp;
        closest = entry.task.effortType;
      }
    }
  }
  return closest;
}

/**
 * Local search: try swapping pairs of placed tasks to improve total score.
 * Runs up to `maxIter` iterations.
 */
function localSearchSwap(result, freeSlots, timezone, maxIter = 50) {
  const { placed, unscheduled } = result;
  if (placed.length < 2) return { placed, unscheduled };

  let improved = true;
  let iterations = 0;

  while (improved && iterations < maxIter) {
    improved = false;
    iterations++;

    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i];
        const b = placed[j];

        // Can they swap? Check duration fits
        const aMin = a.task.estimatedMinutes || 30;
        const bMin = b.task.estimatedMinutes || 30;

        // Check if b's task fits in a's time window and vice versa
        const aSlot = freeSlots[a.slotIndex];
        const bSlot = freeSlots[b.slotIndex];

        // Simple check: does each task's duration fit at the other's start position?
        const bFitsInA =
          a.startTimestamp + bMin * 60000 <= (aSlot ? aSlot.end : a.endTimestamp);
        const aFitsInB =
          b.startTimestamp + aMin * 60000 <= (bSlot ? bSlot.end : b.endTimestamp);

        if (!bFitsInA || !aFitsInB) continue;

        // Also check no overlap with other tasks in those slots
        if (!canFitAt(placed, i, b.task, a.slotIndex, a.startTimestamp) ||
            !canFitAt(placed, j, a.task, b.slotIndex, b.startTimestamp)) {
          continue;
        }

        // Compute scores before and after swap
        const prevA = findPreviousTaskType(placed, a.slotIndex, a.startTimestamp);
        const prevB = findPreviousTaskType(placed, b.slotIndex, b.startTimestamp);

        const currentScore =
          scoreTaskInSlot(a.task, aSlot, (a.startTimestamp - aSlot.start) / 60000, prevA, timezone) +
          scoreTaskInSlot(b.task, bSlot, (b.startTimestamp - bSlot.start) / 60000, prevB, timezone);

        const swappedScore =
          scoreTaskInSlot(b.task, aSlot, (a.startTimestamp - aSlot.start) / 60000, prevA, timezone) +
          scoreTaskInSlot(a.task, bSlot, (b.startTimestamp - bSlot.start) / 60000, prevB, timezone);

        if (swappedScore > currentScore + 0.5) {
          // Do the swap
          const tmpTask = a.task;
          const tmpMin = a.task.estimatedMinutes || 30;

          placed[i] = {
            task: b.task,
            slotIndex: a.slotIndex,
            startTimestamp: a.startTimestamp,
            endTimestamp: a.startTimestamp + (b.task.estimatedMinutes || 30) * 60000,
            score: scoreTaskInSlot(b.task, aSlot, (a.startTimestamp - aSlot.start) / 60000, prevA, timezone),
          };
          placed[j] = {
            task: tmpTask,
            slotIndex: b.slotIndex,
            startTimestamp: b.startTimestamp,
            endTimestamp: b.startTimestamp + tmpMin * 60000,
            score: scoreTaskInSlot(tmpTask, bSlot, (b.startTimestamp - bSlot.start) / 60000, prevB, timezone),
          };
          improved = true;
        }
      }
    }
  }

  // Sort by start time for clean output
  placed.sort((a, b) => a.startTimestamp - b.startTimestamp);

  return { placed, unscheduled };
}

/**
 * Check if a task can fit at a specific position without overlapping other placed tasks
 * (excluding the task at `excludeIndex`).
 */
function canFitAt(placed, excludeIndex, task, slotIndex, startTimestamp) {
  const taskMs = (task.estimatedMinutes || 30) * 60000;
  const endTimestamp = startTimestamp + taskMs;

  for (let k = 0; k < placed.length; k++) {
    if (k === excludeIndex) continue;
    if (placed[k].slotIndex !== slotIndex) continue;
    // Check overlap
    if (startTimestamp < placed[k].endTimestamp && endTimestamp > placed[k].startTimestamp) {
      return false;
    }
  }
  return true;
}

// ─── Schedule Formatter for Morning Brief ───

export function formatScheduleForBrief(scheduleResult, timezone) {
  if (!scheduleResult?.schedule?.length) return null;

  const lines = [];
  lines.push("Your optimized schedule:");
  lines.push("");

  for (const entry of scheduleResult.schedule) {
    const emoji = effortEmoji(entry.effortType);
    const energy = entry.energyMatch >= 80 ? "peak" : entry.energyMatch >= 60 ? "good" : "low";
    lines.push(
      `  ${entry.startHour} - ${entry.endHour}  ${emoji} ${entry.taskTitle} (${entry.estimatedMinutes}m, ${energy} energy)`
    );
  }

  if (scheduleResult.unscheduled?.length > 0) {
    lines.push("");
    lines.push(`${scheduleResult.unscheduled.length} task(s) couldn't fit today:`);
    for (const u of scheduleResult.unscheduled) {
      lines.push(`  - ${u.task.title} (${u.task.estimatedMinutes || 30}m) — ${u.reason}`);
    }
  }

  if (scheduleResult.freeSlots?.length > 0) {
    const totalFree = scheduleResult.freeSlots.reduce((s, f) => s + f.durationMin, 0);
    const totalScheduled = scheduleResult.schedule.reduce((s, e) => s + e.estimatedMinutes, 0);
    lines.push("");
    lines.push(`${totalFree}m available, ${totalScheduled}m scheduled.`);
  }

  return lines.join("\n");
}

function effortEmoji(type) {
  switch (type) {
    case "deep_work": return "[D]";
    case "learning": return "[L]";
    case "call": return "[C]";
    case "admin": return "[A]";
    case "errand": return "[E]";
    case "health": return "[H]";
    default: return "[T]";
  }
}

// ─── Integration: Optimized Daily Plan ───

/**
 * Produce an optimized daily plan that includes time-blocked schedule.
 * This wraps the existing priority scoring with calendar-aware scheduling.
 *
 * @param {Object} params
 * @param {Array} params.scoredTasks - Tasks with priorityScore from recomputeDailyPlan
 * @param {Array} params.topPriorities - Top priority tasks
 * @param {Array} params.calendarEvents - Google Calendar events
 * @param {Object} params.profile - User's agent profile
 * @param {string} params.dateKey - "YYYY-MM-DD"
 * @returns {Object} Schedule result
 */
export function buildOptimizedSchedule({
  scoredTasks,
  topPriorities,
  calendarEvents = [],
  profile = {},
  dateKey,
}) {
  // Schedule top priorities + any recurring due today
  const tasksToSchedule = [...topPriorities];

  // Also try to schedule high-scoring tasks beyond top priorities
  // if there's likely time available
  const extra = (scoredTasks || [])
    .filter((t) => !tasksToSchedule.some((tp) => tp.id === t.id))
    .filter((t) => !t.done && t.status !== "completed")
    .filter((t) => (t.priorityScore || 0) >= 40)
    .slice(0, 3);
  tasksToSchedule.push(...extra);

  const scheduleResult = optimizeSchedule({
    tasks: tasksToSchedule,
    calendarEvents,
    workdayStart: profile.workdayStart || "09:00",
    workdayEnd: profile.workdayEnd || "18:00",
    timezone: profile.timezone || "Asia/Kolkata",
    dateKey,
  });

  return scheduleResult;
}
