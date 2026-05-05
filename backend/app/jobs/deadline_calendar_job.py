"""
Hourly job — pre-schedules a midnight reminder notification.
At 23:00 UTC each day, sends email listing all items due within the next hour.
"""

import logging
from datetime import timedelta

from ..db import SessionLocal
from ..models import Item, Notification, utcnow

log = logging.getLogger(__name__)


def run_deadline_calendar_job():
    db = SessionLocal()
    try:
        now = utcnow()
        from datetime import timezone
        import zoneinfo


        # Pre-schedule midnight reminder for items due after 23:00 today
        local_tz = zoneinfo.ZoneInfo("Asia/Karachi")
        now_local = now.astimezone(local_tz)
        today = now_local.date()
        tonight_11pm_utc = (
            __import__("datetime").datetime.combine(today, __import__("datetime").time(23, 0), tzinfo=local_tz)
            .astimezone(timezone.utc)
        )

        # Check if reminder already scheduled for today
        today_reminder = (
            db.query(Notification)
            .filter(
                Notification.kind == "midnight_reminder",
                Notification.scheduled_for >= now_local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc),
                Notification.scheduled_for < (now_local.replace(hour=23, minute=59, second=59, microsecond=0).astimezone(timezone.utc) + timedelta(seconds=1)),
            )
            .first()
        )

        if not today_reminder:
            # Check if any items are due after 23:00 today
            items_due_tonight = (
                db.query(Item)
                .filter(
                    Item.due_at >= tonight_11pm_utc,
                    Item.due_at < (tonight_11pm_utc + timedelta(hours=1)),
                    Item.completed_at.is_(None),
                )
                .first()
            )
            if items_due_tonight:
                reminder = Notification(
                    kind="midnight_reminder",
                    scheduled_for=tonight_11pm_utc,
                    item_id=None,  # will be rendered at dispatch time for all items
                )
                db.add(reminder)
                log.info("Scheduled midnight reminder for %s 23:00", today)

        db.commit()
        log.info("Deadline reminder job done")
    except Exception:
        log.exception("Deadline calendar job crashed")
        db.rollback()
    finally:
        db.close()
