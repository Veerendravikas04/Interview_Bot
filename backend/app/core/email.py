"""Email sending via SMTP (stdlib smtplib — no extra dependency).

Configured entirely from env so nothing is hard-coded:
  SMTP_HOST   e.g. smtp.gmail.com
  SMTP_PORT   default 587 (STARTTLS)
  SMTP_USER   the sending account (e.g. you@gmail.com)
  SMTP_PASS   an app password (Gmail: Account → Security → App passwords)
  FROM_EMAIL  optional; defaults to SMTP_USER

If SMTP isn't configured, send_email() returns False and the caller falls back
(e.g. the dev reset-link log). Never logs credentials or the email body.
"""
import os
import ssl
import smtplib
from email.message import EmailMessage

import structlog

logger = structlog.get_logger(__name__)


def _cfg() -> dict:
    user = os.environ.get("SMTP_USER", "").strip()
    return {
        "host": os.environ.get("SMTP_HOST", "").strip(),
        "port": int(os.environ.get("SMTP_PORT", "587")),
        "user": user,
        "password": os.environ.get("SMTP_PASS", "").strip(),
        "from_email": os.environ.get("FROM_EMAIL", user).strip(),
    }


def email_configured() -> bool:
    c = _cfg()
    return bool(c["host"] and c["user"] and c["password"])


def send_email(to_email: str, subject: str, body_text: str, body_html: str | None = None) -> bool:
    """Send one email. Returns True on success, False if unconfigured or it fails."""
    c = _cfg()
    if not email_configured():
        logger.info("email_not_configured")
        return False

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = c["from_email"]
    msg["To"] = to_email
    msg.set_content(body_text)
    if body_html:
        msg.add_alternative(body_html, subtype="html")

    try:
        ctx = ssl.create_default_context()
        with smtplib.SMTP(c["host"], c["port"], timeout=15) as server:
            server.starttls(context=ctx)
            server.login(c["user"], c["password"])
            server.send_message(msg)
        logger.info("email_sent", to=to_email, subject=subject)
        return True
    except Exception as e:
        # Log the failure type, never the credentials/body.
        logger.warning("email_send_failed", to=to_email, error_type=type(e).__name__, error=str(e)[:200])
        return False
