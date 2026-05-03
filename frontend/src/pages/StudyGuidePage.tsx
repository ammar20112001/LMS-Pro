import { useQuery } from "@tanstack/react-query";
import { fetchStudyGuide, StudyCourse, StudyItem, StudyLecture } from "../api/client";

// ── Deterministic priority engine ────────────────────────────────────────────

/**
 * Parse the leading lecture serial from a lesson reference string.
 * Formats seen: "3. Lab 3: ...", "8. Branching", "40. 3.40. ..."
 * Returns null if no number found.
 */
function parseLessonSerial(lesson: string | null | undefined): number | null {
  if (!lesson) return null;
  const m = lesson.match(/^(\d+)\./);
  if (m) return parseInt(m[1], 10);
  return null;
}

function daysUntil(isoDate: string | null): number | null {
  if (!isoDate) return null;
  return (new Date(isoDate).getTime() - Date.now()) / 86_400_000;
}

type UrgencyLevel = "critical" | "urgent" | "watch" | "normal" | "none";

function urgencyFromDays(days: number | null): UrgencyLevel {
  if (days === null) return "none";
  if (days < 0) return "critical";   // overdue
  if (days < 1) return "critical";
  if (days < 3) return "urgent";
  if (days < 7) return "watch";
  return "normal";
}

const URGENCY_ORDER: Record<UrgencyLevel, number> = {
  critical: 0, urgent: 1, watch: 2, normal: 3, none: 4,
};

// ── Computed types ────────────────────────────────────────────────────────────

interface FocusItem {
  item: StudyItem;
  course: StudyCourse;
  priority: number;
  daysLeft: number | null;
  urgency: UrgencyLevel;
  lessonSerial: number | null;
  gapCount: number;          // lectures still needed before this item
  gapLectures: StudyLecture[]; // the actual lectures needed
  why: string;
}

interface QueueEntry {
  lecture: StudyLecture;
  course: StudyCourse;
  linkedItem: StudyItem | null;
  daysLeft: number | null;
  urgency: UrgencyLevel;
}

// ── Engine functions ──────────────────────────────────────────────────────────

function computeFocusItems(courses: StudyCourse[]): FocusItem[] {
  const items: FocusItem[] = [];

  for (const course of courses) {
    for (const item of course.open_items) {
      const daysLeft = daysUntil(item.due_at);
      // Skip items with no due date or that are very far out (>60d) — low signal
      if (daysLeft !== null && daysLeft > 60) continue;

      const lessonSerial = parseLessonSerial(item.lesson);
      const current = course.current_serial;

      // Lectures the user still needs to watch before this item
      const gapLectures = lessonSerial
        ? course.next_lectures.filter(
            (l) => l.serial_no > current && l.serial_no <= lessonSerial
          )
        : [];
      const gapCount = gapLectures.length;

      // Priority score: deadline urgency × coverage gap multiplier
      const hoursLeft = daysLeft !== null ? Math.max(daysLeft * 24, 0.5) : 336; // 2 weeks default
      const deadlineScore = 10_000 / hoursLeft;
      const priority = deadlineScore * (1 + 0.5 * gapCount);

      const urgency = urgencyFromDays(daysLeft);

      // "Why" text — deterministic from data
      const whyParts: string[] = [];
      if (daysLeft === null) {
        whyParts.push("no deadline set");
      } else if (daysLeft < 0) {
        whyParts.push("overdue");
      } else if (daysLeft < 1) {
        whyParts.push("due today");
      } else if (daysLeft < 2) {
        whyParts.push("due tomorrow");
      } else {
        whyParts.push(`due in ${Math.floor(daysLeft)} day${Math.floor(daysLeft) !== 1 ? "s" : ""}`);
      }

      if (gapCount > 0) {
        whyParts.push(`${gapCount} lecture${gapCount > 1 ? "s" : ""} to cover first`);
      } else if (lessonSerial !== null && lessonSerial <= current) {
        whyParts.push("content already covered");
      } else if (lessonSerial === null) {
        whyParts.push("no specific lecture referenced");
      }

      items.push({
        item, course, priority, daysLeft, urgency,
        lessonSerial, gapCount, gapLectures, why: whyParts.join(" · "),
      });
    }
  }

  return items.sort((a, b) => b.priority - a.priority);
}

