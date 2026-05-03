# CLAUDE.md — LMS-Pro Project Guide

## Project Overview

LMS-Pro is a local-first personal learning OS that replaces the Virtual University of Pakistan (VU) LMS workflow. It scrapes the VU LMS, turns lecture videos into readable notes, tracks deadlines, and provides a unified dashboard with email alerts.

- **LMS**: Virtual University of Pakistan — `https://vulms.vu.edu.pk/`
- **LMS Type**: Custom ASP.NET-based platform (no public API)
- **Scraper strategy**: Playwright (headless after first headed login)

## Repository Layout

```
Documentation/          # Design docs (DESIGN.md, PHASE1_SCRAPER.md)
backend/                # FastAPI app
  app/
    main.py
    config.py
    db.py
    models.py
    schemas.py
    api/
      courses.py        # Course + notes API endpoints
      sync.py           # Sync trigger endpoints
      items.py          # Handouts/deadlines
    scraper/
      vu_lms.py         # Playwright scraper (YouTube ID extraction included)
    jobs/
      sync_job.py       # LMS scraping scheduler
      notes_job.py      # Transcription + translation pipeline
    notes/
      transcript.py     # YouTube API transcript fetching
      generator.py      # AI handout generation (Claude Haiku)
      obsidian.py       # Markdown export to Obsidian vault
    mail/
  alembic/              # DB migrations
  tests/
frontend/               # React + Vite app
  src/
    pages/
      Dashboard.tsx        # Main dashboard
      CoursesPage.tsx      # Course listing
      CoursePage.tsx       # Single course view
      HandoutReader.tsx    # Study handout viewer
      PipelinePage.tsx     # Notes pipeline status
      StudyGuidePage.tsx   # Study guide view
.env                    # Local creds — never committed
CLAUDE.md               # This file
```

## Environment

Credentials and config live in `.env` (gitignored):
```
lms_url=https://vulms.vu.edu.pk/
username=...
password=...
roll_number=...
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
AI_PROVIDER=anthropic   # or gemini
OBSIDIAN_VAULT_PATH=...
```

Load with `python-dotenv`. Never hardcode credentials.

## Tech Stack

- **Backend**: FastAPI + SQLAlchemy + Alembic + SQLite (→ Postgres later)
- **Frontend**: React + Vite + TanStack Query + shadcn/ui
- **Scraper**: Playwright (Python, async)
- **Jobs**: APScheduler (in-process)
- **AI (Translation + Handouts)**: Anthropic Claude Haiku (`claude-haiku-4-5-20251001`) via direct httpx calls
- **Transcription**: YouTube Transcript API (primary); videos without captions are marked failed
- **Email**: SMTP (Gmail app password or SendGrid)

## Development Commands

```bash
# Backend
cd backend && uvicorn app.main:app --reload

# Frontend
cd frontend && npm run dev

# Run scraper manually
cd backend && python -m app.scraper.run

# DB migrations
cd backend && alembic upgrade head
```

## Git Rules

- **Never add `Co-Authored-By: Claude` to commits.** Commits are authored by the user only.
- Never commit `.env` or any file containing credentials.
- Never commit `backend/test_*.py` or `samples/` — gitignored.
- Commit messages should be concise, imperative mood, no trailing period.

## Phasing

- **Phase 1** ✅: Scraper + SQLite + React dashboard + email notifications
- **Phase 2** ✅: YouTube API transcription + translation (deep-translator) + Claude Haiku handouts
- **Phase 3**: Quiz generation + mastery tracking
- **Phase 4**: Assignment workspace + RAG tutor
- **Phase 5**: Daily planner (deadline-aware scheduling)

## Phase 2 — Lecture Notes Pipeline

### How It Works

1. **Scraper** (`vu_lms.py`) extracts YouTube IDs from lecture pages and stores them in `LectureVideo` rows
2. **Notes job** (`notes_job.py`) runs every 3 minutes via APScheduler:
   - Picks up to 5 `pending` `LectureVideo` rows
   - Fetches transcript via YouTube Transcript API (`transcript.py`)
   - Translates Urdu/Hinglish → English via `deep-translator` (GoogleTranslate, free)
   - Stores `transcript_raw`, `transcript_en`, `notes_status`
3. **Handout generation** (`generator.py`) calls Claude Haiku to produce structured Markdown study guides
4. **Frontend** shows transcripts, translations, and handouts via `HandoutReader` and `PipelinePage`

### Transcription Strategy

- **Primary**: YouTube Transcript API — works for ~70% of VU LMS lectures (those with auto-captions)
- **Fallback**: Videos without captions are marked `failed` after `MAX_RETRIES` (10) attempts
- **No local Whisper**: Local Whisper was evaluated and rejected — CPU transcription is 4-5x slower than real-time (40+ min per lecture), impractical for 300 lectures/semester
- **Future option**: OpenAI Whisper API ($0.02/min) if coverage needs to improve

### Cost Model (per semester, 300 lectures)

| Phase | Tool | Cost |
|-------|------|------|
| Transcription | YouTube API (free) | $0 |
| Translation | deep-translator / GoogleTranslate (free) | $0 |
| Handout generation | Claude Haiku | ~$18 |
| **Total** | | **~$18/semester** |

### API Notes

- Claude Haiku model ID: `claude-haiku-4-5-20251001`
- Call via direct `httpx` POST to `https://api.anthropic.com/v1/messages`
- Required headers: `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`
- **Do not use the `anthropic` SDK** — use httpx directly (SDK had auth header issues)
- Translation timeout: 180s (large transcripts take 90-100s)

## Key Design Decisions

- Local-first: everything runs on the user's machine; only outbound calls to AI APIs and email.
- Notes written as Markdown into the Obsidian vault so they're browseable natively.
- Diff-based scraping: `content_hash` on each item, only process changes.
- Session persistence: Playwright `storage_state.json` persists after first headed login; no credentials stored.
- Manual upload fallback in UI for anything the scraper can't reach.
- Single-prompt translation and handout generation (not chunked) — transcripts are ~13K tokens, well within Haiku's 200K context window.
