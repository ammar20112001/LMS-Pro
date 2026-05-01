"""
Notification dispatcher: runs every 5 minutes.
Sends deadline emails for items whose scheduled_for <= now.
"""

import logging
from datetime import timezone

from ..db import SessionLocal
from ..models import Item, Notification, utcnow
from ..mail.smtp import send_email

log = logging.getLogger(__name__)

KIND_LABELS = {
    "deadline_72h": "due in 72 hours",
    "deadline_24h": "due in 24 hours",
    "deadline_2h":  "due in 2 hours",
}


def run_notify():
    db = SessionLocal()
    try:
        now = utcnow()
        pending = (
            db.query(Notification)
            .filter(Notification.scheduled_for <= now, Notification.sent_at.is_(None))
            .all()
        )
        log.info("Notification dispatcher: %d pending", len(pending))

        for notif in pending:
            item = db.query(Item).get(notif.item_id)
            if not item:
                notif.sent_at = now
                continue
            # Skip if item is already completed
            if item.completed_at:
                notif.sent_at = now
                continue

            label = KIND_LABELS.get(notif.kind, notif.kind)
            course = item.course
            due_str = item.due_at.strftime("%b %d, %Y %I:%M %p") if item.due_at else "Unknown"

            subject = f"[LMS-Pro] {course.code} — {item.title} {label}"
            body = _render_deadline_email(item, label, due_str)

            if send_email(subject, body):
                notif.sent_at = now

        db.commit()
    finally:
        db.close()


def run_digest():
    """Daily morning digest — all items due in next 7 days."""
    from datetime import timedelta
    db = SessionLocal()
    try:
        now = utcnow()
        cutoff = now + timedelta(days=7)
        items = (
            db.query(Item)
            .filter(Item.due_at >= now, Item.due_at <= cutoff, Item.completed_at.is_(None))
            .order_by(Item.due_at)
            .all()
        )
        if not items:
            log.info("Digest: no upcoming items, skipping")
            return

        body = _render_digest_email(items, now)
        send_email("[LMS-Pro] Daily Study Digest", body)
        log.info("Digest sent with %d items", len(items))
    finally:
        db.close()


def _render_deadline_email(item: "Item", label: str, due_str: str) -> str:
    kind_icon = {"assignment": "📝", "quiz": "🧠", "gdb": "💬"}.get(item.kind, "📌")
    return f"""
<html><body style="font-family:sans-serif;max-width:600px;margin:auto">
  <h2 style="color:#e74c3c">{kind_icon} {item.kind.title()} Due Soon</h2>
  <table style="width:100%;border-collapse:collapse">
    <tr><td style="padding:8px;font-weight:bold">Course</td>
        <td style="padding:8px">{item.course.code} — {item.course.title}</td></tr>
    <tr style="background:#f8f9fa"><td style="padding:8px;font-weight:bold">Item</td>
        <td style="padding:8px">{item.title}</td></tr>
    <tr><td style="padding:8px;font-weight:bold">Due</td>
        <td style="padding:8px;color:#e74c3c"><strong>{due_str}</strong> ({label})</td></tr>
    <tr style="background:#f8f9fa"><td style="padding:8px;font-weight:bold">Marks</td>
        <td style="padding:8px">{item.total_marks or "—"}</td></tr>
  </table>
  <p style="color:#666;font-size:12px;margin-top:20px">LMS-Pro</p>
</body></html>"""


def _render_digest_email(items: list, now: "datetime") -> str:
    from datetime import timedelta
    rows = []
    for item in items:
        delta = item.due_at - now
        hours = int(delta.total_seconds() / 3600)
        urgency_color = "#e74c3c" if hours < 24 else "#e67e22" if hours < 72 else "#27ae60"
        rows.append(f"""
        <tr>
          <td style="padding:6px;border-bottom:1px solid #eee">{item.course.code}</td>
          <td style="padding:6px;border-bottom:1px solid #eee">{item.kind.title()}</td>
          <td style="padding:6px;border-bottom:1px solid #eee">{item.title}</td>
          <td style="padding:6px;border-bottom:1px solid #eee;color:{urgency_color}">
            {item.due_at.strftime("%b %d %I:%M %p")}
          </td>
        </tr>""")

    return f"""
<html><body style="font-family:sans-serif;max-width:700px;margin:auto">
  <h2>📅 Daily Study Digest — {now.strftime("%B %d, %Y")}</h2>
  <p>{len(items)} item(s) due in the next 7 days:</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <thead>
      <tr style="background:#2c3e50;color:white">
        <th style="padding:8px;text-align:left">Course</th>
        <th style="padding:8px;text-align:left">Type</th>
        <th style="padding:8px;text-align:left">Title</th>
        <th style="padding:8px;text-align:left">Due</th>
      </tr>
    </thead>
    <tbody>{''.join(rows)}</tbody>
  </table>
  <p style="color:#666;font-size:12px;margin-top:20px">LMS-Pro</p>
</body></html>"""