function computeLectureQueue(courses: StudyCourse[]): QueueEntry[] {
  const queue: QueueEntry[] = [];

  for (const course of courses) {
    // Map: for each upcoming lecture serial, what's the most urgent linked item?
    const linkedItemBySerial = new Map<number, StudyItem>();

    for (const item of course.open_items) {
      const lessonSerial = parseLessonSerial(item.lesson);
      if (!lessonSerial) continue;
      // All lectures from current+1 up to lessonSerial are "needed" for this item
      for (let s = course.current_serial + 1; s <= lessonSerial; s++) {
        const existing = linkedItemBySerial.get(s);
        const itemDays = daysUntil(item.due_at);
        const existingDays = existing ? daysUntil(existing.due_at) : null;
        // Keep the most urgent (nearest deadline)
        if (!existing || (itemDays !== null && (existingDays === null || itemDays < existingDays))) {
          linkedItemBySerial.set(s, item);
        }
      }
    }

    for (const lec of course.next_lectures) {
      const linked = linkedItemBySerial.get(lec.serial_no) ?? null;
      const daysLeft = linked ? daysUntil(linked.due_at) : null;
      queue.push({
        lecture: lec,
        course,
        linkedItem: linked,
        daysLeft,
        urgency: urgencyFromDays(daysLeft),
      });
    }
  }

  // Sort: by urgency tier, then by days left within tier, then by course+serial
  return queue.sort((a, b) => {
    const uDiff = URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency];
    if (uDiff !== 0) return uDiff;
    if (a.daysLeft !== null && b.daysLeft !== null) return a.daysLeft - b.daysLeft;
    return a.course.code.localeCompare(b.course.code) || a.lecture.serial_no - b.lecture.serial_no;
  });
}

// ── UI helpers ────────────────────────────────────────────────────────────────

const KIND_LABEL: Record<string, string> = {
  assignment: "Assignment", quiz: "Quiz", gdb: "GDB",
};

const URGENCY_COLOR: Record<UrgencyLevel, string> = {
  critical: "var(--red)",
  urgent: "var(--amber)",
  watch: "#eab308",
  normal: "var(--text3)",
  none: "var(--text3)",
};

function formatDaysLeft(days: number | null): string {
  if (days === null) return "No deadline";
  if (days < 0) return "Overdue";
  if (days < 1) return "Today";
  if (days < 2) return "Tomorrow";
  return `${Math.floor(days)}d left`;
}

function formatDueDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Focus card ────────────────────────────────────────────────────────────────

