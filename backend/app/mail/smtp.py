import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from ..config import settings

log = logging.getLogger(__name__)


def send_email(subject: str, html_body: str, to: str = None) -> bool:
    to = to or settings.notify_email
    if not to or not settings.smtp_user:
        log.warning("Email not configured — skipping send")
        return False

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = settings.smtp_from or settings.smtp_user
    msg["To"] = to
    msg.attach(MIMEText(html_body, "html"))

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as smtp:
            smtp.ehlo()
            smtp.starttls()
            smtp.login(settings.smtp_user, settings.smtp_pass)
            smtp.sendmail(msg["From"], [to], msg.as_string())
        log.info("Email sent: %s → %s", subject, to)
        return True
    except Exception as e:
        log.error("Email send failed: %s", e)
        return False
