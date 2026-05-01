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
    scraper/
    jobs/
    mail/
  alembic/
  tests/
frontend/               # React + Vite app
samples/                # Captured HTML/HAR from VU LMS for parser tests
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
```

Load with `python-dotenv`. Never hardcode credentials.

## Tech Stack

- **Backend**: FastAPI + SQLAlchemy + Alembic + SQLite (→ Postgres later)
- **Frontend**: React + Vite + TanStack Query + shadcn/ui
- **Scraper**: Playwright (Python, async)
- **Jobs**: APScheduler (in-process)
- **AI**: Anthropic Claude API (`anthropic` SDK)
- **Transcription**: OpenAI Whisper API or local `whisper.cpp`
- **Vectors**: ChromaDB (local persistent)
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
- Commit messages should be concise, imperative mood, no trailing period.

## Phasing

- **Phase 1** (current): Scraper + SQLite + React dashboard + email notifications
- **Phase 2**: Lecture download + Whisper transcription + Claude notes
- **Phase 3**: Quiz generation + mastery tracking
- **Phase 4**: Assignment workspace + RAG tutor
- **Phase 5**: Daily planner (deadline-aware scheduling)

## Key Design Decisions

- Local-first: everything runs on the user's machine; only outbound calls to AI APIs and email.
- Notes written as Markdown into the Obsidian vault so they're browseable natively.
- Diff-based scraping: `content_hash` on each item, only process changes.
- Session persistence: Playwright `storage_state.json` persists after first headed login; no credentials stored.
- Manual upload fallback in UI for anything the scraper can't reach.
