import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  fetchStudyPlan,
  aiMarkSubmission,
  TheoryCourse,
  PracticalCourse,
  PlanDeadline,
  PracticalTask,
  AiMarkResult,
} from "../api/client";

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtMinutes(min: number): string {
  if (min <= 0) return "—";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function fmtDue(deadline: PlanDeadline): string {
  if (deadline.is_past) return "Past";
  if (deadline.days_left === 0) return "Today";
  if (deadline.days_left === 1) return "Tomorrow";
  return `${deadline.days_left}d left`;
}

function urgencyColor(deadline: PlanDeadline): string {
  if (deadline.is_completed) return "var(--green)";
  if (deadline.is_past) return "var(--text3)";
  if ((deadline.days_left ?? 99) <= 1) return "var(--red)";
  if ((deadline.days_left ?? 99) <= 4) return "var(--amber)";
  return "var(--text2)";
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
      textTransform: "uppercase", color: "var(--text3)",
      marginBottom: 10, marginTop: 24,
    }}>
      {label}
    </div>
  );
}

function DeadlineRow({ d }: { d: PlanDeadline }) {
  const hasLectures = d.lecture_range !== null;
  const done = d.is_completed || d.lectures_needed === 0;

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 16,
      padding: "10px 14px",
      background: d.is_past && !d.is_completed ? "rgba(255,255,255,0.02)" : "var(--bg2)",
      borderRadius: "var(--radius-sm)",
      border: "1px solid var(--border)",
      opacity: d.is_past && !d.is_completed ? 0.6 : 1,
    }}>
      {/* Status dot */}
      <div style={{
        width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
        background: d.is_completed ? "var(--green)" : urgencyColor(d),
      }} />

      {/* Title + range */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {d.title}
        </div>
        {hasLectures && (
          <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
            Lectures {d.lecture_range![0]}–{d.lecture_range![1]}
            {d.quiz_number && ` · Quiz ${d.quiz_number}/${d.total_quizzes}`}
          </div>
        )}
      </div>

      {/* Workload */}
      {hasLectures && !d.is_completed && d.lectures_needed > 0 && (
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: urgencyColor(d) }}>
            {d.lectures_needed} lecture{d.lectures_needed !== 1 ? "s" : ""}
          </div>
          <div style={{ fontSize: 11, color: "var(--text3)" }}>
            ~{fmtMinutes(d.estimated_minutes)}
          </div>
        </div>
      )}

      {/* Done / past label */}
      {d.is_completed && (
        <div style={{ fontSize: 12, color: "var(--green)", fontWeight: 600, flexShrink: 0 }}>
          Done
        </div>
      )}
      {!d.is_completed && hasLectures && d.lectures_needed === 0 && (
        <div style={{ fontSize: 12, color: "var(--green)", flexShrink: 0 }}>On track</div>
      )}

      {/* Due badge */}
      <div style={{
        fontSize: 11, fontWeight: 600, color: urgencyColor(d),
        flexShrink: 0, minWidth: 64, textAlign: "right",
      }}>
        {fmtDue(d)}
      </div>
    </div>
  );
}

