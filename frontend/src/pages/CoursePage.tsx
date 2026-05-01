import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchLectures, fetchProgress, setProgress, Course } from "../api/client";

interface Props {
  course: Course;
  onBack: () => void;
}

export function CoursePage({ course, onBack }: Props) {
  const qc = useQueryClient();

  const { data: lectures = [] } = useQuery({
    queryKey: ["lectures", course.id],
    queryFn: () => fetchLectures(course.id),
  });

  const { data: progress } = useQuery({
    queryKey: ["progress", course.id],
    queryFn: () => fetchProgress(course.id),
  });

  const progressMut = useMutation({
    mutationFn: (serial: number) => setProgress(course.id, serial),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["progress", course.id] }),
  });

  const current = progress?.current_lecture_serial ?? 0;
  const total = progress?.total_lectures ?? lectures.length;

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "24px 16px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <button onClick={onBack} style={{
          background: "none", border: "none", cursor: "pointer",
          color: "#6b7280", fontSize: 13, padding: "4px 8px",
          borderRadius: 4, display: "flex", alignItems: "center", gap: 4,
        }}>
          ← Back
        </button>
        <div>
          <div style={{ fontWeight: 700, fontSize: 18, color: "#111827" }}>
            {course.code} — {course.title}
          </div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
            {current} / {total} lectures completed
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{
        height: 6, background: "#e5e7eb", borderRadius: 3, marginBottom: 24, overflow: "hidden",
      }}>
        <div style={{
          height: "100%", borderRadius: 3, background: "#4f46e5",
          width: total > 0 ? `${(current / total) * 100}%` : "0%",
          transition: "width 0.3s",
        }} />
      </div>

      {/* Lecture list */}
      {lectures.length === 0 ? (
        <div style={{ textAlign: "center", color: "#9ca3af", padding: 40 }}>
          No lectures synced yet. Run a sync to load lecture data.
        </div>
      ) : (
        <div>
          {lectures.map((lec) => {
            const done = lec.serial_no <= current;
            const isCurrent = lec.serial_no === current;
            return (
              <div
                key={lec.id}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "10px 14px", marginBottom: 4,
                  borderRadius: 8,
                  background: isCurrent ? "#ede9fe" : done ? "#f0fdf4" : "#fff",
                  border: `1px solid ${isCurrent ? "#c4b5fd" : done ? "#bbf7d0" : "#e5e7eb"}`,
                  cursor: "pointer",
                }}
                onClick={() => progressMut.mutate(lec.serial_no)}
                title={`Mark up to lecture ${lec.serial_no} as done`}
              >
                <div style={{
                  width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                  background: done ? (isCurrent ? "#7c3aed" : "#10b981") : "#e5e7eb",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, fontWeight: 700, color: done ? "#fff" : "#6b7280",
                }}>
                  {done ? (isCurrent ? lec.serial_no : "✓") : lec.serial_no}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontSize: 13, fontWeight: done ? 500 : 400, color: done ? "#111827" : "#374151",
                  }}>
                    {lec.title}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  {lec.has_video && <span title="Video" style={{ fontSize: 14 }}>🎬</span>}
                  {lec.has_reading && <span title="Reading" style={{ fontSize: 14 }}>📖</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
