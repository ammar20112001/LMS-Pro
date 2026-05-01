# LMS-Pro — End-to-End Design Doc

## 1. Vision

Replace the manual workflow of opening the university LMS, hunting for deadlines, watching 1–2 hour recorded lectures, and copying assignment specs into a notebook. Instead: a single local-first app that ingests everything from the LMS, turns lectures into readable notes + practice + quizzes, tracks what's due, surfaces weak concepts, and notifies the user before things slip.

The user's effort goes into **learning and practicing**. Everything else (tracking, downloading, formatting, scheduling) is automated.

## 2. Goals

- **One inbox for coursework.** A dashboard showing every deadline, lecture, assignment, and announcement across all courses.
- **Lectures → notes, fast.** Transcribe recorded lectures, generate structured notes, link to external resources for weak spots.
- **Active recall built in.** Auto-generate practice problems and quizzes from lecture content; track mastery per concept.
- **Deadline-aware scheduling.** Given a quiz on Friday, work backward: which lectures must be watched, which practice must be done.
- **Assignment workspace.** Download assignment files automatically, provide a workspace to draft solutions, format submission files (roll number, filename conventions, cover page) from a user-written core, upload after explicit user approval.
- **Tutor chatbot.** Conversational help grounded in the user's own course materials (RAG over notes + transcripts).
- **Notifications.** Email alerts for upcoming deadlines and overdue items.
- **Generating assignment solutions end-to-end and submitting them as the user's work.** When the user has provided solution themselves. Help them build the solution that is from raw to ready-to-submit and submit.
- **Auto-submission.** The app prepares the submission package; the user clicks submit. For this the dashboard displays on left-hand-side the assignment file and on the right-hand-side the assigment solution file. For hte purpose of review.

## 4. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        React Frontend                            │
│   Dashboard · Course view · Notes · Quiz · Assignment workspace │
└─────────────────────────────────────────────────────────────────┘
                              │ REST / WS
┌─────────────────────────────▼───────────────────────────────────┐
│                       FastAPI Backend                            │
│   Auth · Courses · Deadlines · Notes · Quizzes · Tutor (RAG)    │
└─────────────────────────────────────────────────────────────────┘
        │              │              │              │
   ┌────▼────┐    ┌────▼────┐    ┌────▼─────┐   ┌────▼────┐
   │ Postgres│    │ChromaDB │    │  Files   │   │ APSched │
   │  (state)│    │(vectors)│    │ (S3-lite │   │ (jobs)  │
   │         │    │         │    │  on disk)│   │         │
   └─────────┘    └─────────┘    └──────────┘   └─────────┘
                              │
                ┌─────────────┴──────────────┐
                │      Worker Pipelines      │
                ├────────────────────────────┤
                │ • LMS Scraper (Playwright) │
                │ • Lecture downloader       │
                │ • Whisper transcription    │
                │ • Claude content gen       │
                │ • Quiz generator           │
                │ • Notification dispatcher  │
                └────────────────────────────┘
                              │
                ┌─────────────┴──────────────┐
                │       External APIs        │
                ├────────────────────────────┤
                │ University LMS · Anthropic │
                │ OpenAI Whisper · SendGrid  │
                └────────────────────────────┘
```

**Local-first**: everything runs on the user's machine. Postgres, ChromaDB, file storage, workers are all local. Only outbound calls are to AI APIs and SendGrid.

## 5. Components

### 5.1 LMS Scraper
- Playwright (Python, async, headed for first login, headless after).
- Persists session cookies; refreshes on expiry.
- Runs on a schedule (every 30 min during semester, configurable).
- Surfaces: courses, deadlines (assignments/quizzes/exams), lecture metadata + video URLs, assignment briefs + attached files, announcements.
- Diff-based: only writes changes to the DB, fires events on new/updated items.
- **Manual upload fallback**: if a piece can't be scraped (e.g., proctored quiz inside an iframe), the UI exposes "upload this manually."

Detail in `PHASE1_SCRAPER.md`.

### 5.2 Lecture Pipeline
1. Scraper detects new lecture → enqueues download job.
2. Downloader pulls video to local storage.
3. Transcription job: Whisper (local `whisper.cpp` if GPU available, else OpenAI API for cost/speed tradeoff).
4. Note generation: Claude takes transcript + slides (if available) and produces structured Markdown notes — concepts, definitions, examples, "things to practice."
5. Embedding job: chunks notes + transcript, stores vectors in ChromaDB with `(course_id, lecture_id, chunk_id)` metadata.
6. Resource enrichment: for each "weak / dense concept" tag, Claude suggests external resources (textbook chapter, blog, YT short). Stored alongside notes.

Notes are written to disk as Markdown so they're Obsidian-readable (working directory is already an Obsidian vault).

### 5.3 Quiz & Practice Engine
- Per lecture: Claude generates 5–10 quiz items (MCQ + short answer + coding tasks where applicable) tagged by concept.
- Practice sessions: same generator with looser constraints, untimed, with hints.
- Grading: deterministic for MCQ; Claude-as-judge with rubric for short answer; for code, run in a sandboxed subprocess against generated test cases.
- Mastery model: per `(user, concept)` track exposure count, correctness rate, last-seen. Spaced repetition surfaces weak concepts.

### 5.4 Scheduler / Planner
- Given upcoming deadlines and the user's mastery state, builds a daily plan: "Today: finish Lecture 7 notes, practice Topic X (weak), draft Assignment 3 outline."
- Backward-chained from deadlines. Configurable daily study budget.
- Re-plans on data change (new deadline, completed item, failed quiz).

### 5.5 Assignment Workspace
- Each scraped assignment becomes a workspace: brief, attached files, draft area, submission package builder.
- Draft area is a Monaco editor (code) or Markdown editor (writing).
- Tutor chatbot is course-context-aware (RAG over that course's notes + transcripts) and assignment-context-aware. Hints, debugging, "explain this concept" — yes. "Write the answer for me" — refused, with the same line drawn earlier.
- Submission builder takes the user's core work and a configurable template (roll number, name, filename pattern, cover page) and produces the upload-ready file. The user reviews and clicks submit.

### 5.6 Tutor (RAG)
- Single chatbot endpoint. Retrieval scoped by course; user can broaden.
- Anthropic Claude with prompt caching on the system prompt + retrieved context.
- Conversation history per (user, course) thread.

### 5.7 Notifications
- SMTP or SendGrid. Email-only for v1 (no push, no SMS).
- Triggers: deadline T-72h / T-24h / T-2h, new assignment posted, new announcement, new lecture available, quiz score below threshold (suggest review).
- Digest mode: morning summary email with "today's plan."

## 6. Data Model (Sketch)

```
users(id, email, smtp_config, ...)
courses(id, lms_id, code, title, term, ...)
lectures(id, course_id, lms_id, title, video_url, duration, posted_at,
         transcript_path, notes_path, status)
