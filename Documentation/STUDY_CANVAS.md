# Study Canvas — Phase 3B Documentation

## Purpose

Study Canvas transforms raw course handout files (PDFs, PPTXs) into richly structured, first-principles learning notes that can be studied directly inside LMS-Pro. It eliminates the need to switch between the LMS, a PDF viewer, and external resources.

The core idea: take a 505-page PDF that a student can barely read in time, and produce a set of lecture-by-lecture learning documents that explain every concept from scratch — with definitions, examples, and structure — generated once by Claude Haiku, then available instantly in the browser.

---

## Goals

1. **Ingest** handout files (PDF, PPTX) from the `handouts/` directory and split them into per-lecture chunks.
2. **Enrich** each chunk once using Claude Haiku: generate detailed first-principles Markdown notes, including sections, definitions, worked examples, and key takeaways.
3. **Display** enriched notes in the browser alongside any extracted images from the source file.
4. **Enrich on-demand** with Claude Sonnet via a button: the user can give custom instructions (e.g., "explain with Python analogies", "add more references") and receive a personalized version of the notes.

---

## Architecture Overview

```
handouts/
  CS301.pdf        ─┐
  CS502.pdf         ├─ Source files (manual drop-in by user)
  CS603/            │
    001-015.pptx   ─┘

                          [Ingestion Job — runs on startup + hourly]
                          │
                          ▼
                   HandoutSource (1 per file)
                          │
                   HandoutChunk (1 per lecture/section)
                          │
                   HandoutImage (N per chunk, stored on disk)

                          [Enrichment Job — runs continuously]
                          │
                          ▼
                   chunk.enriched_md  ← Claude Haiku (one-time)

                          [Runtime]
                          │
                   POST /chunks/{id}/enrich  ← Claude Sonnet (on-demand, user instruction)
```

---

## Data Model

### HandoutSource
One row per source file. Tracks ingestion state.

| Column | Type | Notes |
|--------|------|-------|
| id | int PK | |
| course_code | str | e.g. "CS301" |
| file_path | str | Absolute path to the source file |
| file_type | str | "pdf" or "pptx" |
| total_chunks | int | Set after ingestion |
| ingest_status | str | pending / ingesting / done / failed |
| ingested_at | datetime | |

### HandoutChunk
One row per logical lecture or section. Contains raw extracted text and enriched notes.

| Column | Type | Notes |
|--------|------|-------|
| id | int PK | |
| source_id | int FK | → HandoutSource |
| course_code | str | Denormalized for easy filtering |
| lecture_no | int | Detected from heading or filename |
| title | str | e.g. "Lecture 5 — Stacks" |
| raw_text | text | Extracted from PDF/PPTX |
| page_start | int | Source page range start |
| page_end | int | Source page range end |
| enriched_md | text | Claude Haiku output (Markdown) |
| enriched_at | datetime | |
| enrich_status | str | pending / enriching / done / failed |

### HandoutImage
One row per image extracted from a chunk's source pages.

| Column | Type | Notes |
|--------|------|-------|
| id | int PK | |
| chunk_id | int FK | → HandoutChunk |
| seq | int | 1-based ordering within chunk |
| file_path | str | `~/.lms-pro/handout_images/{course}/{chunk_id}_{seq}.png` |

---

## Ingestion Pipeline

### PDF Strategy (`pymupdf`)
1. Open the PDF with `fitz.open()`.
2. Scan pages for lecture boundary markers:
   - Bold/large text matching `Lecture \d+` or `Lecture No. \d+`
   - VU-style: usually a heading at the top of a new lecture with `Lecture #: Title`
3. Extract text for each page range. Combine consecutive pages belonging to the same lecture.
4. Extract raster images per page using `page.get_images()` and save as PNG.
5. Create `HandoutChunk` + `HandoutImage` rows.

### PPTX Strategy (`python-pptx`)
1. Filename encodes lecture range: `001-015.pptx` → lectures 1–15.
2. Group slides by estimated lecture (total slides ÷ lecture count).
3. Extract text from each slide's text frames.
4. Extract images from slide shapes.
5. Create one `HandoutChunk` per lecture range (or per slide group).

