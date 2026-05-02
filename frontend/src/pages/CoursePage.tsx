import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { parseISO } from "date-fns";
import {
  fetchLectures, fetchProgress, setProgress, fetchCourseItems,
  Course, Item,
} from "../api/client";

interface Props {
  course: Course;
  onBack: () => void;
  onSelectItem: (item: Item) => void;
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

function formatDue(dueAt: string | null) {
  if (!dueAt) return "—";
  return parseISO(dueAt).toLocaleDateString("en-PK", { month: "short", day: "numeric" });
}

export function CoursePage({ course, onBack, onSelectItem }: Props) {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"lectures" | "assignments" | "quizzes" | "gdbs">("lectures");

  const { data: lectures = [] } = useQuery({
    queryKey: ["lectures", course.id],
    queryFn: () => fetchLectures(course.id),
  });

  const { data: progress } = useQuery({
    queryKey: ["progress", course.id],
    queryFn: () => fetchProgress(course.id),
  });

  const { data: courseItems = [] } = useQuery({
    queryKey: ["course-items", course.id],
    queryFn: () => fetchCourseItems(course.id),
  });

  const progressMut = useMutation({
    mutationFn: (serial: number) => setProgress(course.id, serial),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["progress", course.id] }),
  });

  const current = progress?.current_lecture_serial ?? 0;
  const total = progress?.total_lectures ?? lectures.length;
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;

  const assignments = courseItems.filter((i) => i.kind === "assignment");
  const quizzes = courseItems.filter((i) => i.kind === "quiz");
  const gdbs = courseItems.filter((i) => i.kind === "gdb");

  const pendingItems = courseItems.filter(
    (i) => i.status !== "Submitted" && i.status !== "Expired"
  ).sort((a, b) => {
    if (!a.due_at) return 1;
    if (!b.due_at) return -1;
    return parseISO(a.due_at).getTime() - parseISO(b.due_at).getTime();
  });

  return (
    <div className="page course-detail">
      <div className="page__header">
        <button className="btn-back" onClick={onBack}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 4L6 8l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          Back
        </button>
        <div className="page__header-left" style={{ marginTop: "0.75rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span className="course-detail__code" style={{ background: "oklch(0.62 0.2 265 / 0.15)", color: "var(--accent)", border: "1px solid oklch(0.62 0.2 265 / 0.3)" }}>
              {course.code}
            </span>
            <h1 className="page__title">{course.title}</h1>
          </div>
        </div>
      </div>

      {/* Progress */}
      <div className="course-detail__progress-section">
        <div className="course-detail__progress-header">
          <span className="course-detail__progress-label">Lecture Progress</span>
          <span className="course-detail__progress-count">{current} of {total} completed</span>
        </div>
        <div className="course-detail__progress-track">
          <div className="course-detail__progress-fill" style={{ width: `${pct}%`, background: "var(--accent)" }} />
        </div>
        <span className="course-detail__progress-pct">{pct}%</span>
      </div>

      {/* Pending deadlines */}
      {pendingItems.length > 0 && (
        <div className="course-detail__pending">
          <div className="section-header">
            <h2 className="section-title">Pending Deadlines</h2>
            <span className="section-hint">{pendingItems.length} item{pendingItems.length !== 1 ? "s" : ""} need attention</span>
          </div>
          <div className="item-list">
            {pendingItems.map((item) => (
              <div
                key={item.id}
                className="item-row"
                style={{ "--course-color": "var(--accent)" } as React.CSSProperties}
                onClick={() => onSelectItem(item)}
              >
                <TypeBadge kind={item.kind} />
                <div className="item-row__title">{item.title}</div>
                <div className="item-row__meta">
                  <span>{formatDue(item.due_at)}</span>
                  {item.total_marks && <span>{item.total_marks}m</span>}
                </div>
                <StatusChip status={item.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="tabs">
        {(["lectures", "assignments", "quizzes", "gdbs"] as const).map((tab) => (
          <button
            key={tab}
            className={`tab ${activeTab === tab ? "tab--active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
            <span className="tab__count">
              {tab === "lectures" ? lectures.length
                : tab === "assignments" ? assignments.length
                : tab === "quizzes" ? quizzes.length
                : gdbs.length}
            </span>
          </button>
        ))}
      </div>

      <div className="tab-content">
        {activeTab === "lectures" && (
          <div className="lecture-list">
            {lectures.length === 0 && (
              <div className="empty-state">No lectures synced yet. Run a sync to load lecture data.</div>
            )}
            {lectures.map((lec) => {
              const done = lec.serial_no <= current;
              const isCurrent = lec.serial_no === current;
              return (
                <div
                  key={lec.id}
                  className={`lecture-row ${done && !isCurrent ? "lecture-row--done" : ""} ${isCurrent ? "lecture-row--current" : ""}`}
                  onClick={() => progressMut.mutate(lec.serial_no)}
                  title={`Mark up to lecture ${lec.serial_no} as done`}
                >
                  <div className="lecture-row__num">{String(lec.serial_no).padStart(2, "0")}</div>
                  <div className="lecture-row__body">
                    <div className="lecture-row__title">{lec.title}</div>
                    <div className="lecture-row__icons">
                      {lec.has_video && <span className="lec-icon" title="Video">▶</span>}
                      {lec.has_reading && <span className="lec-icon" title="Reading">📄</span>}
                    </div>
                  </div>
                  <div>
                    {done
                      ? <span className={isCurrent ? "lec-current" : "lec-done"}>
                          {isCurrent ? `#${lec.serial_no}` : "✓"}
                        </span>
                      : <span className="lec-todo">—</span>
                    }
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === "assignments" && (
          <div className="item-list">
            {assignments.length === 0
              ? <div className="empty-state">No assignments yet</div>
              : assignments.map((a) => (
                <div key={a.id} className="item-row" style={{ "--course-color": "var(--accent)" } as React.CSSProperties} onClick={() => onSelectItem(a)}>
                  <TypeBadge kind="assignment" />
                  <div className="item-row__title">{a.title}</div>
                  <div className="item-row__meta">
                    <span>{formatDue(a.due_at)}</span>
                    {a.total_marks && <span>{a.total_marks}m</span>}
                  </div>
                  <StatusChip status={a.status} />
                </div>
              ))
            }
          </div>
        )}

        {activeTab === "quizzes" && (
          <div className="item-list">
            {quizzes.length === 0
              ? <div className="empty-state">No quizzes yet</div>
              : quizzes.map((q) => (
                <div key={q.id} className="item-row" style={{ "--course-color": "var(--accent2)" } as React.CSSProperties} onClick={() => onSelectItem(q)}>
                  <TypeBadge kind="quiz" />
                  <div className="item-row__title">{q.title}</div>
                  <div className="item-row__meta">
                    <span>{formatDue(q.due_at)}</span>
                    {q.total_marks && <span>{q.total_marks}m</span>}
                  </div>
                  <StatusChip status={q.status} />
                </div>
              ))
            }
          </div>
        )}

        {activeTab === "gdbs" && (
          <div className="item-list">
            {gdbs.length === 0
              ? <div className="empty-state">No GDBs yet</div>
              : gdbs.map((g) => (
                <div key={g.id} className="item-row" style={{ "--course-color": "var(--cyan)" } as React.CSSProperties} onClick={() => onSelectItem(g)}>
                  <TypeBadge kind="gdb" />
                  <div className="item-row__title">{g.title}</div>
                  <div className="item-row__meta">
                    <span>{formatDue(g.due_at)}</span>
                    {g.total_marks && <span>{g.total_marks}m</span>}
                  </div>
                  <StatusChip status={g.status} />
                </div>
              ))
            }
          </div>
        )}
      </div>
    </div>
  );
}
