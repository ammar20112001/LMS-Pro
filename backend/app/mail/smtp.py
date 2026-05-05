import logging
import smtplib
import base64
from datetime import datetime, timezone, timedelta
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.header import Header

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
    msg["Subject"] = Header(subject, 'utf-8')
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

    kind_label = {"assignment": "Assignment", "quiz": "Quiz", "gdb": "Discussion"}.get(item.kind, "Item")
    summary = f"{kind_label}: {item.title} ({item.course.code})"
    desc = (
        f"{kind_label} for {item.course.code}\\n"
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


def send_calendar_invites_batch(items: list) -> bool:
    """Send single email with multiple .ics calendar files."""
    to = settings.personal_email or settings.notify_email
    if not to or not settings.smtp_user:
        log.warning("Email not configured — skipping calendar invites")
        return False

    if not items:
        return False

    msg = MIMEMultipart("mixed")
    msg["Subject"] = Header(f"[LMS-Pro] {len(items)} Upcoming Deadlines — Calendar Invites", 'utf-8')
    msg["From"] = settings.smtp_from or settings.smtp_user
    msg["To"] = to

    rows = []
    for item in items:
        kind_label = {"assignment": "Assignment", "quiz": "Quiz", "gdb": "Discussion"}.get(item.kind, "Item")
        due_str = item.due_at.strftime("%b %d, %Y %I:%M %p") if item.due_at else "Unknown"
        rows.append(f"""
        <tr>
          <td style="padding:8px;border-bottom:1px solid #eee">{item.course.code}</td>
          <td style="padding:8px;border-bottom:1px solid #eee">{kind_label}</td>
          <td style="padding:8px;border-bottom:1px solid #eee">{item.title}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;color:#e74c3c"><strong>{due_str}</strong></td>
        </tr>""")

    html = f"""<html><body style="font-family:sans-serif;max-width:700px;margin:auto">
  <h2 style="color:#e74c3c">New Deadlines — Calendar Invites Attached</h2>
  <p>{len(items)} new deadline(s) have been added to your LMS-Pro. Download the attached .ics files and:</p>
  <ol style="color:#666;line-height:1.8">
    <li><strong>Google Calendar:</strong> Drag & drop the .ics file onto your calendar, or open it and click "Add to Calendar"</li>
    <li><strong>Outlook:</strong> Right-click the .ics file and select "Open with" → "Calendar"</li>
    <li><strong>Apple Calendar:</strong> Double-click the .ics file</li>
    <li><strong>Other calendars:</strong> Import the .ics file via your calendar app's import function</li>
  </ol>

  <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:20px">
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

    msg.attach(MIMEText(html, "html"))

    # Attach .ics file for each item
    for item in items:
        ical_content = _make_ical(item, method="REQUEST").encode('utf-8')
        ical_part = MIMEBase("text", "calendar", method="REQUEST", name=f"{item.id}.ics")
        ical_part.set_payload(base64.b64encode(ical_content).decode('ascii'))
        ical_part['Content-Transfer-Encoding'] = 'base64'
        ical_part.add_header("Content-Disposition", "attachment", filename=f"{item.course.code}_{item.id}.ics")
        msg.attach(ical_part)

    ok = _smtp_send(msg, to)
    if ok:
        log.info("Calendar invites sent: %d items", len(items))
    return ok


def send_calendar_invite(item, cancel: bool = False) -> bool:
    to = settings.personal_email or settings.notify_email
    if not to or not settings.smtp_user:
        log.warning("Email not configured — skipping calendar invite")
        return False

    method = "CANCEL" if cancel else "REQUEST"
    due_str = item.due_at.strftime("%b %d, %Y %I:%M %p") if item.due_at else "Unknown"
    action = "Removed from Calendar" if cancel else "Added to Calendar"
    kind_label = {"assignment": "Assignment", "quiz": "Quiz", "gdb": "Discussion"}.get(item.kind, "Item")

    subject = f"[LMS-Pro] {action}: {item.course.code} — {item.title}"
    html = f"""<html><body style="font-family:sans-serif;max-width:600px;margin:auto">
  <h2>{"Cancelled" if cancel else "New Deadline"}: {kind_label} - {item.title}</h2>
  <table style="width:100%;border-collapse:collapse">
    <tr><td style="padding:8px;font-weight:bold">Course</td>
        <td style="padding:8px">{item.course.code} — {item.course.title}</td></tr>
    <tr style="background:#f8f9fa"><td style="padding:8px;font-weight:bold">Type</td>
        <td style="padding:8px">{kind_label}</td></tr>
    <tr><td style="padding:8px;font-weight:bold">Due</td>
        <td style="padding:8px;color:#e74c3c"><strong>{due_str}</strong></td></tr>
    <tr style="background:#f8f9fa"><td style="padding:8px;font-weight:bold">Marks</td>
        <td style="padding:8px">{item.total_marks or "—"}</td></tr>
  </table>
  <p style="color:#666;font-size:12px;margin-top:16px">
    {"Submitted/completed — removed from your calendar." if cancel
     else "The attached .ics file can be imported to Google Calendar, Outlook, or Apple Calendar."}
  </p>
</body></html>"""

    msg = MIMEMultipart("mixed")
    msg["Subject"] = Header(subject, 'utf-8')
    msg["From"] = settings.smtp_from or settings.smtp_user
    msg["To"] = to
    msg.attach(MIMEText(html, "html"))

    ical_content = _make_ical(item, method).encode('utf-8')
    ical_part = MIMEBase("text", "calendar", method=method, name="invite.ics")
    ical_part.set_payload(base64.b64encode(ical_content).decode('ascii'))
    ical_part['Content-Transfer-Encoding'] = 'base64'
    ical_part.add_header("Content-Disposition", "attachment", filename="invite.ics")
    msg.attach(ical_part)

    ok = _smtp_send(msg, to)
    if ok:
        log.info("Calendar invite (%s) sent: %s", method, item.title)
    return ok
