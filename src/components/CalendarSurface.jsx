import { useState, useMemo, useCallback } from "react";
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

function getMonthGrid(year, month) {
  const first = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0).getDate();
  // Monday-based: 0=Mon … 6=Sun
  let startDow = first.getDay() - 1;
  if (startDow < 0) startDow = 6;

  const cells = [];
  // leading blanks
  for (let i = 0; i < startDow; i++) {
    const d = new Date(year, month, 1 - (startDow - i));
    cells.push({ date: d, outside: true });
  }
  // month days
  for (let d = 1; d <= lastDay; d++) {
    cells.push({ date: new Date(year, month, d), outside: false });
  }
  // trailing blanks to fill last row
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
      // One-time: show on scheduledDate, dueDate, or completionDate
      const matchDate =
        task.scheduledDate || task.dueDate || null;
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

export default function CalendarSurface({
  allTasks,
  goals,
  occurrenceStore,
  onOpenTask,
  onDone,
  onSnooze,
}) {
  const today = useMemo(() => new Date(), []);
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState(today);
  const [view, setView] = useState("month"); // "month" | "week"

  const grid = useMemo(() => getMonthGrid(viewYear, viewMonth), [viewYear, viewMonth]);

  // Build a map of dateKey → task count for dot indicators
  const tasksByDate = useMemo(() => {
    const map = {};
    for (const cell of grid) {
      const dk = isoDate(cell.date);
      map[dk] = getTasksForDate(allTasks, dk, cell.date, occurrenceStore);
    }
    return map;
  }, [grid, allTasks, occurrenceStore]);

  const selectedDateKey = isoDate(selectedDate);
  const selectedTasks = useMemo(
    () => getTasksForDate(allTasks, selectedDateKey, selectedDate, occurrenceStore),
    [allTasks, selectedDateKey, selectedDate, occurrenceStore]
  );

  // Goal lookup for color
  const goalById = useMemo(() => {
    const m = {};
    for (const g of goals) m[g.id] = g;
    return m;
  }, [goals]);

  const prevMonth = useCallback(() => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
  }, [viewMonth]);

  const nextMonth = useCallback(() => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
  }, [viewMonth]);

  const goToToday = useCallback(() => {
    const now = new Date();
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
    setSelectedDate(now);
  }, []);

  const isToday = (d) => sameDay(d, today);
  const isSelected = (d) => sameDay(d, selectedDate);

  // Week view helpers
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

  // Total minutes for selected day
  const dayTotalMinutes = selectedTasks.reduce(
    (s, t) => s + (t.estimatedMinutes || 30), 0
  );
  const dayCompletedCount = selectedTasks.filter((t) => t._done).length;

  const selectedWeekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][selectedDate.getDay()];
  const selectedMonthName = MONTH_NAMES[selectedDate.getMonth()];

  return (
    <div className="calendarSurface">
      {/* Header */}
      <div className="calendarHeader">
        <div className="calendarHeaderLeft">
          <h2 className="calendarMonthTitle">
            {MONTH_NAMES[viewMonth]} {viewYear}
          </h2>
          <button type="button" className="calendarTodayBtn" onClick={goToToday}>
            Today
          </button>
        </div>
        <div className="calendarHeaderRight">
          <div className="calendarViewToggle">
            <button
              type="button"
              className={view === "month" ? "calendarViewBtn active" : "calendarViewBtn"}
              onClick={() => setView("month")}
            >
              Month
            </button>
            <button
              type="button"
              className={view === "week" ? "calendarViewBtn active" : "calendarViewBtn"}
              onClick={() => setView("week")}
            >
              Week
            </button>
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

      {/* Calendar Grid */}
      {view === "month" ? (
        <div className="calendarGrid">
          {/* Weekday headers */}
          {WEEKDAY_LABELS.map((d) => (
            <div key={d} className="calendarWeekdayHeader">{d}</div>
          ))}
          {/* Day cells */}
          {grid.map((cell) => {
            const dk = isoDate(cell.date);
            const tasks = tasksByDate[dk] || [];
            const doneCount = tasks.filter((t) => t._done).length;
            const totalCount = tasks.length;
            const allDone = totalCount > 0 && doneCount === totalCount;
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
                    {totalCount <= 4 ? (
                      tasks.slice(0, 4).map((t, i) => (
                        <span
                          key={i}
                          className={t._done ? "calendarDot done" : "calendarDot"}
                          style={{ backgroundColor: t._done ? "#10B981" : effortColor(t.effortType) }}
                        />
                      ))
                    ) : (
                      <>
                        <span className="calendarDotCount" style={{ color: allDone ? "#10B981" : "var(--accent)" }}>
                          {totalCount}
                        </span>
                      </>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        /* Week view */
        <div className="calendarWeekView">
          {weekDays.map((d) => {
            const dk = isoDate(d);
            const tasks = getTasksForDate(allTasks, dk, d, occurrenceStore);
            const isSel = sameDay(d, selectedDate);
            const isTod = isToday(d);
            return (
              <button
                type="button"
                key={dk}
                className={[
                  "calendarWeekDay",
                  isTod ? "today" : "",
                  isSel ? "selected" : "",
                ].filter(Boolean).join(" ")}
                onClick={() => setSelectedDate(new Date(d))}
              >
                <span className="calendarWeekDayLabel">
                  {WEEKDAY_LABELS[(d.getDay() + 6) % 7]}
                </span>
                <span className="calendarWeekDayNum">{d.getDate()}</span>
                {tasks.length > 0 && (
                  <span className="calendarWeekDayCount">{tasks.length}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Selected day detail */}
      <div className="calendarDayDetail">
        <div className="calendarDayDetailHeader">
          <h3 className="calendarDayDetailTitle">
            {selectedWeekday}, {selectedMonthName} {selectedDate.getDate()}
          </h3>
          <span className="calendarDayDetailMeta">
            {selectedTasks.length === 0
              ? "Nothing scheduled"
              : `${selectedTasks.length} task${selectedTasks.length !== 1 ? "s" : ""} · ${formatMinutes(dayTotalMinutes)}`}
            {dayCompletedCount > 0 && ` · ${dayCompletedCount} done`}
          </span>
        </div>

        {selectedTasks.length === 0 ? (
          <div className="calendarEmptyDay">
            <p className="calendarEmptyDayText">
              {sameDay(selectedDate, today)
                ? "Your day is clear. Add tasks from Goals or Inbox."
                : "No tasks scheduled for this day."}
            </p>
          </div>
        ) : (
          <ul className="calendarTaskList">
            {selectedTasks.map((task) => {
              const goal = goalById[task.goalId];
              return (
                <li
                  key={task.id}
                  className={task._done ? "calendarTaskItem done" : "calendarTaskItem"}
                  onClick={() => onOpenTask?.(task.goalId, task.id)}
                >
                  <div className="calendarTaskLeft">
                    <span
                      className="calendarTaskDot"
                      style={{ backgroundColor: task._done ? "#10B981" : effortColor(task.effortType) }}
                    />
                    <div className="calendarTaskInfo">
                      <span className="calendarTaskTitle">{task.title}</span>
                      <span className="calendarTaskMeta">
                        {goal?.title || ""}
                        {task.estimatedMinutes ? ` · ${formatMinutes(task.estimatedMinutes)}` : ""}
                        {task.isRecurring && " · recurring"}
                      </span>
                    </div>
                  </div>
                  <div className="calendarTaskActions">
                    {!task._done && onDone && (
                      <button
                        type="button"
                        className="calendarTaskAction"
                        title="Mark done"
                        onClick={(e) => { e.stopPropagation(); onDone(task); }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </button>
                    )}
                    {!task._done && onSnooze && (
                      <button
                        type="button"
                        className="calendarTaskAction"
                        title="Snooze to tomorrow"
                        onClick={(e) => { e.stopPropagation(); onSnooze(task); }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </button>
                    )}
                    {task._done && (
                      <span className="calendarTaskDoneCheck">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
