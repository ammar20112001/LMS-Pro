import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchDueSoon, fetchCourses, fetchSyncRuns, triggerSync,
  fetchProgress, fetchLectures, Course, Item, SyncRun, Lecture,
} from "../api/client";
import { formatDistanceToNow, parseISO, differenceInHours } from "date-fns";

const COURSE_COLORS = [
  "#6366f1","#8b5cf6","#06b6d4","#10b981","#f59e0b","#ef4444","#ec4899","#14b8a6",
];

function courseColor(index: number) {
  return COURSE_COLORS[index % COURSE_COLORS.length];
}

function timeUntil(dueAt: string | null) {
  if (!dueAt) return { label: "No deadline", urgent: false, overdue: false };
  const diff = parseISO(dueAt).getTime() - Date.now();
  if (diff < 0) {
    const h = Math.abs(Math.floor(diff / 3_600_000));
    const d = Math.floor(h / 24);
    return { label: d > 0 ? `${d}d overdue` : `${h}h overdue`, urgent: true, overdue: true };
  }
  const h = Math.floor(diff / 3_600_000);
  const d = Math.floor(h / 24);
  const hrs = h % 24;
  if (h === 0) { const m = Math.floor(diff / 60000); return { label: `${m}m left`, urgent: true, overdue: false }; }
  if (d === 0) return { label: `${h}h left`, urgent: h < 6, overdue: false };
  if (d === 1) return { label: `${d}d ${hrs}h left`, urgent: true, overdue: false };
  return { label: `${d}d left`, urgent: false, overdue: false };
}

