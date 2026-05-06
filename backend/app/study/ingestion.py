"""
Handout ingestion pipeline.
Extracts text and images from PDF/PPTX handout files, splits by lecture, stores as HandoutChunk rows.
"""

import logging
import re
from pathlib import Path
from datetime import timezone

from ..db import SessionLocal
from ..models import HandoutSource, HandoutChunk, HandoutImage, utcnow
from ..config import settings

log = logging.getLogger(__name__)

HANDOUTS_DIR = Path(__file__).parents[3] / "handouts"
IMAGES_DIR = settings.data_dir / "handout_images"

_LECTURE_HEADING = re.compile(
    r"(?:Lecture\s*(?:No\.?\s*)?(\d+))",
    re.IGNORECASE,
)


def run_ingestion():
    """Scan handouts/ directory, ingest any new or pending sources."""
    db = SessionLocal()
    try:
        _scan_and_ingest(db)
    except Exception:
        log.exception("Handout ingestion crashed")
        db.rollback()
    finally:
        db.close()


def _scan_and_ingest(db):
    if not HANDOUTS_DIR.exists():
        log.warning("handouts/ directory not found at %s", HANDOUTS_DIR)
        return

    files = list(HANDOUTS_DIR.glob("**/*.pdf")) + list(HANDOUTS_DIR.glob("**/*.pptx"))
    log.info("Ingestion scan: found %d handout files", len(files))

    for file_path in sorted(files):
        course_code = _course_code_from_path(file_path)
        if not course_code:
            continue

        source = db.query(HandoutSource).filter_by(file_path=str(file_path)).first()
        if source and source.ingest_status == "done":
            continue

        if not source:
            source = HandoutSource(
                course_code=course_code,
                file_path=str(file_path),
                file_type=file_path.suffix.lstrip(".").lower(),
            )
            db.add(source)
            db.flush()

        log.info("Ingesting %s (%s)", file_path.name, course_code)
        source.ingest_status = "ingesting"
        db.commit()

        try:
            if source.file_type == "pdf":
                chunks = _ingest_pdf(db, source, file_path, course_code)
            else:
                chunks = _ingest_pptx(db, source, file_path, course_code)

            source.total_chunks = chunks
            source.ingest_status = "done"
            source.ingested_at = utcnow()
            db.commit()
            log.info("Ingested %s — %d chunks", file_path.name, chunks)
        except Exception as e:
            log.exception("Failed to ingest %s: %s", file_path.name, e)
            source.ingest_status = "failed"
            db.commit()


def _course_code_from_path(file_path: Path) -> str | None:
    """Derive course code from filename or parent directory."""
    name = file_path.stem.upper()
    parent = file_path.parent.name.upper()

    for candidate in (name, parent):
        m = re.match(r"(CS\d{3,4})", candidate)
        if m:
            return m.group(1)
    return None


def _ingest_pdf(db, source: HandoutSource, file_path: Path, course_code: str) -> int:
    import fitz  # pymupdf

    doc = fitz.open(str(file_path))
    pages_text: list[str] = [page.get_text("text") for page in doc]
    total_pages = len(pages_text)

    # Detect lecture boundaries
    boundaries: list[tuple[int, int, str]] = []  # (page_idx, lecture_no, title)
    for i, text in enumerate(pages_text):
        m = _LECTURE_HEADING.search(text)
        if m:
            lec_no = int(m.group(1))
            title = _extract_title_from_page(text, lec_no)
            boundaries.append((i, lec_no, title))

    # Deduplicate: keep only first occurrence of each lecture number
    seen: set[int] = set()
    unique_boundaries: list[tuple[int, int, str]] = []
    for b in boundaries:
        if b[1] not in seen:
            seen.add(b[1])
            unique_boundaries.append(b)

    if not unique_boundaries:
        # No lecture headings found — treat whole file as one chunk
        raw_text = "\n".join(pages_text)
        _save_chunk(db, source, course_code, 1, file_path.stem, raw_text, 0, total_pages - 1)
        _extract_pdf_images(db, doc, 0, total_pages - 1, source.id, 1, course_code)
        return 1

    chunk_count = 0
    for idx, (page_start, lec_no, title) in enumerate(unique_boundaries):
        page_end = (unique_boundaries[idx + 1][0] - 1) if idx + 1 < len(unique_boundaries) else total_pages - 1
        raw_text = "\n".join(pages_text[page_start:page_end + 1])
        chunk = _save_chunk(db, source, course_code, lec_no, title, raw_text, page_start, page_end)
        _extract_pdf_images(db, doc, page_start, page_end, source.id, chunk.id, course_code)
        chunk_count += 1

    doc.close()
    return chunk_count


