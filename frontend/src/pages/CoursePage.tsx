import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { parseISO } from "date-fns";
import {
  fetchLectures, fetchProgress, setProgress, fetchCourseItems,
  Course, Item, Lecture,
} from "../api/client";

interface Props {
  course: Course;
  onBack: () => void;
  onSelectItem: (item: Item) => void;
  onSelectLecture?: (lecture: Lecture) => void;
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

function LectureStatusChip({ lec }: { lec: Lecture }) {
  const hasVideo = lec.has_video && lec.youtube_id && lec.youtube_id !== "NONE";
  const noId = lec.has_video && (!lec.youtube_id || lec.youtube_id === "NONE");

  if (!lec.has_video) return <span className="lec-status lec-status--novid">No video</span>;
  if (noId) return <span className="lec-status lec-status--novid">Video not linked</span>;

  const s = lec.notes_status;
  if (s === "done") return <span className="lec-status lec-status--done">Handout ready</span>;
  if (s === "transcribed") return <span className="lec-status lec-status--progress">Transcript ready</span>;
  if (s === "transcribing" || s === "generating") return <span className="lec-status lec-status--gen">Generating…</span>;
  if (s === "failed") return <span className="lec-status lec-status--novid">Failed</span>;
  return <span className="lec-status lec-status--queued">Queued</span>;
}

export function CoursePage({ course, onBack, onSelectItem, onSelectLecture }: Props) {
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
              const canOpen = onSelectLecture &&
                lec.has_video &&
                lec.youtube_id &&
                lec.youtube_id !== "NONE" &&
                (lec.notes_status === "done" || lec.notes_status === "transcribed" || lec.notes_status === "transcribing");
              const noVideo = !lec.has_video || !lec.youtube_id || lec.youtube_id === "NONE";

              return (
                <div
                  key={lec.id}
                  className={`lecture-row-v2 ${canOpen ? "lecture-row-v2--clickable" : ""} ${done ? "lecture-row-v2--done" : ""} ${noVideo ? "lecture-row-v2--dim" : ""}`}
                  onClick={() => canOpen ? onSelectLecture!(lec) : progressMut.mutate(lec.serial_no)}
                >
                  <div className="lecture-row-v2__num">{String(lec.serial_no).padStart(2, "0")}</div>
                  <div className="lecture-row-v2__body">
                    <div className="lecture-row-v2__top">
                      <span className="lecture-row-v2__title">{lec.title}</span>
                      <div className="lecture-row-v2__icons">
                        {lec.has_video && (
                          <span className="lec-icon-v2" title="Video">
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 1.5h5.5a.5.5 0 01.5.5v5a.5.5 0 01-.5.5H1a.5.5 0 01-.5-.5V2a.5.5 0 01.5-.5z" stroke="currentColor" strokeWidth="1"/><path d="M7 3.5l2-1v5l-2-1" stroke="currentColor" strokeWidth="1"/></svg>
                          </span>
                        )}
                        {lec.has_reading && (
                          <span className="lec-icon-v2" title="Reading">
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="1" y="1" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1"/><path d="M3 3.5h4M3 5h4M3 6.5h2.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/></svg>
                          </span>
                        )}
                        {(lec.notes_status === "done" || lec.notes_status === "transcribed") && (
                          <span className="lec-icon-v2 lec-icon-v2--handout" title="Handout/transcript available">
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 1h6a1 1 0 011 1v6a1 1 0 01-1 1H2a1 1 0 01-1-1V2a1 1 0 011-1z" stroke="currentColor" strokeWidth="1"/><path d="M3 3.5h4M3 5h4M3 6.5h2" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/></svg>
                          </span>
                        )}
                        {lec.notes_status === "transcribed" && (
                          <span className="lec-icon-v2 lec-icon-v2--transcript" title="Transcript available">
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1"/><path d="M3.5 5l1 1 2-2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="lecture-row-v2__right">
                    <LectureStatusChip lec={lec} />
                    {lec.youtube_id && lec.youtube_id !== "NONE" && (
                      <a
                        className="btn-yt"
                        href={`https://www.youtube.com/watch?v=${lec.youtube_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title="Watch on YouTube"
                      >
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1C3.69 1 1 3.69 1 7s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6z" stroke="currentColor" strokeWidth="1.2"/><path d="M5.5 5l3.5 2-3.5 2V5z" fill="currentColor"/></svg>
                      </a>
                    )}
                    {canOpen && (
                      <span className="lecture-row-v2__arrow">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </span>
                    )}
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
