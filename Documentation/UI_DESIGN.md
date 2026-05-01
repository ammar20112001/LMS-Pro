# LMS-Pro UI/UX Design Specification

## Overview

LMS-Pro is a local-first personal learning dashboard for students at Virtual University of Pakistan (VU). It replaces the clunky VU LMS web interface with a fast, single-page app that surfaces what actually matters: deadlines, submission status, lecture progress, and sync history. The user never needs to open the VU LMS website directly for day-to-day tracking.

**Target user**: A VU student who has multiple concurrent courses, multiple assignment/quiz/GDB deadlines active at once, and wants a single-glance view of what needs attention without logging into vulms.vu.edu.pk.

---

## Design Principles

1. **Information density over decoration.** Every pixel should carry meaning. No hero images, no sidebars, no onboarding carousels.
2. **Urgency through color, not icons.** The left border of each item card uses a traffic-light system (green → orange → red) based on time remaining. Status badges reinforce this secondarily.
3. **Dark accent on white.** Indigo (#4f46e5) as the primary action color on white backgrounds. Colored text/badges, not heavy fills, for secondary information.
4. **Local-first, zero cloud.** The UI talks only to `localhost:8000`. No telemetry, no remote login required after initial session capture.
5. **Click to drill down, not to navigate pages.** The app is a single HTML page. Course detail replaces the dashboard view; the back button restores it. No URL routing needed for Phase 1.

---

## Color System

| Role | Hex | Usage |
|---|---|---|
| Primary / indigo | `#4f46e5` | Buttons, active states, assignment badge, course code text |
| Success / green | `#10b981` | Submitted status, completed lectures, progress bar |
| Warning / amber | `#d97706` | Due in 24–72 h, GDB badge |
| Danger / red | `#dc2626` | Due in < 24 h or past due, Expired status |
| Quiz / emerald | `#059669` | Quiz kind badge |
| Submitted / violet | `#6366f1` | Submitted status text |
| Neutral text | `#111827` | Primary headings, body text |
| Secondary text | `#374151` | Subtext, table rows |
| Muted text | `#6b7280` | Labels, timestamps, course codes in cards |
| Placeholder | `#9ca3af` | Empty states, marks label |
| Border | `#e5e7eb` | Card borders, table lines |
| Surface | `#f9fafb` | Empty state background |

Badge backgrounds use the matching color at 9% opacity (hex suffix `18`), e.g. `#4f46e518` for assignment badges.

---

## Typography

All text uses `system-ui, -apple-system, sans-serif` (inherited from browser default). No web font loading.

| Level | Size | Weight | Color | Usage |
|---|---|---|---|---|
| Page title | 24px | 700 | `#111827` | "LMS-Pro" header |
| Section heading | 16px | 700 | `#111827` | "Due in the Next 14 Days", "Courses" |
| Course heading (detail) | 18px | 700 | `#111827` | Course code + title in CoursePage |
| Card title | 14px | 600 | `#111827` | Item / lecture title |
| Badge label | 11px | 600 | kind color | Assignment / Quiz / GDB kind badge |
| Course code | 13px | 700 | `#4f46e5` | Course grid card |
| Course subtitle | 12px | 400 | `#374151` | Course full title in grid |
| Due label | 12px | 600 | urgency color | "in 3 days", "2 hours ago" |
| Marks / meta | 11px | 400 | `#9ca3af` | "20 marks", "GDB lesson ref" |
| Status badge | 10px | 700 | status color | "OPEN", "EXPIRED", "SUBMITTED" (uppercase) |
| Table text | 12px | 400 | `#374151` | Sync history rows |
| Button text | 13px | 600 | white | "Sync Now" |

---

## Layout

**Max width**: 860px, centered with `margin: 0 auto`.  
**Padding**: 24px top/bottom, 16px left/right.  
**No sidebar.** No persistent navigation bar. The header row serves as the app identity + action area.

### Grid

- Stats row: 3 equal-width flex items, `gap: 12px`.
- Course grid: 2-column CSS grid, `gap: 8px`.
- Item list: full width, stacked vertically.

---

## Dashboard Page

The root view. Shown when no course is selected.

### Header row

Left: App name "📚 LMS-Pro" (h1, 24px bold) + subtitle "Spring 2026 · N courses" (12px muted).  
Right: "Synced X ago" text + "↻ Sync Now" indigo button (8px 14px padding). While syncing: button text becomes "Syncing…" at 70% opacity, disabled.

### Stats bar

Three equal cards showing counts of pending items by kind:
- Assignments (indigo)
- Quizzes (emerald)
- GDBs (amber)

Each card: 24px bold count + 12px "X due" muted label. White background, 1px `#e5e7eb` border, 8px radius.

### Due-soon list

Heading "Due in the Next 14 Days". Items are fetched from `GET /api/items?due_within_days=14`. Sorted by `due_at` ascending.

Empty state: centered box with dashed border, "🎉 Nothing due in the next 14 days." + "Run a sync to pull the latest from VU LMS." hint.

Loading state: centered "Loading…" in `#9ca3af`.

Items render as `ItemCard` components (see Item Card section).

### Course grid

Heading "Courses". 2-column grid. Each tile: course code (bold indigo 13px) + full title (12px `#374151`). Clicking a tile navigates to the Course Detail view (sets `selectedCourse` state). On hover: border turns indigo.

### Sync history table

Heading "Recent Syncs". Columns: Time (relative), Status, Added, Updated. Shows last 5 runs. Status is color-coded: ok = emerald, error = red, running = amber.

---

## Item Card

Used in the due-soon list on the Dashboard.

### Structure

Two-column flex layout: left (flex-grow) + right (fixed-width).

**Left column:**
- Top row: kind badge + course code + status badge (status aligned to the right with `margin-left: auto`)
- Title (14px bold, ellipsized with overflow hidden)
- Optional lesson/reference label (12px muted, below title)

**Right column:**
- Due label (12px bold, urgency color)
- Marks if present (11px `#9ca3af`)
- "↓ View File" link button for assignment items that aren't submitted

### Left border

4px solid, urgency color. Combined with `border: 1px solid #e5e7eb` (the `borderLeft` overrides the left side of the border).

### Urgency color logic

| Condition | Color |
|---|---|
| status = Submitted | `#10b981` (green) |
| status = Expired | `#dc2626` (red) |
| no due date | `#6b7280` (gray) |
| < 0 h remaining | `#dc2626` (red) |
| < 24 h remaining | `#dc2626` (red) |
| < 72 h remaining | `#d97706` (amber) |
| >= 72 h remaining | `#059669` (green) |

### Submitted / completed state

Background turns `#f0fdf4` (light green). Opacity 0.8. Title has `text-decoration: line-through`.

### View File button

Only shown for assignments (`kind === "assignment"`) when not submitted. Styled as a small inline anchor: `#ede9fe` background, indigo text, 4px radius, opens `http://localhost:8000/api/items/{id}/file` in a new tab. The backend proxies the download through a live Playwright browser session.

### No toggle-complete button

Completion state is driven entirely by the scraper detecting a solution file link (`lbtnViewSolutionFile_{idx}`) on the VU LMS assignments page. There is no manual toggle. The backend sets `completed_at` automatically when an item's status becomes "Submitted".

---

## Course Detail Page (CoursePage)

Rendered when the user clicks a course tile on the Dashboard. The Dashboard conditionally renders `<CoursePage>` instead of the main view — no URL routing.

### Header

Back button (← Back) + course code + title as `{CODE} — {Full Title}`. Below: "{current} / {total} lectures completed" in muted 12px.

### Progress bar

Thin (6px) indigo bar. Width = `(current / total) * 100%`. Animated with CSS transition. Background `#e5e7eb`.

### Lecture list

One row per lecture, sorted by `serial_no` ascending. Fetched from `GET /api/courses/{id}/lectures` and `GET /api/courses/{id}/progress`.

**Row structure:** circular serial badge (left) + title (flex-grow) + content type icons (right).

**Row states:**
- Not yet reached: white background, `#e5e7eb` border. Badge: `#e5e7eb` bg, `#6b7280` text showing serial number.
- Completed (serial <= current, not current): `#f0fdf4` background, `#bbf7d0` border. Badge: `#10b981` bg, white "✓".
- Current lecture (serial === current): `#ede9fe` background, `#c4b5fd` border. Badge: `#7c3aed` bg, white serial number.

**Click behavior:** clicking any row calls `POST /api/courses/{id}/progress?serial={n}`, setting the "I'm up to lecture N" marker. The progress query is invalidated and the bar/rows re-render.

**Content icons:** if `has_video`, show 🎬; if `has_reading`, show 📖. Both can appear.

### Empty state

"No lectures synced yet. Run a sync to load lecture data." centered in `#9ca3af`.

---

## Assignment File Viewer

The "↓ View File" button links directly to `GET /api/items/{id}/file`. The backend:
1. Spins up a Playwright browser using the persisted session (`storage_state.json`).
2. Navigates to the Assignments page with the correct course context.
3. Triggers the `lbtnViewAssignmentFile_{idx}` PostBack and captures the download.
4. Streams the bytes back as `application/octet-stream` with `Content-Disposition: attachment`.

The browser opens this URL in a new tab. If the file is a PDF, the browser's native PDF viewer displays it. Other file types (docx, etc.) download directly.

No frontend file-handling code is needed beyond the `<a target="_blank">` link.

---

## Sync Status

**Trigger**: "↻ Sync Now" button calls `POST /api/sync`. The button disables and shows "Syncing…" while `syncMut.isPending`. After success, all queries are invalidated after a 3-second delay (to let the sync job write its results).

**Last synced**: Shows relative time from the most recent `SyncRun.finished_at`. Displayed as "Synced 5 minutes ago" in muted 12px text.

**Sync history table**: Last 5 sync runs with start time (relative), status, items added, items updated. Auto-refreshes every 30 seconds.

**Running state**: If a sync run has `status = "running"`, the status cell shows amber "running". The UI does not currently show a live progress indicator during the sync — the table updates when the next 30-second poll fires.

---

## Notification System (Backend)

Email alerts are sent for deadlines at T-72h, T-24h, and T-2h before `due_at`. Implemented via `notify_job.py` + `smtp.py`. Not represented in the UI currently. Future Phase 1 addition: a small bell icon in the header showing unsent notifications count.

---

## Empty States

| Location | Empty state text |
|---|---|
| Due-soon list | "🎉 Nothing due in the next 14 days. / Run a sync to pull the latest from VU LMS." |
| Course lecture list | "No lectures synced yet. Run a sync to load lecture data." |
| Course grid | (hidden — section only renders if `courses.length > 0`) |
| Sync history | (hidden — section only renders if `runs.length > 0`) |

---

## Phase 2 UI Additions (Planned)

These are not implemented yet but should be designed to fit within the existing layout.

**Lecture video player**: A panel that opens below the lecture row when clicked (expand/collapse). Embeds or links to the lecture video. Adjacent tab for AI-generated notes (Markdown rendered).

**AI notes panel**: Fetches pre-generated Markdown notes from the backend (stored in the Obsidian vault). Rendered inline with basic Markdown support. A "Regenerate" button triggers re-transcription + re-summarization via Claude API.

**Quiz practice mode**: Accessible from the Dashboard or from a course's items list. Shows a quiz question, accepts a text answer, sends to Claude for evaluation, shows feedback. Progress tracked per quiz item.

**Phase 2 color additions**: No new colors needed. The existing palette covers all planned UI states.
