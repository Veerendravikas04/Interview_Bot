"""Transactional email.

Two backends, tried in this order:

  1. Brevo HTTP API (recommended for hosted/free deployments) — works where
     outbound SMTP is blocked (e.g. Render's free tier blocks port 587).
       BREVO_API_KEY   a v3 API key from Brevo → SMTP & API → API Keys (xkeysib-…)
       FROM_EMAIL      a *verified* sender address in Brevo
       FROM_NAME       optional display name (default "Caliber")

  2. SMTP (stdlib smtplib) — for local dev or a backend that allows SMTP.
       SMTP_HOST / SMTP_PORT (default 587) / SMTP_USER / SMTP_PASS / FROM_EMAIL

If neither is configured, send_email() returns False and the caller falls back
(e.g. the dev reset-link log). Never logs credentials or the email body.
"""
import os
import ssl
import json
import smtplib
import urllib.request
import urllib.error
from email.message import EmailMessage

import structlog

logger = structlog.get_logger(__name__)

BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email"


# ── Brevo HTTP API ──────────────────────────────────────────────────────────
def _brevo_cfg() -> dict:
    return {
        "api_key": os.environ.get("BREVO_API_KEY", "").strip(),
        "from_email": os.environ.get("FROM_EMAIL", "").strip(),
        "from_name": os.environ.get("FROM_NAME", "Caliber").strip() or "Caliber",
    }


def _brevo_configured() -> bool:
    c = _brevo_cfg()
    return bool(c["api_key"] and c["from_email"])


def _brevo_payload(to_email, subject, body_text, body_html, cfg):
    """Build the Brevo v3 request body. Split out so it's unit-testable offline."""
    payload = {
        "sender": {"email": cfg["from_email"], "name": cfg["from_name"]},
        "to": [{"email": to_email}],
        "subject": subject,
        "textContent": body_text,
    }
    if body_html:
        payload["htmlContent"] = body_html
    return payload


def _send_via_brevo(to_email, subject, body_text, body_html) -> bool:
    c = _brevo_cfg()
    data = json.dumps(_brevo_payload(to_email, subject, body_text, body_html, c)).encode()
    req = urllib.request.Request(
        BREVO_ENDPOINT,
        data=data,
        method="POST",
        headers={
            "api-key": c["api_key"],
            "content-type": "application/json",
            "accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            ok = 200 <= resp.status < 300
        logger.info("email_sent", provider="brevo", to=to_email, subject=subject)
        return ok
    except urllib.error.HTTPError as e:
        # Brevo's error body helps diagnose (e.g. unverified sender); never logs the key.
        detail = ""
        try:
            detail = e.read()[:200].decode(errors="ignore")
        except Exception:
            pass
        logger.warning("email_send_failed", provider="brevo", to=to_email, status=e.code, error=detail)
        return False
    except Exception as e:
        logger.warning("email_send_failed", provider="brevo", to=to_email, error_type=type(e).__name__, error=str(e)[:200])
        return False


# ── SMTP fallback ────────────────────────────────────────────────────────────
def _smtp_cfg() -> dict:
    user = os.environ.get("SMTP_USER", "").strip()
    return {
        "host": os.environ.get("SMTP_HOST", "").strip(),
        "port": int(os.environ.get("SMTP_PORT", "587")),
        "user": user,
        "password": os.environ.get("SMTP_PASS", "").strip(),
        "from_email": os.environ.get("FROM_EMAIL", user).strip(),
    }


def _smtp_configured() -> bool:
    c = _smtp_cfg()
    return bool(c["host"] and c["user"] and c["password"])


def _send_via_smtp(to_email, subject, body_text, body_html) -> bool:
    c = _smtp_cfg()
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
        logger.info("email_sent", provider="smtp", to=to_email, subject=subject)
        return True
    except Exception as e:
        logger.warning("email_send_failed", provider="smtp", to=to_email, error_type=type(e).__name__, error=str(e)[:200])
        return False


# ── Public API ───────────────────────────────────────────────────────────────
def email_configured() -> bool:
    return _brevo_configured() or _smtp_configured()


def send_email(to_email: str, subject: str, body_text: str, body_html: str | None = None) -> bool:
    """Send one email. Prefers Brevo HTTP; falls back to SMTP. Returns True on success."""
    if _brevo_configured():
        return _send_via_brevo(to_email, subject, body_text, body_html)
    if _smtp_configured():
        return _send_via_smtp(to_email, subject, body_text, body_html)
    logger.info("email_not_configured")
    return False


if __name__ == "__main__":
    # Offline self-check: payload shape is correct, no network.
    cfg = {"from_email": "noreply@example.com", "from_name": "Caliber"}
    p = _brevo_payload("u@x.com", "Reset", "text only", None, cfg)
    assert p["sender"] == {"email": "noreply@example.com", "name": "Caliber"}
    assert p["to"] == [{"email": "u@x.com"}]
    assert p["textContent"] == "text only" and "htmlContent" not in p
    p2 = _brevo_payload("u@x.com", "Reset", "t", "<b>t</b>", cfg)
    assert p2["htmlContent"] == "<b>t</b>"
    print("email.py self-check OK")
