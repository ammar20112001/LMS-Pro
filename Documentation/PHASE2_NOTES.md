# Phase 2 — Lecture Notes Pipeline

## Overview

Phase 2 turns raw VU lecture recordings into structured, readable Markdown notes stored directly in the Obsidian vault. The user never watches a lecture to take notes — the app does it automatically.

**Pipeline in one line:**
```
LMS lecture page → YouTube video ID → auto-transcript → Gemini 2.0 Flash → Markdown notes → Obsidian vault
```

**Fallback (if auto-transcript quality is poor):**
```
YouTube video ID → yt-dlp audio download → faster-whisper (local) → Gemini 2.0 Flash → Markdown notes
```

---

## Goals

- Extract YouTube video IDs from all lecture pages
- Fetch auto-generated transcripts via `youtube-transcript-api`
- Detect poor quality transcripts and flag them for fallback
- Generate structured English notes using Gemini 2.0 Flash (free tier)
- Write notes as Markdown to the Obsidian vault
- Surface notes in the app UI per lecture
- AI provider is swappable via `.env` (Gemini now, Claude later)

---

## 1. Data Model Changes

### `Lecture` table — new columns

```python
class Lecture(Base):
    # existing columns
    id: int
    course_id: int
    week: int
    lms_index: int
    serial_no: int
    title: str
    has_video: bool
    has_reading: bool

    # new in Phase 2
    youtube_id: str | None          # extracted from iframe src
    transcript_raw: str | None      # raw text from youtube-transcript-api
    transcript_source: str | None   # "youtube_auto" | "whisper_local"
    transcript_quality: str | None  # "ok" | "poor" | None (not checked yet)
    notes_md: str | None            # generated Markdown notes
    notes_generated_at: datetime | None
    notes_status: str               # "pending" | "transcribing" | "generating" | "done" | "failed"
```

### Migration

```
alembic revision --autogenerate -m "add phase2 lecture notes columns"
alembic upgrade head
```

---

## 2. Scraper Changes

### 2a. Extract YouTube ID from lecture pages

VU embeds YouTube videos in an `<iframe>` on the CourseHome lecture view. During the existing `list_lectures()` scrape, we click into each lecture (or check the embedded content) to pull the video URL.

**File:** `backend/app/scraper/vu_lms.py`

```python
async def get_lecture_youtube_id(self, course_id: str, lecture_lms_index: int) -> str | None:
    """Navigate to a lecture page and extract the YouTube video ID from the iframe."""
    # Navigate to lecture content page
    # Find: <iframe src="https://www.youtube.com/embed/{VIDEO_ID}?...">
    # Extract VIDEO_ID from src attribute
    # Return None if no iframe found
```

The scraper already visits each course page. We extend `_sync_lectures()` in `sync_job.py` to also call `get_lecture_youtube_id()` for any lecture where `youtube_id IS NULL` and `has_video = True`.

This runs lazily — first sync populates basic lecture data, YouTube IDs fill in on the next pass.

---

## 3. AI Client Abstraction

**File:** `backend/app/ai/client.py`

Single interface, multiple providers. Swap via `AI_PROVIDER` in `.env`.

```python
from abc import ABC, abstractmethod

class AIClient(ABC):
    @abstractmethod
    async def complete(self, system: str, user: str) -> str:
        ...

class GeminiClient(AIClient):
    def __init__(self, api_key: str):
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        self.model = genai.GenerativeModel("gemini-2.0-flash")

    async def complete(self, system: str, user: str) -> str:
        response = self.model.generate_content(f"{system}\n\n{user}")
        return response.text

class AnthropicClient(AIClient):
    def __init__(self, api_key: str):
        import anthropic
        self.client = anthropic.Anthropic(api_key=api_key)

    async def complete(self, system: str, user: str) -> str:
        msg = self.client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=4096,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        return msg.content[0].text

def get_ai_client() -> AIClient:
    from app.config import settings
    if settings.ai_provider == "gemini":
        return GeminiClient(settings.gemini_api_key)
    if settings.ai_provider == "anthropic":
        return AnthropicClient(settings.anthropic_api_key)
    raise ValueError(f"Unknown AI provider: {settings.ai_provider}")
```

