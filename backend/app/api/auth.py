"""Authentication endpoints."""
import os
import uuid
import hashlib
import secrets
import structlog
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends
from app.models.user import UserCreate, UserLogin, UserResponse, TokenResponse
from app.core.security import get_password_hash, verify_password, create_access_token, get_current_user
from app.core.errors import AppError
from app.db.client import get_db

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])

FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000")
RESET_TOKEN_TTL_MIN = int(os.environ.get("RESET_TOKEN_TTL_MIN", "30"))


def _hash_token(t: str) -> str:
    return hashlib.sha256(t.encode()).hexdigest()

@router.post("/signup", response_model=TokenResponse)
def signup(user_data: UserCreate):
    db = get_db()
    email_lower = user_data.email.lower()
    
    if db.users.find_one({"email": email_lower}):
        raise AppError(code="EMAIL_EXISTS", message="Email is already registered", status_code=400)
        
    user_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    
    new_user = {
        "_id": user_id,
        "email": email_lower,
        "password_hash": get_password_hash(user_data.password),
        "name": user_data.name,
        "created_at": now,
        "updated_at": now
    }
    
    db.users.insert_one(new_user)
    logger.info("user_signed_up", user_id=user_id)
    
    token = create_access_token({"sub": user_id})
    return {"access_token": token, "user": new_user}

@router.post("/login", response_model=TokenResponse)
def login(user_data: UserLogin):
    db = get_db()
    email_lower = user_data.email.lower()
    
    user = db.users.find_one({"email": email_lower})
    if not user or not verify_password(user_data.password, user["password_hash"]):
        raise AppError(code="UNAUTHORIZED", message="Invalid email or password", status_code=401)
        
    logger.info("user_logged_in", user_id=user["_id"])
    token = create_access_token({"sub": user["_id"]})
    return {"access_token": token, "user": user}

@router.post("/logout")
def logout(current_user: dict = Depends(get_current_user)):
    logger.info("user_logged_out", user_id=current_user["_id"])
    return {"ok": True}

@router.get("/me", response_model=UserResponse)
def get_me(current_user: dict = Depends(get_current_user)):
    return current_user


@router.post("/forgot-password")
def forgot_password(payload: dict):
    """Start a password reset. Always returns a generic message (no email
    enumeration). A reset token is stored hashed with a short TTL; the link is
    delivered by email in production — here (no email provider) it's logged."""
    db = get_db()
    email = (payload.get("email") or "").strip().lower()
    generic = {"ok": True, "message": "If that email is registered, a reset link has been sent."}
    if not email:
        return generic

    user = db.users.find_one({"email": email})
    if not user:
        logger.info("forgot_password_unknown_email")  # do NOT reveal to the client
        return generic

    token = secrets.token_urlsafe(32)
    expires = (datetime.now(timezone.utc) + timedelta(minutes=RESET_TOKEN_TTL_MIN)).isoformat()
    db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"reset_token_hash": _hash_token(token), "reset_token_exp": expires}},
    )
    reset_link = f"{FRONTEND_URL}/?reset={token}"
    # SECURITY: never log the token/link — that would put a working account-takeover
    # credential in plaintext logs. Log the event only.
    logger.info("password_reset_requested", user_id=user["_id"])

    # Send the link by email when SMTP is configured (see core/email.py).
    from app.core.email import send_email, email_configured
    sent = send_email(
        email,
        "Reset your Caliber password",
        f"We received a request to reset your Caliber password.\n\n"
        f"Use this link to set a new password (valid for {RESET_TOKEN_TTL_MIN} minutes):\n{reset_link}\n\n"
        f"If you didn't request this, you can safely ignore this email.",
        body_html=(
            f"<p>We received a request to reset your <b>Caliber</b> password.</p>"
            f"<p>Use this link to set a new password (valid for {RESET_TOKEN_TTL_MIN} minutes):</p>"
            f'<p><a href="{reset_link}">Reset my password</a></p>'
            f"<p style='color:#888'>If you didn't request this, you can safely ignore this email.</p>"
        ),
    )

    # Fallbacks when no email provider is set up — DEV ONLY, gated by an env flag.
    if not sent and not email_configured() and os.environ.get("AUTH_DEV_LOG_RESET_LINK", "").lower() == "true":
        print(f"[DEV] password reset link for {email}: {reset_link}", flush=True)
    return generic


@router.post("/reset-password")
def reset_password(payload: dict):
    """Complete a password reset with a valid, unexpired token."""
    db = get_db()
    token = (payload.get("token") or "").strip()
    new_password = payload.get("password") or ""
    if not token or len(new_password) < 6:
        raise AppError(code="INVALID_INPUT", message="A token and a password (min 6 chars) are required", status_code=400)

    user = db.users.find_one({"reset_token_hash": _hash_token(token)})
    if not user:
        raise AppError(code="INVALID_TOKEN", message="Invalid or already-used reset link", status_code=400)

    exp = user.get("reset_token_exp")
    try:
        expired = (not exp) or datetime.fromisoformat(exp) < datetime.now(timezone.utc)
    except Exception:
        expired = True
    if expired:
        raise AppError(code="EXPIRED_TOKEN", message="This reset link has expired. Request a new one.", status_code=400)

    db.users.update_one(
        {"_id": user["_id"]},
        {
            "$set": {"password_hash": get_password_hash(new_password),
                     "updated_at": datetime.now(timezone.utc).isoformat()},
            "$unset": {"reset_token_hash": "", "reset_token_exp": ""},
        },
    )
    logger.info("password_reset_complete", user_id=user["_id"])
    return {"ok": True, "message": "Password updated — you can now log in."}

@router.get("/crash")
def force_crash():
    raise ValueError("Intentional crash for trace_id testing")