function TheoryCourseCard({ course, onOpenCanvas }: {
  course: TheoryCourse;
  onOpenCanvas: (code: string) => void;
}) {
  const upcoming = course.deadlines.filter((d) => !d.is_past && !d.is_completed);
  const past = course.deadlines.filter((d) => d.is_past && !d.is_completed);
  const completed = course.deadlines.filter((d) => d.is_completed);
  const [showPast, setShowPast] = useState(false);

  const totalNeeded = upcoming.reduce((s, d) => s + d.lectures_needed, 0);
  const totalMinutes = upcoming.reduce((s, d) => s + d.estimated_minutes, 0);
  const pct = course.total_lectures > 0
    ? Math.round((course.current_lecture / course.total_lectures) * 100)
    : 0;

  return (
    <div style={{
      background: "var(--bg2)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius)",
      padding: "1.25rem",
      marginBottom: 16,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{course.course_code}</div>
          <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 2 }}>{course.course_title}</div>
        </div>
        <button
          className="btn btn--ghost"
          style={{ fontSize: 11, padding: "0.3rem 0.7rem" }}
          onClick={() => onOpenCanvas(course.course_code)}
        >
          Open Notes
        </button>
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text3)", marginBottom: 5 }}>
          <span>Lecture {course.current_lecture} of {course.total_lectures}</span>
          <span>{pct}%</span>
        </div>
        <div style={{ height: 5, background: "var(--bg3)", borderRadius: 99, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: "var(--accent)", borderRadius: 99, transition: "width 0.3s" }} />
        </div>
      </div>

      {/* Backlog + workload summary */}
      {(course.backlog_lectures > 0 || totalNeeded > 0) && (
        <div style={{
          display: "flex", gap: 12, marginBottom: 14,
          padding: "8px 12px",
          background: "var(--bg3)",
          borderRadius: "var(--radius-sm)",
          borderLeft: `3px solid ${course.backlog_lectures > 0 ? "var(--red)" : "var(--amber)"}`,
        }}>
          {course.backlog_lectures > 0 && (
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--red)" }}>{course.backlog_lectures}</div>
              <div style={{ fontSize: 11, color: "var(--text3)" }}>lectures behind</div>
            </div>
          )}
          {totalNeeded > 0 && (
            <>
              <div style={{ width: 1, background: "var(--border)" }} />
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--amber)" }}>{totalNeeded}</div>
                <div style={{ fontSize: 11, color: "var(--text3)" }}>to cover upcoming</div>
              </div>
              <div style={{ width: 1, background: "var(--border)" }} />
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{fmtMinutes(totalMinutes)}</div>
                <div style={{ fontSize: 11, color: "var(--text3)" }}>estimated read time</div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Upcoming deadlines */}
      {upcoming.length > 0 && (
        <>
          <SectionLabel label="Upcoming" />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {upcoming.map((d) => <DeadlineRow key={d.item_id} d={d} />)}
          </div>
        </>
      )}

      {/* Completed */}
      {completed.length > 0 && (
        <>
          <SectionLabel label={`Completed (${completed.length})`} />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {completed.map((d) => <DeadlineRow key={d.item_id} d={d} />)}
          </div>
        </>
      )}

      {/* Past / missed */}
      {past.length > 0 && (
        <>
          <button
            onClick={() => setShowPast(!showPast)}
            style={{ background: "none", border: "none", color: "var(--red)", fontSize: 12, cursor: "pointer", padding: "8px 0 0", fontWeight: 600 }}
          >
            {showPast ? "Hide" : "Show"} {past.length} missed deadline{past.length !== 1 ? "s" : ""}
          </button>
          {showPast && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
              {past.map((d) => <DeadlineRow key={d.item_id} d={d} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── AI Marking panel ──────────────────────────────────────────────────────────

function AiMarkPanel({ task, onClose }: { task: PracticalTask; onClose: () => void }) {
  const [description, setDescription] = useState("");
  const [solution, setSolution] = useState("");
  const [result, setResult] = useState<AiMarkResult | null>(null);

  const mutation = useMutation({
    mutationFn: () => aiMarkSubmission(task.item_id, description, solution),
    onSuccess: (data) => setResult(data),
  });

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 100, padding: "2rem",
    }}>
      <div style={{
        background: "var(--bg2)", border: "1px solid var(--border2)",
        borderRadius: "var(--radius)", width: "100%", maxWidth: 640,
        maxHeight: "85vh", overflow: "auto", padding: "1.5rem",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{task.title}</div>
          <button className="btn btn--ghost" style={{ fontSize: 12 }} onClick={onClose}>Close</button>
        </div>

        {!result ? (
          <>
            <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 6 }}>Task description / requirements</div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Paste the task question or requirements here..."
              style={{ width: "100%", minHeight: 80, ...textareaStyle }}
            />
            <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 6, marginTop: 14 }}>Your solution</div>
            <textarea
              value={solution}
              onChange={(e) => setSolution(e.target.value)}
              placeholder="Paste your code, answer, or solution here..."
              style={{ width: "100%", minHeight: 160, fontFamily: "var(--font-mono)", fontSize: 12, ...textareaStyle }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <button
                className="btn"
                disabled={!description.trim() || !solution.trim() || mutation.isPending}
                onClick={() => mutation.mutate()}
              >
                {mutation.isPending ? "Marking..." : "Submit for AI Marking"}
              </button>
            </div>
          </>
        ) : (
          <MarkResult result={result} onRetry={() => setResult(null)} />
        )}
      </div>
    </div>
  );
}

const textareaStyle: React.CSSProperties = {
  background: "var(--bg3)", border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)", color: "var(--text)",
  padding: "0.6rem 0.8rem", resize: "vertical",
  fontFamily: "var(--font)", fontSize: 13, width: "100%",
};

function MarkResult({ result, onRetry }: { result: AiMarkResult; onRetry: () => void }) {
  const gradeColor = { A: "var(--green)", B: "var(--cyan)", C: "var(--amber)", D: "var(--amber)", F: "var(--red)" };
  const color = gradeColor[result.grade as keyof typeof gradeColor] ?? "var(--text2)";

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 20 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 36, fontWeight: 800, color }}>{result.grade}</div>
          <div style={{ fontSize: 13, color: "var(--text2)" }}>
            {result.marks ?? "?"}/{result.max_marks}
          </div>
        </div>
        <div style={{ flex: 1, fontSize: 14, color: "var(--text)", fontStyle: "italic" }}>
          "{result.summary}"
        </div>
      </div>

      {result.strengths.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--green)", marginBottom: 6 }}>Strengths</div>
          {result.strengths.map((s, i) => (
            <div key={i} style={{ fontSize: 13, color: "var(--text2)", marginBottom: 3, paddingLeft: 12 }}>+ {s}</div>
          ))}
        </div>
      )}

      {result.issues.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--red)", marginBottom: 6 }}>Issues</div>
          {result.issues.map((s, i) => (
            <div key={i} style={{ fontSize: 13, color: "var(--text2)", marginBottom: 3, paddingLeft: 12 }}>- {s}</div>
          ))}
        </div>
      )}

      <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.7, marginBottom: 16 }}>
        {result.feedback}
      </div>

      <button className="btn btn--ghost" style={{ fontSize: 12 }} onClick={onRetry}>Try Another</button>
    </div>
  );
}

