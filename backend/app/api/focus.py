"""
Focus Mode API.
- Notes: CRUD on SectionNote
- Sessions: create/update/list FocusSession
- Bulk chunk fetch: returns multiple chunks (sections + images) in one call
"""
import json
import logging
from pathlib import Path
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel

from ..db import SessionLocal
from ..models import HandoutChunk, HandoutSection, SectionNote, FocusSession, HandoutImage, ExternalResource, SectionScreenshot, ChatMessage, utcnow
from ..config import settings

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
                resources = db.query(ExternalResource).filter_by(section_id=s.id).order_by(ExternalResource.created_at).all()
                screenshots = db.query(SectionScreenshot).filter_by(section_id=s.id).order_by(SectionScreenshot.seq).all()
                sections_out.append({
                    "id": s.id,
                    "section_key": s.section_key,
                    "level": s.level,
                    "title": s.title,
                    "body": s.body or "",
                    "order": s.order,
                    "is_completed": s.is_completed,
                    "notes": [_note_dict(n) for n in notes],
                    "resources": [_resource_dict(r) for r in resources],
                    "screenshots": [_screenshot_dict(sc) for sc in screenshots],
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


def _resource_dict(r: ExternalResource) -> dict:
    return {
        "id": r.id,
        "section_id": r.section_id,
        "selected_text": r.selected_text,
        "instructions": r.instructions,
        "resources": json.loads(r.resources),
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


def _screenshot_dict(sc: SectionScreenshot) -> dict:
    return {
        "id": sc.id,
        "section_id": sc.section_id,
        "url": f"/api/focus/screenshots/{sc.id}",
        "caption": sc.caption,
        "seq": sc.seq,
        "created_at": sc.created_at.isoformat() if sc.created_at else None,
    }


# ── External Resources ────────────────────────────────────────────────────────

SCREENSHOTS_DIR = settings.data_dir / "section_screenshots"

RESOURCE_SYSTEM = """\
You are a study assistant. Given a piece of text from a lecture and optional guidance, \
find 3–5 high-quality external resources a student can use to deepen their understanding.

Return a JSON array only — no explanation, no markdown fences. Each item must have:
  "url": a real, publicly accessible URL
  "title": the page or video title
  "snippet": one sentence on why this resource is useful for this topic

Prefer: official documentation, Khan Academy, GeeksForGeeks, Wikipedia, MIT OpenCourseWare, \
YouTube (educational channels), or well-known textbook excerpts.
Only return resources that genuinely exist and are relevant.\
"""


class ResourceRequest(BaseModel):
    selected_text: str
    instructions: str = ""


@router.post("/sections/{section_id}/resources")
def generate_resources(section_id: int, body: ResourceRequest):
    db = SessionLocal()
    try:
        section = db.query(HandoutSection).get(section_id)
        if not section:
            raise HTTPException(status_code=404, detail="Section not found")

        import httpx
        from ..config import settings as cfg

        prompt = f"Lecture section: {section.title}\n\nSelected text:\n{body.selected_text[:1500]}"
        if body.instructions.strip():
            prompt += f"\n\nStudent guidance: {body.instructions}"

        resp = httpx.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": cfg.anthropic_api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": "claude-sonnet-4-6",
                "max_tokens": 1024,
                "system": RESOURCE_SYSTEM,
                "messages": [{"role": "user", "content": prompt}],
            },
            timeout=60,
        )
        resp.raise_for_status()
        raw = resp.json()["content"][0]["text"].strip()

        # Parse JSON — strip any accidental fences
        if raw.startswith("```"):
            raw = "\n".join(raw.split("\n")[1:])
            raw = raw.rsplit("```", 1)[0].strip()
        resources_list = json.loads(raw)

        record = ExternalResource(
            section_id=section_id,
            selected_text=body.selected_text[:2000],
            instructions=body.instructions or None,
            resources=json.dumps(resources_list),
            created_at=utcnow(),
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        return _resource_dict(record)
    finally:
        db.close()


@router.get("/sections/{section_id}/resources")
def get_resources(section_id: int):
    db = SessionLocal()
    try:
        resources = db.query(ExternalResource).filter_by(section_id=section_id).order_by(ExternalResource.created_at).all()
        return [_resource_dict(r) for r in resources]
    finally:
        db.close()


@router.delete("/resources/{resource_id}")
def delete_resource(resource_id: int):
    db = SessionLocal()
    try:
        r = db.query(ExternalResource).get(resource_id)
        if not r:
            raise HTTPException(status_code=404, detail="Not found")
        db.delete(r)
        db.commit()
        return {"ok": True}
    finally:
        db.close()


# ── Screenshots ───────────────────────────────────────────────────────────────

@router.post("/sections/{section_id}/screenshots")
async def upload_screenshot(
    section_id: int,
    file: UploadFile = File(...),
    caption: str = Form(""),
):
    db = SessionLocal()
    try:
        section = db.query(HandoutSection).get(section_id)
        if not section:
            raise HTTPException(status_code=404, detail="Section not found")

        SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)

        # Next seq for this section
        existing = db.query(SectionScreenshot).filter_by(section_id=section_id).count()
        seq = existing + 1

        ext = Path(file.filename or "screenshot.png").suffix or ".png"
        out_path = SCREENSHOTS_DIR / f"{section_id}_{seq}{ext}"
        out_path.write_bytes(await file.read())

        sc = SectionScreenshot(
            section_id=section_id,
            file_path=str(out_path),
            caption=caption.strip() or None,
            seq=seq,
            created_at=utcnow(),
        )
        db.add(sc)
        db.commit()
        db.refresh(sc)
        return _screenshot_dict(sc)
    finally:
        db.close()


from fastapi.responses import FileResponse

@router.get("/screenshots/{screenshot_id}")
def serve_screenshot(screenshot_id: int):
    db = SessionLocal()
    try:
        sc = db.query(SectionScreenshot).get(screenshot_id)
        if not sc:
            raise HTTPException(status_code=404, detail="Not found")
        path = Path(sc.file_path)
        if not path.exists():
            raise HTTPException(status_code=404, detail="File missing")
        ext = path.suffix.lower().lstrip(".")
        media = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
                 "gif": "image/gif", "webp": "image/webp"}.get(ext, "image/png")
        return FileResponse(str(path), media_type=media)
    finally:
        db.close()


