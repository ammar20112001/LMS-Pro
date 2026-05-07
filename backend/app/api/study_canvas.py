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

from ..db import SessionLocal
from ..models import HandoutSource, HandoutChunk, HandoutImage

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
        return {
            "id": chunk.id,
            "course_code": chunk.course_code,
            "lecture_no": chunk.lecture_no,
            "title": chunk.title,
            "enrich_status": chunk.enrich_status,
            "enriched_md": chunk.enriched_md,
            "enriched_at": chunk.enriched_at.isoformat() if chunk.enriched_at else None,
            "page_start": chunk.page_start,
            "page_end": chunk.page_end,
            "images": [
                {"seq": img.seq, "url": f"/api/study-canvas/chunks/{chunk_id}/images/{img.seq}"}
                for img in chunk.images
            ],
        }
    finally:
        db.close()


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


def _media_type(path: Path) -> str:
    ext = path.suffix.lower()
    return {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
            "gif": "image/gif", "webp": "image/webp"}.get(ext.lstrip("."), "image/png")
