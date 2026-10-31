import { useEffect, useMemo, useState } from "react";
import { api } from "./portal-state.js";
import { AdminField, StatusMessage, formatDateTime, getCourseTypeDisplayLabel, isGovernmentCourse } from "./portal-views.jsx";

const EMPTY_SCHEDULE_FORM = {
  id: null,
  title: "",
  summary: "",
  location: "",
  startAt: "",
  endAt: "",
  timezone: "Asia/Seoul",
  visibility: "public",
  status: "scheduled",
  showOnLanding: false,
  promotionEnabled: false,
  promotionTitle: "",
  promotionMessage: "",
  promotionPriority: "0",
  badgeLabel: "",
  iconKey: "video",
  courseId: "",
  instructorName: "",
  capacity: "",
  applyUrl: "",
  applyMethod: "",
  memo: "",
  recurrenceExceptions: "",
  recurrenceFrequency: "none",
  recurrenceInterval: "1",
  recurrenceUntil: "",
  recurrenceCount: "",
  recurrenceWeekdays: [],
};
const DEFAULT_SCHEDULE_START_HOUR = 10;
const DEFAULT_SCHEDULE_DURATION_HOURS = 2;
const SCHEDULE_PAGE_SIZE = 10;
const SCHEDULE_ICON_OPTIONS = [
  { value: "video", label: "온라인", icon: "▶" },
  { value: "terminal", label: "랩", icon: "▣" },
  { value: "calendar", label: "일정", icon: "□" },
  { value: "check", label: "출석", icon: "✓" },
  { value: "rocket", label: "집중", icon: "▲" },
  { value: "cloud", label: "클라우드", icon: "☁" },
];
const WEEKDAYS = [
  { value: 0, label: "일" },
  { value: 1, label: "월" },
  { value: 2, label: "화" },
  { value: 3, label: "수" },
  { value: 4, label: "목" },
  { value: 5, label: "금" },
  { value: 6, label: "토" },
];
const CALENDAR_WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
const SCHEDULE_STATUS_OPTIONS = [
  { value: "scheduled", label: "예정", className: "is-muted" },
  { value: "recruiting", label: "모집중", className: "is-success" },
  { value: "closed", label: "마감", className: "is-warn" },
  { value: "ended", label: "종료", className: "is-muted" },
  { value: "cancelled", label: "취소", className: "is-error" },
];
const SCHEDULE_VISIBILITY_OPTIONS = [
  { value: "public", label: "비회원 공개" },
  { value: "member", label: "회원 공개" },
  { value: "admin", label: "관리자 전용" },
];

function getTodayDateInput() {
  return new Date().toISOString().slice(0, 10);
}

function isValidDate(date) {
  return date instanceof Date && !Number.isNaN(date.getTime());
}

function parseDateOrFallback(value, fallback = getTodayDateInput()) {
  const date = new Date(value);
  if (isValidDate(date)) return date;
  const fallbackDate = new Date(fallback);
  return isValidDate(fallbackDate) ? fallbackDate : new Date();
}

