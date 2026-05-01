# Phase 1 — LMS Scraper, Dashboard, Email Alerts

End state: the user opens the LMS-Pro dashboard in the morning, sees every deadline across every course, gets an email when something is due in 72h / 24h / 2h, and never logs into the university LMS to check what's pending.

No lectures, no notes, no quizzes, no tutor in this phase. Just **what's due, when, where's the file**.

## 1. Scope

### In
- LMS login (cookie-based session, persisted).
- Discover all enrolled courses for the current term.
- Per course, extract:
  - Assignment list: title, brief (HTML or PDF), due date, submission format hints, attached files.
  - Quiz list: title, due/open windows, attempts allowed.
  - Announcement list: title, body, posted date.
  - Resource list: lecture videos and slides — **metadata only** in this phase (URL, posted date, duration if available). No download yet.
- Diff-based ingestion: only changed/new items hit the DB.
- File downloads: assignment attachments only.
- SQLite schema and migrations.
- Minimal React dashboard:
  - "Due Soon" list (next 14 days, sorted by due date).
  - Per-course view (assignments, quizzes, announcements).
  - Item detail (brief, attached files, link back to LMS as fallback).
- Email notifications via SMTP at T-72h, T-24h, T-2h per item.
- A daily 7am digest email.
- Manual "Mark complete" toggle so finished items leave the Due Soon list.

### Out (deferred to later phases)
- Lecture video download / transcription / notes.
- Quiz content extraction (just the existence + due date for now).
- Submission upload from the app.
- Tutor / chatbot.
- Plan generation.

## 2. Pre-Work — Discovery (Day 1)

**Blocking question**: what LMS does the university run?

Steps the user should run before code:
1. Open browser DevTools on the LMS landing page after login. Note any of:
   - URL pattern (`/moodle/`, `/canvas/`, `/blackboard/`, custom).
   - Any `<meta name="generator">` tag.
   - Any visible footer attribution.
   - The XHR/fetch calls hitting `/api/v1/...` or similar — Canvas exposes a JSON API; Moodle exposes a web service if enabled.
2. If it's Canvas or Moodle with API access enabled, **skip Playwright** and go straight to the API client. Faster, more stable, no DOM scraping.
3. If it's a custom build, proceed with Playwright.
4. Map the routes: courses index, course home, assignment index, assignment detail, quiz index, announcement index. Capture sample HTML for each into `samples/` for selector development without hammering the live LMS.

Output of this step: a `LMS_PROFILE.md` with routes, auth flow, and 2FA notes. The scraper module is then implemented against that profile.

## 3. Architecture (Phase 1 only)

```
┌──────────────────┐         ┌──────────────────┐
│  React (Vite)    │ ◀─REST─ │  FastAPI         │
│  Dashboard       │         │  /api/courses    │
└──────────────────┘         │  /api/items      │
                             │  /api/items/:id  │
                             │  /api/sync       │
                             └────────┬─────────┘
                                      │
                          ┌───────────┴───────────┐
                          │                       │
                    ┌─────▼──────┐         ┌──────▼─────┐
                    │  SQLite    │         │APScheduler │
                    │  + Alembic │         │  jobs      │
                    └────────────┘         └──────┬─────┘
                                                  │
                              ┌───────────────────┼────────────────────┐
                              │                   │                    │
                     ┌────────▼────────┐ ┌────────▼────────┐ ┌─────────▼────────┐
                     │  LMS Scraper    │ │  Notification   │ │  Daily Digest    │
                     │  (Playwright)   │ │  Dispatcher     │ │  (7 AM)          │
                     │  every 30 min   │ │  every 5 min    │ │  daily           │
                     └─────────────────┘ └─────────────────┘ └──────────────────┘
```

In-process. One Python service, one React app. SQLite file. No Docker required for v1.

## 4. Module Layout

```
lms_pro/
  backend/
    app/
      main.py                # FastAPI entry
      config.py              # env + keyring access
      db.py                  # SQLAlchemy session
      models.py              # ORM
      schemas.py             # Pydantic
      api/
        courses.py
        items.py
        sync.py
      scraper/
        __init__.py
        base.py              # abstract Scraper interface
        playwright_driver.py # session, login, fetch helpers
        moodle.py            # if applicable
        canvas.py            # if applicable
        custom.py            # university-specific
        parsers/
          courses.py
          assignments.py
          quizzes.py
          announcements.py
        diff.py              # compare scraped vs DB, emit events
      jobs/
        scheduler.py         # APScheduler setup
        sync_job.py
        notify_job.py
        digest_job.py
      mail/
        smtp.py
        templates/
          deadline.html
          digest.html
      events.py              # event bus (in-process pub/sub)
    alembic/
    tests/
    pyproject.toml
  frontend/
    src/
      App.tsx
      pages/
        Dashboard.tsx
        Course.tsx
        Item.tsx
      components/
        DueSoonList.tsx
        ItemCard.tsx
      api/client.ts
      hooks/
    package.json
  samples/                   # captured HTML for parser tests
  .env.example
  README.md
```