### Deduplication
- `HandoutSource` has a unique constraint on `file_path`.
- Re-running ingestion skips already-ingested sources (`ingest_status = "done"`).
- To re-ingest, set `ingest_status = "pending"` in DB.

---

## Enrichment Pipeline

### Haiku Prompt (One-Time, Per Chunk)
**System:**
```
You are an expert educator. Your task is to convert raw lecture notes into a
detailed, first-principles learning document. The output must be comprehensive
enough that a student with zero prior knowledge of the subject can understand
every concept. Use clear sections, definitions, worked examples, and key
takeaways. Format as Markdown.
```

**User:**
```
Course: {course_code}
Lecture: {chunk.title}

--- RAW CONTENT ---
{chunk.raw_text}
--- END ---

Generate a complete, richly detailed learning document for this lecture.
Include:
1. A brief introduction setting context
2. Each concept explained from first principles with definitions
3. Worked examples for any algorithms, formulas, or procedures
4. A "Key Takeaways" section
5. Any relationships to prior concepts (if inferrable from content)

Do not truncate. Cover everything in the raw content.
```

- Model: `claude-haiku-4-5-20251001`
- Max tokens: 4096 per chunk
- Timeout: 120s per API call

### Sonnet Enrichment (On-Demand)
- Triggered by user clicking "Enrich with Sonnet" + entering instructions
- Takes existing `enriched_md` as base + user instructions
- Model: `claude-sonnet-4-6` (or latest Sonnet)
- Response overwrites `enriched_md` or creates a separate `sonnet_md` field (Phase 1: overwrites)
- Max tokens: 8192

---

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/study-canvas/courses` | List courses with handout availability and chunk counts |
| GET | `/api/study-canvas/{course_code}/chunks` | List all chunks for a course with status |
| GET | `/api/study-canvas/chunks/{chunk_id}` | Full chunk: enriched_md, image list, metadata |
| GET | `/api/study-canvas/chunks/{chunk_id}/images/{seq}` | Serve extracted image as PNG |
| POST | `/api/study-canvas/chunks/{chunk_id}/enrich` | Trigger Sonnet enrichment with `{ instructions: str }` |
| POST | `/api/study-canvas/ingest` | Manually trigger ingestion scan |

---

## Frontend

### StudyCanvasPage
Route: `/study-canvas`

Layout:
```
┌─────────────────────────────────────────────────────────┐
│ Study Canvas                                            │
├──────────────┬──────────────────────────────────────────┤
│ Course List  │ Chunk List          │ Enriched Notes      │
│ ─────────    │ ─────────           │ ─────────────────   │
│ CS301  (45)  │ Lecture 1           │ # Lecture 5         │
│ CS502  (12)  │ Lecture 2           │ ## Introduction     │
│ CS603  (23)  │ Lecture 3           │ ...                 │
│              │ > Lecture 5 (open)  │ [Images inline]     │
│              │ Lecture 6           │                     │
│              │ ...                 │ [Enrich with Sonnet]│
└──────────────┴──────────────────────────────────────────┘
```

- Three-panel layout: course list → chunk list → reading pane
- Enriched notes rendered as Markdown (react-markdown or similar)
- Images displayed inline within reading pane
- "Enrich with Sonnet" button opens an instruction input before sending
- Chunk enrich_status shown as badge: pending / enriching / done

---

## Job Schedule

| Job | Trigger | Purpose |
|-----|---------|---------|
| Handout Ingestion | On startup + every hour | Scan handouts/, ingest new/pending sources |
| Handout Enrichment | Every 2 min | Pick next 3 pending chunks, call Haiku, store enriched_md |

Both jobs use asyncio locks to prevent overlap.

---

## File Storage

```
~/.lms-pro/
  handout_images/
    CS301/
      42_1.png     ← chunk_id=42, seq=1
      42_2.png
    CS603/
      ...
```

---

## Phase Roadmap

| Phase | What it adds |
|-------|-------------|
| 1 (current) | Ingestion + Haiku enrichment + frontend reading pane |
| 2 | Per-concept mastery tracking (skimmed / learned) |
| 3 | Semester-aware catch-up plan ("4.5 hours left, here's today's plan") |
| 4 | External resource injection (Khan Academy, GeeksForGeeks links) |
| 5 | Full Study Canvas (draggable panels, code playground, AI tutor chat) |
