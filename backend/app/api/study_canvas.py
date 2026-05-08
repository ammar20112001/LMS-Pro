"""
Study Canvas API endpoints.
Serves handout chunks, enriched notes, images, and triggers Sonnet enrichment.
"""

import logging
from pathlib import Path
from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func, case

from ..db import SessionLocal, engine
from ..models import HandoutSource, HandoutChunk, HandoutImage, HandoutSection

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/study-canvas", tags=["study-canvas"])


class EnrichRequest(BaseModel):
    instructions: str


@router.get("/courses")
def list_courses():
    db = SessionLocal()
    try:
        rows = (
            db.query(
                HandoutChunk.course_code,
                func.count(HandoutChunk.id).label("total_chunks"),
                func.sum(
                    case((HandoutChunk.enrich_status == "done", 1), else_=0)
                ).label("enriched_chunks"),
            )
            .group_by(HandoutChunk.course_code)
            .order_by(HandoutChunk.course_code)
            .all()
        )
        return [
            {
                "course_code": r.course_code,
                "total_chunks": r.total_chunks,
                "enriched_chunks": int(r.enriched_chunks or 0),
            }
            for r in rows
        ]
    finally:
        db.close()


@router.get("/{course_code}/chunks")
def list_chunks(course_code: str):
    db = SessionLocal()
    try:
        chunks = (
            db.query(HandoutChunk)
            .filter(HandoutChunk.course_code == course_code)
            .order_by(HandoutChunk.lecture_no, HandoutChunk.id)
            .all()
        )
        return [
            {
                "id": c.id,
                "lecture_no": c.lecture_no,
                "title": c.title,
                "enrich_status": c.enrich_status,
                "enriched_at": c.enriched_at.isoformat() if c.enriched_at else None,
                "is_completed": c.is_completed,
                "image_count": len(c.images),
            }
            for c in chunks
        ]
    finally:
        db.close()


@router.get("/chunks/{chunk_id}")
def get_chunk(chunk_id: int):
    db = SessionLocal()
    try:
        chunk = db.query(HandoutChunk).get(chunk_id)
        if not chunk:
            raise HTTPException(status_code=404, detail="Chunk not found")

        # Lazy section parse on first fetch after enrichment
        sections_db = (
            db.query(HandoutSection)
            .filter_by(chunk_id=chunk_id)
            .order_by(HandoutSection.order)
            .all()
        )
        if not sections_db and chunk.enriched_md:
            from ..study.sections import parse_chunk_sections
            parse_chunk_sections(chunk_id)
            sections_db = (
                db.query(HandoutSection)
                .filter_by(chunk_id=chunk_id)
                .order_by(HandoutSection.order)
                .all()
            )

        # Build image map: page_no → list of image URLs
        images_by_page: dict[int, list[dict]] = {}
        for img in chunk.images:
            images_by_page.setdefault(img.page_no, []).append({
                "seq": img.seq,
                "page_no": img.page_no,
                "url": f"/api/study-canvas/chunks/{chunk_id}/images/{img.seq}",
            })

        return {
            "id": chunk.id,
            "course_code": chunk.course_code,
            "lecture_no": chunk.lecture_no,
            "title": chunk.title,
            "enrich_status": chunk.enrich_status,
            "enriched_md": chunk.enriched_md,
            "enriched_at": chunk.enriched_at.isoformat() if chunk.enriched_at else None,
            "is_completed": chunk.is_completed,
            "page_start": chunk.page_start,
            "page_end": chunk.page_end,
            "images": [
                {"seq": img.seq, "page_no": img.page_no, "url": f"/api/study-canvas/chunks/{chunk_id}/images/{img.seq}"}
                for img in chunk.images
            ],
            "images_by_page": images_by_page,
            "sections": [
                {
                    "id": s.id,
                    "section_key": s.section_key,
                    "level": s.level,
                    "title": s.title,
                    "body": s.body or "",
                    "order": s.order,
                    "is_completed": s.is_completed,
                }
                for s in sections_db
            ],
        }
    finally:
        db.close()


class CompletionRequest(BaseModel):
    is_completed: bool


@router.post("/chunks/{chunk_id}/complete")
def set_chunk_completion(chunk_id: int, body: CompletionRequest):
    db = SessionLocal()
    try:
        chunk = db.query(HandoutChunk).get(chunk_id)
        if not chunk:
            raise HTTPException(status_code=404, detail="Chunk not found")
        chunk.is_completed = body.is_completed
        db.commit()
        return {"ok": True}
    finally:
        db.close()


@router.post("/sections/{section_id}/complete")
def set_section_completion(section_id: int, body: CompletionRequest):
    db = SessionLocal()
    try:
        section = db.query(HandoutSection).get(section_id)
        if not section:
            raise HTTPException(status_code=404, detail="Section not found")
        section.is_completed = body.is_completed
        db.commit()
        return {"ok": True}
    finally:
        db.close()


@router.post("/chunks/{chunk_id}/parse-sections")
def reparse_sections(chunk_id: int):
    """Force re-parse sections from enriched_md (useful after Sonnet edits)."""
    from ..study.sections import parse_chunk_sections
    db = SessionLocal()
    try:
        chunk = db.query(HandoutChunk).get(chunk_id)
        if not chunk:
            raise HTTPException(status_code=404, detail="Chunk not found")
    finally:
        db.close()
    sections = parse_chunk_sections(chunk_id)
    return {"count": len(sections)}


@router.get("/chunks/{chunk_id}/images/{seq}")
def get_image(chunk_id: int, seq: int):
    db = SessionLocal()
    try:
        img = db.query(HandoutImage).filter_by(chunk_id=chunk_id, seq=seq).first()
        if not img:
            raise HTTPException(status_code=404, detail="Image not found")
        path = Path(img.file_path)
        if not path.exists():
            raise HTTPException(status_code=404, detail="Image file missing")
        return FileResponse(str(path), media_type=_media_type(path))
    finally:
        db.close()


@router.post("/chunks/{chunk_id}/enrich")
def enrich_chunk(chunk_id: int, body: EnrichRequest, background_tasks: BackgroundTasks):
    """Trigger Sonnet enrichment with custom instructions (runs in background)."""
    db = SessionLocal()
    try:
        chunk = db.query(HandoutChunk).get(chunk_id)
        if not chunk:
            raise HTTPException(status_code=404, detail="Chunk not found")
        if chunk.enrich_status == "enriching":
            return {"status": "already_enriching"}
        chunk.enrich_status = "enriching"
        db.commit()
    finally:
        db.close()

    background_tasks.add_task(_do_sonnet_enrich, chunk_id, body.instructions)
    return {"status": "started"}


def _do_sonnet_enrich(chunk_id: int, instructions: str):
    from ..study.enrichment import enrich_with_sonnet
    try:
        enrich_with_sonnet(chunk_id, instructions)
    except Exception as e:
        log.exception("Sonnet enrichment failed for chunk %d: %s", chunk_id, e)
        db = SessionLocal()
        try:
            chunk = db.query(HandoutChunk).get(chunk_id)
            if chunk:
                chunk.enrich_status = "failed"
                db.commit()
        finally:
            db.close()


@router.post("/ingest")
def trigger_ingest(background_tasks: BackgroundTasks):
    """Manually trigger handout ingestion."""
    from ..jobs.handout_job import run_ingestion_job
    background_tasks.add_task(run_ingestion_job)
    return {"status": "started"}


@router.get("/sources")
def list_sources():
    db = SessionLocal()
    try:
        sources = db.query(HandoutSource).order_by(HandoutSource.course_code).all()
        return [
            {
                "id": s.id,
                "course_code": s.course_code,
                "file_path": s.file_path,
                "file_type": s.file_type,
                "total_chunks": s.total_chunks,
                "ingest_status": s.ingest_status,
                "ingested_at": s.ingested_at.isoformat() if s.ingested_at else None,
            }
            for s in sources
        ]
    finally:
        db.close()


@router.post("/sources/{source_id}/reingest")
def reingest_source(source_id: int, background_tasks: BackgroundTasks):
    """Reset a source to pending and trigger re-ingestion (uses Haiku fallback if needed)."""
    db = SessionLocal()
    try:
        source = db.query(HandoutSource).get(source_id)
        if not source:
            raise HTTPException(status_code=404, detail="Source not found")
        file_path = source.file_path
    finally:
        db.close()

    from ..study.ingestion import reset_source_for_reingest, run_ingestion
    reset_source_for_reingest(file_path)
    background_tasks.add_task(run_ingestion)
    return {"status": "started", "file": Path(file_path).name}


@router.get("/search")
def search_sections(q: str, course_code: str | None = None, limit: int = 15):
    """Full-text search over section titles and bodies using SQLite FTS5 (BM25 ranking)."""
    q = q.strip()
    if len(q) < 2:
        return []

    # Build prefix-match FTS5 query: "hash table" → "hash* table*"
    import re
    safe = re.sub(r"[^\w\s]", " ", q)
    fts_query = " ".join(w + "*" for w in safe.split() if w)

    from sqlalchemy import text

    where_extra = "AND c.course_code = :course_code" if course_code else ""
    sql = text(f"""
        SELECT
            s.id,
            s.title,
            s.level,
            s.order AS "order",
            s.section_key,
            COALESCE(SUBSTR(s.body, 1, 220), '') AS body_snippet,
            c.id   AS chunk_id,
            c.title AS chunk_title,
            c.lecture_no,
            c.course_code
        FROM sections_fts
        JOIN handout_sections s ON sections_fts.rowid = s.id
        JOIN handout_chunks   c ON s.chunk_id = c.id
        WHERE sections_fts MATCH :q
        {where_extra}
        ORDER BY rank
        LIMIT :limit
    """)
    params: dict = {"q": fts_query, "limit": limit}
    if course_code:
        params["course_code"] = course_code

    with engine.connect() as conn:
        rows = conn.execute(sql, params).fetchall()

    return [dict(r._mapping) for r in rows]


def _media_type(path: Path) -> str:
    ext = path.suffix.lower()
    return {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
            "gif": "image/gif", "webp": "image/webp"}.get(ext.lstrip("."), "image/png")
