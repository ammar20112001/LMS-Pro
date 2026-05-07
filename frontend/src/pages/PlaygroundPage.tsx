import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCoursePlan, PlanDeadline, PlanLecture, TheoryCourseFull } from "../api/client";

function fmtMins(min: number) {
  if (!min || min <= 0) return null;
  const h = Math.floor(min / 60), m = min % 60;
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

function pct(a: number, b: number) {
  return b > 0 ? Math.round((a / b) * 100) : 0;
}

const U_COLOR = {
  behind: "var(--red)",
  soon:   "var(--amber)",
  later:  "var(--text3)",
  done:   "var(--green)",
};

const U_BG = {
  behind: "rgba(240,71,71,0.06)",
  soon:   "rgba(245,158,11,0.06)",
  later:  "transparent",
  done:   "rgba(72,199,120,0.06)",
};

// ── Lecture row ────────────────────────────────────────────────────────────────

function LectureRow({
  lec,
  onOpenCanvas,
}: {
  lec: PlanLecture;
  onOpenCanvas: (chunkId: number) => void;
}) {
  const color = U_COLOR[lec.urgency];
  const timeStr = fmtMins(lec.estimated_minutes);
  const clickable = lec.chunk_id !== null;

  return (
    <div
      onClick={() => clickable && onOpenCanvas(lec.chunk_id!)}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "7px 14px",
        cursor: clickable ? "pointer" : "default",
        background: "transparent",
        transition: "background 0.1s",
      }}
      onMouseEnter={(e) => { if (clickable) (e.currentTarget as HTMLDivElement).style.background = U_BG[lec.urgency]; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
    >
      <span style={{
        width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
        background: color,
        boxShadow: lec.urgency === "behind" ? `0 0 6px ${color}` : "none",
      }} />
      <span style={{ fontSize: 11, color: "var(--text3)", minWidth: 40, flexShrink: 0 }}>
        Lec {lec.serial_no}
      </span>
      <span style={{ flex: 1, fontSize: 13, color: "var(--text)", lineHeight: 1.35 }}>
        {lec.title}
      </span>
      {timeStr && (
        <span style={{ fontSize: 11, color: "var(--text3)", flexShrink: 0 }}>{timeStr}</span>
      )}
      {clickable && (
        <span style={{ fontSize: 10, color: "var(--text3)", flexShrink: 0 }}>→</span>
      )}
    </div>
  );
}

// ── Deadline group (within a section) ─────────────────────────────────────────

function DeadlineGroup({
  title,
  lectures,
  color,
  onOpenCanvas,
}: {
  title: string;
  lectures: PlanLecture[];
  color: string;
  onOpenCanvas: (chunkId: number) => void;
}) {
  const [open, setOpen] = useState(true);
  const timeStr = fmtMins(lectures.reduce((s, l) => s + l.estimated_minutes, 0));

  return (
    <div style={{ marginBottom: 6, border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
      <button
        onClick={() => setOpen((x) => !x)}
        style={{
          width: "100%", textAlign: "left", background: "var(--bg2)",
          border: "none", padding: "8px 14px", cursor: "pointer",
          display: "flex", alignItems: "center", gap: 8,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color, flex: 1 }}>{title}</span>
        {timeStr && (
          <span style={{ fontSize: 11, color: "var(--text3)" }}>{timeStr} total</span>
        )}
        <span style={{ fontSize: 11, color: "var(--text3)" }}>
          {lectures.length} lec
        </span>
        <span style={{ color: "var(--text3)", fontSize: 10, marginLeft: 4 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ borderTop: "1px solid var(--border)" }}>
          {lectures.map((lec) => (
            <LectureRow key={lec.serial_no} lec={lec} onOpenCanvas={onOpenCanvas} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Urgency section (BEHIND / THIS WEEK / LATER) ───────────────────────────────

function UrgencySection({
  label,
  lectures,
  color,
  defaultOpen,
  onOpenCanvas,
}: {
  label: string;
  lectures: PlanLecture[];
  color: string;
  defaultOpen: boolean;
  onOpenCanvas: (chunkId: number) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);

  // Group by deadline_title
  const groups = lectures.reduce<Record<string, PlanLecture[]>>((acc, lec) => {
    const key = lec.deadline_title ?? "Other";
    if (!acc[key]) acc[key] = [];
    acc[key].push(lec);
    return acc;
  }, {});

  const totalTime = fmtMins(lectures.reduce((s, l) => s + l.estimated_minutes, 0));

  return (
    <div style={{ marginBottom: 20 }}>
      <button
        onClick={() => setOpen((x) => !x)}
        style={{
          background: "none", border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", gap: 8,
          padding: "0 0 8px 0", width: "100%",
        }}
      >
        <span style={{
          fontSize: 10, fontWeight: 800, letterSpacing: "0.1em",
          textTransform: "uppercase", color,
        }}>
          {label}
        </span>
        <span style={{
          fontSize: 10, fontWeight: 600, color,
          background: color + "18", padding: "1px 7px", borderRadius: 99,
        }}>
          {lectures.length}
        </span>
        {totalTime && (
          <span style={{ fontSize: 11, color: "var(--text3)" }}>· {totalTime}</span>
        )}
        <span style={{ marginLeft: "auto", color: "var(--text3)", fontSize: 10 }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div>
          {Object.entries(groups).map(([deadlineTitle, lecs]) => (
            <DeadlineGroup
              key={deadlineTitle}
              title={deadlineTitle}
              lectures={lecs}
              color={color}
              onOpenCanvas={onOpenCanvas}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function PlaygroundPage({
  courseCode,
  onBack,
  onOpenCanvas,
}: {
  courseCode: string;
  onBack: () => void;
  onOpenCanvas: (courseCode: string, chunkId?: number) => void;
}) {
  const { data, isLoading } = useQuery<TheoryCourseFull>({
    queryKey: ["course-plan", courseCode],
    queryFn: () => fetchCoursePlan(courseCode),
    refetchInterval: 60_000,
  });

  if (isLoading || !data) {
    return (
      <div className="page">
        <button onClick={onBack} className="btn" style={{ marginBottom: 16, fontSize: 12, padding: "4px 10px" }}>
          ← Study Plan
        </button>
        <div style={{ color: "var(--text3)", fontSize: 13 }}>Loading...</div>
      </div>
    );
  }

  const progress = pct(data.current_lecture, data.total_lectures);
  const { behind, soon, later } = data.playground;

  function handleOpenCanvas(chunkId: number) {
    sessionStorage.setItem("canvas_select_course", courseCode);
    if (chunkId) sessionStorage.setItem("canvas_select_chunk", String(chunkId));
    onOpenCanvas(courseCode, chunkId);
  }

  const hasBehind = data.backlog_lectures > 0;

  return (
    <div className="page">
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <button
          onClick={onBack}
          style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: 12, color: "var(--text3)", padding: 0, marginBottom: 12,
            display: "flex", alignItems: "center", gap: 4,
          }}
        >
          ← Study Plan
        </button>

        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", margin: 0 }}>
              {courseCode}
            </h1>
            <p style={{ fontSize: 12, color: "var(--text3)", margin: "3px 0 0" }}>
              {data.course_title}
            </p>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 12, color: "var(--text2)" }}>
              {data.current_lecture} / {data.total_lectures} lectures
            </div>
            {hasBehind && (
              <div style={{ fontSize: 11, color: "var(--red)", fontWeight: 600, marginTop: 2 }}>
                {data.backlog_lectures} behind
              </div>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ height: 5, background: "var(--bg3)", borderRadius: 99, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${progress}%`, background: "var(--accent)", borderRadius: 99, transition: "width 0.4s" }} />
        </div>
      </div>

      {/* Sections */}
      {behind.length === 0 && soon.length === 0 && later.length === 0 ? (
        <div style={{ color: "var(--text3)", fontSize: 13, padding: "20px 0" }}>
          All caught up — no pending lectures.
        </div>
      ) : (
        <>
          {behind.length > 0 && (
            <UrgencySection
              label="Behind"
              lectures={behind}
              color="var(--red)"
              defaultOpen={true}
              onOpenCanvas={handleOpenCanvas}
            />
          )}
          {soon.length > 0 && (
            <UrgencySection
              label="This Week"
              lectures={soon}
              color="var(--amber)"
              defaultOpen={true}
              onOpenCanvas={handleOpenCanvas}
            />
          )}
          {later.length > 0 && (
            <UrgencySection
              label="Later"
              lectures={later}
              color="var(--text3)"
              defaultOpen={behind.length === 0 && soon.length === 0}
              onOpenCanvas={handleOpenCanvas}
            />
          )}
        </>
      )}

      {/* Deadline detail */}
      {data.deadlines.length > 0 && (
        <div style={{ marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 20 }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text3)", marginBottom: 12 }}>
            All Deadlines
          </div>
          {data.deadlines.map((dl) => (
            <DeadlineDetailRow key={dl.item_id} dl={dl} onOpenCanvas={handleOpenCanvas} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Deadline detail row (all deadlines section) ───────────────────────────────

function DeadlineDetailRow({
  dl,
  onOpenCanvas,
}: {
  dl: PlanDeadline & { lectures: PlanLecture[] };
  onOpenCanvas: (chunkId: number) => void;
}) {
  const [open, setOpen] = useState(false);

  const isPast = dl.is_past;
  const isDone = dl.is_completed || dl.lectures_needed === 0;
  const color = isDone ? "var(--green)" : isPast ? "var(--red)" : (dl.days_left ?? 99) <= 7 ? "var(--amber)" : "var(--text3)";

  const lectures = dl.lectures;
  const hasLectures = lectures && lectures.length > 0;
  const timeStr = fmtMins(dl.estimated_minutes);

  function dueLabel() {
    if (dl.is_completed) return "done";
    if (dl.is_past) return "past";
    if (dl.days_left === 0) return "today";
    if (dl.days_left === 1) return "tomorrow";
    return dl.days_left != null ? `${dl.days_left}d` : "";
  }

  return (
    <div style={{ borderLeft: `2px solid ${color}`, marginBottom: 6 }}>
      <button
        onClick={() => hasLectures && setOpen((x) => !x)}
        style={{
          width: "100%", textAlign: "left", background: "var(--bg2)",
          border: "none", padding: "8px 12px",
          cursor: hasLectures ? "pointer" : "default",
          display: "flex", alignItems: "center", gap: 8,
        }}
      >
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{dl.title}</span>
        {dl.lectures_needed > 0 && (
          <span style={{ fontSize: 11, color, fontWeight: 600 }}>
            {dl.lectures_needed} lec{timeStr ? ` · ${timeStr}` : ""}
          </span>
        )}
        <span style={{ fontSize: 11, color, minWidth: 40, textAlign: "right" }}>{dueLabel()}</span>
        {hasLectures && (
          <span style={{ fontSize: 10, color: "var(--text3)" }}>{open ? "▲" : "▼"}</span>
        )}
      </button>

      {open && hasLectures && (
        <div style={{ borderTop: "1px solid var(--border)" }}>
          {lectures!.map((lec) => (
            <LectureRow key={lec.serial_no} lec={lec} onOpenCanvas={onOpenCanvas} />
          ))}
        </div>
      )}
    </div>
  );
}
