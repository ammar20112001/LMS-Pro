"""
Notes job: fetch transcript, translate to English.
AI handout generation is disabled until an AI provider is configured.
Runs every 3 minutes via APScheduler, processing up to BATCH_SIZE videos per run.
"""

import asyncio
import logging
import time

from ..db import SessionLocal
from ..models import Course, Lecture, LectureVideo
from ..notes.transcript import fetch_transcript, assess_quality, TranscriptUnavailable

log = logging.getLogger(__name__)

BATCH_SIZE = 5
MAX_RETRIES = 10
RETRY_DELAY_SECS = 2


def _translate_to_english(text: str) -> str | None:
    """
    Translate text to English using Google Translate (via deep-translator, free/no API key).
    Splits into 4500-char chunks to stay within the limit.
    Returns None if translation fails.
    """
    try:
        from deep_translator import GoogleTranslator
        translator = GoogleTranslator(source="auto", target="en")
        chunk_size = 4500
        chunks = [text[i:i + chunk_size] for i in range(0, len(text), chunk_size)]
        translated_chunks = [translator.translate(chunk) for chunk in chunks]
        result = " ".join(c for c in translated_chunks if c)
        log.info("Translation complete: %d → %d chars", len(text), len(result))
        return result
    except Exception as e:
        log.warning("Translation failed: %s", e)
        return None


async def run_notes_job():
    """
    Entry point called by APScheduler.
    Processes up to BATCH_SIZE pending LectureVideo rows per run.
    """
    db = SessionLocal()
    try:
        videos = (
            db.query(LectureVideo)
            .filter(LectureVideo.youtube_id.isnot(None))
            .filter(LectureVideo.youtube_id != "NONE")
            .filter(LectureVideo.notes_status == "pending")
            .filter(LectureVideo.transcript_retries < MAX_RETRIES)
            .order_by(LectureVideo.lecture_id, LectureVideo.seq)
            .limit(BATCH_SIZE)
            .all()
        )

        if not videos:
            return

        log.info("Notes job: processing %d videos", len(videos))
        for video in videos:
            await _process_video(db, video)

    except Exception as e:
        log.exception("Notes job crashed: %s", e)
    finally:
        db.close()


async def _process_video(db, video: LectureVideo):
    lecture = db.query(Lecture).get(video.lecture_id)
    course = db.query(Course).get(lecture.course_id) if lecture else None
    course_code = course.code if course else "?"
    serial_no = lecture.serial_no if lecture else 0
    title = lecture.title[:50] if lecture else "?"

    log.info("Processing video %d (lecture %d seq %d) — %s (%s) [attempt %d]",
             video.id, video.lecture_id, video.seq, title, course_code,
             (video.transcript_retries or 0) + 1)

    video.notes_status = "transcribing"
    db.commit()

    # ── Retry loop for transcript fetch ──────────────────────────────────
    transcript = None
    source = None
    last_error = None

    for attempt in range(3):
        try:
            transcript, source = fetch_transcript(video.youtube_id)
            break
        except TranscriptUnavailable as e:
            last_error = e
            if attempt < 2:
                log.warning("Attempt %d failed for video %d: %s — retrying in %ds",
                            attempt + 1, video.id, e, RETRY_DELAY_SECS)
                await asyncio.sleep(RETRY_DELAY_SECS)
        except Exception as e:
            last_error = e
            if attempt < 2:
                log.warning("Attempt %d unexpected error for video %d: %s — retrying",
                            attempt + 1, video.id, e)
                await asyncio.sleep(RETRY_DELAY_SECS)

    if transcript is None:
        video.transcript_retries = (video.transcript_retries or 0) + 1
        if video.transcript_retries >= MAX_RETRIES:
            log.error("Video %d exhausted %d retries — marking failed: %s",
                      video.id, MAX_RETRIES, last_error)
            video.notes_status = "failed"
            video.transcript_quality = "unavailable"
        else:
            log.warning("Video %d failed this run (retry %d/%d) — will retry next run",
                        video.id, video.transcript_retries, MAX_RETRIES)
            video.notes_status = "pending"
        db.commit()
        return

    quality = assess_quality(transcript)
    video.transcript_raw = transcript
    video.transcript_source = source
    video.transcript_quality = quality
    video.transcript_retries = 0  # reset on success
    db.commit()

    if quality == "poor":
        log.warning("Video %d transcript quality poor — skipping", video.id)
        video.notes_status = "failed"
        db.commit()
        return

    # ── Translate to English ──────────────────────────────────────────────
    log.info("Translating video %d transcript to English…", video.id)
    translated = _translate_to_english(transcript)
    if translated:
        video.transcript_en = translated
        log.info("Video %d translated: %d words", video.id, len(translated.split()))
    else:
        log.warning("Video %d translation failed — transcript_en will be empty", video.id)

    video.notes_status = "transcribed"
    db.commit()
    log.info("Video %d (lecture %d seq %d, %s) transcribed and translated",
             video.id, video.lecture_id, video.seq, course_code)


async def run_notes_for_lecture(lecture_id: int) -> dict:
    """
    Manually trigger transcript fetching for all pending videos of a lecture.
    Used by POST /api/notes/run.
    """
    db = SessionLocal()
    try:
        lecture = db.query(Lecture).get(lecture_id)
        if not lecture:
            return {"error": "Lecture not found"}
        pending_videos = [
            v for v in lecture.videos
            if v.youtube_id and v.youtube_id != "NONE"
            and v.notes_status in ("pending", "failed")
        ]
        if not pending_videos:
            return {"error": "No pending videos for this lecture"}
        for video in pending_videos:
            video.notes_status = "pending"
            video.transcript_retries = 0
            db.commit()
            await _process_video(db, video)
        db.refresh(lecture)
        return {
            "lecture_id": lecture_id,
            "videos_processed": len(pending_videos),
            "video_statuses": [{"seq": v.seq, "status": v.notes_status} for v in lecture.videos],
        }
    finally:
        db.close()
