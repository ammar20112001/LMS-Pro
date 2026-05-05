import logging
import smtplib
from datetime import datetime, timezone, timedelta
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from ..config import settings

log = logging.getLogger(__name__)


def _smtp_send(msg: MIMEMultipart, to: str) -> bool:
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as smtp:
            smtp.ehlo()
            smtp.starttls()
            smtp.login(settings.smtp_user, settings.smtp_pass)
            smtp.sendmail(msg["From"], [to], msg.as_string())
        return True
    except Exception as e:
        log.error("SMTP send failed: %s", e)
        return False


def send_email(subject: str, html_body: str, to: str = None) -> bool:
    to = to or settings.personal_email or settings.notify_email
    if not to or not settings.smtp_user:
        log.warning("Email not configured — skipping send")
        return False

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = settings.smtp_from or settings.smtp_user
    msg["To"] = to
    msg.attach(MIMEText(html_body, "html"))

    ok = _smtp_send(msg, to)
    if ok:
        log.info("Email sent: %s → %s", subject, to)
    return ok


def _make_ical(item, method: str = "REQUEST") -> str:
    now_utc = datetime.now(timezone.utc)
    due = item.due_at.astimezone(timezone.utc)
    start = due - timedelta(hours=1)

    def fmt(dt: datetime) -> str:
        return dt.strftime("%Y%m%dT%H%M%SZ")

    icon = {"assignment": "📝", "quiz": "🧠", "gdb": "💬"}.get(item.kind, "📌")
    summary = f"{icon} {item.kind.title()}: {item.title} ({item.course.code})"
    desc = (
        f"{item.kind.title()} for {item.course.code}\\n"
        f"Due: {due.strftime('%Y-%m-%d %H:%M UTC')}\\n"
        f"Marks: {item.total_marks or 'N/A'}"
    )
    uid = f"lmspro-{item.id}@lmspro"

    alarms = ""
    if method == "REQUEST":
        alarms = (
            "BEGIN:VALARM\nTRIGGER:-PT24H\nACTION:DISPLAY\n"
            "DESCRIPTION:Due in 24 hours!\nEND:VALARM\n"
            "BEGIN:VALARM\nTRIGGER:-PT2H\nACTION:DISPLAY\n"
            "DESCRIPTION:Due in 2 hours!\nEND:VALARM\n"
        )

    status = "CONFIRMED" if method == "REQUEST" else "CANCELLED"
    return (
        f"BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//LMS-Pro//EN\nMETHOD:{method}\n"
        f"BEGIN:VEVENT\nUID:{uid}\nDTSTAMP:{fmt(now_utc)}\n"
        f"DTSTART:{fmt(start)}\nDTEND:{fmt(due)}\n"
        f"SUMMARY:{summary}\nDESCRIPTION:{desc}\nSTATUS:{status}\n"
        f"{alarms}END:VEVENT\nEND:VCALENDAR"
    )


def send_calendar_invite(item, cancel: bool = False) -> bool:
    to = settings.personal_email or settings.notify_email
    if not to or not settings.smtp_user:
        log.warning("Email not configured — skipping calendar invite")
        return False

    method = "CANCEL" if cancel else "REQUEST"
    icon = {"assignment": "📝", "quiz": "🧠", "gdb": "💬"}.get(item.kind, "📌")
    due_str = item.due_at.strftime("%b %d, %Y %I:%M %p") if item.due_at else "Unknown"
    action = "Removed from Calendar" if cancel else "Added to Calendar"

    subject = f"[LMS-Pro] {action}: {icon} {item.course.code} — {item.title}"
    html = f"""<html><body style="font-family:sans-serif;max-width:600px;margin:auto">
  <h2>{"🗑️ Cancelled" if cancel else "📅 New Deadline"}: {icon} {item.title}</h2>
  <table style="width:100%;border-collapse:collapse">
    <tr><td style="padding:8px;font-weight:bold">Course</td>
        <td style="padding:8px">{item.course.code} — {item.course.title}</td></tr>
    <tr style="background:#f8f9fa"><td style="padding:8px;font-weight:bold">Type</td>
        <td style="padding:8px">{item.kind.title()}</td></tr>
    <tr><td style="padding:8px;font-weight:bold">Due</td>
        <td style="padding:8px;color:#e74c3c"><strong>{due_str}</strong></td></tr>
    <tr style="background:#f8f9fa"><td style="padding:8px;font-weight:bold">Marks</td>
        <td style="padding:8px">{item.total_marks or "—"}</td></tr>
  </table>
  <p style="color:#666;font-size:12px;margin-top:16px">
    {"Submitted/completed — removed from your calendar." if cancel
     else "Accept the attached .ics to add this deadline to Google Calendar."}
  </p>
</body></html>"""

    msg = MIMEMultipart("mixed")
    msg["Subject"] = subject
    msg["From"] = settings.smtp_from or settings.smtp_user
    msg["To"] = to
    msg.attach(MIMEText(html, "html"))

    ical_part = MIMEBase("text", "calendar", method=method, name="invite.ics")
    ical_part.set_payload(_make_ical(item, method).encode())
    ical_part.add_header("Content-Disposition", "attachment", filename="invite.ics")
    msg.attach(ical_part)

    ok = _smtp_send(msg, to)
    if ok:
        log.info("Calendar invite (%s) sent: %s", method, item.title)
    return ok