function formatDue(dueAt: string | null) {
  if (!dueAt) return "—";
  return parseISO(dueAt).toLocaleDateString("en-PK", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function TypeBadge({ kind }: { kind: string }) {
  const map: Record<string, string> = { assignment: "badge--assign", quiz: "badge--quiz", gdb: "badge--gdb" };
  const label: Record<string, string> = { assignment: "ASSIGN", quiz: "QUIZ", gdb: "GDB" };
  return <span className={`badge ${map[kind] ?? ""}`}>{label[kind] ?? kind}</span>;
}

function StatusChip({ status }: { status: string | null }) {
  const s = (status ?? "").toLowerCase();
  if (s === "submitted") return <span className="status-chip status-chip--submitted">✓ Submitted</span>;
  if (s === "expired") return <span className="status-chip status-chip--expired">Expired</span>;
  if (s === "open") return <span className="status-chip status-chip--open">Open Now</span>;
  return <span className="status-chip status-chip--pending">Pending</span>;
}

// ── Sync bar ──────────────────────────────────────────────────────────────────
function SyncBar({ runs, onSync, syncing }: { runs: SyncRun[]; onSync: () => void; syncing: boolean }) {
  return (
    <div className="sync-bar">
      <div className="sync-bar__history">
        {runs.slice(0, 2).map((s) => (
          <div key={s.id} className="sync-bar__item">
            <div className={`sync-dot ${s.status === "ok" ? "sync-dot--ok" : s.status === "running" ? "sync-dot--running" : "sync-dot--err"}`} />
            <span>{s.started_at ? formatDistanceToNow(parseISO(s.started_at), { addSuffix: true }) : "—"}</span>
            {s.status === "ok"
              ? <span className="sync-bar__detail">+{s.items_added} · {s.items_updated} updated</span>
              : s.status === "running"
                ? <span className="sync-bar__detail">Syncing…</span>
                : <span className="sync-bar__detail sync-bar__detail--err">Error</span>
            }
          </div>
        ))}
      </div>
      <button className={`btn-sync ${syncing ? "btn-sync--active" : ""}`} onClick={onSync} disabled={syncing}>
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className={syncing ? "spin" : ""}>
          <path d="M11.5 6.5A5 5 0 112.3 3.2M11.5 6.5V3M11.5 3H8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {syncing ? "Syncing…" : "Sync Now"}
      </button>
    </div>
  );
}

// ── Focus card ────────────────────────────────────────────────────────────────
function FocusCard({ item, color, label, onSelect }: { item: Item | null; color: string; label: string; onSelect: (i: Item) => void }) {
  if (!item) {
    return (
      <div className="focus-card focus-card--empty">
        <div className="focus-card__empty-icon">✓</div>
        <div className="focus-card__empty-text">Nothing urgent</div>
      </div>
    );
  }
  const t = timeUntil(item.due_at);
  return (
    <div
      className={`focus-card ${t.urgent ? "focus-card--urgent" : ""}`}
      style={{ "--course-color": color } as React.CSSProperties}
      onClick={() => onSelect(item)}
    >
      <div className="focus-card__label">{label}</div>
      <div className="focus-card__bar" />
      <div className="focus-card__body">
        <div className="focus-card__top">
          <TypeBadge kind={item.kind} />
          <span className="focus-card__course">{item.course_code}</span>
        </div>
        <div className="focus-card__title">{item.title}</div>
        <div className="focus-card__bottom">
          <span className="focus-card__due">Due {formatDue(item.due_at)}</span>
          <span className={`focus-card__time ${t.urgent ? "focus-card__time--urgent" : ""}`}>{t.label}</span>
        </div>
      </div>
    </div>
  );
}

// ── Study card ────────────────────────────────────────────────────────────────
function StudyCard({ lecture, course, color, onSelect }: { lecture: Lecture; course: Course; color: string; onSelect: () => void }) {
  return (
    <div
      className="study-focus-card"
      style={{ "--course-color": color } as React.CSSProperties}
      onClick={onSelect}
    >
      <div className="study-focus-card__label">Study Next</div>
      <div className="study-focus-card__bar" />
      <div className="study-focus-card__body">
        <div className="study-focus-card__top">
          <span className="study-focus-card__course">{course.code}</span>
          <span className="study-focus-card__lec">Lecture {lecture.serial_no}</span>
        </div>
        <div className="study-focus-card__title">{lecture.title}</div>
        <div className="study-focus-card__reason">Has transcript available</div>
      </div>
      <div className="study-focus-card__cta">Open handout →</div>
    </div>
  );
}

// ── Week timeline ─────────────────────────────────────────────────────────────
function WeekTimeline({ items, courses, onSelectItem }: { items: Item[]; courses: Course[]; onSelectItem: (i: Item) => void }) {
  const colorMap = Object.fromEntries(courses.map((c, i) => [c.id, courseColor(i)]));

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return d;
  });

  const dayLabel = (d: Date, i: number) => {
    if (i === 0) return "Today";
    if (i === 1) return "Tomorrow";
    return d.toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" });
  };

  const itemsForDay = (day: Date) =>
    items.filter((item) => {
      if (!item.due_at) return false;
      const due = parseISO(item.due_at);
      return due.getFullYear() === day.getFullYear() &&
        due.getMonth() === day.getMonth() &&
        due.getDate() === day.getDate();
    });

  return (
    <div className="week-timeline">
      {days.map((day, i) => {
        const dayItems = itemsForDay(day);
        return (
          <div key={i} className={`week-col ${i === 0 ? "week-col--today" : ""} ${dayItems.length === 0 ? "week-col--empty" : ""}`}>
            <div className="week-col__label">{dayLabel(day, i)}</div>
            <div className="week-col__items">
              {dayItems.length === 0
                ? <div className="week-col__empty-dot" />
                : dayItems.map((item) => {
                  const color = colorMap[item.course_id] ?? "#6366f1";
                  const t = timeUntil(item.due_at);
                  const done = item.status === "Submitted" || !!item.completed_at;
                  return (
                    <div
                      key={item.id}
                      className={`week-item week-item--${item.kind} ${done ? "week-item--done" : ""}`}
                      style={{ "--course-color": color } as React.CSSProperties}
                      onClick={() => onSelectItem(item)}
                      title={`${item.course_code}: ${item.title}`}
                    >
                      <div className="week-item__bar" />
                      <div className="week-item__body">
                        <div className="week-item__course">{item.course_code}</div>
                        <div className="week-item__title">{item.title}</div>
                        <div className="week-item__meta">
                          <TypeBadge kind={item.kind} />
                          {done
                            ? <span className="week-item__done">✓</span>
                            : <span className="week-item__time">{t.label}</span>
                          }
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Course row (bottom section) ────────────────────────────────────────────────
function CourseRow({ course, color, items, onSelectCourse }: { course: Course; color: string; items: Item[]; onSelectCourse: () => void }) {
  const { data: progress } = useQuery({
    queryKey: ["progress", course.id],
    queryFn: () => fetchProgress(course.id),
    staleTime: 60_000,
  });
  const pct = progress && progress.total_lectures > 0
    ? Math.round((progress.current_lecture_serial / progress.total_lectures) * 100)
    : 0;
  const nextDue = items
    .filter((i) => i.course_id === course.id && i.due_at && i.status !== "Submitted" && i.status !== "Expired")
    .sort((a, b) => parseISO(a.due_at!).getTime() - parseISO(b.due_at!).getTime())[0] ?? null;

  return (
    <div
      className="dashboard-course-row"
      style={{ "--course-color": color } as React.CSSProperties}
      onClick={onSelectCourse}
    >
      <div className="dashboard-course-row__bar" />
      <div className="dashboard-course-row__body">
        <div className="dashboard-course-row__top">
          <span className="dashboard-course-row__code">{course.code}</span>
          <span className="dashboard-course-row__title">{course.title}</span>
        </div>
        <div className="dashboard-course-row__bottom">
          <div className="dashboard-course-row__progress">
            <div className="dashboard-course-row__track">
              <div className="dashboard-course-row__fill" style={{ width: `${pct}%`, background: color }} />
            </div>
            <span className="dashboard-course-row__pct">{pct}%</span>
          </div>
          {nextDue && (
            <span className={`dashboard-course-row__next ${timeUntil(nextDue.due_at).urgent ? "text-urgent" : ""}`}>
              {timeUntil(nextDue.due_at).label}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Lecture study queue ───────────────────────────────────────────────────────
function StudyQueue({ courses, onSelectLecture }: { courses: Course[]; onSelectLecture: (l: Lecture, c: Course, idx: number) => void }) {
  const { data: lectures = [] } = useQuery({
    queryKey: ["all-transcribed-lectures"],
    queryFn: async () => {
      const all = await Promise.all(courses.map((c) => fetchLectures(c.id)));
      return all.flatMap((lecs, i) => lecs.map((l) => ({ ...l, _courseIdx: i })));
    },
    enabled: courses.length > 0,
    staleTime: 60_000,
  });

  const queue = lectures
    .filter((l) => l.notes_status === "transcribed" || l.notes_status === "done")
    .slice(0, 5);

  if (queue.length === 0) return (
    <div className="empty-state" style={{ minHeight: "auto", padding: "1rem" }}>
      No transcribed lectures yet. The background job will fetch them automatically.
    </div>
  );

  return (
    <div className="study-queue">
      {queue.map((lec, i) => {
        const course = courses.find((c) => c.id === lec.course_id);
        if (!course) return null;
        const color = courseColor(courses.findIndex((c) => c.id === course.id));
        return (
          <div
            key={lec.id}
            className="study-queue-row"
            style={{ "--course-color": color } as React.CSSProperties}
            onClick={() => onSelectLecture(lec, course, courses.findIndex((c) => c.id === course.id))}
          >
            <div className="study-queue-row__num">{i + 1}</div>
            <div className="study-queue-row__bar" />
            <div className="study-queue-row__body">
              <div className="study-queue-row__head">
                <span className="study-queue-row__course">{course.code}</span>
                <span className="study-queue-row__lec">Lec {lec.serial_no}</span>
                <span className="study-queue-row__title">{lec.title}</span>
              </div>
              <div className="study-queue-row__reason">
                <span className="study-next-dot" style={{ background: "var(--accent)" }} />
                {lec.notes_status === "done" ? "Handout ready" : "Transcript available"}
              </div>
            </div>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M4.5 3l4 3.5-4 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
          </div>
        );
      })}
    </div>
  );
}

interface Props {
  onSelectItem: (item: Item, courses: Course[]) => void;
  onSelectCourse: (course: Course) => void;
  onSelectLecture?: (lecture: Lecture, course: Course, courseIdx: number) => void;
}

export function Dashboard({ onSelectItem, onSelectCourse, onSelectLecture }: Props) {
  const qc = useQueryClient();

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["due-soon"],
    queryFn: () => fetchDueSoon(14),
    refetchInterval: 60_000,
  });

  const { data: courses = [] } = useQuery({
    queryKey: ["courses"],
    queryFn: fetchCourses,
  });

  const { data: runs = [] } = useQuery({
    queryKey: ["sync-runs"],
    queryFn: fetchSyncRuns,
    refetchInterval: 30_000,
  });

  const syncMut = useMutation({
    mutationFn: triggerSync,
    onSuccess: () => setTimeout(() => qc.invalidateQueries(), 3000),
  });

  const colorMap = Object.fromEntries(courses.map((c, i) => [c.id, courseColor(i)]));

  const pending = items
    .filter((i) => i.status !== "Submitted" && i.status !== "Expired")
    .sort((a, b) => parseISO(a.due_at ?? "9999").getTime() - parseISO(b.due_at ?? "9999").getTime());

  const urgentCount = items.filter((i) => {
    if (i.status === "Submitted" || i.status === "Expired" || !i.due_at) return false;
    return differenceInHours(parseISO(i.due_at), new Date()) < 24;
  }).length;

  const doNow = pending.find((i) => {
    if (!i.due_at) return false;
    const diff = parseISO(i.due_at).getTime() - Date.now();
    return diff > 0 && diff < 2 * 24 * 3_600_000;
  }) ?? pending[0] ?? null;

  const doToday = pending.find((i) => {
    if (i === doNow || !i.due_at) return false;
    const diff = parseISO(i.due_at).getTime() - Date.now();
    return diff > 0 && diff < 5 * 24 * 3_600_000;
  }) ?? null;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="page dashboard-v2">

      {/* Hero */}
      <div className="today-hero">
        <div className="today-hero__left">
          <div className="today-hero__greeting">{greeting}</div>
          <div className="today-hero__date">
            {new Date().toLocaleDateString("en-PK", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
          </div>
          <div className="today-hero__summary">
            {urgentCount > 0
              ? <><span className="today-hero__urgent">{urgentCount} urgent</span> · {pending.length} total pending</>
              : pending.length > 0
                ? <>{pending.length} items pending · no urgent deadlines</>
                : <span style={{ color: "var(--green)" }}>All caught up 🎉</span>
            }
          </div>
        </div>
        <SyncBar runs={runs} onSync={() => syncMut.mutate()} syncing={syncMut.isPending} />
      </div>

      {/* Focus triptych */}
      <div className="focus-triptych">
        <FocusCard item={doNow} color={doNow ? colorMap[doNow.course_id] ?? "#6366f1" : "#6366f1"} label="Do Now" onSelect={(i) => onSelectItem(i, courses)} />
        <FocusCard item={doToday} color={doToday ? colorMap[doToday.course_id] ?? "#6366f1" : "#6366f1"} label="Do Today" onSelect={(i) => onSelectItem(i, courses)} />
        <FocusCard item={pending[2] ?? null} color={pending[2] ? colorMap[pending[2].course_id] ?? "#6366f1" : "#6366f1"} label="Due Soon" onSelect={(i) => onSelectItem(i, courses)} />
      </div>

      {/* Week timeline */}
      <section className="dashboard-section">
        <div className="section-header">
          <h2 className="section-title">This week</h2>
          <span className="section-hint">Click any item to open it</span>
        </div>
        <WeekTimeline items={items} courses={courses} onSelectItem={(i) => onSelectItem(i, courses)} />
      </section>

      {/* Bottom two-col */}
      <div className="dashboard-bottom">

        {/* Study queue */}
        <section className="dashboard-section">
          <div className="section-header">
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span className="ai-glow-dot" />
              <h2 className="section-title">Study queue</h2>
            </div>
          </div>
          {courses.length > 0 ? (
            <StudyQueue
              courses={courses}
              onSelectLecture={(l, c, idx) => onSelectLecture?.(l, c, idx)}
            />
          ) : (
            <div className="empty-state" style={{ minHeight: "auto", padding: "1rem" }}>Run a sync to see your courses.</div>
          )}
        </section>

        {/* Courses overview */}
        <section className="dashboard-section">
          <div className="section-header">
            <h2 className="section-title">Courses</h2>
            <button className="section-link" onClick={() => onSelectCourse && courses[0] && onSelectCourse(courses[0])}>View all →</button>
          </div>
          <div className="dashboard-courses">
            {isLoading && <div className="empty-state" style={{ minHeight: "auto" }}>Loading…</div>}
            {!isLoading && courses.length === 0 && (
              <div className="empty-state" style={{ minHeight: "auto" }}>No courses yet. Run a sync.</div>
            )}
            {courses.map((c, i) => (
              <CourseRow
                key={c.id}
                course={c}
                color={courseColor(i)}
                items={items}
                onSelectCourse={() => onSelectCourse(c)}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
