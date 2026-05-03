import { useQuery } from "@tanstack/react-query";
import { fetchCourses, fetchCourseItems, fetchProgress, Course } from "../api/client";

const COURSE_COLORS = [
  "#6366f1","#8b5cf6","#06b6d4","#10b981","#f59e0b","#ef4444","#ec4899","#14b8a6",
];

function courseColor(idx: number) {
  return COURSE_COLORS[idx % COURSE_COLORS.length];
}

function timeUntil(dueAt: string | null) {
  if (!dueAt) return null;
  const diff = new Date(dueAt).getTime() - Date.now();
  if (diff < 0) return { label: "Overdue", urgent: true };
  const h = Math.floor(diff / 3_600_000);
  const d = Math.floor(h / 24);
  if (d === 0) return { label: `${h}h left`, urgent: h < 6 };
  if (d === 1) return { label: `${d}d ${h % 24}h left`, urgent: true };
  return { label: `${d}d left`, urgent: false };
}

function CourseCard({
  course,
  colorIdx,
  onClick,
}: {
  course: Course;
  colorIdx: number;
  onClick: () => void;
}) {
  const color = courseColor(colorIdx);

  const { data: items = [] } = useQuery({
    queryKey: ["course-items", course.id],
    queryFn: () => fetchCourseItems(course.id),
    staleTime: 60_000,
  });

  const { data: progress } = useQuery({
    queryKey: ["progress", course.id],
    queryFn: () => fetchProgress(course.id),
    staleTime: 60_000,
  });

  const pendingAssign = items.filter((i) => i.kind === "assignment" && i.status !== "Submitted" && i.status !== "Expired").length;
  const openQuizzes = items.filter((i) => i.kind === "quiz" && i.status !== "Submitted" && i.status !== "Expired").length;
  const openGDBs = items.filter((i) => i.kind === "gdb" && i.status !== "Submitted" && i.status !== "Expired").length;
  const totalPending = pendingAssign + openQuizzes + openGDBs;

  const pct = progress && progress.total_lectures > 0
    ? Math.round((progress.current_lecture_serial / progress.total_lectures) * 100)
    : 0;

  const nextDue = items
    .filter((i) => i.due_at && i.status !== "Submitted" && i.status !== "Expired")
    .sort((a, b) => new Date(a.due_at!).getTime() - new Date(b.due_at!).getTime())[0] ?? null;

  const ndTime = nextDue ? timeUntil(nextDue.due_at) : null;

  return (
    <div
      className="course-big-card"
      style={{ "--course-color": color } as React.CSSProperties}
      onClick={onClick}
    >
      <div className="course-big-card__top">
        <div className="course-big-card__code-row">
          <span className="course-big-card__code">{course.code}</span>
          {totalPending > 0 && (
            <span className="course-big-card__pending-badge">{totalPending} pending</span>
          )}
        </div>
        <div className="course-big-card__title">{course.title}</div>
        <div className="course-big-card__credits">{course.term}</div>
      </div>

      {/* Progress ring */}
      <div className="course-big-card__progress-row">
        <div className="course-big-card__ring">
          <svg viewBox="0 0 36 36" width="52" height="52">
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--bg3)" strokeWidth="2.5" />
            <circle
              cx="18" cy="18" r="15.5" fill="none"
              stroke={color} strokeWidth="2.5"
              strokeDasharray={`${pct * 0.974} 97.4`}
              strokeLinecap="round"
              transform="rotate(-90 18 18)"
            />
            <text x="18" y="18" textAnchor="middle" dominantBaseline="central" fill="var(--text)" fontSize="7" fontWeight="700" fontFamily="DM Mono, monospace">{pct}%</text>
          </svg>
        </div>
        <div className="course-big-card__progress-detail">
          <div className="course-big-card__lec-count">
            {progress ? `${progress.current_lecture_serial}/${progress.total_lectures}` : "—"} lectures done
          </div>
        </div>
      </div>

      {/* Next deadline */}
      {nextDue && ndTime && (
        <div className={`course-big-card__deadline ${ndTime.urgent ? "course-big-card__deadline--urgent" : ""}`}>
          <span className="course-big-card__deadline-type">{nextDue.kind.toUpperCase()}</span>
          <span className="course-big-card__deadline-title">{nextDue.title}</span>
          <span className="course-big-card__deadline-time">{ndTime.label}</span>
        </div>
      )}

      {/* Item counts */}
      <div className="course-big-card__counts">
        {pendingAssign > 0 && <span className="course-count course-count--assign">{pendingAssign} assign</span>}
        {openQuizzes > 0 && <span className="course-count course-count--quiz">{openQuizzes} quiz</span>}
        {openGDBs > 0 && <span className="course-count course-count--gdb">{openGDBs} GDB</span>}
        {totalPending === 0 && <span className="course-count" style={{ color: "var(--green)" }}>All clear ✓</span>}
      </div>

      <div className="course-big-card__arrow">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </div>
    </div>
  );
}

interface Props {
  onSelectCourse: (course: Course) => void;
}

export function CoursesPage({ onSelectCourse }: Props) {
  const { data: courses = [], isLoading } = useQuery({
    queryKey: ["courses"],
    queryFn: fetchCourses,
  });

  return (
    <div className="page courses-page">
      <div className="page__header">
        <div className="page__header-left">
          <h1 className="page__title">Courses</h1>
          <span className="page__subtitle">Spring 2026 · Virtual University of Pakistan</span>
        </div>
      </div>

      {isLoading && <div className="empty-state">Loading courses…</div>}
      {!isLoading && courses.length === 0 && (
        <div className="empty-state">No courses synced yet. Run a sync from the Dashboard.</div>
      )}
      <div className="courses-grid">
        {courses.map((c, idx) => (
          <CourseCard key={c.id} course={c} colorIdx={idx} onClick={() => onSelectCourse(c)} />
        ))}
      </div>
    </div>
  );
}
