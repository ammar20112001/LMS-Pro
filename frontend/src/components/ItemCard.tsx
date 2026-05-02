import { parseISO, differenceInHours } from "date-fns";
import { Item } from "../api/client";
import { FileViewer } from "./FileViewer";

interface Props {
  item: Item;
  onClick?: () => void;
}

function urgencyClass(dueAt: string | null, status: string): string {
  if (status === "Submitted") return "deadline-row--submitted";
  if (status === "Expired") return "deadline-row--expired";
  if (!dueAt) return "";
  const h = differenceInHours(parseISO(dueAt), new Date());
  if (h < 0) return "deadline-row--urgent";
  if (h < 24) return "deadline-row--urgent";
  return "";
}

function countdownLabel(dueAt: string | null) {
  if (!dueAt) return null;
  const diff = parseISO(dueAt).getTime() - Date.now();
  if (diff < 0) {
    const h = Math.abs(Math.floor(diff / 3_600_000));
    return { text: `${h}h overdue`, urgent: true, overdue: true };
  }
  const h = Math.floor(diff / 3_600_000);
  const d = Math.floor(h / 24);
  if (h === 0) { const m = Math.floor(diff / 60000); return { text: `${m}m left`, urgent: true, overdue: false }; }
  if (d === 0) return { text: `${h}h left`, urgent: h < 6, overdue: false };
  if (d === 1) return { text: `${d}d ${h % 24}h left`, urgent: true, overdue: false };
  return { text: `${d}d left`, urgent: false, overdue: false };
}

function formatDue(dueAt: string | null) {
  if (!dueAt) return "—";
  return parseISO(dueAt).toLocaleDateString("en-PK", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const KIND_BADGE: Record<string, string> = {
  assignment: "badge--assign",
  quiz: "badge--quiz",
  gdb: "badge--gdb",
};

const KIND_LABEL: Record<string, string> = {
  assignment: "ASSIGN",
  quiz: "QUIZ",
  gdb: "GDB",
};

const STATUS_CHIP: Record<string, string> = {
  Submitted: "status-chip--submitted",
  Expired: "status-chip--expired",
  Open: "status-chip--open",
};

export function ItemCard({ item, onClick }: Props) {
  const urgClass = urgencyClass(item.due_at, item.status ?? "");
  const countdown = countdownLabel(item.due_at);
  const isSubmitted = item.status === "Submitted" || Boolean(item.completed_at);
  const isExpired = item.status === "Expired";
  const hasFile = item.kind === "assignment";

  return (
    <div
      className={`deadline-row ${urgClass}`}
      style={{ "--course-color": "var(--accent)" } as React.CSSProperties}
      onClick={onClick}
    >
      <div className="deadline-row__course-bar" />
      <div className="deadline-row__main">
        <div className="deadline-row__top">
          <div className="deadline-row__left">
            <span className={`badge ${KIND_BADGE[item.kind] ?? ""}`}>{KIND_LABEL[item.kind] ?? item.kind}</span>
            <span className="deadline-row__course">{item.course_code}</span>
            <span className="deadline-row__title">{item.title}</span>
          </div>
          <span className={`status-chip ${STATUS_CHIP[item.status ?? ""] ?? "status-chip--pending"}`}>
            {item.status === "Submitted" ? "✓ Submitted" : item.status ?? "Pending"}
          </span>
        </div>
        <div className="deadline-row__bottom">
          <span className="deadline-row__due">Due {formatDue(item.due_at)}</span>
          {item.total_marks && <span className="deadline-row__marks">{item.total_marks} marks</span>}
          {!isSubmitted && !isExpired && countdown && (
            <span className={`deadline-row__countdown ${countdown.urgent ? "deadline-row__countdown--urgent" : ""} ${countdown.overdue ? "deadline-row__countdown--overdue" : ""}`}>
              {countdown.overdue ? "⚠ " : "⏱ "}{countdown.text}
            </span>
          )}
          {hasFile && !isSubmitted && (
            <span onClick={(e) => e.stopPropagation()}>
              <FileViewer item={item} />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