**Config additions** (`backend/app/config.py`):

```python
ai_provider: str = "gemini"        # "gemini" | "anthropic"
gemini_api_key: str = ""
anthropic_api_key: str = ""
obsidian_vault_path: str = ""      # absolute path to Obsidian vault root
```

**.env additions:**

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=your_key_here
OBSIDIAN_VAULT_PATH=/home/ammar/Documents/Ammar Obsedian Vault
```

---

## 4. Transcript Fetching

**File:** `backend/app/notes/transcript.py`

```python
from youtube_transcript_api import YouTubeTranscriptApi, NoTranscriptFound, TranscriptsDisabled

def fetch_transcript(youtube_id: str) -> tuple[str, str]:
    """
    Returns (transcript_text, source) where source is "youtube_auto".
    Raises TranscriptUnavailable if nothing found.
    """
    try:
        # Try English first, then any available language
        segments = YouTubeTranscriptApi.get_transcript(youtube_id, languages=["en", "ur"])
        text = " ".join(seg["text"] for seg in segments)
        return text, "youtube_auto"
    except (NoTranscriptFound, TranscriptsDisabled):
        raise TranscriptUnavailable(youtube_id)

def assess_quality(transcript: str) -> str:
    """
    Heuristic quality check.
    Returns "ok" or "poor".

    Poor signals:
    - Very short for a long lecture (< 500 words)
    - High ratio of [Music] / [Applause] / [...] tags
    - Excessive repetition (auto-caption glitch)
    """
    word_count = len(transcript.split())
    noise_tags = transcript.count("[") 
    noise_ratio = noise_tags / max(word_count, 1)

    if word_count < 500:
        return "poor"
    if noise_ratio > 0.05:
        return "poor"
    return "ok"
```

**Fallback (local Whisper) — stubbed for now, activated later if needed:**

```python
def transcribe_with_whisper(audio_path: str) -> tuple[str, str]:
    """
    Uses faster-whisper locally. Called only when youtube_auto quality is "poor".
    Requires: pip install faster-whisper yt-dlp
    """
    from faster_whisper import WhisperModel
    model = WhisperModel("medium", device="cpu", compute_type="int8")
    segments, _ = model.transcribe(audio_path, language=None)  # auto-detect
    text = " ".join(seg.text for seg in segments)
    return text, "whisper_local"
```

---

## 5. Note Generation

**File:** `backend/app/notes/generator.py`

```python
SYSTEM_PROMPT = """
You are a study notes generator for a university student at Virtual University of Pakistan.

You will receive a raw transcript from a recorded lecture. The transcript may be:
- In English
- In Urdu
- A mix of both (code-switching is common in Pakistani CS education)
- Imperfect (auto-generated captions may have errors)

Your task: generate clean, structured study notes IN ENGLISH regardless of the source language.

Output format (Markdown):

# {Lecture Title}

## Key Concepts
- Bullet list of the main topics covered

## Detailed Notes
### {Topic 1}
Explanation, definitions, examples

### {Topic 2}
...

## Important Definitions
| Term | Definition |
|------|-----------|
| ... | ... |

## Formulas / Algorithms
(if applicable — code blocks for pseudocode)

## Summary
2–3 sentence summary of what was covered and why it matters.

## Practice Questions
3–5 questions a student should be able to answer after this lecture.

Rules:
- If a concept was explained in Urdu, translate and explain it in English
- Ignore filler words, greetings, repeated phrases
- Be concise but complete — a student should not need to watch the lecture after reading these notes
- Use simple, clear English
""".strip()

async def generate_notes(
    title: str,
    course_code: str,
    lecture_serial: int,
    transcript: str,
    ai_client: AIClient,
) -> str:
    user_prompt = f"""
Course: {course_code}
Lecture {lecture_serial}: {title}

Transcript:
---
{transcript[:50_000]}  # cap at 50K chars (~12K tokens) to stay within context
---

Generate study notes for this lecture.
""".strip()

    return await ai_client.complete(SYSTEM_PROMPT, user_prompt)
