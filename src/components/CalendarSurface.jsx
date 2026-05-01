import { useState, useMemo, useCallback, useEffect } from "react";
import {
  recurrenceOccursOnDate,
  occurrenceKey,
} from "../lib/executionEngine";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function getMonthGrid(year, month) {
  const first = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0).getDate();
  let startDow = first.getDay() - 1;
  if (startDow < 0) startDow = 6;

  const cells = [];
  for (let i = 0; i < startDow; i++) {
    const d = new Date(year, month, 1 - (startDow - i));
    cells.push({ date: d, outside: true });
  }
  for (let d = 1; d <= lastDay; d++) {
    cells.push({ date: new Date(year, month, d), outside: false });
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1].date;
    const d = new Date(last);
    d.setDate(d.getDate() + 1);
    cells.push({ date: d, outside: true });
  }
  return cells;
}

function getTasksForDate(allTasks, dateKey, dateObj, occurrenceStore) {
  const result = [];
  for (const task of allTasks) {
    if (task.isNote || task.status === "archived") continue;

    if (task.isRecurring) {
      if (recurrenceOccursOnDate(task, dateObj)) {
        const key = occurrenceKey(task.id, dateKey);
        const occ = occurrenceStore[key];
        if (occ?.skipped) continue;
        if (occ?.rescheduledTo && occ.rescheduledTo !== dateKey) continue;
        result.push({
          ...task,
          _done: occ?.status === "completed" || occ?.status === "done",
          _occActual: occ?.actualMinutes || 0,
        });
      }
    } else {
      const matchDate = task.scheduledDate || task.dueDate || null;
      const completedDate = task.completionDate || task.completedAt || null;

      if (matchDate === dateKey) {
        result.push({
          ...task,
          _done: Boolean(task.completedAt || task.completionDate || task.status === "done"),
        });
      } else if (!matchDate && completedDate && completedDate.slice(0, 10) === dateKey) {
        result.push({ ...task, _done: true });
      }
    }
  }
  return result;
}

function effortColor(effortType) {
  switch (effortType) {
    case "deep_work": return "var(--accent)";
    case "admin": return "#6B7280";
    case "call": return "#8B5CF6";
    case "errand": return "#F59E0B";
    case "health": return "#10B981";
    case "learning": return "#3B82F6";
    case "relationship": return "#EC4899";
    default: return "var(--accent)";
  }
}

