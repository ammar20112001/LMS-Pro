# CLAUDE.md — LMS-Pro Project Guide

## Project Overview

LMS-Pro is a local-first personal learning OS replacing the Virtual University of Pakistan (VU) LMS workflow. It scrapes the LMS, tracks deadlines, generates lecture notes from YouTube transcripts, provides an AI-powered assignment workspace, and sends deadline email alerts.

- **LMS**: Virtual University of Pakistan — `https://vulms.vu.edu.pk/`
- **LMS Type**: Custom ASP.NET platform (no public API)
- **Scraper strategy**: Playwright (headless after first headed login)

---

## Quick Navigation (Start Here for New Sessions)

| Task | Where to go |
|------|-------------|
| Assignment AI (hint, complete, format, submit) | `backend/app/api/assignments.py`, `backend/app/ai/assignment_ai.py` |
| Email / notifications | `backend/app/mail/smtp.py`, `backend/app/jobs/notify_job.py` |
| Deadline reminders (23:00 email) | `backend/app/jobs/deadline_calendar_job.py` |
| LMS scraper (login, courses, assignments, lectures) | `backend/app/scraper/vu_lms.py` |
| LMS assignment submission | `backend/app/scraper/submit.py` |
| Sync job (deadlines, assignments, quizzes) | `backend/app/jobs/sync_job.py` |
| YouTube ID extraction (parallel, separate job) | `backend/app/jobs/youtube_job.py` |
| Notes pipeline (transcript → translate → handout) | `backend/app/jobs/notes_job.py` |
| Scheduler (all job registrations + intervals) | `backend/app/jobs/scheduler.py` |
| DB models | `backend/app/models.py` |
| API schemas | `backend/app/schemas.py` |
| Config / .env fields | `backend/app/config.py` |
| Frontend pages | `frontend/src/pages/` |
| Frontend API client | `frontend/src/api/client.ts` |

---

## Repository Layout

```
backend/
  app/
    main.py                         # FastAPI app entry, router mounts
    config.py                       # Settings from .env
    db.py                           # SQLAlchemy session
    models.py                       # All DB models
    schemas.py                      # Pydantic schemas
    ai/
      assignment_ai.py              # Claude Haiku prompts: hint, complete, format
      client.py                     # httpx wrapper for Anthropic API
    api/
      assignments.py                # Assignment AI endpoints + file ops
      courses.py                    # Courses, lectures, notes, study guide
      items.py                      # Deadlines/handouts: list, text, file view
      sync.py                       # Manual sync trigger
    scraper/
      vu_lms.py                     # Playwright: login, scrape, YouTube ID extraction
      submit.py                     # Playwright: submit assignment files to LMS
    jobs/
      scheduler.py                  # APScheduler job registrations (start here for job changes)
      sync_job.py                   # Scrapes deadlines/quizzes/lectures every 30 min
      youtube_job.py                # Parallel YouTube ID extraction (2 browsers, every 2 min)
      notes_job.py                  # Transcript → translate → handout every 3 min
      notify_job.py                 # Notification dispatcher every 5 min + daily digest
      deadline_calendar_job.py      # Pre-schedules 23:00 midnight reminder hourly
    notes/
      transcript.py                 # YouTube Transcript API fetching
      generator.py                  # Claude Haiku handout generation
      obsidian.py                   # Markdown export to Obsidian vault
    mail/
      smtp.py                       # SMTP send_email(), send_calendar_invite(), batch functions
  alembic/                          # DB migrations
frontend/
  src/
    App.tsx                         # Routes
    api/client.ts                   # All API calls
    pages/
      Dashboard.tsx                 # Main dashboard
      CoursesPage.tsx               # Course listing
      CoursePage.tsx                # Single course: lectures, items
      AssignmentDetail.tsx          # Assignment AI workspace (hint, complete, format, run, submit)
      QuizDetail.tsx                # Quiz view
      GDBDetail.tsx                 # GDB discussion view
      HandoutReader.tsx             # Lecture handout/transcript viewer
      PipelinePage.tsx              # Notes pipeline status
      StudyGuidePage.tsx            # AI study guide view
    components/
      ItemCard.tsx                  # Deadline card component
      FileViewer.tsx                # Inline file viewer
start.sh                            # Starts both frontend + backend
kill.sh                             # Kills both services by port
```

---

## Environment (.env)

