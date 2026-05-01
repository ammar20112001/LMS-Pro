import { formatDistanceToNow, parseISO } from "date-fns";
import { Item } from "../api/client";

interface Props {
  item: Item;
  onToggleComplete: (item: Item) => void;
}

const KIND_ICON: Record<string, string> = {
  assignment: "📝",
  quiz: "🧠",
  gdb: "💬",
};

const KIND_COLOR: Record<string, string> = {
  assignment: "#4f46e5",
  quiz: "#059669",
  gdb: "#d97706",
};

function urgencyColor(dueAt: string | null): string {
  if (!dueAt) return "#6b7280";
  const diff = parseISO(dueAt).getTime() - Date.now();
  const hours = diff / 3_600_000;
  if (hours < 0) return "#dc2626";
  if (hours < 24) return "#dc2626";
  if (hours < 72) return "#d97706";
  return "#059669";
}

export function ItemCard({ item, onToggleComplete }: Props) {
  const color = urgencyColor(item.due_at);
  const dueLabel = item.due_at
    ? formatDistanceToNow(parseISO(item.due_at), { addSuffix: true })
    : "No deadline";

  return (
    <div
      style={{
        border: `1px solid ${item.completed_at ? "#d1fae5" : "#e5e7eb"}`,
        borderLeft: `4px solid ${item.completed_at ? "#10b981" : color}`,
        borderRadius: 8,
        padding: "12px 16px",
        marginBottom: 8,
        background: item.completed_at ? "#f0fdf4" : "#fff",
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        opacity: item.completed_at ? 0.7 : 1,
      }}
    >
      <button
        onClick={() => onToggleComplete(item)}
        title={item.completed_at ? "Mark incomplete" : "Mark complete"}
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          border: `2px solid ${item.completed_at ? "#10b981" : "#9ca3af"}`,
          background: item.completed_at ? "#10b981" : "transparent",
          cursor: "pointer",
          flexShrink: 0,
          marginTop: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontSize: 12,
        }}
      >
        {item.completed_at ? "✓" : ""}
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              background: KIND_COLOR[item.kind] + "18",
              color: KIND_COLOR[item.kind],
              padding: "2px 6px",
              borderRadius: 4,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            {KIND_ICON[item.kind]} {item.kind}
          </span>
          <span style={{ fontSize: 11, color: "#6b7280" }}>{item.course_code}</span>
        </div>

        <div
          style={{
            fontWeight: 600,
            fontSize: 14,
            color: "#111827",
            textDecoration: item.completed_at ? "line-through" : "none",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {item.title}
        </div>

        {item.lesson && (
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
            {item.lesson}
          </div>
        )}
      </div>

      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color }}>
          {dueLabel}
        </div>
        {item.total_marks && (
          <div style={{ fontSize: 11, color: "#9ca3af" }}>{item.total_marks} marks</div>
        )}
        {item.status && (
          <div
            style={{
              fontSize: 10,
              marginTop: 2,
              color: item.status === "Expired" ? "#dc2626" : "#6b7280",
            }}
          >
            {item.status}
          </div>
        )}
      </div>
    </div>
  );
}
