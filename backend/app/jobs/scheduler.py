import asyncio
import logging
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from ..config import settings
from .notify_job import run_notify, run_digest
from .notes_job import run_notes_job
from .deadline_calendar_job import run_deadline_calendar_job
from .youtube_job import run_youtube_job
from .handout_job import run_ingestion_job, run_enrichment_job
from . import job_toggles as toggles

log = logging.getLogger(__name__)

_scheduler: BackgroundScheduler | None = None


def _run_sync_wrapper():
    """Bridge async sync job into the sync APScheduler context."""
    from .sync_job import run_sync
    try:
        asyncio.run(run_sync())
    except Exception as e:
        log.exception("Sync job crashed: %s", e)


def _run_notes_wrapper():
    """Bridge async notes job into the sync APScheduler context."""
    try:
        asyncio.run(run_notes_job())
    except Exception as e:
        log.exception("Notes job crashed: %s", e)


def start():
    global _scheduler
    _scheduler = BackgroundScheduler(timezone="Asia/Karachi")

    # Each job is gated by a flag in `job_toggles.py` — edit that file
    # to enable/disable pipelines without touching this scheduler.
    enabled: list[str] = []

    if toggles.LMS_SYNC:
        _scheduler.add_job(
            _run_sync_wrapper,
            trigger=IntervalTrigger(minutes=settings.sync_interval_minutes),
            id="lms_sync", name="LMS Sync", replace_existing=True,
            misfire_grace_time=None, coalesce=True,
        )
        enabled.append("lms_sync")

    if toggles.NOTIFY_DISPATCH:
        _scheduler.add_job(
            run_notify, trigger=IntervalTrigger(minutes=5),
            id="notify_dispatch", name="Notification Dispatcher", replace_existing=True,
        )
        enabled.append("notify_dispatch")

    if toggles.DAILY_DIGEST:
        _scheduler.add_job(
            run_digest, trigger=CronTrigger(hour=settings.digest_hour_local, minute=0),
            id="daily_digest", name="Daily Digest", replace_existing=True,
        )
        enabled.append("daily_digest")

    if toggles.NOTES_GENERATION:
        _scheduler.add_job(
            _run_notes_wrapper,
            trigger=IntervalTrigger(minutes=settings.notes_interval_minutes),
            id="notes_gen", name="Notes Generator", replace_existing=True, coalesce=True,
        )
        enabled.append("notes_gen")

    if toggles.DEADLINE_REMINDER:
        _scheduler.add_job(
            run_deadline_calendar_job, trigger=IntervalTrigger(hours=1),
            id="deadline_reminder", name="Deadline Reminder Scheduler",
            replace_existing=True, coalesce=True,
        )
        enabled.append("deadline_reminder")

    if toggles.YOUTUBE_EXTRACTION:
        _scheduler.add_job(
            run_youtube_job, trigger=IntervalTrigger(minutes=2),
            id="youtube_extraction", name="YouTube Video Extraction", replace_existing=True,
        )
        enabled.append("youtube_extraction")

    if toggles.HANDOUT_INGESTION:
        _scheduler.add_job(
            run_ingestion_job, trigger=IntervalTrigger(hours=1),
            id="handout_ingestion", name="Handout Ingestion",
            replace_existing=True, coalesce=True,
        )
        enabled.append("handout_ingestion")

    if toggles.HANDOUT_ENRICHMENT:
        _scheduler.add_job(
            run_enrichment_job, trigger=IntervalTrigger(minutes=2),
            id="handout_enrichment", name="Handout Enrichment",
            replace_existing=True, coalesce=True,
        )
        enabled.append("handout_enrichment")

    if toggles.HANDOUT_INGESTION_STARTUP:
        _scheduler.add_job(
            run_ingestion_job, trigger="date",
            id="handout_ingestion_startup", name="Handout Ingestion (startup)",
            replace_existing=True,
        )
        enabled.append("handout_ingestion_startup")

    _scheduler.start()
    log.info("Scheduler started — enabled jobs: %s", ", ".join(enabled) or "(none)")


def stop():
    if _scheduler:
        _scheduler.shutdown(wait=False)


def trigger_sync_now():
    if _scheduler:
        _scheduler.modify_job("lms_sync", next_run_time=__import__("datetime").datetime.now())