def _extract_title_from_page(text: str, lec_no: int) -> str:
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    for i, line in enumerate(lines[:15]):
        if re.search(rf"lecture\s*(?:no\.?\s*)?{lec_no}", line, re.IGNORECASE):
            # Skip TOC-style lines (contain dots or trailing page numbers)
            if re.search(r"\.{3,}|\s\d{1,3}\s*$", line):
                continue
            # Try to get a subtitle on the next line
            next_lines = [l for l in lines[i + 1:i + 4] if len(l) > 3 and not re.search(r"\.{3,}|\s\d{1,3}\s*$", l)]
            if next_lines:
                return f"Lecture {lec_no} — {next_lines[0]}"
            return f"Lecture {lec_no}"
    return f"Lecture {lec_no}"


def _extract_pdf_images(db, doc, page_start: int, page_end: int, source_id: int, chunk_id: int, course_code: str):
    out_dir = IMAGES_DIR / course_code
    out_dir.mkdir(parents=True, exist_ok=True)

    seq = 1
    for page_idx in range(page_start, page_end + 1):
        page = doc[page_idx]
        for img_info in page.get_images(full=True):
            xref = img_info[0]
            try:
                img_bytes = doc.extract_image(xref)
                if img_bytes["width"] < 50 or img_bytes["height"] < 50:
                    continue  # skip tiny images (bullets, icons)
                ext = img_bytes["ext"]
                out_path = out_dir / f"{chunk_id}_{seq}.{ext}"
                out_path.write_bytes(img_bytes["image"])
                db.add(HandoutImage(chunk_id=chunk_id, seq=seq, file_path=str(out_path)))
                seq += 1
            except Exception as e:
                log.debug("Image extraction error xref=%d: %s", xref, e)

    if seq > 1:
        db.flush()


def _ingest_pptx(db, source: HandoutSource, file_path: Path, course_code: str) -> int:
    from pptx import Presentation
    from pptx.util import Inches

    # Derive lecture range from filename, e.g. "001-015" → 1..15
    lec_range = _lecture_range_from_filename(file_path.stem)
    lec_start, lec_end = lec_range if lec_range else (1, 1)

    prs = Presentation(str(file_path))
    slides = list(prs.slides)
    total_slides = len(slides)

    if not slides:
        return 0

    lec_count = lec_end - lec_start + 1
    slides_per_lec = max(1, total_slides // lec_count)

    out_dir = IMAGES_DIR / course_code
    out_dir.mkdir(parents=True, exist_ok=True)

    chunk_count = 0
    for lec_offset in range(lec_count):
        lec_no = lec_start + lec_offset
        slide_start = lec_offset * slides_per_lec
        slide_end = slide_start + slides_per_lec if lec_offset < lec_count - 1 else total_slides
        lec_slides = slides[slide_start:slide_end]

        text_parts = []
        for slide in lec_slides:
            for shape in slide.shapes:
                if shape.has_text_frame:
                    for para in shape.text_frame.paragraphs:
                        line = " ".join(r.text for r in para.runs).strip()
                        if line:
                            text_parts.append(line)

        raw_text = "\n".join(text_parts)
        title = f"Lecture {lec_no}"
        chunk = _save_chunk(db, source, course_code, lec_no, title, raw_text, slide_start, slide_end - 1)

        # Extract images from PPTX slides
        seq = 1
        for slide in lec_slides:
            for shape in slide.shapes:
                if shape.shape_type == 13:  # MSO_SHAPE_TYPE.PICTURE
                    try:
                        img = shape.image
                        out_path = out_dir / f"{chunk.id}_{seq}.{img.ext}"
                        out_path.write_bytes(img.blob)
                        db.add(HandoutImage(chunk_id=chunk.id, seq=seq, file_path=str(out_path)))
                        seq += 1
                    except Exception as e:
                        log.debug("PPTX image extract error: %s", e)

        if seq > 1:
            db.flush()

        chunk_count += 1

    return chunk_count


def _lecture_range_from_filename(stem: str) -> tuple[int, int] | None:
    m = re.search(r"(\d+)[_\-](\d+)", stem)
    if m:
        return int(m.group(1)), int(m.group(2))
    m = re.search(r"(\d+)", stem)
    if m:
        n = int(m.group(1))
        return n, n
    return None


def _save_chunk(db, source: HandoutSource, course_code: str, lecture_no: int,
                title: str, raw_text: str, page_start: int, page_end: int) -> HandoutChunk:
    chunk = HandoutChunk(
        source_id=source.id,
        course_code=course_code,
        lecture_no=lecture_no,
        title=title,
        raw_text=raw_text,
        page_start=page_start,
        page_end=page_end,
        enrich_status="pending",
    )
    db.add(chunk)
    db.flush()
    return chunk
