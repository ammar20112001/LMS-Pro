import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchStudyPlan, TheoryCourse, PlanDeadline, PracticalCourse } from "../api/client";

// ── Utilities ─────────────────────────────────────────────────────────────────

function fmtMins(min: number) {
  if (!min || min <= 0) return null;
  const h = Math.floor(min / 60), m = min % 60;
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

function pct(a: number, b: number) {
  return b > 0 ? Math.round((a / b) * 100) : 0;
}

function dueLabel(d: PlanDeadline): string {
  if (d.is_completed) return "done";
  if (d.is_past) return "past";
  if (d.days_left === 0) return "today";
  if (d.days_left === 1) return "tomorrow";
  return `${d.days_left}d`;
}

function urgencyOf(d: PlanDeadline): "done" | "behind" | "soon" | "later" {
  if (d.is_completed || (d.lecture_range && d.lectures_needed === 0)) return "done";
  if (d.is_past) return "behind";
  if ((d.days_left ?? 99) <= 7) return "soon";
  return "later";
}

const U_COLOR = {
  done:   "var(--green)",
  behind: "var(--red)",
  soon:   "var(--amber)",
  later:  "var(--text3)",
};
const U_BG = {
  done:   "rgba(72,199,120,0.08)",
  behind: "rgba(240,71,71,0.08)",
  soon:   "rgba(245,158,11,0.08)",
  later:  "transparent",
};

// ── Deadline row (inside expanded card) ───────────────────────────────────────

function DeadlineRow({ d, onOpenPlayground }: {
  d: PlanDeadline;
  onOpenPlayground: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const u = urgencyOf(d);
  const color = U_COLOR[u];
  const timeStr = fmtMins(d.estimated_minutes);
  const isQuiz = d.lecture_range !== null;

  return (
    <div style={{ borderLeft: `2px solid ${color}`, marginBottom: 4 }}>
      <button
        onClick={() => isQuiz && setOpen((x) => !x)}
        style={{
          width: "100%", textAlign: "left", background: U_BG[u],
          border: "none", padding: "7px 10px",
          cursor: isQuiz ? "pointer" : "default",
          display: "flex", alignItems: "center", gap: 8,
        }}
      >
        <span style={{ fontSize: 13, flex: 1, color: "var(--text)", fontWeight: 500 }}>
          {d.title}
        </span>
        {isQuiz && d.lectures_needed > 0 && (
          <span style={{ fontSize: 11, color, fontWeight: 600 }}>
            {d.lectures_needed} lec{timeStr ? ` · ${timeStr}` : ""}
          </span>
        )}
        <span style={{ fontSize: 11, color, minWidth: 40, textAlign: "right" }}>
          {dueLabel(d)}
        </span>
        {isQuiz && (
          <span style={{ color: "var(--text3)", fontSize: 10 }}>{open ? "▲" : "▼"}</span>
        )}
      </button>

      {open && isQuiz && (
        <div style={{ padding: "4px 10px 6px 16px", display: "flex", flexDirection: "column", gap: 3 }}>
          {Array.from({ length: (d.lecture_range![1] - d.lecture_range![0] + 1) }, (_, i) => {
            const sno = d.lecture_range![0] + i;
            const isCovered = d.lectures_covered >= sno - d.lecture_range![0] + 1;
            return (
              <div
                key={sno}
                onClick={() => onOpenPlayground(d.title)}
                style={{
                  fontSize: 12, color: isCovered ? "var(--text3)" : "var(--text)",
                  display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
                  padding: "2px 0",
                  opacity: isCovered ? 0.5 : 1,
                }}
              >
                <span style={{
                  width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                  background: isCovered ? "var(--text3)" : color,
                }} />
                Lec {sno}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Compact course card ───────────────────────────────────────────────────────

function CourseCard({ course, onOpenPlayground }: {
  course: TheoryCourse;
  onOpenPlayground: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const upcoming = course.deadlines.filter((d) => !d.is_past && !d.is_completed);
  const nextDue = upcoming[0];
  const totalUpcomingMin = upcoming.reduce((s, d) => s + d.estimated_minutes, 0);
  const totalUpcomingLec = upcoming.reduce((s, d) => s + d.lectures_needed, 0);
  const progress = pct(course.current_lecture, course.total_lectures);
  const hasBehind = course.backlog_lectures > 0;
  const nextDueUrgency = nextDue ? urgencyOf(nextDue) : "later";

  return (
    <div style={{
      background: "var(--bg2)",
      border: `1px solid ${hasBehind ? "rgba(240,71,71,0.3)" : "var(--border)"}`,
      borderRadius: "var(--radius)",
      overflow: "hidden",
    }}>
      {/* Card header — always visible */}
      <button
        onClick={() => setOpen((x) => !x)}
        style={{
          width: "100%", textAlign: "left", background: "none",
          border: "none", padding: "14px 14px 10px", cursor: "pointer",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
          <div>
            <span style={{ fontSize: 16, fontWeight: 800, color: "var(--text)" }}>{course.course_code}</span>
            {hasBehind && (
              <span style={{
                marginLeft: 8, fontSize: 10, fontWeight: 700, color: "var(--red)",
                background: "rgba(240,71,71,0.12)", padding: "2px 6px", borderRadius: 99,
              }}>
                {course.backlog_lectures} behind
              </span>
            )}
          </div>
          <span style={{ color: "var(--text3)", fontSize: 11 }}>{open ? "▲" : "▼"}</span>
        </div>

        {/* Progress bar */}
        <div style={{ height: 4, background: "var(--bg3)", borderRadius: 99, overflow: "hidden", marginBottom: 8 }}>
          <div style={{ height: "100%", width: `${progress}%`, background: "var(--accent)", borderRadius: 99 }} />
        </div>

        {/* Summary row */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "var(--text3)" }}>
            {course.current_lecture}/{course.total_lectures} lec
          </span>
          {nextDue && (
            <>
              <span style={{ color: "var(--border2)" }}>·</span>
              <span style={{ fontSize: 11, color: U_COLOR[nextDueUrgency], fontWeight: 600 }}>
                {nextDue.title.length > 18 ? nextDue.title.slice(0, 18) + "…" : nextDue.title}
                {" "}{dueLabel(nextDue)}
              </span>
            </>
          )}
          {totalUpcomingLec > 0 && (
            <>
              <span style={{ color: "var(--border2)" }}>·</span>
              <span style={{ fontSize: 11, color: "var(--text2)" }}>
                {totalUpcomingLec} lec {fmtMins(totalUpcomingMin) ? `~${fmtMins(totalUpcomingMin)}` : ""}
              </span>
            </>
          )}
        </div>
      </button>

      {/* Expanded body */}
      {open && (
        <div style={{ borderTop: "1px solid var(--border)", padding: "8px 0 4px" }}>
          {/* Open Playground CTA */}
          <div style={{ padding: "0 14px 8px", display: "flex", justifyContent: "flex-end" }}>
            <button
              className="btn"
              style={{ fontSize: 11, padding: "4px 12px" }}
              onClick={(e) => { e.stopPropagation(); onOpenPlayground(course.course_code); }}
            >
              Open Playground →
            </button>
          </div>

          {course.deadlines.length === 0 ? (
            <div style={{ padding: "8px 14px", color: "var(--text3)", fontSize: 12 }}>No deadlines</div>
          ) : (
            course.deadlines.map((d) => (
              <DeadlineRow key={d.item_id} d={d} onOpenPlayground={() => onOpenPlayground(course.course_code)} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Practical card ─────────────────────────────────────────────────────────────

function PracticalCard({ course }: { course: PracticalCourse }) {
  const [open, setOpen] = useState(false);
  const nextTask = course.upcoming[0];

  return (
    <div style={{
      background: "var(--bg2)", border: "1px solid var(--border)",
      borderRadius: "var(--radius)", overflow: "hidden",
    }}>
      <button
        onClick={() => setOpen((x) => !x)}
        style={{
          width: "100%", textAlign: "left", background: "none",
          border: "none", padding: "14px 14px 10px", cursor: "pointer",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: "var(--text)" }}>{course.course_code}</span>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 99,
              background: "var(--bg3)",
              color: course.type === "cpp_runner" ? "var(--cyan)" : "var(--accent)",
            }}>
              {course.type === "cpp_runner" ? "C++" : "AI Marked"}
            </span>
          </div>
          <span style={{ color: "var(--text3)", fontSize: 11 }}>{open ? "▲" : "▼"}</span>
        </div>
        <div style={{ fontSize: 11, color: "var(--text3)" }}>
          {course.upcoming.length > 0
            ? `${course.upcoming.length} upcoming · next: ${nextTask?.days_left ?? 0}d`
            : "No upcoming tasks"}
        </div>
      </button>

      {open && (
        <div style={{ borderTop: "1px solid var(--border)", padding: "6px 0" }}>
          {course.upcoming.map((t) => (
            <div key={t.item_id} style={{
              display: "flex", alignItems: "center", gap: 8, padding: "6px 14px",
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                background: (t.days_left ?? 99) <= 1 ? "var(--red)"
                  : (t.days_left ?? 99) <= 7 ? "var(--amber)" : "var(--text3)",
              }} />
              <span style={{ flex: 1, fontSize: 12, color: "var(--text)" }}>{t.title}</span>
              <span style={{ fontSize: 11, color: "var(--text3)" }}>{t.days_left}d</span>
            </div>
          ))}
          {course.upcoming.length === 0 && (
            <div style={{ padding: "6px 14px", color: "var(--text3)", fontSize: 12 }}>All caught up</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function StudyPlanPage({ onOpenPlayground }: {
  onOpenPlayground: (courseCode: string) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["study-plan"],
    queryFn: fetchStudyPlan,
    refetchInterval: 60_000,
  });

  if (isLoading || !data) {
    return (
      <div className="page">
        <div className="page__header">
          <h1 className="page__title">Study Plan</h1>
        </div>
        <div style={{ color: "var(--text3)", fontSize: 13 }}>Loading...</div>
      </div>
    );
  }

  const totalBehind = data.theory.reduce((s, c) => s + c.backlog_lectures, 0);
  const totalSoon = data.theory.reduce((s, c) =>
    s + c.deadlines.filter((d) => !d.is_past && !d.is_completed && (d.days_left ?? 99) <= 7 && d.lectures_needed > 0).length, 0
  );

  return (
    <div className="page">
      <div className="page__header" style={{ marginBottom: 16 }}>
        <h1 className="page__title">Study Plan</h1>
        <div style={{ display: "flex", gap: 16, marginTop: 6 }}>
          {totalBehind > 0 && (
            <span style={{ fontSize: 13, color: "var(--red)", fontWeight: 600 }}>
              {totalBehind} lectures behind
            </span>
          )}
          {totalSoon > 0 && (
            <span style={{ fontSize: 13, color: "var(--amber)", fontWeight: 600 }}>
              {totalSoon} deadlines this week
            </span>
          )}
        </div>
      </div>

      {/* Theory grid */}
      {data.theory.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 10 }}>
            Theory
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 10,
            marginBottom: 24,
          }}>
            {data.theory.map((c) => (
              <CourseCard key={c.course_code} course={c} onOpenPlayground={onOpenPlayground} />
            ))}
          </div>
        </>
      )}

      {/* Practicals grid */}
      {data.practicals.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 10 }}>
            Practicals
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 10,
          }}>
            {data.practicals.map((c) => (
              <PracticalCard key={c.course_code} course={c} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