function toDateInputFromDate(date) {
  if (!isValidDate(date)) return getTodayDateInput();
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function shiftDateByMonths(value, amount) {
  const date = parseDateOrFallback(value);
  date.setDate(1);
  date.setMonth(date.getMonth() + amount);
  return toDateInputFromDate(date);
}

function getDateKey(date) {
  return isValidDate(date) ? toDateInputFromDate(date) : `invalid-${Math.random().toString(36).slice(2)}`;
}

function getDateTime(value, fallback = Number.POSITIVE_INFINITY) {
  const date = new Date(value);
  return isValidDate(date) ? date.getTime() : fallback;
}

function getEventDateRange(event) {
  const start = new Date(event?.startAt);
  const end = new Date(event?.endAt || event?.startAt);
  if (!isValidDate(start)) return null;
  return {
    start,
    end: isValidDate(end) && end > start ? end : new Date(start.getTime() + 1),
  };
}

function startOfLocalDay(value) {
  const date = parseDateOrFallback(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function eventIntersectsDay(event, day) {
  const range = getEventDateRange(event);
  if (!range || !isValidDate(day)) return false;
  const dayStart = startOfLocalDay(day);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  return range.start < dayEnd && range.end > dayStart;
}

function eventIntersectsMonth(event, anchorDate) {
  const range = getEventDateRange(event);
  if (!range) return false;
  const monthStart = parseDateOrFallback(anchorDate);
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthEnd = new Date(monthStart);
  monthEnd.setMonth(monthEnd.getMonth() + 1);
  return range.start < monthEnd && range.end > monthStart;
}

function getScheduleEventKind(event, linkedCourse = null, platformStatus = null) {
  return getScheduleCourseKind({
    ...(linkedCourse || {}),
    courseType: linkedCourse?.courseType || event?.courseType || "standard",
    programType: linkedCourse?.programType || event?.courseProgramType || "일반",
  }, platformStatus);
}

function getScheduleEventDedupeKey(event) {
  return [
    String(event?.title || "").trim().toLowerCase(),
    String(event?.startAt || "").slice(0, 19),
    String(event?.endAt || event?.startAt || "").slice(0, 19),
  ].join("|");
}

function dedupeScheduleEvents(events = []) {
  const seen = new Set();
  return events.filter((event) => {
    const key = getScheduleEventDedupeKey(event);
    if (!key.trim() || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildMonthEventBars(days, events, { getLinkedCourse = () => null, platformStatus = null, maxLanes = 3 } = {}) {
  if (!days.length) return [];
  const dayMs = 24 * 60 * 60 * 1000;
  const gridStart = startOfLocalDay(days[0]);
  const gridEnd = startOfLocalDay(days[days.length - 1]);
  gridEnd.setDate(gridEnd.getDate() + 1);
  const rowLanes = Array.from({ length: 6 }, () => []);
  const bars = [];

  dedupeScheduleEvents(events).forEach((event) => {
    const range = getEventDateRange(event);
    if (!range || range.end <= gridStart || range.start >= gridEnd) return;

    const eventStart = startOfLocalDay(range.start);
    const eventEndMarker = new Date(range.end.getTime() - 1);
    const eventEnd = startOfLocalDay(eventEndMarker);
    const startIndex = Math.max(0, Math.floor((eventStart.getTime() - gridStart.getTime()) / dayMs));
    const endIndex = Math.min(days.length - 1, Math.floor((eventEnd.getTime() - gridStart.getTime()) / dayMs));

    for (let row = Math.floor(startIndex / 7); row <= Math.floor(endIndex / 7); row += 1) {
      const rowStart = row * 7;
      const colStart = Math.max(startIndex, rowStart) - rowStart;
      const colEnd = Math.min(endIndex, rowStart + 6) - rowStart;
      const lanes = rowLanes[row];
      let lane = lanes.findIndex((lastCol) => lastCol < colStart);
      if (lane < 0) lane = lanes.length;
      if (lane >= maxLanes) continue;
      lanes[lane] = colEnd;
      const linkedCourse = getLinkedCourse(event);
      bars.push({
        event,
        key: `${event.occurrenceId || event.id}:${row}:${colStart}:${colEnd}`,
        row,
        lane,
        colStart,
        colSpan: colEnd - colStart + 1,
        kind: getScheduleEventKind(event, linkedCourse, platformStatus),
        linkedCourse,
      });
    }
  });

  return bars;
}

function toIsoStringOrEmpty(value) {
  const date = new Date(value);
  return isValidDate(date) ? date.toISOString() : "";
}

function getScheduleStatusMeta(status) {
  return SCHEDULE_STATUS_OPTIONS.find((item) => item.value === status) || SCHEDULE_STATUS_OPTIONS[0];
}

function getScheduleIconMeta(iconKey) {
  return SCHEDULE_ICON_OPTIONS.find((item) => item.value === iconKey) || SCHEDULE_ICON_OPTIONS[0];
}

function getScheduleDurationDays(event) {
  const range = getEventDateRange(event);
  if (!range) return null;
  const start = startOfLocalDay(range.start);
  const end = startOfLocalDay(range.end);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  return days;
}

function getScheduleBadgeLabel(event) {
  if (event?.badgeLabel) return event.badgeLabel;
  const days = getScheduleDurationDays(event);
  return days ? `${days}일` : getScheduleStatusMeta(event?.status).label;
}

function getScheduleVisibilityLabel(visibility) {
  return (SCHEDULE_VISIBILITY_OPTIONS.find((item) => item.value === visibility) || SCHEDULE_VISIBILITY_OPTIONS[0]).label;
}

function isScheduleApplyOpen(status) {
  return !["closed", "ended", "cancelled"].includes(String(status || "").trim());
}

function isLandingScheduleCandidate(event, now = new Date()) {
  const end = new Date(event?.endAt || event?.startAt || "");
  return Boolean(event?.showOnLanding || event?.promotionEnabled)
    && event?.visibility === "public"
    && event?.status !== "cancelled"
    && isValidDate(end)
    && end >= now;
}

function getLandingScheduleExclusionReason(event, now = new Date()) {
  if (!Boolean(event?.showOnLanding || event?.promotionEnabled)) return "";
  const end = new Date(event?.endAt || event?.startAt || "");
  if (event?.visibility !== "public") return "비회원 공개 아님";
  if (event?.status === "cancelled") return "취소된 일정";
  if (!isValidDate(end)) return "종료일 확인 필요";
  if (end < now) return "종료일 지남";
  return "";
}

function getScheduleCourseKind(courseLike, platformStatus = null) {
  if (String(courseLike?.courseType || "standard") === "online") return "online";
  const programType = String(courseLike?.programType || courseLike?.courseProgramType || "").trim().toLowerCase();
  if (programType === "ilt" || programType.includes("instructor led training")) return "ilt";
  if (isGovernmentCourse(courseLike, platformStatus)) return "government";
  return "standard";
}

function escapeCsvValue(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadScheduleCsv(events) {
  const headers = ["제목", "시작", "종료", "상태", "공개범위", "랜딩노출", "과정", "강사", "장소", "정원", "신청링크", "신청방식", "안내문구", "운영메모"];
  const rows = events.map((event) => [
    event.title,
    event.startAt,
    event.endAt,
    getScheduleStatusMeta(event.status).label,
    getScheduleVisibilityLabel(event.visibility),
    event.showOnLanding ? "Y" : "N",
    event.courseTitle,
    event.instructorName,
    event.location,
    event.capacity || "",
    event.applyUrl,
    event.applyMethod,
    event.summary,
    event.memo,
  ]);
  const csv = [headers, ...rows].map((row) => row.map(escapeCsvValue).join(",")).join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `schedule-events-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function toLocalInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toDateInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function buildLocalDateTime(dateValue, hour = DEFAULT_SCHEDULE_START_HOUR, minute = 0) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(hour)}:${pad(minute)}`;
}

function addHoursToLocalInput(value, hours) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  date.setHours(date.getHours() + hours);
  return buildLocalDateTime(date, date.getHours(), date.getMinutes());
}

function buildRange(anchorDate, viewMode) {
  const anchor = parseDateOrFallback(anchorDate);
  const from = new Date(anchor);
  const to = new Date(anchor);
  if (viewMode === "week") {
    const day = from.getDay();
    from.setDate(from.getDate() - day);
    from.setHours(0, 0, 0, 0);
    to.setTime(from.getTime());
    to.setDate(to.getDate() + 7);
    return { from: from.toISOString(), to: to.toISOString() };
  }
  if (viewMode === "month") {
    from.setDate(1);
    from.setHours(0, 0, 0, 0);
    to.setTime(from.getTime());
    to.setMonth(to.getMonth() + 1);
    return { from: from.toISOString(), to: to.toISOString() };
  }
  from.setHours(0, 0, 0, 0);
  to.setDate(to.getDate() + 90);
  return { from: from.toISOString(), to: to.toISOString() };
}

function formatDateLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", weekday: "short" }).format(date);
}

function formatMonthHeading(value) {
  const date = parseDateOrFallback(value);
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long" }).format(date);
}

function formatTimeRange(event) {
  const start = new Date(event.startAt);
  const end = new Date(event.endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";
  const formatter = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" });
  return `${formatter.format(start)} - ${formatter.format(end)}`;
}

function ScheduleEventCard({ event, compact = false, linkedCourse = null, onCourseAction = null, onSelect = null }) {
  const hasCourse = Boolean(event.courseId);
  const hasAccess = linkedCourse ? linkedCourse.hasAccess !== false : false;
  const statusMeta = getScheduleStatusMeta(event.status);
  const iconMeta = getScheduleIconMeta(event.iconKey);
  const badgeLabel = getScheduleBadgeLabel(event);
  const canApply = isScheduleApplyOpen(event.status);
  const courseActionLabel = hasCourse
    ? (canApply ? "\uACFC\uC815 \uBCF4\uAE30" : statusMeta.label)
    : "";
  return (
    <article className={`schedule-event-card ${compact ? "is-compact" : ""}`}>
      <div>
        <span className={`schedule-card-icon is-${iconMeta.value}`} aria-hidden="true">{iconMeta.icon}</span>
        <button className="schedule-title-btn" onClick={() => onSelect?.(event)} type="button">{event.title}</button>
        <span>{formatTimeRange(event)}</span>
      </div>
      <div className="portal-chip-row schedule-card-badges">
        <span className={`status-chip ${statusMeta.className}`}>{statusMeta.label}</span>
        <span className="status-chip is-online">{badgeLabel}</span>
        {String(event.courseType || linkedCourse?.courseType || "") === "online" ? <span className="status-chip is-success">온라인 클래스</span> : null}
        {event.promotionEnabled ? <span className="status-chip is-warn">홍보 노출</span> : null}
        {event.capacity ? <span className="status-chip is-muted">{`정원 ${event.capacity}명`}</span> : null}
      </div>
      {event.courseTitle ? (
        <p>
          <span className="status-chip is-muted">{getCourseTypeDisplayLabel({ courseType: event.courseType || "standard", programType: event.courseProgramType || "일반" })}</span>
          {event.courseTitle}
        </p>
      ) : null}
      {event.instructorName || event.location ? <small>{[event.instructorName ? `강사 ${event.instructorName}` : "", event.location].filter(Boolean).join(" · ")}</small> : null}
      {(event.promotionTitle || event.promotionMessage) ? <p className="schedule-promotion-copy">{event.promotionTitle || event.promotionMessage}</p> : null}
      {!compact && event.summary ? <small>{event.summary}</small> : null}
      {hasCourse && typeof onCourseAction === "function" ? (
        <button className={compact ? "mini-btn" : hasAccess ? "ghost-btn" : "primary-btn"} disabled={!canApply} onClick={() => onCourseAction(event)} type="button">
          {courseActionLabel}
        </button>
      ) : null}
    </article>
  );
}

export function UserScheduleView(props = {}) {
  const [viewMode, setViewMode] = useState("month");
  const [anchorDate, setAnchorDate] = useState(getTodayDateInput);
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState({ tone: "", message: "" });
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [filters, setFilters] = useState({ search: "", courseId: "", status: "", courseKind: "" });
  const range = useMemo(() => buildRange(anchorDate, viewMode), [anchorDate, viewMode]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      from: range.from,
      to: range.to,
      limit: "500",
    });
    if (filters.search.trim()) params.set("search", filters.search.trim());
    if (filters.courseId) params.set("courseId", filters.courseId);
    if (filters.status) params.set("status", filters.status);
    if (filters.courseKind === "online") params.set("courseType", "online");
    if (filters.courseKind === "government") params.set("government", "true");
    if (filters.courseKind === "standard") {
      params.set("courseType", "standard");
      params.set("government", "false");
    }
    api(`/api/schedule-events?${params.toString()}`)
      .then((result) => {
        if (!cancelled) {
          setEvents(result.events || []);
          setStatus({ tone: "", message: "" });
        }
      })
      .catch((error) => {
        if (!cancelled) setStatus({ tone: "error", message: error.message || "일정을 불러오지 못했습니다." });
      });
    return () => { cancelled = true; };
  }, [range.from, range.to, filters.search, filters.courseId, filters.status, filters.courseKind]);

  const monthDays = useMemo(() => {
    const first = parseDateOrFallback(anchorDate);
    first.setDate(1);
    const cursor = new Date(first);
    cursor.setDate(cursor.getDate() - cursor.getDay());
    return Array.from({ length: 42 }, () => {
      const day = new Date(cursor);
      cursor.setDate(cursor.getDate() + 1);
      return day;
    });
  }, [anchorDate]);
  const weekDays = useMemo(() => {
    const first = new Date(range.from);
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(first);
      day.setDate(first.getDate() + index);
      return day;
    });
  }, [range.from]);
  const sortedEvents = [...events].filter((event) => getEventDateRange(event)).sort((a, b) => getDateTime(a.startAt) - getDateTime(b.startAt));
  const visibleListEvents = sortedEvents.slice(0, SCHEDULE_PAGE_SIZE);
  function getLinkedCourse(event) {
    return (props.courses || []).find((course) => Number(course.id) === Number(event.courseId)) || null;
  }
  const monthBars = useMemo(() => buildMonthEventBars(monthDays, sortedEvents, {
    getLinkedCourse,
    platformStatus: props.platformStatus,
  }), [monthDays, sortedEvents, props.courses, props.platformStatus]);
  function handleCourseAction(event) {
    const linkedCourse = getLinkedCourse(event);
    if (!event.courseId) return;
    props.setSelectedCourseId?.(event.courseId);
    props.setOpenSelectedCourseDetail?.(true);
    const courseKind = getScheduleCourseKind(linkedCourse || event, props.platformStatus);
    props.setSection?.(courseKind === "online" ? "onlineCourses" : courseKind === "government" ? "governmentCourses" : courseKind === "ilt" ? "iltCourses" : "courses");
  }
  function moveAnchorMonth(amount) {
    setAnchorDate((current) => shiftDateByMonths(current, amount));
  }

  return (
    <section className="portal-stack">
      <section className="simple-panel schedule-panel">
        <div className="portal-detail-head schedule-head">
          <div>
            <p className="card-label">강의 일정</p>
            <h3>Terminal Lab 일정</h3>
          </div>
          <div className="schedule-toolbar">
            <button className="mini-btn" onClick={() => moveAnchorMonth(-1)} type="button">이전달</button>
            <button className="mini-btn" onClick={() => setAnchorDate(getTodayDateInput())} type="button">오늘</button>
            <button className="mini-btn" onClick={() => moveAnchorMonth(1)} type="button">다음달</button>
            <input aria-label="기준 날짜" type="date" value={anchorDate} onChange={(event) => setAnchorDate(event.target.value || getTodayDateInput())} />
            <div className="segmented-control">
              {["month", "week", "list"].map((mode) => (
                <button className={viewMode === mode ? "is-active" : ""} key={mode} onClick={() => setViewMode(mode)} type="button">
                  {mode === "month" ? "월" : mode === "week" ? "주" : "목록"}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="schedule-filter-bar">
          <input aria-label="일정 검색" placeholder="일정, 장소, 과정 검색" value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} />
          <select aria-label="과정 필터" value={filters.courseId} onChange={(event) => setFilters((current) => ({ ...current, courseId: event.target.value }))}>
            <option value="">전체 과정</option>
            {(props.courses || []).map((course) => <option key={course.id} value={course.id}>{`${getCourseTypeDisplayLabel(course, props.platformStatus)} · ${course.title}`}</option>)}
          </select>
          <select aria-label="상태 필터" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
            <option value="">전체 상태</option>
            {SCHEDULE_STATUS_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <select aria-label="과정 유형 필터" value={filters.courseKind} onChange={(event) => setFilters((current) => ({ ...current, courseKind: event.target.value }))}>
            <option value="">전체 유형</option>
            <option value="standard">🎓 일반 교육 과정</option>
            <option value="government">🏢 정부 과정</option>
            <option value="online">🌐 온라인 과정</option>
          </select>
        </div>
        <StatusMessage {...status} />
        {viewMode === "month" ? (
          <div className="schedule-month-board">
            <div className="schedule-month-grid">
              {monthDays.map((day) => (
                <button className={`schedule-day ${day.getMonth() === parseDateOrFallback(anchorDate).getMonth() ? "" : "is-muted"}`} key={getDateKey(day)} onClick={() => setAnchorDate(toDateInputFromDate(day))} type="button">
                  <strong>{day.getDate()}</strong>
                </button>
              ))}
            </div>
            <div className="schedule-month-bars">
              {monthBars.map((bar) => (
                <button
                  className={`schedule-month-bar is-${bar.kind}`}
                  key={bar.key}
                  onClick={() => setSelectedEvent(bar.event)}
                  style={{
                    "--bar-row": bar.row,
                    "--bar-lane": bar.lane,
                    "--bar-col": bar.colStart,
                    "--bar-span": bar.colSpan,
                  }}
                  type="button"
                >
                  {bar.event.title}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {viewMode === "week" ? (
          <div className="schedule-week-grid">
            {weekDays.map((day) => (
              <section className="schedule-week-day" key={getDateKey(day)}>
                <strong>{formatDateLabel(day)}</strong>
                {sortedEvents.filter((event) => eventIntersectsDay(event, day)).map((event) => <ScheduleEventCard event={event} key={event.occurrenceId || event.id} linkedCourse={getLinkedCourse(event)} onCourseAction={handleCourseAction} onSelect={setSelectedEvent} />)}
              </section>
            ))}
          </div>
        ) : null}
        {viewMode === "list" ? (
          <div className="schedule-list">
            {visibleListEvents.map((event) => (
              <div className="schedule-list-row" key={event.occurrenceId || event.id}>
                <span>{formatDateLabel(event.startAt)}</span>
                <ScheduleEventCard event={event} linkedCourse={getLinkedCourse(event)} onCourseAction={handleCourseAction} onSelect={setSelectedEvent} />
              </div>
            ))}
            {sortedEvents.length > SCHEDULE_PAGE_SIZE ? <p className="hint">{`한 화면에는 ${SCHEDULE_PAGE_SIZE}개까지 표시합니다. 필터나 날짜를 조정해 나머지 일정을 확인하세요.`}</p> : null}
          </div>
        ) : null}
        {!sortedEvents.length ? <p className="hint">표시할 공개 강의 일정이 없습니다.</p> : null}
        {selectedEvent ? (
          <div className="portal-modal-backdrop" onClick={() => setSelectedEvent(null)} role="presentation">
            <article className="portal-modal-card schedule-detail-modal" onClick={(event) => event.stopPropagation()}>
              <div className="portal-detail-head">
                <div>
                  <p className="card-label">일정 상세</p>
                  <h3>{selectedEvent.title}</h3>
                </div>
                <button className="mini-btn" onClick={() => setSelectedEvent(null)} type="button">닫기</button>
              </div>
              <div className="portal-chip-row">
                <span className={`status-chip ${getScheduleStatusMeta(selectedEvent.status).className}`}>{getScheduleStatusMeta(selectedEvent.status).label}</span>
                <span className="status-chip is-online">{getScheduleBadgeLabel(selectedEvent)}</span>
                {selectedEvent.promotionEnabled ? <span className="status-chip is-warn">홍보 노출</span> : null}
                <span className="status-chip is-muted">{formatDateTime(selectedEvent.startAt)}</span>
                {selectedEvent.courseTitle ? <span className="status-chip is-muted">{getCourseTypeDisplayLabel({ courseType: selectedEvent.courseType || "standard", programType: selectedEvent.courseProgramType || "일반" })}</span> : null}
              </div>
              <div className="schedule-detail-grid">
                <span>종료</span><strong>{formatDateTime(selectedEvent.endAt)}</strong>
                <span>강사</span><strong>{selectedEvent.instructorName || "-"}</strong>
                <span>장소</span><strong>{selectedEvent.location || "-"}</strong>
                <span>정원</span><strong>{selectedEvent.capacity ? `${selectedEvent.capacity}명` : "-"}</strong>
                <span>과정</span><strong>{selectedEvent.courseTitle || "-"}</strong>
              </div>
              {(selectedEvent.promotionTitle || selectedEvent.promotionMessage) ? (
                <section className="schedule-promotion-detail">
                  <strong>{selectedEvent.promotionTitle || "온라인 클래스 안내"}</strong>
                  {selectedEvent.promotionMessage ? <p>{selectedEvent.promotionMessage}</p> : null}
                </section>
              ) : null}
              {selectedEvent.summary ? <p>{selectedEvent.summary}</p> : null}
              {selectedEvent.memo ? <p className="hint">{selectedEvent.memo}</p> : null}
              <div className="admin-inline-actions">
                {selectedEvent.applyUrl && isScheduleApplyOpen(selectedEvent.status) ? <a className="primary-btn" href={selectedEvent.applyUrl} rel="noreferrer" target="_blank">신청 링크 열기</a> : null}
                {selectedEvent.applyMethod ? <span className="hint">{selectedEvent.applyMethod}</span> : null}
                {selectedEvent.courseId && isScheduleApplyOpen(selectedEvent.status) ? <button className="ghost-btn" onClick={() => handleCourseAction(selectedEvent)} type="button">과정 보기</button> : null}
                {!isScheduleApplyOpen(selectedEvent.status) ? <span className="hint">현재 상태에서는 신청을 받을 수 없습니다.</span> : null}
              </div>
            </article>
          </div>
        ) : null}
      </section>
    </section>
  );
}

export function AdminScheduleTab({ adminCourses = [], adminStatus, setAdminStatus, platformStatus = {} }) {
  const [events, setEvents] = useState([]);
  const [form, setForm] = useState(EMPTY_SCHEDULE_FORM);
  const [filters, setFilters] = useState({ search: "", courseId: "", status: "", visibility: "", courseKind: "" });
  const [adminAnchorDate, setAdminAnchorDate] = useState(getTodayDateInput);
  const [googleSyncing, setGoogleSyncing] = useState(false);
  const [googleSyncOptions, setGoogleSyncOptions] = useState({
    mode: "all",
    month: getTodayDateInput().slice(0, 7),
    skipPolicy: "manual-date",
  });

  async function loadEvents() {
    const result = await api("/api/admin/schedule-events");
    setEvents(result.events || []);
  }

  useEffect(() => {
    loadEvents().catch((error) => setAdminStatus?.(error.message || "일정을 불러오지 못했습니다."));
  }, []);

  function editEvent(event) {
    if (event.startAt) setAdminAnchorDate(String(event.startAt).slice(0, 10));
    setForm({
      id: event.id,
      title: event.title || "",
      summary: event.summary || "",
      memo: event.memo || "",
      location: event.location || "",
      instructorName: event.instructorName || "",
      capacity: event.capacity ? String(event.capacity) : "",
      applyUrl: event.applyUrl || "",
      applyMethod: event.applyMethod || "",
      startAt: toLocalInput(event.startAt),
      endAt: toLocalInput(event.endAt),
      timezone: event.timezone || "Asia/Seoul",
      visibility: event.visibility || "public",
      status: event.status || "scheduled",
      showOnLanding: Boolean(event.showOnLanding),
      promotionEnabled: Boolean(event.promotionEnabled),
      promotionTitle: event.promotionTitle || "",
      promotionMessage: event.promotionMessage || "",
      promotionPriority: String(event.promotionPriority || 0),
      badgeLabel: event.badgeLabel || "",
      iconKey: event.iconKey || "video",
      courseId: event.courseId ? String(event.courseId) : "",
      recurrenceExceptions: Array.isArray(event.recurrenceExceptions) ? event.recurrenceExceptions.join(", ") : "",
      recurrenceFrequency: event.recurrence?.frequency || "none",
      recurrenceInterval: String(event.recurrence?.interval || 1),
      recurrenceUntil: toDateInput(event.recurrence?.until),
      recurrenceCount: event.recurrence?.count ? String(event.recurrence.count) : "",
      recurrenceWeekdays: Array.isArray(event.recurrence?.weekdays) ? event.recurrence.weekdays : [],
    });
  }

  async function saveEvent(event) {
    event.preventDefault();
    const body = {
      title: form.title,
      summary: form.summary,
      memo: form.memo,
      location: form.location,
      instructorName: form.instructorName,
      capacity: form.capacity ? Number(form.capacity) : null,
      applyUrl: form.applyUrl,
      applyMethod: form.applyMethod,
      startAt: toIsoStringOrEmpty(form.startAt),
      endAt: toIsoStringOrEmpty(form.endAt),
      timezone: form.timezone,
      visibility: form.visibility,
      status: form.status,
      showOnLanding: form.showOnLanding,
      promotionEnabled: form.promotionEnabled,
      promotionTitle: form.promotionTitle,
      promotionMessage: form.promotionMessage,
      promotionPriority: Number(form.promotionPriority || 0),
      badgeLabel: form.badgeLabel,
      iconKey: form.iconKey,
      courseId: form.courseId ? Number(form.courseId) : null,
      recurrenceExceptions: form.recurrenceExceptions.split(",").map((item) => item.trim()).filter(Boolean),
      recurrence: {
        frequency: form.recurrenceFrequency,
        interval: Number(form.recurrenceInterval || 1),
        until: toIsoStringOrEmpty(form.recurrenceUntil ? `${form.recurrenceUntil}T23:59:59` : ""),
        count: form.recurrenceCount ? Number(form.recurrenceCount) : null,
        weekdays: form.recurrenceWeekdays,
      },
    };
    try {
      const result = await api(form.id ? `/api/admin/schedule-events/${form.id}` : "/api/admin/schedule-events", {
        method: form.id ? "PUT" : "POST",
        body,
      });
      setAdminStatus?.(result.message || "일정을 저장했습니다.");
      setForm(EMPTY_SCHEDULE_FORM);
      await loadEvents();
    } catch (error) {
      setAdminStatus?.(error.message || "일정을 저장하지 못했습니다.");
    }
  }

  async function deleteEvent(eventId) {
    try {
      const result = await api(`/api/admin/schedule-events/${eventId}`, { method: "DELETE" });
      setAdminStatus?.(result.message || "일정을 삭제했습니다.");
      await loadEvents();
    } catch (error) {
      setAdminStatus?.(error.message || "일정을 삭제하지 못했습니다.");
    }
  }

  async function createQuickCalendarEvent(day) {
    const startAt = buildLocalDateTime(day);
    if (!startAt) return;
    const endAt = addHoursToLocalInput(startAt, DEFAULT_SCHEDULE_DURATION_HOURS);
    try {
      const result = await api("/api/admin/schedule-events", {
        method: "POST",
        body: {
          title: "새 일정",
          summary: "",
          memo: "",
          location: "",
          instructorName: "",
          capacity: null,
          applyUrl: "",
          applyMethod: "",
          startAt: toIsoStringOrEmpty(startAt),
          endAt: toIsoStringOrEmpty(endAt),
          timezone: "Asia/Seoul",
          visibility: "public",
          status: "scheduled",
          showOnLanding: true,
          promotionEnabled: false,
          promotionTitle: "",
          promotionMessage: "",
          promotionPriority: 0,
          badgeLabel: "",
          iconKey: "calendar",
          courseId: null,
          recurrenceExceptions: [],
          recurrence: { frequency: "none", interval: 1, until: "", count: null, weekdays: [] },
        },
      });
      setAdminStatus?.(result.message || "일정을 등록했습니다.");
      await loadEvents();
      if (result.event) editEvent(result.event);
    } catch (error) {
      setAdminStatus?.(error.message || "일정을 바로 등록하지 못했습니다.");
    }
  }

  async function syncGoogleCalendar() {
    const icsUrl = String(platformStatus?.googleCalendarIcsUrl || "").trim();
    if (!icsUrl) {
      setAdminStatus?.("Google Calendar iCal URL을 먼저 플랫폼 설정에 입력해 주세요.");
      return;
    }
    setGoogleSyncing(true);
    try {
      const result = await api("/api/admin/schedule-events/google-sync", {
        method: "POST",
        body: {
          icsUrl,
          mode: googleSyncOptions.mode,
          month: googleSyncOptions.month || adminAnchorDate.slice(0, 7),
          skipPolicy: googleSyncOptions.skipPolicy,
        },
      });
      setAdminStatus?.(result.message || `Google Calendar 일정 ${result.synced || 0}건을 동기화했습니다.`);
      await loadEvents();
    } catch (error) {
      setAdminStatus?.(error.message || "Google Calendar 일정을 동기화하지 못했습니다.");
    } finally {
      setGoogleSyncing(false);
    }
  }

  function selectCalendarDay(day) {
    const startAt = buildLocalDateTime(day);
    if (!startAt) return;
    setAdminAnchorDate(startAt.slice(0, 10));
    setForm((current) => ({
      ...current,
      id: null,
      startAt,
      endAt: addHoursToLocalInput(startAt, DEFAULT_SCHEDULE_DURATION_HOURS),
    }));
  }

  const filteredEvents = events.filter((event) => {
    const normalizedSearch = filters.search.trim().toLowerCase();
    const eventText = [event.title, event.summary, event.location, event.instructorName, event.courseTitle].join(" ").toLowerCase();
    const eventCourse = adminCourses.find((course) => Number(course.id) === Number(event.courseId));
    const courseKind = getScheduleCourseKind({
      courseType: event.courseType || eventCourse?.courseType || "standard",
      programType: event.courseProgramType || eventCourse?.programType || "일반",
    });
    if (normalizedSearch && !eventText.includes(normalizedSearch)) return false;
    if (filters.courseId && Number(event.courseId) !== Number(filters.courseId)) return false;
    if (filters.status && event.status !== filters.status) return false;
    if (filters.visibility && event.visibility !== filters.visibility) return false;
    if (filters.courseKind && filters.courseKind !== courseKind) return false;
    return true;
  });
  const adminMonthDays = useMemo(() => {
    const first = parseDateOrFallback(adminAnchorDate);
    first.setDate(1);
    const cursor = new Date(first);
    cursor.setDate(cursor.getDate() - cursor.getDay());
    return Array.from({ length: 42 }, () => {
      const day = new Date(cursor);
      cursor.setDate(cursor.getDate() + 1);
      return day;
    });
  }, [adminAnchorDate]);
  const adminCalendarEvents = filteredEvents
    .filter((event) => eventIntersectsMonth(event, adminAnchorDate))
    .sort((a, b) => getDateTime(a.startAt) - getDateTime(b.startAt));
  const formLandingCandidate = isLandingScheduleCandidate({
    ...form,
    showOnLanding: form.showOnLanding,
    promotionEnabled: form.promotionEnabled,
    visibility: form.visibility,
    status: form.status,
    endAt: toIsoStringOrEmpty(form.endAt),
    startAt: toIsoStringOrEmpty(form.startAt),
  });
  const formLandingRequested = Boolean(form.showOnLanding || form.promotionEnabled);
  function getAdminLinkedCourse(event) {
    return adminCourses.find((course) => Number(course.id) === Number(event.courseId)) || null;
  }
  const adminMonthBars = useMemo(() => buildMonthEventBars(adminMonthDays, adminCalendarEvents, {
    getLinkedCourse: getAdminLinkedCourse,
  }), [adminMonthDays, adminCalendarEvents, adminCourses]);
  const adminMonthLabel = formatMonthHeading(adminAnchorDate);
  const adminMonthValue = adminAnchorDate.slice(0, 7);
  function moveAdminAnchorMonth(amount) {
    setAdminAnchorDate((current) => shiftDateByMonths(current, amount));
  }

  return (
    <section className="admin-simple-card">
      <div className="admin-card-header">
        <strong>강의 일정 관리</strong>
        <button className="mini-btn" onClick={() => downloadScheduleCsv(filteredEvents)} type="button">CSV 내보내기</button>
      </div>
      <StatusMessage tone={adminStatus ? "success" : ""} message={adminStatus || ""} />
      <section className="admin-schedule-sync-panel">
        <div>
          <strong>Google Calendar 동기화</strong>
          <p className="hint">플랫폼 설정의 iCal URL에서 일정을 가져오고, 가져온 일정의 상세 설명은 아래 편집 화면에서 보강할 수 있습니다.</p>
        </div>
        <div className="admin-schedule-sync-options">
          <label>
            <span>동기화 범위</span>
            <select
              value={googleSyncOptions.mode}
              onChange={(event) => setGoogleSyncOptions((current) => ({ ...current, mode: event.target.value }))}
            >
              <option value="all">전체</option>
              <option value="month">선택 월</option>
            </select>
          </label>
          <label>
            <span>월</span>
            <input
              disabled={googleSyncOptions.mode !== "month"}
              type="month"
              value={googleSyncOptions.month || adminMonthValue}
              onChange={(event) => setGoogleSyncOptions((current) => ({ ...current, month: event.target.value }))}
            />
          </label>
          <label>
            <span>수동 일정 보호</span>
            <select
              value={googleSyncOptions.skipPolicy}
              onChange={(event) => setGoogleSyncOptions((current) => ({ ...current, skipPolicy: event.target.value }))}
            >
              <option value="manual-date">같은 날짜 제외</option>
              <option value="manual-week">같은 주 제외</option>
              <option value="manual-weekday">같은 요일 제외</option>
              <option value="none">보호 안 함</option>
            </select>
          </label>
        </div>
        <div className="admin-inline-actions">
          <span className={`status-chip ${platformStatus?.googleCalendarSyncEnabled ? "is-success" : "is-muted"}`}>
            {platformStatus?.googleCalendarSyncEnabled ? "자동 동기화" : "수동 동기화"}
          </span>
          <button className="mini-btn" disabled={googleSyncing || !platformStatus?.googleCalendarIcsUrl} onClick={syncGoogleCalendar} type="button">
            {googleSyncing ? "동기화 중" : "Google 일정 가져오기"}
          </button>
        </div>
      </section>
      <section className="admin-schedule-calendar-panel">
        <div className="admin-card-header">
          <div>
            <strong>월간 일정</strong>
            <p className="hint">날짜를 클릭하면 해당 날짜로 신규 일정 시간이 자동 입력됩니다.</p>
          </div>
          <div className="admin-schedule-month-controls">
            <div className="admin-schedule-month-nav" aria-label="월 이동">
              <button className="mini-btn admin-schedule-icon-btn" onClick={() => moveAdminAnchorMonth(-1)} type="button" title="이전달" aria-label="이전달">
                <span aria-hidden="true">&lsaquo;</span>
                <span className="sr-only">이전달</span>
              </button>
              <button className="mini-btn admin-schedule-icon-btn is-today" onClick={() => setAdminAnchorDate(getTodayDateInput())} type="button" title="이번달" aria-label="이번달">
                <span aria-hidden="true">&bull;</span>
                <span className="sr-only">이번달</span>
              </button>
              <button className="mini-btn admin-schedule-icon-btn" onClick={() => moveAdminAnchorMonth(1)} type="button" title="다음달" aria-label="다음달">
                <span aria-hidden="true">&rsaquo;</span>
                <span className="sr-only">다음달</span>
              </button>
            </div>
            <input aria-label="관리자 일정 기준 월" type="month" value={adminMonthValue} onChange={(event) => setAdminAnchorDate(event.target.value ? `${event.target.value}-01` : getTodayDateInput())} />
          </div>
        </div>
        <div className="admin-schedule-month-summary" aria-live="polite">
          <span>현재 표시 월</span>
          <strong>{adminMonthLabel}</strong>
          <small>{adminMonthValue}</small>
        </div>
        <div className="admin-schedule-weekday-grid" aria-hidden="true">
          {CALENDAR_WEEKDAY_LABELS.map((label) => <span key={label}>{label}</span>)}
        </div>
        <div className="admin-schedule-month-board">
          <div className="admin-schedule-month-grid">
            {adminMonthDays.map((day) => {
              const isCurrentMonth = day.getMonth() === parseDateOrFallback(adminAnchorDate).getMonth();
              const isToday = getDateKey(day) === getTodayDateInput();
              return (
                <div className={`admin-schedule-day-cell ${isCurrentMonth ? "" : "is-muted"} ${isToday ? "is-today" : ""}`} key={getDateKey(day)}>
                  <button className="admin-schedule-day" onClick={() => selectCalendarDay(day)} type="button">
                    <strong>
                      <span>{day.getDate()}</span>
                      {isToday ? <span className="admin-schedule-today-icon" aria-label="오늘">📅</span> : null}
                    </strong>
                  </button>
                  <button className="admin-schedule-day-create" onClick={() => createQuickCalendarEvent(day)} type="button" aria-label={`${day.getDate()}일 일정 바로 생성`} title="일정 바로 생성">+</button>
                </div>
              );
            })}
          </div>
          <div className="schedule-month-bars admin-schedule-month-bars">
            {adminMonthBars.map((bar) => (
              <div
                className={`schedule-month-bar is-${bar.kind}`}
                key={bar.key}
                style={{
                  "--bar-row": bar.row,
                  "--bar-lane": bar.lane,
                  "--bar-col": bar.colStart,
                  "--bar-span": bar.colSpan,
                }}
              >
                <button className="schedule-month-bar-title" onClick={() => editEvent(bar.event)} type="button">{bar.event.title}</button>
                <button className="schedule-month-bar-delete" onClick={() => deleteEvent(bar.event.id)} type="button" aria-label={`${bar.event.title} 삭제`} title="삭제">×</button>
              </div>
            ))}
          </div>
        </div>
      </section>
      <form className="portal-stack" onSubmit={saveEvent}>
        <div className="admin-form-grid compact-admin-grid">
          <AdminField label="제목" required><input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} /></AdminField>
          <AdminField label="과정 연동">
            <select value={form.courseId} onChange={(event) => setForm((current) => ({ ...current, courseId: event.target.value }))}>
              <option value="">과정 없음</option>
              {adminCourses.map((course) => <option key={course.id} value={course.id}>{`${getCourseTypeDisplayLabel(course)} · ${course.title}`}</option>)}
            </select>
          </AdminField>
          <AdminField label="시작" required><input type="datetime-local" value={form.startAt} onChange={(event) => setForm((current) => ({ ...current, startAt: event.target.value }))} /></AdminField>
          <AdminField label="종료" required><input type="datetime-local" value={form.endAt} onChange={(event) => setForm((current) => ({ ...current, endAt: event.target.value }))} /></AdminField>
          <AdminField label="장소"><input value={form.location} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))} /></AdminField>
          <AdminField label="강사명"><input value={form.instructorName} onChange={(event) => setForm((current) => ({ ...current, instructorName: event.target.value }))} /></AdminField>
          <AdminField label="정원"><input min="0" type="number" value={form.capacity} onChange={(event) => setForm((current) => ({ ...current, capacity: event.target.value }))} /></AdminField>
          <AdminField label="공개 범위">
            <select value={form.visibility} onChange={(event) => setForm((current) => ({ ...current, visibility: event.target.value }))}>
              {SCHEDULE_VISIBILITY_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </AdminField>
          <AdminField label="상태">
            <select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
              {SCHEDULE_STATUS_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </AdminField>
          <AdminField label="신청 링크"><input value={form.applyUrl} onChange={(event) => setForm((current) => ({ ...current, applyUrl: event.target.value }))} placeholder="https://..." /></AdminField>
          <AdminField label="신청 방식"><input value={form.applyMethod} onChange={(event) => setForm((current) => ({ ...current, applyMethod: event.target.value }))} placeholder="과정 상세에서 신청, 별도 문의 등" /></AdminField>
          <AdminField label="반복">
            <select value={form.recurrenceFrequency} onChange={(event) => setForm((current) => ({ ...current, recurrenceFrequency: event.target.value }))}>
              <option value="none">반복 없음</option>
              <option value="daily">매일</option>
              <option value="weekly">매주</option>
              <option value="monthly">매월</option>
            </select>
          </AdminField>
          <AdminField label="반복 간격"><input min="1" type="number" value={form.recurrenceInterval} onChange={(event) => setForm((current) => ({ ...current, recurrenceInterval: event.target.value }))} /></AdminField>
          <AdminField label="반복 종료일"><input type="date" value={form.recurrenceUntil} onChange={(event) => setForm((current) => ({ ...current, recurrenceUntil: event.target.value }))} /></AdminField>
          <AdminField label="반복 횟수"><input min="1" max="200" type="number" value={form.recurrenceCount} onChange={(event) => setForm((current) => ({ ...current, recurrenceCount: event.target.value }))} /></AdminField>
          <AdminField label="예외 회차"><input value={form.recurrenceExceptions} onChange={(event) => setForm((current) => ({ ...current, recurrenceExceptions: event.target.value }))} placeholder="2026-05-05, 2026-05-12" /></AdminField>
        </div>
        {form.recurrenceFrequency === "weekly" ? (
          <div className="schedule-weekday-picker">
            {WEEKDAYS.map((day) => (
              <label key={day.value}>
                <input
                  checked={form.recurrenceWeekdays.includes(day.value)}
                  onChange={(event) => setForm((current) => ({
                    ...current,
                    recurrenceWeekdays: event.target.checked
                      ? [...current.recurrenceWeekdays, day.value]
                      : current.recurrenceWeekdays.filter((value) => value !== day.value),
                  }))}
                  type="checkbox"
                />
                {day.label}
              </label>
            ))}
          </div>
        ) : null}
        <label className="admin-checkbox-line">
          <input checked={form.showOnLanding} onChange={(event) => setForm((current) => ({ ...current, showOnLanding: event.target.checked }))} type="checkbox" />
          랜딩 페이지 일정 요약에 노출
        </label>
        <label className="admin-checkbox-line">
          <input checked={form.promotionEnabled} onChange={(event) => setForm((current) => ({ ...current, promotionEnabled: event.target.checked }))} type="checkbox" />
          온라인 클래스 홍보/알림 노출
        </label>
        {formLandingRequested ? (
          <div className={`hint ${formLandingCandidate ? "" : "is-error"}`}>
            {formLandingCandidate
              ? "랜딩에는 비회원 공개이고 종료 시간이 지나지 않은 일정만 표시됩니다."
              : "랜딩에 표시하려면 공개 범위를 비회원 공개로 두고 종료 시간을 오늘 이후로 설정해야 합니다."}
          </div>
        ) : null}
        <div className="admin-form-grid compact-admin-grid">
          <AdminField label="클래스 배지"><input value={form.badgeLabel} onChange={(event) => setForm((current) => ({ ...current, badgeLabel: event.target.value }))} placeholder="5일, 3일, 마감 임박" /></AdminField>
          <AdminField label="아이콘">
            <select value={form.iconKey} onChange={(event) => setForm((current) => ({ ...current, iconKey: event.target.value }))}>
              {SCHEDULE_ICON_OPTIONS.map((item) => <option key={item.value} value={item.value}>{`${item.icon} ${item.label}`}</option>)}
            </select>
          </AdminField>
          <AdminField label="홍보 제목"><input value={form.promotionTitle} onChange={(event) => setForm((current) => ({ ...current, promotionTitle: event.target.value }))} placeholder="5월 온라인 랩 모집 중" /></AdminField>
          <AdminField label="홍보 우선순위"><input min="0" max="100" type="number" value={form.promotionPriority} onChange={(event) => setForm((current) => ({ ...current, promotionPriority: event.target.value }))} /></AdminField>
        </div>
        <AdminField label="홍보 문구"><textarea value={form.promotionMessage} onChange={(event) => setForm((current) => ({ ...current, promotionMessage: event.target.value }))} placeholder="신청 마감, 운영 기간, 준비 사항 등을 짧게 안내하세요." /></AdminField>
        <AdminField label="안내 문구"><textarea value={form.summary} onChange={(event) => setForm((current) => ({ ...current, summary: event.target.value }))} /></AdminField>
        <AdminField label="운영 메모"><textarea value={form.memo} onChange={(event) => setForm((current) => ({ ...current, memo: event.target.value }))} /></AdminField>
        <div className="admin-inline-actions">
          <button className="mini-btn primary-mini-btn" type="submit">{form.id ? "일정 수정" : "일정 등록"}</button>
          <button className="mini-btn" onClick={() => setForm(EMPTY_SCHEDULE_FORM)} type="button">초기화</button>
        </div>
      </form>
      <div className="schedule-filter-bar">
        <input aria-label="관리자 일정 검색" placeholder="제목, 강사, 장소, 과정 검색" value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} />
        <select value={filters.courseId} onChange={(event) => setFilters((current) => ({ ...current, courseId: event.target.value }))}>
          <option value="">전체 과정</option>
          {adminCourses.map((course) => <option key={course.id} value={course.id}>{`${getCourseTypeDisplayLabel(course)} · ${course.title}`}</option>)}
        </select>
        <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
          <option value="">전체 상태</option>
          {SCHEDULE_STATUS_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <select value={filters.visibility} onChange={(event) => setFilters((current) => ({ ...current, visibility: event.target.value }))}>
          <option value="">전체 공개 범위</option>
          {SCHEDULE_VISIBILITY_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <select value={filters.courseKind} onChange={(event) => setFilters((current) => ({ ...current, courseKind: event.target.value }))}>
          <option value="">전체 유형</option>
          <option value="standard">🎓 일반 교육 과정</option>
          <option value="government">🏢 정부 과정</option>
          <option value="online">🌐 온라인 과정</option>
        </select>
      </div>
      <div className="admin-table admin-table-scroll">
        <div className="admin-table-head admin-schedule-grid"><span>일정</span><span>과정</span><span>상태/공개</span><span>관리</span></div>
        {filteredEvents.map((event) => (
          <div className="admin-table-row admin-schedule-grid" key={event.id}>
            <span><strong>{event.title}</strong><small>{formatDateTime(event.startAt)} - {formatDateTime(event.endAt)}</small><small>{[event.instructorName, event.location].filter(Boolean).join(" · ")}</small></span>
            <span>{event.courseTitle || "-"}</span>
            <span className="portal-chip-row">
              <span className={`status-chip ${getScheduleStatusMeta(event.status).className}`}>{getScheduleStatusMeta(event.status).label}</span>
              <span className={`status-chip ${event.visibility === "public" ? "is-success" : event.visibility === "member" ? "is-warn" : "is-muted"}`}>{getScheduleVisibilityLabel(event.visibility)}</span>
              {event.scheduleSource === "google-calendar" ? <span className="status-chip is-info">Google</span> : null}
              {Boolean(event.showOnLanding || event.promotionEnabled) ? (() => {
                const landingCandidate = isLandingScheduleCandidate(event);
                const landingReason = getLandingScheduleExclusionReason(event);
                return (
                  <>
                    <span className={`status-chip ${landingCandidate ? "is-government" : "is-muted"}`} title={landingReason || "랜딩 페이지 공개 대상입니다."}>
                      {landingCandidate ? "랜딩 공개" : "랜딩 제외"}
                    </span>
                    {!landingCandidate && landingReason ? <span className="status-chip is-muted" title="랜딩 제외 사유">{landingReason}</span> : null}
                  </>
                );
              })() : null}
              {event.promotionEnabled ? <span className="status-chip is-warn">홍보</span> : null}
              <span className="status-chip is-online">{getScheduleBadgeLabel(event)}</span>
            </span>
            <div className="admin-inline-actions">
              <button className="mini-btn" onClick={() => editEvent(event)} type="button">수정</button>
              <button className="mini-btn danger-mini-btn" onClick={() => deleteEvent(event.id)} type="button">삭제</button>
            </div>
          </div>
        ))}
        {!filteredEvents.length ? (
          <div className="admin-table-row admin-schedule-grid">
            <span>조건에 맞는 일정이 없습니다.</span>
            <span>-</span>
            <span>-</span>
            <span>-</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
