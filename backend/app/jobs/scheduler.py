import asyncio
import logging
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from ..config import settings
from .notify_job import run_notify, run_digest

log = logging.getLogger(__name__)

_scheduler: BackgroundScheduler | None = None


def _run_sync_wrapper():
    """Bridge async sync job into the sync APScheduler context."""
    from .sync_job import run_sync
    try:
        asyncio.run(run_sync())
    except Exception as e:
        log.exception("Sync job crashed: %s", e)


def start():
    global _scheduler
    _scheduler = BackgroundScheduler(timezone="Asia/Karachi")

    _scheduler.add_job(
        _run_sync_wrapper,
        trigger=IntervalTrigger(minutes=settings.sync_interval_minutes),
        id="lms_sync",
        name="LMS Sync",
        replace_existing=True,
        misfire_grace_time=None,
        coalesce=True,
    )

    _scheduler.add_job(
        run_notify,
        trigger=IntervalTrigger(minutes=5),
        id="notify_dispatch",
        name="Notification Dispatcher",
        replace_existing=True,
    )

    _scheduler.add_job(
        run_digest,
        trigger=CronTrigger(hour=settings.digest_hour_local, minute=0),
        id="daily_digest",
        name="Daily Digest",
        replace_existing=True,
    )

    _scheduler.start()
    log.info(
        "Scheduler started — sync every %d min, notify every 5 min, digest at %d:00",
        settings.sync_interval_minutes,
        settings.digest_hour_local,
    )


def stop():
    if _scheduler:
        _scheduler.shutdown(wait=False)


def trigger_sync_now():
    if _scheduler:
        _scheduler.modify_job("lms_sync", next_run_time=__import__("datetime").datetime.now())