function formatMinutes(m) {
  if (!m) return "";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

// Derive priority tier from score + task properties
function getPriorityTier(task) {
  if (task._isCalendarEvent) return "immovable";
  const score = task.priorityScore || 0;
  const overdue = task.dueDate && task.dueDate < isoDate(new Date());
  if (overdue || score >= 60 || task.urgency >= 5) return "p1";
  if (score >= 35 || task.urgency >= 3 || task.importance >= 4) return "p2";
  return "p3";
}

function tierLabel(tier) {
  if (tier === "immovable") return "Fixed";
  return tier.toUpperCase();
}

function tierColorClass(tier) {
  if (tier === "immovable") return "tierFixed";
  if (tier === "p1") return "tierP1";
  if (tier === "p2") return "tierP2";
  return "tierP3";
}

function parseEventTime(isoStr) {
  if (!isoStr) return null;
  try {
    const d = new Date(isoStr);
    return d.getHours() * 60 + d.getMinutes();
  } catch { return null; }
}

function formatTime(minutesSinceMidnight) {
  const h = Math.floor(minutesSinceMidnight / 60);
  const m = minutesSinceMidnight % 60;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

export default function CalendarSurface({
  allTasks,
  goals,
  occurrenceStore,
  onOpenTask,
  onDone,
  onSnooze,
  onStartNow,
  onRecompute,
  onMonthChange,
  calendarEvents,
  calendarLoading,
  optimizedSchedule,
  scheduleLoading,
  weeklyMomentum,
  executionMetrics,
  dueTodayCount,
  overdueCount,
  blockedCount,
  procrastinationSignals,
}) {
  const today = useMemo(() => new Date(), []);
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState(today);
  const [view, setView] = useState("month");

  const grid = useMemo(() => getMonthGrid(viewYear, viewMonth), [viewYear, viewMonth]);

  const tasksByDate = useMemo(() => {
    const map = {};
    for (const cell of grid) {
      const dk = isoDate(cell.date);
      map[dk] = getTasksForDate(allTasks, dk, cell.date, occurrenceStore);
    }
    return map;
  }, [grid, allTasks, occurrenceStore]);

  // Count gcal events per date
  const eventsByDate = useMemo(() => {
    const map = {};
    for (const ev of (calendarEvents || [])) {
      const dk = ev.date || (ev.start || "").slice(0, 10);
      if (!map[dk]) map[dk] = [];
      map[dk].push(ev);
    }
    return map;
  }, [calendarEvents]);

  const selectedDateKey = isoDate(selectedDate);
  const isSelectedToday = sameDay(selectedDate, today);

  const selectedTasks = useMemo(
    () => getTasksForDate(allTasks, selectedDateKey, selectedDate, occurrenceStore),
    [allTasks, selectedDateKey, selectedDate, occurrenceStore]
  );

  const selectedEvents = useMemo(
    () => (eventsByDate[selectedDateKey] || []),
    [eventsByDate, selectedDateKey]
  );

  // Build unified timeline: gcal events (immovable) + tasks, sorted by time
  const timeline = useMemo(() => {
    const items = [];

    // Add Google Calendar events as immovable blocks
    for (const ev of selectedEvents) {
      const startMin = parseEventTime(ev.start);
      const endMin = parseEventTime(ev.end);
      items.push({
        id: `gcal-${ev.id}`,
        title: ev.summary,
        _isCalendarEvent: true,
        _done: false,
        startMinutes: startMin,
        endMinutes: endMin,
        startLabel: ev.startTime || ev.time || "",
        endLabel: ev.endTime || "",
        allDay: ev.allDay,
        location: ev.location,
        effortType: "call",
      });
    }

    // Add optimized schedule items if available (they have start/end times)
    const scheduledIds = new Set();
    if (optimizedSchedule?.schedule) {
      for (const entry of optimizedSchedule.schedule) {
        scheduledIds.add(entry.taskId);
        const task = selectedTasks.find((t) => t.id === entry.taskId) || {};
        const startMin = parseEventTime(entry.startTime);
        const endMin = parseEventTime(entry.endTime);
        items.push({
          ...task,
          id: entry.taskId,
          title: entry.taskTitle || task.title,
          effortType: entry.effortType || task.effortType,
          estimatedMinutes: entry.estimatedMinutes || task.estimatedMinutes,
          startMinutes: startMin,
          endMinutes: endMin,
          startLabel: entry.startHour || "",
          endLabel: entry.endHour || "",
          _done: task._done || false,
          _isCalendarEvent: false,
          _energyMatch: entry.energyMatch,
        });
      }
    }

    // Add remaining tasks without time slots
    for (const task of selectedTasks) {
      if (scheduledIds.has(task.id)) continue;
      items.push({
        ...task,
        startMinutes: null,
        endMinutes: null,
        startLabel: "",
        endLabel: "",
      });
    }

    // Sort: timed items first (by start), then untimed
    items.sort((a, b) => {
      if (a.startMinutes != null && b.startMinutes != null) return a.startMinutes - b.startMinutes;
      if (a.startMinutes != null) return -1;
      if (b.startMinutes != null) return 1;
      // Untimed: sort by priority tier
      const tierOrder = { p1: 0, p2: 1, p3: 2 };
      return (tierOrder[getPriorityTier(a)] || 2) - (tierOrder[getPriorityTier(b)] || 2);
    });

    return items;
  }, [selectedEvents, selectedTasks, optimizedSchedule]);

  const goalById = useMemo(() => {
    const m = {};
    for (const g of goals) m[g.id] = g;
    return m;
  }, [goals]);

  const prevMonth = useCallback(() => {
    const newMonth = viewMonth === 0 ? 11 : viewMonth - 1;
    const newYear = viewMonth === 0 ? viewYear - 1 : viewYear;
    setViewMonth(newMonth);
    setViewYear(newYear);
    onMonthChange?.(newYear, newMonth);
  }, [viewMonth, viewYear, onMonthChange]);

  const nextMonth = useCallback(() => {
    const newMonth = viewMonth === 11 ? 0 : viewMonth + 1;
    const newYear = viewMonth === 11 ? viewYear + 1 : viewYear;
    setViewMonth(newMonth);
    setViewYear(newYear);
    onMonthChange?.(newYear, newMonth);
  }, [viewMonth, viewYear, onMonthChange]);

  const goToToday = useCallback(() => {
    const now = new Date();
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
    setSelectedDate(now);
  }, []);

  const isToday = (d) => sameDay(d, today);
  const isSelected = (d) => sameDay(d, selectedDate);

  // Week view
  const weekStart = useMemo(() => {
    const d = new Date(selectedDate);
    let dow = d.getDay() - 1;
    if (dow < 0) dow = 6;
    d.setDate(d.getDate() - dow);
    return d;
  }, [selectedDate]);

  const weekDays = useMemo(() => {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      days.push(d);
    }
    return days;
  }, [weekStart]);

  // Stats
  const dayTotalMinutes = selectedTasks.reduce((s, t) => s + (t.estimatedMinutes || 30), 0);
  const dayCompletedCount = selectedTasks.filter((t) => t._done).length;
  const timedCount = timeline.filter((t) => t.startMinutes != null).length;
  const untimedTasks = timeline.filter((t) => t.startMinutes == null && !t._isCalendarEvent);

  const selectedWeekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][selectedDate.getDay()];
  const selectedMonthName = MONTH_NAMES[selectedDate.getMonth()];

  // Momentum
  const hasProgress = weeklyMomentum && (
    weeklyMomentum.completedThisWeek > 0 ||
    weeklyMomentum.deepWorkHours > 0 ||
    weeklyMomentum.goalsAdvanced > 0
  );
  const habitRate = executionMetrics?.recurringConsistency != null
    ? Math.round(executionMetrics.recurringConsistency * 100)
    : null;

  const statParts = [];
  if (dueTodayCount > 0) statParts.push(`${dueTodayCount} due`);
  if (overdueCount > 0) statParts.push(`${overdueCount} overdue`);
  if (selectedEvents.length > 0) statParts.push(`${selectedEvents.length} event${selectedEvents.length !== 1 ? "s" : ""}`);
  if (dayTotalMinutes > 0) statParts.push(formatMinutes(dayTotalMinutes));
  const statsSummary = statParts.join(" \u00b7 ");

  const showSignals = procrastinationSignals?.length > 0;

  return (
    <div className="calendarSurface">
      {/* ─── Greeting (today only) ─── */}
      {isSelectedToday && (
        <div className="todayGreetingBlock">
          <div className="todayGreetingLeft">
            <h2 className="todayGreeting">{getGreeting()}</h2>
            <p className="todayFullDate">{selectedWeekday}, {selectedMonthName} {selectedDate.getDate()}</p>
          </div>
          {statsSummary && <span className="todayInlineStats">{statsSummary}</span>}
        </div>
      )}

      {/* ─── Momentum ─── */}
      {isSelectedToday && hasProgress && (
        <p className="todayMomentumLine">
          {weeklyMomentum.completedThisWeek > 0 && <span>{weeklyMomentum.completedThisWeek} done this week</span>}
          {weeklyMomentum.deepWorkHours > 0 && <span>{weeklyMomentum.deepWorkHours}h deep work</span>}
          {weeklyMomentum.goalsAdvanced > 0 && <span>{weeklyMomentum.goalsAdvanced} goal{weeklyMomentum.goalsAdvanced !== 1 ? "s" : ""} moved</span>}
          {habitRate > 0 && <span>{habitRate}% habits</span>}
        </p>
      )}

      {/* ─── Calendar header + grid ─── */}
      <div className="calendarHeader">
        <div className="calendarHeaderLeft">
          <h2 className="calendarMonthTitle">
            {MONTH_NAMES[viewMonth]} {viewYear}
          </h2>
          <button type="button" className="calendarTodayBtn" onClick={goToToday}>Today</button>
        </div>
        <div className="calendarHeaderRight">
          <div className="calendarViewToggle">
            <button type="button" className={view === "month" ? "calendarViewBtn active" : "calendarViewBtn"} onClick={() => setView("month")}>Month</button>
            <button type="button" className={view === "week" ? "calendarViewBtn active" : "calendarViewBtn"} onClick={() => setView("week")}>Week</button>
          </div>
          <div className="calendarNavBtns">
            <button type="button" className="calendarNavBtn" onClick={prevMonth} aria-label="Previous month">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
            <button type="button" className="calendarNavBtn" onClick={nextMonth} aria-label="Next month">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          </div>
        </div>
      </div>

      {view === "month" ? (
        <div className="calendarGrid">
          {WEEKDAY_LABELS.map((d) => (
            <div key={d} className="calendarWeekdayHeader">{d}</div>
          ))}
          {grid.map((cell) => {
            const dk = isoDate(cell.date);
            const tasks = tasksByDate[dk] || [];
            const events = eventsByDate[dk] || [];
            const totalCount = tasks.length + events.length;
            const doneCount = tasks.filter((t) => t._done).length;
            const allDone = tasks.length > 0 && doneCount === tasks.length && events.length === 0;
            return (
              <button
                type="button"
                key={dk}
                className={[
                  "calendarDayCell",
                  cell.outside ? "outside" : "",
                  isToday(cell.date) ? "today" : "",
                  isSelected(cell.date) ? "selected" : "",
                ].filter(Boolean).join(" ")}
                onClick={() => setSelectedDate(new Date(cell.date))}
              >
                <span className="calendarDayNum">{cell.date.getDate()}</span>
                {totalCount > 0 && (
                  <div className="calendarDayDots">
                    {events.length > 0 && <span className="calendarDot" style={{ backgroundColor: "#8B5CF6" }} />}
                    {totalCount <= 4 ? (
                      tasks.slice(0, Math.min(3, 4 - events.length)).map((t, i) => (
                        <span
                          key={i}
                          className={t._done ? "calendarDot done" : "calendarDot"}
                          style={{ backgroundColor: t._done ? "#10B981" : effortColor(t.effortType) }}
                        />
                      ))
                    ) : (
                      <span className="calendarDotCount" style={{ color: allDone ? "#10B981" : "var(--accent)" }}>
                        {totalCount}
                      </span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="calendarWeekView">
          {weekDays.map((d) => {
            const dk = isoDate(d);
            const tasks = getTasksForDate(allTasks, dk, d, occurrenceStore);
            const events = eventsByDate[dk] || [];
            return (
              <button
                type="button"
                key={dk}
                className={[
                  "calendarWeekDay",
                  isToday(d) ? "today" : "",
                  sameDay(d, selectedDate) ? "selected" : "",
                ].filter(Boolean).join(" ")}
                onClick={() => setSelectedDate(new Date(d))}
              >
                <span className="calendarWeekDayLabel">{WEEKDAY_LABELS[(d.getDay() + 6) % 7]}</span>
                <span className="calendarWeekDayNum">{d.getDate()}</span>
                {(tasks.length + events.length) > 0 && (
                  <span className="calendarWeekDayCount">{tasks.length + events.length}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ─── Daily schedule ─── */}
      <div className="calendarDayDetail">
        <div className="calendarDayDetailHeader">
          <h3 className="calendarDayDetailTitle">
            {isSelectedToday ? "Today's schedule" : `${selectedWeekday}, ${selectedMonthName} ${selectedDate.getDate()}`}
          </h3>
          <div className="calendarDayDetailActions">
            {scheduleLoading && <span className="calendarLoadingDot" />}
            {onRecompute && isSelectedToday && (
              <button type="button" className="calendarTodayBtn" onClick={onRecompute} disabled={scheduleLoading}>
                {scheduleLoading ? "Optimizing..." : "Auto-schedule"}
              </button>
            )}
          </div>
        </div>

        {timeline.length === 0 && !calendarLoading ? (
          <div className="calendarEmptyDay">
            <p className="calendarEmptyDayText">
              {isSelectedToday
                ? "Your day is clear. Add tasks from Goals or Inbox."
                : "No tasks or events scheduled."}
            </p>
          </div>
        ) : (
          <>
            {/* Timed items — timeline view */}
            {timedCount > 0 && (
              <div className="calendarTimeline">
                {timeline.filter((item) => item.startMinutes != null).map((item) => {
                  const tier = getPriorityTier(item);
                  const goal = goalById[item.goalId];
                  return (
                    <div
                      key={item.id}
                      className={[
                        "calendarTimeBlock",
                        item._isCalendarEvent ? "gcalEvent" : "",
                        item._done ? "done" : "",
                      ].filter(Boolean).join(" ")}
                      onClick={() => !item._isCalendarEvent && onOpenTask?.(item.goalId, item.id)}
                    >
                      <div className="calendarTimeBlockTime">
                        <span className="calendarTimeStart">{item.startLabel}</span>
                        <span className="calendarTimeEnd">{item.endLabel}</span>
                      </div>
                      <div
                        className="calendarTimeBlockBar"
                        style={{ backgroundColor: item._isCalendarEvent ? "#8B5CF6" : effortColor(item.effortType) }}
                      />
                      <div className="calendarTimeBlockContent">
                        <div className="calendarTimeBlockTop">
                          <span className={`calendarTierBadge ${tierColorClass(tier)}`}>{tierLabel(tier)}</span>
                          <span className="calendarTimeBlockTitle">{item.title}</span>
                        </div>
                        <span className="calendarTimeBlockMeta">
                          {item._isCalendarEvent
                            ? (item.location || "Google Calendar")
                            : [goal?.title, item.estimatedMinutes ? formatMinutes(item.estimatedMinutes) : "", item.isRecurring ? "recurring" : ""].filter(Boolean).join(" \u00b7 ")}
                        </span>
                      </div>
                      {!item._isCalendarEvent && !item._done && (
                        <div className="calendarTaskActions">
                          <button type="button" className="calendarTaskAction" title="Mark done" onClick={(e) => { e.stopPropagation(); onDone?.(item); }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                          </button>
                        </div>
                      )}
                      {item._done && (
                        <span className="calendarTaskDoneCheck">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Untimed tasks — backlog */}
            {untimedTasks.length > 0 && (
              <div className="calendarUntimedSection">
                {timedCount > 0 && <span className="calendarUntimedLabel">Unscheduled</span>}
                <ul className="calendarTaskList">
                  {untimedTasks.map((task) => {
                    const tier = getPriorityTier(task);
                    const goal = goalById[task.goalId];
                    return (
                      <li
                        key={task.id}
                        className={task._done ? "calendarTaskItem done" : "calendarTaskItem"}
                        onClick={() => onOpenTask?.(task.goalId, task.id)}
                      >
                        <div className="calendarTaskLeft">
                          <span className={`calendarTierBadge small ${tierColorClass(tier)}`}>{tierLabel(tier)}</span>
                          <div className="calendarTaskInfo">
                            <span className="calendarTaskTitle">{task.title}</span>
                            <span className="calendarTaskMeta">
                              {goal?.title || ""}
                              {task.estimatedMinutes ? ` \u00b7 ${formatMinutes(task.estimatedMinutes)}` : ""}
                              {task.isRecurring && " \u00b7 recurring"}
                            </span>
                          </div>
                        </div>
                        <div className="calendarTaskActions">
                          {!task._done && onDone && (
                            <button type="button" className="calendarTaskAction" title="Mark done" onClick={(e) => { e.stopPropagation(); onDone(task); }}>
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                            </button>
                          )}
                          {!task._done && onSnooze && (
                            <button type="button" className="calendarTaskAction" title="Move to tomorrow" onClick={(e) => { e.stopPropagation(); onSnooze(task); }}>
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                            </button>
                          )}
                          {task._done && (
                            <span className="calendarTaskDoneCheck">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </>
        )}
      </div>

      {/* ─── Procrastination signals ─── */}
      {isSelectedToday && showSignals && (
        <article className="cardShell todaySignalsCard">
          <h3>Patterns detected</h3>
          {procrastinationSignals.slice(0, 2).map((signal, i) => (
            <div key={signal.id || i} className="signalItem">
              <p className="signalText">{signal.message || signal}</p>
              {signal.action && <p className="signalAction">{signal.action}</p>}
            </div>
          ))}
        </article>
      )}
    </div>
  );
}
