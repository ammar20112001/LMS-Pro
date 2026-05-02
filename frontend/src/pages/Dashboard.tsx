import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchDueSoon, fetchCourses, fetchSyncRuns, triggerSync,
  fetchProgress, Course, Item, SyncRun,
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

interface Props {
  onSelectItem: (item: Item, courses: Course[]) => void;
  onSelectCourse: (course: Course) => void;
  showCoursesView?: boolean;
}

export function Dashboard({ onSelectItem, onSelectCourse, showCoursesView }: Props) {
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

  const lastRun = runs[0] as SyncRun | undefined;
  const lastSyncLabel = lastRun?.finished_at
    ? formatDistanceToNow(parseISO(lastRun.finished_at), { addSuffix: true })
    : "Never";

  const pendingAssignments = items.filter((i) => i.kind === "assignment" && i.status !== "Submitted" && i.status !== "Expired").length;
  const upcomingQuizzes = items.filter((i) => i.kind === "quiz").length;
  const openGDBs = items.filter((i) => i.kind === "gdb").length;
  const urgentCount = items.filter((i) => {
    if (i.status === "Submitted" || i.status === "Expired") return false;
    if (!i.due_at) return false;
    return differenceInHours(parseISO(i.due_at), new Date()) < 24;
  }).length;

  const getCourseIdx = (courseId: number) => courses.findIndex((c) => c.id === courseId);

  return (
    <div className="page dashboard">
      <div className="page__header">
        <div className="page__header-left">
          <h1 className="page__title">Dashboard</h1>
          <span className="page__subtitle">Spring 2026 · Virtual University of Pakistan</span>
        </div>
        <div className="page__header-right">
          <span className="sync-label">Last sync: {lastSyncLabel}</span>
          <button
            className={`btn-sync ${syncMut.isPending ? "btn-sync--active" : ""}`}
            onClick={() => syncMut.mutate()}
            disabled={syncMut.isPending}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className={syncMut.isPending ? "spin" : ""}>
              <path d="M12.5 7A5.5 5.5 0 112.3 3.7M12.5 7V3.5M12.5 3.5H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {syncMut.isPending ? "Syncing…" : "Sync Now"}
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="stats-row">
        <StatCard value={pendingAssignments} label="Pending Assignments" color="var(--accent)"
          icon={<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M13 3H7a2 2 0 00-2 2v12a2 2 0 002 2h6a2 2 0 002-2V5a2 2 0 00-2-2z" stroke="currentColor" strokeWidth="1.5"/><path d="M7 8h6M7 11h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>}
        />
        <StatCard value={upcomingQuizzes} label="Upcoming Quizzes" color="var(--accent2)"
          icon={<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5"/><path d="M10 6v4.5l3 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>}
        />
        <StatCard value={openGDBs} label="Open GDBs" color="var(--cyan)"
          icon={<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 5h14M3 10h14M3 15h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>}
        />
        <StatCard value={urgentCount} label="Due Within 24h" color="var(--amber)"
          icon={<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 3v7l4 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="10" cy="11" r="7.5" stroke="currentColor" strokeWidth="1.5"/></svg>}
        />
      </div>

      <div className="dashboard__body">
        {/* Deadlines feed */}
        <section className="dashboard__deadlines">
          <div className="section-header">
            <h2 className="section-title">Upcoming Deadlines</h2>
            <span className="section-hint">Next 14 days across all courses</span>
          </div>
          <div className="deadline-list">
            {isLoading && <div className="empty-state">Loading…</div>}
            {!isLoading && items.length === 0 && (
              <div className="empty-state">Nothing due in the next 14 days. Run a sync to pull latest from VU LMS.</div>
            )}
            {items.map((item) => {
              const idx = getCourseIdx(item.course_id);
              const color = courseColor(idx >= 0 ? idx : 0);
              const t = timeUntil(item.due_at);
              const isSubmitted = item.status === "Submitted" || Boolean(item.completed_at);
              const isExpired = item.status === "Expired";
              return (
                <div
                  key={item.id}
                  className={`deadline-row ${t.urgent && !isSubmitted && !isExpired ? "deadline-row--urgent" : ""} ${isSubmitted ? "deadline-row--submitted" : ""} ${isExpired ? "deadline-row--expired" : ""}`}
                  style={{ "--course-color": color } as React.CSSProperties}
                  onClick={() => onSelectItem(item, courses)}
                >
                  <div className="deadline-row__course-bar" />
                  <div className="deadline-row__main">
                    <div className="deadline-row__top">
                      <div className="deadline-row__left">
                        <TypeBadge kind={item.kind} />
                        <span className="deadline-row__course">{item.course_code}</span>
                        <span className="deadline-row__title">{item.title}</span>
                      </div>
                      <StatusChip status={item.status} />
                    </div>
                    <div className="deadline-row__bottom">
                      <span className="deadline-row__due">Due {formatDue(item.due_at)}</span>
                      {item.total_marks && <span className="deadline-row__marks">{item.total_marks} marks</span>}
                      {!isSubmitted && !isExpired && item.due_at && (
                        <span className={`deadline-row__countdown ${t.urgent ? "deadline-row__countdown--urgent" : ""} ${t.overdue ? "deadline-row__countdown--overdue" : ""}`}>
                          {t.overdue ? "⚠ " : "⏱ "}{t.label}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Aside: courses + sync history */}
        <aside className="dashboard__aside">
          <section>
            <div className="section-header">
              <h2 className="section-title">My Courses</h2>
            </div>
            <div className="course-list">
              {courses.map((c, idx) => {
                const color = courseColor(idx);
                return (
                  <CourseCard
                    key={c.id}
                    course={c}
                    color={color}
                    onClick={() => onSelectCourse(c)}
                  />
                );
              })}
              {courses.length === 0 && <div className="empty-state">No courses yet. Run a sync.</div>}
            </div>
          </section>

          {runs.length > 0 && (
            <section>
              <div className="section-header">
                <h2 className="section-title">Sync History</h2>
              </div>
              <div className="sync-table">
                {runs.slice(0, 5).map((r) => (
                  <div className="sync-row" key={r.id}>
                    <div className={`sync-dot ${r.status === "ok" ? "sync-dot--ok" : r.status === "running" ? "sync-dot--running" : "sync-dot--err"}`} />
                    <div className="sync-row__time">
                      {r.started_at ? formatDistanceToNow(parseISO(r.started_at), { addSuffix: true }) : "—"}
                    </div>
                    <div className="sync-row__info">
                      {r.status === "ok"
                        ? `+${r.items_added} added · ${r.items_updated} updated`
                        : r.status === "running"
                          ? "Running…"
                          : <span className="sync-row__error">Error</span>
                      }
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function StatCard({ value, label, color, icon }: { value: number; label: string; color: string; icon: React.ReactNode }) {
  return (
    <div className="stat-card" style={{ "--accent": color } as React.CSSProperties}>
      <div className="stat-card__icon">{icon}</div>
      <div>
        <div className="stat-card__value">{value}</div>
        <div className="stat-card__label">{label}</div>
      </div>
    </div>
  );
}

function CourseCard({ course, color, onClick }: { course: Course; color: string; onClick: () => void }) {
  const { data: progress } = useQuery({
    queryKey: ["progress", course.id],
    queryFn: () => fetchProgress(course.id),
  });

  const pct = progress && progress.total_lectures > 0
    ? Math.round((progress.current_lecture_serial / progress.total_lectures) * 100)
    : 0;

  return (
    <div
      className="course-card"
      style={{ "--course-color": color } as React.CSSProperties}
      onClick={onClick}
    >
      <div className="course-card__code">{course.code}</div>
      <div className="course-card__title">{course.title}</div>
      <div className="course-card__progress">
        <div className="course-card__progress-bar">
          <div className="course-card__progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="course-card__progress-label">
          {progress ? `${progress.current_lecture_serial}/${progress.total_lectures}` : "—"} lec
        </span>
      </div>
    </div>
  );
}