function FocusCard({ fi, onSelectItem }: { fi: FocusItem; onSelectItem?: (itemId: number) => void }) {
  const accentColor = URGENCY_COLOR[fi.urgency];

  return (
    <div className={`sg-focus-card sg-focus-card--${fi.urgency}`} style={{ borderLeftColor: accentColor }}>
      <div className="sg-focus-card__meta">
        <span className="sg-kind-badge sg-kind-badge--{fi.item.kind}">{KIND_LABEL[fi.item.kind]}</span>
        <span className="sg-course-badge">{fi.course.code}</span>
        <span className="sg-focus-card__due" style={{ color: accentColor }}>
          {formatDaysLeft(fi.daysLeft)}
          {fi.item.due_at && <span className="sg-focus-card__due-abs"> · {formatDueDate(fi.item.due_at)}</span>}
        </span>
      </div>

      <div className="sg-focus-card__title">{fi.item.title}</div>

      <div className="sg-focus-card__why">{fi.why}</div>

      {fi.gapLectures.length > 0 && (
        <div className="sg-focus-card__gap-lectures">
          {fi.gapLectures.slice(0, 3).map((l) => (
            <span key={l.id} className="sg-gap-lec">
              #{l.serial_no} {l.title.length > 32 ? l.title.slice(0, 32) + "…" : l.title}
            </span>
          ))}
          {fi.gapLectures.length > 3 && (
            <span className="sg-gap-lec sg-gap-lec--more">+{fi.gapLectures.length - 3} more</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Lecture queue row ─────────────────────────────────────────────────────────

function QueueRow({ entry, onSelectLecture }: {
  entry: QueueEntry;
  onSelectLecture?: (lectureId: number, courseId: number) => void;
}) {
  const hasNotes = entry.lecture.notes_status === "transcribed" || entry.lecture.notes_status === "done";

  return (
    <div className="sg-queue-row">
      <span className="sg-queue-row__course">{entry.course.code}</span>
      <span className="sg-queue-row__serial">#{entry.lecture.serial_no}</span>
      <span className="sg-queue-row__title">{entry.lecture.title}</span>

      <span className="sg-queue-row__reason">
        {entry.linkedItem ? (
          <span style={{ color: URGENCY_COLOR[entry.urgency] }}>
            {KIND_LABEL[entry.linkedItem.kind]} · {formatDaysLeft(entry.daysLeft)}
          </span>
        ) : (
          <span style={{ color: "var(--text3)" }}>No deadline</span>
        )}
      </span>

      <div className="sg-queue-row__actions">
        {hasNotes && (
          <span className="sg-notes-badge">Notes ✓</span>
        )}
        {onSelectLecture && (
          <button
            className="btn-tiny"
            onClick={() => onSelectLecture(entry.lecture.id, entry.course.id)}
          >
            {hasNotes ? "Read" : "Watch"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Course progress row ───────────────────────────────────────────────────────

function CourseProgressRow({ course }: { course: StudyCourse }) {
  const pct = course.total_lectures > 0
    ? Math.round((course.current_serial / course.total_lectures) * 100)
    : 0;

  const nextItem = course.open_items.find((i) => i.due_at);
  const nextItemDays = nextItem ? daysUntil(nextItem.due_at) : null;
  const nextItemUrgency = urgencyFromDays(nextItemDays);
  const nextLec = course.next_lectures[0];

  return (
    <div className="sg-progress-row">
      <span className="sg-progress-row__code">{course.code}</span>

      <div className="sg-progress-bar-wrap">
        <div className="sg-progress-bar">
          <div className="sg-progress-bar__fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="sg-progress-row__count">
          {course.current_serial}/{course.total_lectures}
        </span>
      </div>

      <span className="sg-progress-row__next">
        {nextLec ? `Next: #${nextLec.serial_no} ${nextLec.title.slice(0, 35)}${nextLec.title.length > 35 ? "…" : ""}` : "All caught up"}
      </span>

      <span className="sg-progress-row__deadline" style={{ color: URGENCY_COLOR[nextItemUrgency] }}>
        {nextItem
          ? `${KIND_LABEL[nextItem.kind]} · ${formatDaysLeft(nextItemDays)}`
          : <span style={{ color: "var(--text3)" }}>No deadline</span>
        }
      </span>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function StudyGuidePage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["study-guide"],
    queryFn: fetchStudyGuide,
    refetchInterval: 60_000,
  });

  if (isLoading) return <div className="page"><div className="empty-state">Loading study guide…</div></div>;
  if (error || !data) return <div className="page"><div className="empty-state">Failed to load study guide.</div></div>;

  const focusItems = computeFocusItems(data.courses);
  const lectureQueue = computeLectureQueue(data.courses);

  const urgentCount = focusItems.filter(
    (f) => f.urgency === "critical" || f.urgency === "urgent"
  ).length;
  const totalOpen = focusItems.length;

  return (
    <div className="page" style={{ maxWidth: 960 }}>
      <div className="page__header">
        <div className="page__header-left">
          <h1 className="page__title">Study Guide</h1>
          <span className="page__subtitle">
            {urgentCount > 0
              ? `${urgentCount} item${urgentCount > 1 ? "s" : ""} need urgent attention · ${totalOpen} total open`
              : totalOpen > 0
              ? `${totalOpen} open item${totalOpen > 1 ? "s" : ""} · no urgent deadlines`
              : "No open items — you're clear"}
          </span>
        </div>
      </div>

      {/* ── Focus section ── */}
      {focusItems.length > 0 && (
        <section className="sg-section">
          <h2 className="sg-section__title">
            Focus
            <span className="sg-section__hint">Sorted by deadline × coverage gap</span>
          </h2>
          <div className="sg-focus-list">
            {focusItems.slice(0, 6).map((fi) => (
              <FocusCard key={`${fi.course.id}-${fi.item.id}`} fi={fi} />
            ))}
          </div>
        </section>
      )}

      {/* ── Lecture queue ── */}
      {lectureQueue.length > 0 && (
        <section className="sg-section">
          <h2 className="sg-section__title">
            Watch Next
            <span className="sg-section__hint">Lectures ordered by deadline pressure</span>
          </h2>
          <div className="sg-queue-panel">
            <div className="sg-queue-col-header">
              <span>Course</span>
              <span>#</span>
              <span>Lecture</span>
              <span>Why now</span>
              <span></span>
            </div>
            <div className="sg-queue-list">
              {lectureQueue.slice(0, 20).map((entry) => (
                <QueueRow
                  key={`${entry.course.id}-${entry.lecture.id}`}
                  entry={entry}
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Course progress ── */}
      <section className="sg-section">
        <h2 className="sg-section__title">
          Course Progress
          <span className="sg-section__hint">Lectures watched · nearest deadline</span>
        </h2>
        <div className="sg-progress-panel">
          {data.courses.map((course) => (
            <CourseProgressRow key={course.id} course={course} />
          ))}
        </div>
      </section>
    </div>
  );
}
