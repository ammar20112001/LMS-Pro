"""
Notes job: pick one pending lecture per run, fetch transcript, generate notes, write to Obsidian.
Runs every 10 minutes via APScheduler.
"""

import logging
from datetime import datetime, timezone

from ..db import SessionLocal
from ..models import Course, Lecture
from ..config import settings
from ..ai.client import get_ai_client
from ..notes.transcript import fetch_transcript, assess_quality, TranscriptUnavailable
from ..notes.generator import generate_notes
from ..notes.obsidian import write_note

log = logging.getLogger(__name__)


async def run_notes_job():
    """
    Entry point called by APScheduler.
    Processes one pending lecture per run to stay within Gemini free-tier limits.
    """
    db = SessionLocal()
    try:
        # Find the next lecture that has a YouTube ID but no notes yet
        lecture = (
            db.query(Lecture)
            .filter(Lecture.has_video.is_(True))
            .filter(Lecture.youtube_id.isnot(None))
            .filter(Lecture.youtube_id != "NONE")
            .filter(Lecture.notes_status == "pending")
            .order_by(Lecture.serial_no)
            .first()
        )

        if not lecture:
            return  # nothing to process

        course = db.query(Course).get(lecture.course_id)
        log.info(
            "Notes job: processing lecture %d — %s (%s)",
            lecture.serial_no, lecture.title[:50], course.code,
        )

        ai = get_ai_client()

        # ── Step 1: fetch transcript ──────────────────────────────────────
        lecture.notes_status = "transcribing"
        db.commit()

        try:
            transcript, source = fetch_transcript(lecture.youtube_id)
        except TranscriptUnavailable as e:
            log.warning("Transcript unavailable: %s", e)
            lecture.notes_status = "failed"
            lecture.transcript_quality = "unavailable"
            db.commit()
            return

        quality = assess_quality(transcript)
        lecture.transcript_raw = transcript
        lecture.transcript_source = source
        lecture.transcript_quality = quality
        db.commit()

        log.info(
            "Transcript fetched: source=%s quality=%s words=%d",
            source, quality, len(transcript.split()),
        )

        if quality == "poor":
            log.warning(
                "Lecture %d transcript quality is poor — flagged. "
                "Set notes_status back to 'pending' and activate Whisper fallback to retry.",
                lecture.serial_no,
            )
            lecture.notes_status = "failed"
            db.commit()
            return

        # ── Step 2: generate notes ────────────────────────────────────────
        lecture.notes_status = "generating"
        db.commit()

        try:
            notes = await generate_notes(
                title=lecture.title,
                course_code=course.code,
                lecture_serial=lecture.serial_no,
                transcript=transcript,
                ai_client=ai,
            )
        except Exception as e:
            log.error("Note generation failed for lecture %d: %s", lecture.serial_no, e)
            lecture.notes_status = "failed"
            db.commit()
            return

        lecture.notes_md = notes
        lecture.notes_generated_at = datetime.now(timezone.utc)
        lecture.notes_status = "done"
        db.commit()

        # ── Step 3: write to Obsidian vault ───────────────────────────────
        if settings.obsidian_vault_path:
            try:
                write_note(
                    vault_root=settings.obsidian_vault_path,
                    course_code=course.code,
                    course_title=course.title,
                    lecture_serial=lecture.serial_no,
                    lecture_title=lecture.title,
                    notes_md=notes,
                    youtube_id=lecture.youtube_id,
                )
            except Exception as e:
                log.error("Failed to write note to Obsidian: %s", e)
                # Don't fail the job — notes are already in DB
        else:
            log.warning("OBSIDIAN_VAULT_PATH not set — skipping vault write")

        log.info(
            "Notes job complete: lecture %d (%s) — status=done",
            lecture.serial_no, course.code,
        )

    except Exception as e:
        log.exception("Notes job crashed: %s", e)
    finally:
        db.close()


async def run_notes_for_lecture(lecture_id: int) -> dict:
    """
    Manually trigger notes generation for a specific lecture.
    Used by the API endpoint POST /api/notes/run.
    Returns a status dict.
    """
    db = SessionLocal()
    try:
        lecture = db.query(Lecture).get(lecture_id)
        if not lecture:
            return {"error": "Lecture not found"}
        if not lecture.youtube_id:
            return {"error": "No YouTube ID for this lecture — sync first"}

        # Reset so the job picks it up
        lecture.notes_status = "pending"
        lecture.transcript_quality = None
        db.commit()

        await run_notes_job()

        db.refresh(lecture)
        return {
            "lecture_id": lecture_id,
            "notes_status": lecture.notes_status,
            "transcript_quality": lecture.transcript_quality,
            "transcript_source": lecture.transcript_source,
        }
    finally:
        db.close()
