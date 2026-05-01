import { formatDistanceToNow, parseISO } from "date-fns";
import { Item } from "../api/client";
import { FileViewer } from "./FileViewer";

interface Props {
  item: Item;
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

const STATUS_COLOR: Record<string, string> = {
  Open: "#059669",
  Expired: "#dc2626",
  Submitted: "#6366f1",
};

function urgencyColor(dueAt: string | null, status: string): string {
  if (status === "Submitted") return "#10b981";
  if (status === "Expired") return "#dc2626";
  if (!dueAt) return "#6b7280";
  const diff = parseISO(dueAt).getTime() - Date.now();
  const hours = diff / 3_600_000;
  if (hours < 0) return "#dc2626";
  if (hours < 24) return "#dc2626";
  if (hours < 72) return "#d97706";
  return "#059669";
}

export function ItemCard({ item }: Props) {
  const accentColor = urgencyColor(item.due_at, item.status ?? "");
  const dueLabel = item.due_at
    ? formatDistanceToNow(parseISO(item.due_at), { addSuffix: true })
    : "No deadline";
  const isSubmitted = item.status === "Submitted" || Boolean(item.completed_at);

  // Only show file button for assignments that haven't been submitted yet
  const hasFile = item.kind === "assignment";

  return (
    <div style={{
      border: `1px solid #e5e7eb`,
      borderLeft: `4px solid ${accentColor}`,
      borderRadius: 8,
      padding: "14px 16px",
      marginBottom: 8,
      background: isSubmitted ? "#f0fdf4" : "#fff",
      opacity: isSubmitted ? 0.8 : 1,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Kind + course badge row */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{
              fontSize: 11, fontWeight: 600,
              background: KIND_COLOR[item.kind] + "18",
              color: KIND_COLOR[item.kind],
              padding: "2px 7px", borderRadius: 4,
              textTransform: "uppercase", letterSpacing: "0.5px",
            }}>
              {KIND_ICON[item.kind]} {item.kind}
            </span>
            <span style={{ fontSize: 11, color: "#6b7280", fontWeight: 500 }}>{item.course_code}</span>
            <span style={{
              fontSize: 10, fontWeight: 700,
              color: STATUS_COLOR[item.status ?? ""] || "#6b7280",
              marginLeft: "auto",
              textTransform: "uppercase", letterSpacing: "0.5px",
            }}>
              {item.status}
            </span>
          </div>

          {/* Title */}
          <div style={{
            fontWeight: 600, fontSize: 14, color: "#111827",
            textDecoration: isSubmitted ? "line-through" : "none",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            marginBottom: item.lesson ? 4 : 0,
          }}>
            {item.title}
          </div>

          {item.lesson && (
            <div style={{ fontSize: 12, color: "#6b7280" }}>{item.lesson}</div>
          )}
        </div>

        {/* Right column */}
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: accentColor }}>{dueLabel}</div>
          {item.total_marks && (
            <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>{item.total_marks} marks</div>
          )}
          {hasFile && !isSubmitted && <FileViewer item={item} />}
        </div>
      </div>
    </div>
  );
}