function PracticalCourseCard({ course, onOpenCpp }: {
  course: PracticalCourse;
  onOpenCpp: (task: PracticalTask) => void;
}) {
  const [markingTask, setMarkingTask] = useState<PracticalTask | null>(null);

  return (
    <div style={{
      background: "var(--bg2)", border: "1px solid var(--border)",
      borderRadius: "var(--radius)", padding: "1.25rem", marginBottom: 16,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{course.course_code}</div>
          <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 2 }}>{course.course_title}</div>
        </div>
        <span style={{
          fontSize: 11, fontWeight: 600, padding: "3px 8px",
          borderRadius: 99, background: "var(--bg3)",
          color: course.type === "cpp_runner" ? "var(--cyan)" : "var(--accent)",
        }}>
          {course.type === "cpp_runner" ? "C++ Runner" : "AI Marked"}
        </span>
      </div>

      {course.upcoming.length === 0 && (
        <div style={{ fontSize: 13, color: "var(--text3)" }}>No upcoming tasks</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {course.upcoming.map((task) => (
          <div key={task.item_id} style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "10px 14px", background: "var(--bg3)",
            borderRadius: "var(--radius-sm)", border: "1px solid var(--border)",
          }}>
            <div style={{
              width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
              background: task.is_completed ? "var(--green)"
                : (task.days_left ?? 99) <= 1 ? "var(--red)"
                : (task.days_left ?? 99) <= 4 ? "var(--amber)"
                : "var(--text3)",
            }} />
            <div style={{ flex: 1, fontSize: 13 }}>{task.title}</div>
            <div style={{ fontSize: 11, color: "var(--text3)", flexShrink: 0 }}>
              {task.is_completed ? "Done" : task.days_left != null ? `${task.days_left}d left` : "—"}
            </div>
            {!task.is_completed && (
              <button
                className="btn btn--ghost"
                style={{ fontSize: 11, padding: "3px 10px", flexShrink: 0 }}
                onClick={() => course.type === "cpp_runner" ? onOpenCpp(task) : setMarkingTask(task)}
              >
                {course.type === "cpp_runner" ? "Practice" : "Submit"}
              </button>
            )}
          </div>
        ))}
      </div>

      {markingTask && (
        <AiMarkPanel task={markingTask} onClose={() => setMarkingTask(null)} />
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function StudyPlanPage({ onOpenCanvas }: { onOpenCanvas: (code: string) => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["study-plan"],
    queryFn: fetchStudyPlan,
    refetchInterval: 60_000,
  });

  const [activeTab, setActiveTab] = useState<"theory" | "practicals">("theory");

  if (isLoading) return (
    <div className="page">
      <div style={{ color: "var(--text3)", padding: "3rem", textAlign: "center" }}>Loading study plan...</div>
    </div>
  );

  if (error || !data) return (
    <div className="page">
      <div style={{ color: "var(--red)", padding: "3rem" }}>Failed to load study plan.</div>
    </div>
  );

  const totalBacklog = data.theory.reduce((s, c) => s + c.backlog_lectures, 0);
  const totalNeeded = data.theory.reduce(
    (s, c) => s + c.deadlines.filter(d => !d.is_past && !d.is_completed).reduce((ss, d) => ss + d.lectures_needed, 0),
    0
  );

  return (
    <div className="page">
      <div className="page__header">
        <h1 className="page__title">Study Plan</h1>
        <p className="page__subtitle">What you need to cover and how long it'll take</p>
      </div>

      {/* Global summary */}
      {(totalBacklog > 0 || totalNeeded > 0) && (
        <div style={{
          display: "flex", gap: 16, marginBottom: 24,
          padding: "16px 20px", background: "var(--bg2)",
          border: "1px solid var(--border)", borderRadius: "var(--radius)",
        }}>
          {totalBacklog > 0 && (
            <div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "var(--red)" }}>{totalBacklog}</div>
              <div style={{ fontSize: 12, color: "var(--text3)" }}>lectures behind overall</div>
            </div>
          )}
          {totalBacklog > 0 && totalNeeded > 0 && <div style={{ width: 1, background: "var(--border)" }} />}
          {totalNeeded > 0 && (
            <div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "var(--amber)" }}>{totalNeeded}</div>
              <div style={{ fontSize: 12, color: "var(--text3)" }}>lectures to cover for upcoming deadlines</div>
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "1px solid var(--border)", paddingBottom: 0 }}>
        {(["theory", "practicals"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              background: "none", border: "none", padding: "8px 16px",
              fontSize: 13, fontWeight: 600, cursor: "pointer",
              color: activeTab === tab ? "var(--accent)" : "var(--text3)",
              borderBottom: activeTab === tab ? "2px solid var(--accent)" : "2px solid transparent",
              marginBottom: -1,
            }}
          >
            {tab === "theory" ? `Theory (${data.theory.length})` : `Practicals (${data.practicals.length})`}
          </button>
        ))}
      </div>

      {activeTab === "theory" && (
        data.theory.length === 0
          ? <div style={{ color: "var(--text3)", fontSize: 14 }}>No theory courses found.</div>
          : data.theory.map((c) => (
              <TheoryCourseCard key={c.course_code} course={c} onOpenCanvas={onOpenCanvas} />
            ))
      )}

      {activeTab === "practicals" && (
        data.practicals.length === 0
          ? <div style={{ color: "var(--text3)", fontSize: 14 }}>No practical courses found.</div>
          : data.practicals.map((c) => (
              <PracticalCourseCard
                key={c.course_code}
                course={c}
                onOpenCpp={(task) => {
                  // Navigate to assignment detail — handled by parent
                  console.log("Open C++ runner for task", task.item_id);
                }}
              />
            ))
      )}
    </div>
  );
}