## 5. Auth & Session Handling

- First login: launch Playwright in **headed** mode. User logs in manually (handles SSO + MFA in their normal flow). Cookies persisted to `~/.lms-pro/state.json` via Playwright `storage_state`.
- Subsequent runs: launch headless, load `storage_state`, navigate to a known authenticated URL, check for redirect-to-login. If unauthenticated, surface a notification ("session expired, click to refresh") that re-launches headed.
- Credentials are **never stored**. Only cookies. If the user wants password auto-fill they can use their browser's password manager during the headed login.

## 6. Data Model (Phase 1)

```sql
courses(
  id INTEGER PRIMARY KEY,
  lms_id TEXT UNIQUE NOT NULL,
  code TEXT, title TEXT,
  term TEXT, url TEXT,
  last_synced_at DATETIME
);

items(
  id INTEGER PRIMARY KEY,
  course_id INTEGER REFERENCES courses(id),
  lms_id TEXT, kind TEXT,            -- assignment | quiz | announcement | resource
  title TEXT, body_html TEXT,
  url TEXT,
  opens_at DATETIME, due_at DATETIME,
  posted_at DATETIME,
  metadata_json TEXT,                -- format hints, attempts allowed, etc.
  completed_at DATETIME,             -- user-set
  first_seen_at DATETIME,
  last_seen_at DATETIME,
  content_hash TEXT,                 -- for diff
  UNIQUE(course_id, kind, lms_id)
);

item_files(
  id INTEGER PRIMARY KEY,
  item_id INTEGER REFERENCES items(id),
  filename TEXT, mime TEXT,
  remote_url TEXT, local_path TEXT,
  downloaded_at DATETIME
);

notifications(
  id INTEGER PRIMARY KEY,
  item_id INTEGER REFERENCES items(id),
  kind TEXT,                         -- deadline_72h | deadline_24h | deadline_2h | digest
  scheduled_for DATETIME,
  sent_at DATETIME
);

sync_runs(
  id INTEGER PRIMARY KEY,
  started_at DATETIME, finished_at DATETIME,
  status TEXT, error TEXT,
  items_added INTEGER, items_updated INTEGER
);
```

`content_hash` is `sha256(title + body_html + due_at + metadata_json)`. Diff uses it to skip unchanged rows and to detect "the brief changed, re-notify."

## 7. Scraper Interface

```python
class Scraper(Protocol):
    async def login(self, headed: bool) -> None: ...
    async def list_courses(self) -> list[CourseDTO]: ...
    async def list_assignments(self, course: CourseDTO) -> list[ItemDTO]: ...
    async def list_quizzes(self, course: CourseDTO) -> list[ItemDTO]: ...
    async def list_announcements(self, course: CourseDTO) -> list[ItemDTO]: ...
    async def list_resources(self, course: CourseDTO) -> list[ItemDTO]: ...
    async def download_file(self, url: str, dest: Path) -> None: ...
```

Concrete impl is chosen at startup based on `LMS_PROFILE` config. Same interface whether it's an API client (Canvas/Moodle) or a Playwright driver.

## 8. Sync Job

Runs every 30 minutes (configurable). One sync run:

1. Verify session; refresh if needed.
2. `list_courses()` → upsert into `courses`.
3. For each course, in parallel-bounded fashion:
   - `list_assignments`, `list_quizzes`, `list_announcements`, `list_resources`.
   - For each item, compute `content_hash`. If new or changed:
     - Upsert into `items`.
     - For assignments, download any newly attached files into `~/.lms-pro/files/{course_code}/{assignment_slug}/`.
     - Schedule notifications for `deadline_72h`, `_24h`, `_2h` if `due_at` is in the future and the row was newly created.
     - Emit `item.created` or `item.updated` event.
4. Write a `sync_runs` row with counts.
5. Exit. Errors are logged, never crash the scheduler.

Rate limits: at most 4 concurrent course pages, 200ms between requests on the same domain. Respect `Retry-After`. Back off on 429.