```

---

## 6. Obsidian Integration

**File:** `backend/app/notes/obsidian.py`

Notes are written as `.md` files into the Obsidian vault. Structure:

```
{vault_root}/
  LMS-Pro/
    CS301P — Computer Architecture/
      Lecture_01 — Introduction to Computer Architecture.md
      Lecture_02 — Number Systems and Data Representation.md
    CS401P — Operating Systems/
      Lecture_01 — ...
```

```python
from pathlib import Path

def write_note(
    vault_root: str,
    course_code: str,
    course_title: str,
    lecture_serial: int,
    lecture_title: str,
    notes_md: str,
) -> Path:
    folder = Path(vault_root) / "LMS-Pro" / f"{course_code} — {course_title}"
    folder.mkdir(parents=True, exist_ok=True)

    filename = f"Lecture_{lecture_serial:02d} — {sanitize(lecture_title)}.md"
    path = folder / filename

    frontmatter = f"""---
course: {course_code}
lecture: {lecture_serial}
title: "{lecture_title}"
generated: true
---

"""
    path.write_text(frontmatter + notes_md, encoding="utf-8")
    return path

def sanitize(name: str) -> str:
    """Remove characters invalid in filenames."""
    return "".join(c for c in name if c not in r'\/:*?"<>|').strip()
```

Notes open natively in Obsidian — backlinks, graph view, search all work automatically.

---

## 7. Notes Job

**File:** `backend/app/jobs/notes_job.py`

Runs as a background APScheduler job. Processes one lecture at a time to avoid hammering the YouTube API or Gemini rate limits.

```python
async def run_notes_job():
    """
    Picks one pending lecture per run, generates notes.
    APScheduler calls this every 10 minutes.
    """
    async with get_db() as db:
        lecture = await db.execute(
            select(Lecture)
            .where(Lecture.has_video == True)
            .where(Lecture.youtube_id != None)
            .where(Lecture.notes_status == "pending")
            .order_by(Lecture.serial_no)
            .limit(1)
        )
        lecture = lecture.scalar_one_or_none()
        if not lecture:
            return  # nothing to do

        course = await db.get(Course, lecture.course_id)
        ai = get_ai_client()

        try:
            # 1. Fetch transcript
            lecture.notes_status = "transcribing"
            await db.commit()

            transcript, source = fetch_transcript(lecture.youtube_id)
            quality = assess_quality(transcript)

            lecture.transcript_raw = transcript
            lecture.transcript_source = source
            lecture.transcript_quality = quality
            await db.commit()

            if quality == "poor":
                log.warning(f"Lecture {lecture.id} transcript quality poor — flagged for manual review")
                lecture.notes_status = "failed"
                await db.commit()
                return

            # 2. Generate notes
            lecture.notes_status = "generating"
            await db.commit()

            notes = await generate_notes(
                title=lecture.title,
                course_code=course.code,
                lecture_serial=lecture.serial_no,
                transcript=transcript,
                ai_client=ai,
            )

            lecture.notes_md = notes
            lecture.notes_generated_at = datetime.now(timezone.utc)
            lecture.notes_status = "done"
            await db.commit()

            # 3. Write to Obsidian
            write_note(
                vault_root=settings.obsidian_vault_path,
                course_code=course.code,
                course_title=course.title,
                lecture_serial=lecture.serial_no,
                lecture_title=lecture.title,
                notes_md=notes,
            )

        except TranscriptUnavailable:
            lecture.notes_status = "failed"
            lecture.transcript_quality = "unavailable"
            await db.commit()
        except Exception as e:
            log.error(f"Notes job failed for lecture {lecture.id}: {e}")
            lecture.notes_status = "failed"
            await db.commit()
```

**Scheduler registration** (`backend/app/jobs/scheduler.py`):

```python
scheduler.add_job(
    run_notes_job,
    "interval",
    minutes=10,
    id="notes_job",
    coalesce=True,
    misfire_grace_time=None,
)
```

---

## 8. API Endpoints

**File:** `backend/app/api/lectures.py`

```
GET  /api/courses/{course_id}/lectures
     → existing, extended with notes_status field