@router.patch("/screenshots/{screenshot_id}/caption")
def update_caption(screenshot_id: int, body: NoteBody):
    db = SessionLocal()
    try:
        sc = db.query(SectionScreenshot).get(screenshot_id)
        if not sc:
            raise HTTPException(status_code=404, detail="Not found")
        sc.caption = body.body.strip() or None
        db.commit()
        return _screenshot_dict(sc)
    finally:
        db.close()


@router.delete("/screenshots/{screenshot_id}")
def delete_screenshot(screenshot_id: int):
    db = SessionLocal()
    try:
        sc = db.query(SectionScreenshot).get(screenshot_id)
        if not sc:
            raise HTTPException(status_code=404, detail="Not found")
        Path(sc.file_path).unlink(missing_ok=True)
        db.delete(sc)
        db.commit()
        return {"ok": True}
    finally:
        db.close()


# ── Chat ──────────────────────────────────────────────────────────────────────

CHAT_SYSTEM = """\
You are a focused study assistant helping a student study {course_code}. \
Answer concisely and directly. If the student asks about something outside the \
course material, gently redirect. Use simple language and examples where helpful.\
"""


class ChatRequest(BaseModel):
    content: str
    section_id: int | None = None


@router.get("/sessions/{session_id}/messages")
def get_messages(session_id: int):
    db = SessionLocal()
    try:
        msgs = (
            db.query(ChatMessage)
            .filter_by(session_id=session_id)
            .order_by(ChatMessage.created_at)
            .all()
        )
        return [_chat_dict(m) for m in msgs]
    finally:
        db.close()


@router.post("/sessions/{session_id}/chat")
def send_chat(session_id: int, body: ChatRequest):
    db = SessionLocal()
    try:
        session = db.query(FocusSession).get(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        # Section context
        section_ctx = ""
        if body.section_id:
            section = db.query(HandoutSection).get(body.section_id)
            if section:
                section_body = (section.body or "")[:2000]
                section_ctx = f"\n\nCurrent section the student is reading:\nTitle: {section.title}\n{section_body}"

        system = CHAT_SYSTEM.format(course_code=session.course_code) + section_ctx

        # Recent history (last 20 messages for context)
        recent = (
            db.query(ChatMessage)
            .filter_by(session_id=session_id)
            .order_by(ChatMessage.created_at.desc())
            .limit(20)
            .all()
        )
        recent.reverse()
        history = [{"role": m.role, "content": m.content} for m in recent]
        history.append({"role": "user", "content": body.content})

        # Save user message first
        user_msg = ChatMessage(
            session_id=session_id,
            section_id=body.section_id,
            role="user",
            content=body.content,
            created_at=utcnow(),
        )
        db.add(user_msg)
        db.commit()

        # Call Haiku
        import httpx
        from ..config import settings as cfg

        resp = httpx.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": cfg.anthropic_api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": "claude-haiku-4-5-20251001",
                "max_tokens": 600,
                "system": system,
                "messages": history,
            },
            timeout=30,
        )
        resp.raise_for_status()
        assistant_text = resp.json()["content"][0]["text"]

        asst_msg = ChatMessage(
            session_id=session_id,
            section_id=body.section_id,
            role="assistant",
            content=assistant_text,
            created_at=utcnow(),
        )
        db.add(asst_msg)
        db.commit()
        db.refresh(asst_msg)
        return _chat_dict(asst_msg)
    finally:
        db.close()


@router.delete("/messages/{message_id}")
def delete_message(message_id: int):
    db = SessionLocal()
    try:
        msg = db.query(ChatMessage).get(message_id)
        if not msg:
            raise HTTPException(status_code=404, detail="Not found")
        db.delete(msg)
        db.commit()
        return {"ok": True}
    finally:
        db.close()


def _chat_dict(m: ChatMessage) -> dict:
    return {
        "id": m.id,
        "session_id": m.session_id,
        "section_id": m.section_id,
        "role": m.role,
        "content": m.content,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }
