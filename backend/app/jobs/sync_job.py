"""
Sync job: scrape VU LMS → diff → write to DB → schedule notifications.
Runs every 30 minutes via APScheduler.
"""

import asyncio
import logging
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from ..db import SessionLocal
from ..models import Course, Item, Lecture, LectureVideo, Notification, SyncRun, utcnow
from ..scraper import VULMSScraper, CourseDTO, ItemDTO, LectureDTO

log = logging.getLogger(__name__)

_sync_lock = asyncio.Lock()

NOTIFICATION_WINDOWS = [
    ("deadline_72h", timedelta(hours=72)),
    ("deadline_24h", timedelta(hours=24)),
    ("deadline_2h",  timedelta(hours=2)),
]


async def run_sync():
    """Entry point called by APScheduler. Skips if another sync is already running."""
    if _sync_lock.locked():
        log.info("Sync already in progress — skipping")
        return

    async with _sync_lock:
        await _do_sync()


async def _do_sync():
    db = SessionLocal()
    run = SyncRun()
    db.add(run)
    db.commit()

    scraper = VULMSScraper()
    try:
        await scraper.start(headless=True)
        ok = await scraper.ensure_logged_in()
        if not ok:
            log.error("Sync aborted: could not authenticate")
            _finish_run(db, run, "error", "Authentication failed")
            return

        courses = await scraper.list_courses()
        log.info("Syncing %d courses", len(courses))

        for course_dto in courses:
            try:
                db_course = _upsert_course(db, course_dto)
                added, updated = await _sync_course(db, scraper, db_course, course_dto)
                run.items_added += added
                run.items_updated += updated
                run.courses_synced += 1
                db_course.last_synced_at = utcnow()
                db.commit()
            except Exception as e:
                log.exception("Error syncing course %s: %s", course_dto.code, e)

        _finish_run(db, run, "ok")
        log.info("Sync complete — added=%d updated=%d", run.items_added, run.items_updated)

    except Exception as e:
        log.exception("Sync job failed: %s", e)
        _finish_run(db, run, "error", str(e))
    finally:
        await scraper.stop()
        db.close()



def _finish_run(db: Session, run: SyncRun, status: str, error: str = None):
    run.status = status
    run.error = error
    run.finished_at = utcnow()
    db.commit()


def _upsert_course(db: Session, dto: CourseDTO) -> Course:
    course = db.query(Course).filter_by(lms_index=dto.index).first()
    if not course:
        course = Course(lms_index=dto.index)
        db.add(course)
    course.ctl_id = dto.ctl_id
    course.postback_target = dto.postback_target
    course.code = dto.code
    course.title = dto.title
    db.flush()
    return course


async def _sync_course(
    db: Session, scraper: VULMSScraper, course: Course, dto: CourseDTO
) -> tuple[int, int]:
    added = updated = 0

    all_items: list[ItemDTO] = []
    all_items += await scraper.list_assignments(dto)
    all_items += await scraper.list_quizzes(dto)
    all_items += await scraper.list_gdb(dto)

    for item_dto in all_items:
        a, u = _upsert_item(db, course, item_dto)
        added += a
        updated += u

    lectures = await scraper.list_lectures(dto)
    _sync_lectures(db, course, lectures)

    # Fill in YouTube IDs for video lectures that don't have one yet (max 5 per sync)
    await _sync_video_urls(db, scraper, course, dto)

    return added, updated


async def _sync_video_urls(db: Session, scraper, course, dto) -> None:
    """Discover video tab counts and upsert LectureVideo rows (non-destructive)."""
    # Pick up any lecture not yet confirmed for video count, including previously migrated ones
    pending = (
        db.query(Lecture)
        .filter_by(course_id=course.id, has_video=True, videos_scraped=False)
        .order_by(Lecture.serial_no)
        .limit(20)
        .all()
    )

    for lec in pending:
        try:
            yt_ids = await scraper.get_lecture_all_video_urls(dto, lec.week, lec.lms_index)
            if not yt_ids:
                log.warning("No video data for lecture %d (%s)", lec.serial_no, lec.title[:40])
                # Ensure at least a placeholder row exists; don't mark scraped so it retries
                if not lec.videos:
                    db.add(LectureVideo(lecture_id=lec.id, seq=1, youtube_id="NONE"))
            else:
                lec.video_count = len(yt_ids)
                existing = {v.seq: v for v in lec.videos}
                for seq, yt_id in enumerate(yt_ids, start=1):
                    lv = existing.get(seq)
                    if lv:
                        # Already exists from migration — only fill in if still unchecked
                        if lv.youtube_id is None:
                            lv.youtube_id = yt_id if yt_id else "NONE"
                    else:
                        # New video tab — add without touching existing rows
                        db.add(LectureVideo(
                            lecture_id=lec.id,
                            seq=seq,
                            youtube_id=yt_id if yt_id else "NONE",
                        ))
                lec.videos_scraped = True
                log.info("Lecture %d: confirmed %d video(s)", lec.serial_no, len(yt_ids))
        except Exception as e:
            log.warning("Failed to get video URLs for lecture %d: %s", lec.serial_no, e)

    db.commit()


def _upsert_item(db: Session, course: Course, dto: ItemDTO) -> tuple[int, int]:
    item = (
        db.query(Item)
        .filter_by(course_id=course.id, kind=dto.kind, lms_index=dto.lms_index)
        .first()
    )

    is_new = item is None
    if is_new:
        item = Item(course_id=course.id, kind=dto.kind, lms_index=dto.lms_index)
        db.add(item)

    # Update fields
    item.title = dto.title
    item.lesson = dto.lesson
    item.total_marks = dto.total_marks
    item.status = dto.status
    item.opens_at = dto.opens_at
    item.due_at = dto.due_at
    item.file_url = dto.file_url
    item.last_seen_at = utcnow()

    if dto.status == "Submitted" and not item.completed_at:
        item.completed_at = utcnow()
    elif dto.status != "Submitted" and item.completed_at and not is_new:
        # Don't un-complete manually completed items unless we know for sure
        pass

    new_hash = item.compute_hash()
    changed = item.content_hash != new_hash
    item.content_hash = new_hash

    db.flush()

    if is_new:
        _schedule_notifications(db, item)
        return 1, 0
    elif changed:
        _reschedule_notifications(db, item)
        return 0, 1

    return 0, 0


def _sync_lectures(db: Session, course: Course, dtos: list) -> None:
    existing = {(l.week, l.lms_index): l for l in course.lectures}
    for dto in dtos:
        key = (dto.week, dto.lms_index)
        lec = existing.get(key)
        if not lec:
            lec = Lecture(course_id=course.id, week=dto.week, lms_index=dto.lms_index)
            db.add(lec)
        lec.serial_no = dto.serial_no
        lec.title = dto.title
        lec.has_video = dto.has_video
        lec.has_reading = dto.has_reading
    db.flush()


def _schedule_notifications(db: Session, item: Item):
    if not item.due_at:
        return
    now = utcnow()
    for kind, delta in NOTIFICATION_WINDOWS:
        fire_at = item.due_at - delta
        if fire_at > now:
            db.add(Notification(item_id=item.id, kind=kind, scheduled_for=fire_at))


def _reschedule_notifications(db: Session, item: Item):
    # Cancel unsent notifications and reschedule based on new due_at
    db.query(Notification).filter(
        Notification.item_id == item.id,
        Notification.sent_at.is_(None),
    ).delete()
    _schedule_notifications(db, item)