## 9. Notification Dispatcher

Runs every 5 minutes. Picks rows from `notifications` where `scheduled_for <= now` and `sent_at IS NULL`, sends via SMTP, marks sent. If `items.completed_at` is set, skip and mark sent.

Daily digest at 07:00 local: one email summarizing everything due in the next 7 days, grouped by course.

Templates are simple HTML (Jinja2). Subject lines: `[LMS-Pro] CS401 — Assignment 3 due in 24h`.

## 10. API Surface

```
GET  /api/courses                       → list of courses
GET  /api/courses/:id                   → course + recent items
GET  /api/items?due_within=14d          → due-soon list
GET  /api/items/:id                     → item detail incl. file paths
POST /api/items/:id/complete            → mark completed
POST /api/items/:id/uncomplete
POST /api/sync                          → trigger ad-hoc sync
GET  /api/sync/runs                     → recent sync history
GET  /api/files/:item_file_id           → stream a downloaded file
```

No auth on the API in v1 — single user, bound to `127.0.0.1`.

## 11. Frontend

Three screens, no more:

- **Dashboard** — `Due Soon (14 days)` list, color-coded by urgency, with course code, title, due date, and a "complete" toggle. A small "last synced 12 min ago" indicator and a "Sync now" button.
- **Course** — assignment list, quiz list, announcement list, resource list (metadata-only).
- **Item** — title, due date, brief (rendered HTML), attached files (download links to local copies), "Open in LMS" fallback link, complete toggle.

Stack: Vite + React + TanStack Query + shadcn/ui. No router beyond a simple three-route setup.

## 12. Configuration

`.env`:
```
LMS_BASE_URL=
LMS_PROFILE=moodle|canvas|custom
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=             # via keyring in production
SMTP_FROM=
NOTIFY_EMAIL=
SYNC_INTERVAL_MINUTES=30
DIGEST_HOUR_LOCAL=7
DATA_DIR=~/.lms-pro
```

## 13. Milestones

Roughly week-sized chunks, single developer, evenings.

- **M1 — Discovery + Skeleton.** `LMS_PROFILE.md` filled in. FastAPI app boots, SQLite + Alembic baseline migration, frontend renders empty dashboard. APScheduler running with a no-op job.
- **M2 — Login + Courses.** Headed Playwright login working, session persisted, `list_courses()` returns real data, courses table populated, dashboard shows course list.
- **M3 — Assignments + Files.** Assignment scraping for one course end-to-end. Files downloaded. Item detail page renders brief and file list. Diff logic in place.
- **M4 — Quizzes + Announcements + Multi-course.** All four item kinds across all courses. Sync job stable on 30-min cadence.
- **M5 — Notifications.** SMTP dispatcher + digest. Tested with at least one real item flowing T-72h → T-24h → T-2h.
- **M6 — Polish + Manual Upload Fallback.** "Mark complete," "Open in LMS" links, manual item creation form for the items that couldn't be scraped, error UI, sync history page.

## 14. Testing Strategy

- **Parser tests**: feed captured HTML from `samples/` to parsers, assert `ItemDTO` shape. These are the high-value tests — selectors break, parsers must catch it.
- **Diff tests**: golden DB state + new scrape → assert exact set of upserts and events.
- **Notification scheduling tests**: time-machine the clock, assert correct rows in `notifications`.
- **No live LMS in CI.** Live scraper is exercised manually during development against the user's account.

## 15. Risks Specific to Phase 1

- **2FA every login.** If the LMS forces re-MFA on every session and cookies don't persist long, the headed-login prompt becomes intolerable. Mitigation: extend session lifetime via "remember this device" if offered; otherwise tolerate one re-auth per week.
- **Selector drift mid-semester.** A UI update breaks parsers silently — items stop appearing. Mitigation: alert if `sync_runs.items_added` is 0 across a full week despite known upcoming deadlines; alert if a parser raises on > 20% of pages.
- **Time-zone bugs.** Due dates are the entire product. Store everything in UTC, render in local. Test around DST.
- **Email deliverability.** Self-hosted SMTP from a residential IP is unreliable. Default config should walk the user through using their Gmail SMTP with an app password, or SendGrid free tier.

## 16. Definition of Done — Phase 1

1. The user runs one command, opens `localhost:5173`, sees every assignment, quiz, and announcement across every course, with correct due dates.
2. The user receives a 7am digest email and per-item T-24h emails reliably for one full week.
3. The user has not opened the university LMS for "what's due" purposes during that week.
