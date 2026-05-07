"""
Focus Mode API.
- Notes: CRUD on SectionNote
- Sessions: create/update/list FocusSession
- Bulk chunk fetch: returns multiple chunks (sections + images) in one call
"""
import json
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..db import SessionLocal
from ..models import HandoutChunk, HandoutSection, SectionNote, FocusSession, HandoutImage, utcnow

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/focus", tags=["focus"])


# ── Notes ─────────────────────────────────────────────────────────────────────

class NoteBody(BaseModel):
    body: str


@router.get("/sections/{section_id}/notes")
def get_notes(section_id: int):
    db = SessionLocal()
    try:
        notes = db.query(SectionNote).filter_by(section_id=section_id).order_by(SectionNote.created_at).all()
        return [_note_dict(n) for n in notes]
    finally:
        db.close()


@router.post("/sections/{section_id}/notes")
def add_note(section_id: int, body: NoteBody):
    db = SessionLocal()
    try:
        section = db.query(HandoutSection).get(section_id)
        if not section:
            raise HTTPException(status_code=404, detail="Section not found")
        note = SectionNote(section_id=section_id, body=body.body.strip(), created_at=utcnow(), updated_at=utcnow())
        db.add(note)
        db.commit()
        db.refresh(note)
        return _note_dict(note)
    finally:
        db.close()


@router.put("/notes/{note_id}")
def update_note(note_id: int, body: NoteBody):
    db = SessionLocal()
    try:
        note = db.query(SectionNote).get(note_id)
        if not note:
            raise HTTPException(status_code=404, detail="Note not found")
        note.body = body.body.strip()
        note.updated_at = utcnow()
        db.commit()
        return _note_dict(note)
    finally:
        db.close()


@router.delete("/notes/{note_id}")
def delete_note(note_id: int):
    db = SessionLocal()
    try:
        note = db.query(SectionNote).get(note_id)
        if not note:
            raise HTTPException(status_code=404, detail="Note not found")
        db.delete(note)
        db.commit()
        return {"ok": True}
    finally:
        db.close()


def _note_dict(n: SectionNote) -> dict:
    return {
        "id": n.id,
        "section_id": n.section_id,
        "body": n.body,
        "created_at": n.created_at.isoformat() if n.created_at else None,
        "updated_at": n.updated_at.isoformat() if n.updated_at else None,
    }


# ── Bulk chunk fetch ───────────────────────────────────────────────────────────

class BulkChunksRequest(BaseModel):
    chunk_ids: list[int]


@router.post("/chunks/bulk")
def get_chunks_bulk(body: BulkChunksRequest):
    """Return multiple chunks with sections, images, and notes in one call."""
    db = SessionLocal()
    try:
        result = []
        for chunk_id in body.chunk_ids:
            chunk = db.query(HandoutChunk).get(chunk_id)
            if not chunk:
                continue

            sections = (
                db.query(HandoutSection)
                .filter_by(chunk_id=chunk_id)
                .order_by(HandoutSection.order)
                .all()
            )

            # Lazy parse if needed
            if not sections and chunk.enriched_md:
                from ..study.sections import parse_chunk_sections
                parse_chunk_sections(chunk_id)
                sections = (
                    db.query(HandoutSection)
                    .filter_by(chunk_id=chunk_id)
                    .order_by(HandoutSection.order)
                    .all()
                )

            images = db.query(HandoutImage).filter_by(chunk_id=chunk_id).order_by(HandoutImage.seq).all()

            sections_out = []
            for s in sections:
                notes = db.query(SectionNote).filter_by(section_id=s.id).order_by(SectionNote.created_at).all()
                sections_out.append({
                    "id": s.id,
                    "section_key": s.section_key,
                    "level": s.level,
                    "title": s.title,
                    "body": s.body or "",
                    "order": s.order,
                    "is_completed": s.is_completed,
                    "notes": [_note_dict(n) for n in notes],
                })

            result.append({
                "id": chunk.id,
                "course_code": chunk.course_code,
                "lecture_no": chunk.lecture_no,
                "title": chunk.title,
                "enrich_status": chunk.enrich_status,
                "is_completed": chunk.is_completed,
                "page_start": chunk.page_start,
                "page_end": chunk.page_end,
                "images": [
                    {"seq": img.seq, "page_no": img.page_no, "url": f"/api/study-canvas/chunks/{chunk_id}/images/{img.seq}"}
                    for img in images
                ],
                "sections": sections_out,
            })
        return result
    finally:
        db.close()


# ── Focus Sessions ────────────────────────────────────────────────────────────

class SessionCreate(BaseModel):
    course_code: str
    chunk_ids: list[int]
    label: str | None = None
    budget_minutes: int = 60


class SessionUpdate(BaseModel):
    elapsed_seconds: int | None = None
    last_chunk_id: int | None = None
    budget_minutes: int | None = None
    label: str | None = None


@router.get("/sessions")
def list_sessions(course_code: str | None = None):
    db = SessionLocal()
    try:
        q = db.query(FocusSession).order_by(FocusSession.updated_at.desc())
        if course_code:
            q = q.filter_by(course_code=course_code)
        return [_session_dict(s) for s in q.limit(20).all()]
    finally:
        db.close()


@router.post("/sessions")
def create_session(body: SessionCreate):
    db = SessionLocal()
    try:
        session = FocusSession(
            course_code=body.course_code,
            chunk_ids=json.dumps(body.chunk_ids),
            label=body.label,
            budget_minutes=body.budget_minutes,
            elapsed_seconds=0,
            created_at=utcnow(),
            updated_at=utcnow(),
        )
        db.add(session)
        db.commit()
        db.refresh(session)
        return _session_dict(session)
    finally:
        db.close()


@router.patch("/sessions/{session_id}")
def update_session(session_id: int, body: SessionUpdate):
    db = SessionLocal()
    try:
        session = db.query(FocusSession).get(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        if body.elapsed_seconds is not None:
            session.elapsed_seconds = body.elapsed_seconds
        if body.last_chunk_id is not None:
            session.last_chunk_id = body.last_chunk_id
        if body.budget_minutes is not None:
            session.budget_minutes = body.budget_minutes
        if body.label is not None:
            session.label = body.label
        session.updated_at = utcnow()
        db.commit()
        return _session_dict(session)
    finally:
        db.close()


@router.delete("/sessions/{session_id}")
def delete_session(session_id: int):
    db = SessionLocal()
    try:
        session = db.query(FocusSession).get(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        db.delete(session)
        db.commit()
        return {"ok": True}
    finally:
        db.close()


def _session_dict(s: FocusSession) -> dict:
    return {
        "id": s.id,
        "course_code": s.course_code,
        "chunk_ids": json.loads(s.chunk_ids),
        "label": s.label,
        "budget_minutes": s.budget_minutes,
        "elapsed_seconds": s.elapsed_seconds,
        "last_chunk_id": s.last_chunk_id,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }
