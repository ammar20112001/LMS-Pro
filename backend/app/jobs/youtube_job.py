"""
YouTube extraction job — runs frequently (every 1-2 min) with parallelization.
Extracts YouTube IDs for lectures without blocking the sync job.
Uses 2 parallel browser instances for ~2x speedup.
"""

import asyncio
import logging
from sqlalchemy.orm import Session

from ..db import SessionLocal
from ..models import Course, Lecture, LectureVideo
from ..scraper import VULMSScraper, CourseDTO

log = logging.getLogger(__name__)

_youtube_lock = asyncio.Lock()


async def run_youtube_job():
    """Entry point. Skips if another job is already running."""
    if _youtube_lock.locked():
        return

    async with _youtube_lock:
        await _do_youtube_job()


async def _do_youtube_job():
    """Extract YouTube IDs for all pending lectures using parallel browsers."""
    db = SessionLocal()
    try:
        # Count pending lectures
        pending_count = (
            db.query(Lecture)
            .filter(Lecture.has_video == True, Lecture.videos_scraped == False)
            .count()
        )

        if pending_count == 0:
            return

        log.info("YouTube job: %d pending lectures", pending_count)

        # Spawn 2 parallel scrapers
        scraper1 = VULMSScraper()
        scraper2 = VULMSScraper()

        try:
            await asyncio.gather(
                scraper1.start(headless=True),
                scraper2.start(headless=True),
            )

            # Ensure both are logged in
            ok1 = await scraper1.ensure_logged_in()
            ok2 = await scraper2.ensure_logged_in()

            if not (ok1 and ok2):
                log.error("YouTube job: authentication failed")
                return

            # Get all courses (needed for scraper context)
            courses = await scraper1.list_courses()
            courses_by_id = {c.code: c for c in courses}

            # Get pending lectures
            pending = (
                db.query(Lecture)
                .filter(Lecture.has_video == True, Lecture.videos_scraped == False)
                .order_by(Lecture.id)
                .all()
            )

            # Split into 2 batches for parallel processing
            mid = len(pending) // 2
            batch1 = pending[:mid]
            batch2 = pending[mid:]

            # Process both batches in parallel
            results1 = await _process_batch(db, scraper1, batch1, courses_by_id)
            results2 = await _process_batch(db, scraper2, batch2, courses_by_id)

            log.info(
                "YouTube job done: %d succeeded, %d failed",
                results1[0] + results2[0],
                results1[1] + results2[1],
            )

        finally:
            await asyncio.gather(
                scraper1.stop(),
                scraper2.stop(),
            )

    except Exception as e:
        log.exception("YouTube job failed: %s", e)
    finally:
        db.close()


async def _process_batch(
    db: Session, scraper: "VULMSScraper", lectures: list, courses_by_id: dict
) -> tuple[int, int]:
    """Process a batch of lectures. Returns (succeeded, failed)."""
    succeeded = failed = 0

    for lec in lectures:
        try:
            course = lec.course
            course_dto = courses_by_id.get(course.code)
            if not course_dto:
                failed += 1
                continue

            # Extract video IDs
            yt_ids = await scraper.get_lecture_all_video_urls(
                course_dto, lec.week, lec.lms_index
            )

            if not yt_ids:
                log.warning("No video data for lecture %d (%s)", lec.serial_no, lec.title[:40])
                if not lec.videos:
                    db.add(LectureVideo(lecture_id=lec.id, seq=1, youtube_id="NONE"))
            else:
                lec.video_count = len(yt_ids)
                existing = {v.seq: v for v in lec.videos}
                for seq, yt_id in enumerate(yt_ids, start=1):
                    lv = existing.get(seq)
                    if lv:
                        if lv.youtube_id is None:
                            lv.youtube_id = yt_id if yt_id else "NONE"
                    else:
                        db.add(
                            LectureVideo(
                                lecture_id=lec.id,
                                seq=seq,
                                youtube_id=yt_id if yt_id else "NONE",
                            )
                        )
                lec.videos_scraped = True
                log.info("Lecture %d: confirmed %d video(s)", lec.serial_no, len(yt_ids))

            succeeded += 1

        except Exception as e:
            log.warning("Failed to extract videos for lecture %d: %s", lec.serial_no, e)
            failed += 1

    db.commit()
    return succeeded, failed