concepts(id, course_id, label, parent_id)  -- tag taxonomy per course
lecture_concepts(lecture_id, concept_id)
assignments(id, course_id, lms_id, title, brief_html, due_at,
            submission_format, status)
assignment_files(id, assignment_id, kind, path)  -- attached briefs, refs
quizzes(id, course_id, lms_id?, title, due_at, source)  -- source: lms|generated
quiz_items(id, quiz_id, type, prompt, answer_key, concept_id)
attempts(id, user_id, quiz_item_id, response, correct, score, taken_at)
mastery(user_id, concept_id, exposures, correct, last_seen)
announcements(id, course_id, posted_at, title, body, read_at)
events(id, kind, ref_id, payload, fired_at)  -- audit + notification source
sessions(id, user_id, lms_cookies_encrypted, expires_at)
```

ChromaDB collections: `notes`, `transcripts`, one collection per course or unified with metadata filter.

## 7. Tech Stack

- **Backend**: FastAPI + SQLAlchemy + Alembic. SQLite for v1, Postgres once concurrency matters.
- **Frontend**: React + Vite + TanStack Query + shadcn/ui.
- **Scraper**: Playwright (Python).
- **Jobs**: APScheduler in-process for v1; move to Celery + Redis if jobs get heavy.
- **AI**: `anthropic` SDK for Claude (notes, quiz, tutor). OpenAI Whisper API or local `whisper.cpp` for transcription.
- **Vectors**: ChromaDB (local persistent client).
- **Email**: SMTP via standard lib for v1; SendGrid optional.
- **Storage**: local filesystem rooted at the Obsidian vault, so notes are browseable in Obsidian.
- **Secrets**: `.env` + `keyring` for LMS credentials.

## 8. Phasing

**Phase 1 — Scraper + Dashboard + Email (this doc's companion).**
LMS login, course/deadline/assignment extraction, SQLite, minimal dashboard, deadline emails. End state: user never opens the LMS to check what's due.

**Phase 2 — Lecture pipeline.**
Video download, transcription, Claude-generated notes saved to the vault. Notes-first reading workflow.

**Phase 3 — Quiz + practice + mastery.**
Quiz generation, in-app quiz runner, concept tagging, spaced repetition surfacing.

**Phase 4 — Assignment workspace + tutor RAG.**
Assignment-aware chatbot, draft area, submission package builder.

**Phase 5 — Planner.**
Daily plan generator, backward-chained from deadlines + mastery.

**Phase 6 — Polish.**
Settings UI, multi-course handling refinements, robustness on scraper drift, packaging.

## 9. Risks & Open Questions

- **LMS identity unknown.** Moodle / Canvas / Blackboard each have stable APIs; a custom university build means full Playwright scraping with breakage risk on every UI change. **Open: which LMS?**
- **2FA / SSO.** If the university uses SSO with MFA, headless login is hard. Mitigation: persist a real browser session bootstrapped by the user once; refresh on expiry.
- **Terms of service.** Some LMSs prohibit scraping. The user accepts this risk for personal use; the scraper must rate-limit aggressively and never re-distribute content.
- **Video DRM.** If lectures stream over DRM (Widevine, encrypted HLS), download may not be possible. Fallback: capture audio via loopback during playback, or require manual upload.
- **Transcription cost.** OpenAI Whisper API is ~$0.36/hr; 30 lectures/semester ≈ $11. Local `whisper.cpp` is free if user has the hardware. Default to local with API fallback.
- **AI cost on long transcripts.** 1.5h lecture ≈ 15–20k tokens of transcript. Use prompt caching aggressively; keep the system prompt + course context cached, vary only the lecture chunk.
- **Scraper drift.** University LMS UI updates will break selectors. Mitigation: structure scraper around stable text labels and ARIA roles where possible; record DOM snapshots on failure for rapid debugging.

## 10. Success Criteria

The app is working when, for one full semester, the user:
1. Has not opened the university LMS once outside of submission confirmation.
2. Has missed zero deadlines because the app failed to surface them.
3. Reads notes instead of watching ≥ 70% of lectures.
4. Has a measurable mastery score per course at any point in time.
