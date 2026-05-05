"""
Hourly job — two responsibilities:
1. Send Google Calendar invites (.ics) for newly discovered deadlines.
2. Cancel invites when a deadline is marked completed.

Separate cron job at 23:00 sends a reminder email for anything due within the next hour.
"""

import logging
from datetime import timedelta

from ..db import SessionLocal
from ..models import Item, Notification, utcnow
from ..mail.smtp import send_calendar_invite, send_email

log = logging.getLogger(__name__)


def run_deadline_calendar_job():
    db = SessionLocal()
    try:
        now = utcnow()

        # ── 1. Send calendar invites for new upcoming items ──────────────────
        upcoming = (
            db.query(Item)
            .filter(Item.due_at > now, Item.completed_at.is_(None))
            .all()
        )

        for item in upcoming:
            already_invited = (
                db.query(Notification)
                .filter(
                    Notification.item_id == item.id,
                    Notification.kind == "calendar_invite",
                )
                .first()
            )
            if already_invited:
                continue

            notif = Notification(item_id=item.id, kind="calendar_invite", scheduled_for=now)
            db.add(notif)
            db.flush()

            if send_calendar_invite(item, cancel=False):
                notif.sent_at = now
                log.info("Calendar invite sent: %s (%s)", item.title, item.course.code)
            else:
                log.warning("Calendar invite failed: %s", item.title)

        # ── 2. Cancel invites for newly completed items ───────────────────────
        completed_needing_cancel = (
            db.query(Item)
            .filter(Item.completed_at.isnot(None))
            .join(
                Notification,
                (Notification.item_id == Item.id) & (Notification.kind == "calendar_invite") & (Notification.sent_at.isnot(None)),
            )
            .filter(
                ~db.query(Notification.id)
                .filter(Notification.item_id == Item.id, Notification.kind == "calendar_cancel")
                .correlate(Item)
                .exists()
            )
            .all()
        )

        for item in completed_needing_cancel:
            notif = Notification(item_id=item.id, kind="calendar_cancel", scheduled_for=now)
            db.add(notif)
            db.flush()

            if send_calendar_invite(item, cancel=True):
                notif.sent_at = now
                log.info("Calendar cancel sent: %s", item.title)

        db.commit()
        log.info(
            "Deadline calendar job done — %d upcoming, %d cancelled",
            len(upcoming), len(completed_needing_cancel),
        )
    except Exception:
        log.exception("Deadline calendar job crashed")
        db.rollback()
    finally:
        db.close()


def run_midnight_reminder():
    """Runs at 23:00 — emails all incomplete items due within the next hour."""
    db = SessionLocal()
    try:
        now = utcnow()
        window_end = now + timedelta(hours=1)

        due_soon = (
            db.query(Item)
            .filter(
                Item.due_at >= now,
                Item.due_at <= window_end,
                Item.completed_at.is_(None),
            )
            .order_by(Item.due_at)
            .all()
        )

        if not due_soon:
            log.info("Midnight reminder: no items due in the next hour")
            return

        rows = []
        for item in due_soon:
            icon = {"assignment": "📝", "quiz": "🧠", "gdb": "💬"}.get(item.kind, "📌")
            due_str = item.due_at.strftime("%I:%M %p") if item.due_at else "—"
            rows.append(f"""
            <tr>
              <td style="padding:8px;border-bottom:1px solid #eee">{icon} {item.course.code}</td>
              <td style="padding:8px;border-bottom:1px solid #eee">{item.kind.title()}</td>
              <td style="padding:8px;border-bottom:1px solid #eee">{item.title}</td>
              <td style="padding:8px;border-bottom:1px solid #eee;color:#e74c3c;font-weight:bold">{due_str}</td>
            </tr>""")

        body = f"""<html><body style="font-family:sans-serif;max-width:700px;margin:auto">
  <h2 style="color:#e74c3c">⏰ Deadline Alert — Due Within the Hour</h2>
  <p>{len(due_soon)} item(s) are due before midnight tonight:</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <thead>
      <tr style="background:#c0392b;color:white">
        <th style="padding:8px;text-align:left">Course</th>
        <th style="padding:8px;text-align:left">Type</th>
        <th style="padding:8px;text-align:left">Title</th>
        <th style="padding:8px;text-align:left">Due At</th>
      </tr>
    </thead>
    <tbody>{''.join(rows)}</tbody>
  </table>
  <p style="margin-top:16px;color:#666;font-size:12px">LMS-Pro — sent at 23:00</p>
</body></html>"""

        send_email("[LMS-Pro] ⏰ Deadlines Due in Under an Hour!", body)
        log.info("Midnight reminder sent for %d items", len(due_soon))
    except Exception:
        log.exception("Midnight reminder job crashed")
    finally:
        db.close()