```
# LMS credentials
lms_url=https://vulms.vu.edu.pk/
username=...
password=...
roll_number=...
student_name=...

# AI
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
AI_PROVIDER=anthropic

# Email (Gmail App Password)
personal_email=...
smtp_host=smtp.gmail.com
smtp_port=587
smtp_user=...
smtp_pass=...           # 16-char Gmail App Password (NOT smtp_password)
smtp_from=...

# Storage
OBSIDIAN_VAULT_PATH=...

# Scheduler intervals
sync_interval_minutes=30
digest_hour_local=7
notes_interval_minutes=3
```

**Important:** Config reads `smtp_pass` (not `smtp_password`). `personal_email` is the primary email target.

---

## Development Commands

```bash
# Start both services
./start.sh

# Stop both services
./kill.sh

# Backend only
cd backend && uvicorn app.main:app --reload

# Frontend only
cd frontend && npm run dev

# DB migrations
cd backend && alembic upgrade head

# Run a job manually
cd backend && python3 -c "
import asyncio
from app.jobs.sync_job import run_sync
asyncio.run(run_sync())
"
```

---

## Tech Stack

- **Backend**: FastAPI + SQLAlchemy + Alembic + SQLite
- **Frontend**: React + Vite + TanStack Query + shadcn/ui (CSS vars, not Tailwind)
- **Scraper**: Playwright (Python, async)
- **Jobs**: APScheduler (BackgroundScheduler, in-process)
- **AI**: Anthropic Claude Haiku (`claude-haiku-4-5-20251001`) via direct `httpx` (not SDK)
- **Transcription**: YouTube Transcript API (primary); `failed` after 10 retries
- **Email**: SMTP (Gmail App Password), UTF-8 with base64 for attachments

---

## Job Schedule

| Job | Interval | File | Purpose |
|-----|----------|------|---------|
| LMS Sync | every 30 min | `sync_job.py` | Scrapes deadlines, assignments, quizzes, lectures |
| YouTube Extraction | every 2 min | `youtube_job.py` | Extracts YouTube IDs (2 parallel browsers) |
| Notes Pipeline | every 3 min | `notes_job.py` | Transcript → translate → Claude handout |
| Notify Dispatcher | every 5 min | `notify_job.py` | Sends pending notifications and midnight reminder |
| Daily Digest | 7:00 AM local | `notify_job.py` | Email of all items due in next 7 days |
| Deadline Reminder | every 1 hr | `deadline_calendar_job.py` | Pre-schedules 23:00 reminder if items due at midnight |

**Midnight reminder mechanism**: `deadline_calendar_job` pre-schedules a `Notification(kind="midnight_reminder")` at 23:00 UTC. `run_notify()` dispatches it when `scheduled_for <= now`. Resilient to server downtime — survives if server is down at exactly 23:00.

---

## Phase 3 — Assignment Workspace

### AI Agents (`backend/app/ai/assignment_ai.py`)

| Function | Purpose |
|----------|---------|
| `get_hint()` | 2-3 sentence hint without giving away the answer |
| `complete_solution()` | Full solution using student's roll number |
| `format_for_upload()` | Generates Python code to create the submission file |

- Roll number injected into prompts for assignments that ask students to use their ID
- `extra_instructions` param passed from frontend for all three agents
- `image_paths` list passed to `format_for_upload()` for screenshot context
- Code file outputs (`.cpp`, `.py`, etc.) strip markdown fences using `solution_text` variable

### Assignment API (`backend/app/api/assignments.py`)

| Endpoint | Purpose |
|----------|---------|
| `POST /{id}/hint` | Get AI hint |
| `POST /{id}/complete` | AI full solution |
| `POST /{id}/format` | Generate submission file |
| `POST /{id}/run` | Compile + execute C++ (g++, 10s timeout) |
| `POST /{id}/upload-image` | Upload screenshot for AI context |
| `GET /{id}/images/{filename}` | Serve uploaded image |
| `GET /{id}/file/{filename}/view` | Inline preview of generated file |
| `GET /{id}/file/{filename}` | Download generated file |
| `POST /{id}/submit` | Submit file to LMS via Playwright |

### Format Agent File Rules
- `.docx`: Use `python-docx`, native Word headings/paragraphs/tables, embed images
- `.cpp`/`.py`/code files: Write `solution_text` directly, strip fences — **never inline code**
- Never write student name/roll unless assignment explicitly asks

