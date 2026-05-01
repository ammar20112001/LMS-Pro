import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchDueSoon,
  fetchCourses,
  fetchSyncRuns,
  triggerSync,
  markComplete,
  markUncomplete,
  Item,
} from "../api/client";
import { ItemCard } from "../components/ItemCard";
import { formatDistanceToNow, parseISO } from "date-fns";

export function Dashboard() {
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
    onSuccess: () => {
      setTimeout(() => qc.invalidateQueries(), 3000);
    },
  });

  const toggleMut = useMutation({
    mutationFn: (item: Item) =>
      item.completed_at ? markUncomplete(item.id) : markComplete(item.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["due-soon"] }),
  });

  const lastRun = runs[0];
  const lastSync = lastRun?.finished_at
    ? formatDistanceToNow(parseISO(lastRun.finished_at), { addSuffix: true })
    : "Never";

  const byKind = (kind: string) => items.filter((i) => i.kind === kind);

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "24px 16px" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 24,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: "#111827" }}>
            📚 LMS-Pro
          </h1>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
            Spring 2026 · {courses.length} courses
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, color: "#9ca3af" }}>
            Synced {lastSync}
          </span>
          <button
            onClick={() => syncMut.mutate()}
            disabled={syncMut.isPending}
            style={{
              background: "#4f46e5",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              opacity: syncMut.isPending ? 0.7 : 1,
            }}
          >
            {syncMut.isPending ? "Syncing…" : "↻ Sync Now"}
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
        {[
          { label: "Assignments", count: byKind("assignment").length, color: "#4f46e5" },
          { label: "Quizzes", count: byKind("quiz").length, color: "#059669" },
          { label: "GDBs", count: byKind("gdb").length, color: "#d97706" },
        ].map(({ label, count, color }) => (
          <div
            key={label}
            style={{
              flex: 1,
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              padding: "12px 16px",
            }}
          >
            <div style={{ fontSize: 24, fontWeight: 700, color }}>{count}</div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{label} due</div>
          </div>
        ))}
      </div>

      {/* Due Soon list */}
      <h2 style={{ fontSize: 16, fontWeight: 700, color: "#111827", marginBottom: 12 }}>
        Due in the Next 14 Days
      </h2>

      {isLoading && (
        <div style={{ textAlign: "center", color: "#9ca3af", padding: 40 }}>
          Loading…
        </div>
      )}

      {!isLoading && items.length === 0 && (
        <div
          style={{
            textAlign: "center",
            color: "#6b7280",
            padding: 40,
            background: "#f9fafb",
            borderRadius: 8,
            border: "1px dashed #e5e7eb",
          }}
        >
          🎉 Nothing due in the next 14 days.
          <br />
          <span style={{ fontSize: 12, color: "#9ca3af" }}>
            Run a sync to pull the latest from VU LMS.
          </span>
        </div>
      )}

      {items.map((item) => (
        <ItemCard
          key={item.id}
          item={item}
          onToggleComplete={(i) => toggleMut.mutate(i)}
        />
      ))}

      {/* Courses quick nav */}
      {courses.length > 0 && (
        <>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "#111827", margin: "24px 0 12px" }}>
            Courses
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {courses.map((c) => (
              <div
                key={c.id}
                style={{
                  background: "#fff",
                  border: "1px solid #e5e7eb",
                  borderRadius: 8,
                  padding: "10px 14px",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 13, color: "#4f46e5" }}>{c.code}</div>
                <div style={{ fontSize: 12, color: "#374151", marginTop: 2 }}>{c.title}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Sync history */}
      {runs.length > 0 && (
        <>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "#111827", margin: "24px 0 12px" }}>
            Recent Syncs
          </h2>
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#6b7280", borderBottom: "1px solid #e5e7eb" }}>
                <th style={{ padding: "6px 8px" }}>Time</th>
                <th style={{ padding: "6px 8px" }}>Status</th>
                <th style={{ padding: "6px 8px" }}>Added</th>
                <th style={{ padding: "6px 8px" }}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {runs.slice(0, 5).map((r) => (
                <tr key={r.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "6px 8px", color: "#374151" }}>
                    {r.started_at ? formatDistanceToNow(parseISO(r.started_at), { addSuffix: true }) : "—"}
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <span
                      style={{
                        color: r.status === "ok" ? "#059669" : r.status === "error" ? "#dc2626" : "#d97706",
                        fontWeight: 600,
                      }}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td style={{ padding: "6px 8px", color: "#374151" }}>+{r.items_added}</td>
                  <td style={{ padding: "6px 8px", color: "#374151" }}>~{r.items_updated}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