GET  /api/courses/{course_id}/lectures/{lecture_id}/notes
     → returns { notes_md, notes_status, generated_at, transcript_quality }

POST /api/courses/{course_id}/lectures/{lecture_id}/notes/regenerate
     → resets notes_status to "pending" to trigger re-generation

GET  /api/notes/queue
     → returns all lectures with notes_status != "done", ordered by course + serial
     → used by the UI to show the processing queue

POST /api/notes/run
     → manually triggers run_notes_job() immediately (for testing)
```

---

## 9. Frontend Changes

### 9a. Lecture row — notes status indicator

Each row in the lecture list gets a status pill:

| Status | Display |
|--------|---------|
| `pending` | — |
| `transcribing` | `⟳ Fetching transcript` |
| `generating` | `⟳ Generating notes` |
| `done` | `→ View Notes` (clickable) |
| `failed` | `⚠ Transcript unavailable` |

### 9b. Notes page

Clicking `View Notes` opens the `LectureNotes` page:

```
┌─────────────────────────────────────────────────────────┐
│ ← Back    CS301P · Lecture 12 · Pipelining Hazards      │
├─────────────────────────────────────────────────────────┤
│  [Key Concepts] [Detailed Notes] [Practice Questions]   │  ← tabs
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ## Key Concepts                                        │
│  - Data hazards: RAW, WAR, WAW                          │
│  - Forwarding / bypassing                               │
│  - Pipeline stalls and CPI impact                       │
│                                                         │
│  ## Important Definitions                               │
│  | Term | Definition |                                  │
│  ...                                                    │
│                                                         │
│  ## Practice Questions                                  │
│  1. Given the instruction sequence...                   │
│                                                         │
│       [Open in Obsidian]  [Regenerate]                  │
└─────────────────────────────────────────────────────────┘
```

The notes are rendered from Markdown using a lightweight renderer (e.g. `react-markdown`).

"Open in Obsidian" uses the `obsidian://open?vault=...&file=...` URI scheme to jump directly into the vault.

---

## 10. Dependencies

```bash
# Backend
pip install youtube-transcript-api google-generativeai

# Fallback (install later if needed)
pip install faster-whisper yt-dlp
```

Add to `backend/requirements.txt`.

---

## 11. Build Order

1. **DB migration** — add new columns to `Lecture`
2. **Scraper** — extract YouTube IDs from lecture pages, update `_sync_lectures()`
3. **AI client** — `backend/app/ai/client.py` with Gemini + Anthropic implementations
4. **Transcript** — `backend/app/notes/transcript.py`
5. **Generator** — `backend/app/notes/generator.py`
6. **Obsidian writer** — `backend/app/notes/obsidian.py`
7. **Notes job** — `backend/app/jobs/notes_job.py` + register in scheduler
8. **API endpoints** — `backend/app/api/lectures.py` additions
9. **Frontend** — notes status in lecture rows + `LectureNotes` page
10. **Test** — trigger manually via `POST /api/notes/run`, verify one lecture end-to-end

---

## 12. Quality Fallback Decision Tree

```
youtube_id found?
    NO  → notes_status = "failed", transcript_quality = "unavailable"
    YES → fetch youtube auto-transcript
              success?
                  NO  → notes_status = "failed", transcript_quality = "unavailable"
                  YES → quality check
                            "ok"   → generate notes with Gemini
                            "poor" → notes_status = "failed", transcript_quality = "poor"
                                     (manual review — user can trigger whisper fallback later)
```

Poor-quality lectures are surfaced in the UI so the user knows which ones need the Whisper fallback. When we activate that fallback, it's a single config flag change — no pipeline redesign needed.

---

## 13. Cost Estimate (Testing Phase)

| Step | Tool | Cost |
|------|------|------|
| Transcript fetch | youtube-transcript-api | $0 |
| Note generation | Gemini 2.0 Flash (free tier) | $0 |
| Obsidian write | Local file | $0 |
| **Total** | | **$0** |

Free tier limits: 1500 requests/day, 1M tokens/minute. More than enough for 180 lectures spread across days.

When moving to production: swap `AI_PROVIDER=anthropic` in `.env`. No code changes required.