### Text Extraction (`backend/app/api/items.py`)
- `.docx`: `python-docx`
- `.doc`: LibreOffice converts to `.docx` first, then extracts
- Cached in `~/.lms-pro/files/` after first download

---

## Phase 2 — Notes Pipeline

### How It Works

1. **YouTube job** (`youtube_job.py`) — 2 parallel browsers, extracts YouTube IDs for ~500 pending lectures
2. **Notes job** (`notes_job.py`) — picks up to 5 `pending` `LectureVideo` rows per run:
   - Fetches transcript via YouTube Transcript API
   - Translates Urdu/Hinglish → English via `deep-translator` (GoogleTranslate, free)
   - Generates structured Markdown handout via Claude Haiku
3. **Frontend** shows transcripts and handouts via `HandoutReader` and `PipelinePage`

### Transcription Strategy
- **Primary**: YouTube Transcript API — works for ~70% of lectures (auto-captions)
- **Fallback**: `failed` after `MAX_RETRIES` (10) — no local Whisper (CPU is 4-5x slower than real-time)
- **Future option**: OpenAI Whisper API ($0.02/min) if coverage needs to improve

### YouTube Extraction Performance
- 2 parallel Playwright browsers (matches 2 physical cores on i7-7660U)
- Decoupled from sync job — runs independently every 2 min
- ~500 lectures complete in ~1.5-2 hours

---

## Email System

### Notification Kinds (`notify_job.py` KIND_LABELS)

| Kind | Trigger |
|------|---------|
| `deadline_72h` | Item due in 72 hours |
| `deadline_24h` | Item due in 24 hours |
| `deadline_2h` | Item due in 2 hours |
| `midnight_reminder` | All items due within the next hour (sent at 23:00) |

### SMTP Notes (`mail/smtp.py`)
- Subject lines encoded with `Header(subject, 'utf-8')` to handle special characters
- `.ics` attachments encoded as base64 (emoji in iCal broke raw SMTP)
- Calendar invite sending is **disabled** — only 23:00 midnight reminder is active
- `send_email()` targets `personal_email` first, falls back to `notify_email`

---

## Key Design Decisions

- **Local-first**: all processing on user's machine; outbound only to Anthropic API + SMTP
- **Diff-based scraping**: `content_hash` on each item, only re-process on change
- **Session persistence**: Playwright `storage_state.json` keeps login alive
- **Single-prompt AI**: transcripts ~13K tokens, well within Haiku 200K context window
- **No Tailwind in frontend**: uses CSS variables (`var(--bg)`, `var(--accent)`, etc.) — do not introduce Tailwind classes
- **httpx not anthropic SDK**: direct HTTP calls to Anthropic API (SDK had auth header issues)
- **YouTube job decoupled**: sync job does not do YouTube extraction — that's `youtube_job.py`

---

## Git Rules

- **Never add `Co-Authored-By: Claude` trailers** — commits are by the user only
- Never commit `.env` or credentials
- Never commit `backend/test_*.py` or `samples/`
- Commit messages: concise, imperative mood, no trailing period

---

## Phasing

- **Phase 1** ✅ Scraper + SQLite + React dashboard + email notifications
- **Phase 2** ✅ YouTube transcription + translation + Claude Haiku handouts + parallel YouTube extraction
- **Phase 3** ✅ Assignment workspace: AI hint/complete/format, C++ runner, image upload, LMS submission
- **Phase 3B** 🔜 Active Learning Canvas: AI-guided study sessions, concept graph, playground, resource discovery
- **Phase 4** 🔜 RAG tutor using course PDF handouts
- **Phase 5** 🔜 Daily planner (deadline-aware scheduling)

---

## Phase 3B Vision (Planned — Not Yet Built)

**The idea**: A unified study canvas where the student says "I have 4.5 hours" and the system:
1. Lays out an optimized study plan based on upcoming deadlines and concept mastery
2. Breaks PDFs into atomic concepts (not pages) with difficulty ratings and prerequisites
3. Surfaces external resources (Khan Academy, GeeksforGeeks) inline — no tab switching
4. Provides an interactive playground for code experiments right next to reading
5. Tracks mastery in real-time and adapts next steps
6. AI tutor available on-demand without leaving the canvas
7. Canvas-based UI — panels are draggable, resizable, collapsible

**Design status**: UI design exploration in progress (Claude Design).
**Starting point when building**: New `study_canvas/` directory in frontend + new `api/study.py` endpoint.
