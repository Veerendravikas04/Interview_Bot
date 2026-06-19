"""Security utilities for authentication and authorization."""
import os
import jwt
import structlog
from datetime import datetime, timedelta, timezone
import bcrypt
from fastapi import Request
from app.db.client import get_db
from app.core.errors import AppError

logger = structlog.get_logger(__name__)

JWT_SECRET = os.environ.get("JWT_SECRET", "")
ALGORITHM = "HS256"
# Session lifetime (days) — env-overridable, not hardcoded. 30d keeps users signed
# in across normal usage; lower it for stricter security.
JWT_EXPIRE_DAYS = int(os.environ.get("JWT_EXPIRE_DAYS", "30"))

if not JWT_SECRET:
    # Fail loud: never sign tokens with a guessable default in any environment.
    raise RuntimeError("JWT_SECRET is not set. Add a strong JWT_SECRET to backend/.env.")

def get_password_hash(password: str) -> str:
    salt = bcrypt.gensalt()
    pwd_bytes = password.encode('utf-8')
    return bcrypt.hashpw(pwd_bytes, salt).decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))
    except Exception:
        return False

def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRE_DAYS)
    to_encode.update({"exp": expire.timestamp()})
    return jwt.encode(to_encode, JWT_SECRET, algorithm=ALGORITHM)

def get_current_user(request: Request):
    """FastAPI Dependency to get current user from Bearer token."""
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise AppError(code="UNAUTHORIZED", message="Missing or invalid token", status_code=401)
    
    token = auth_header.split(" ")[1]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if user_id is None:
            raise AppError(code="UNAUTHORIZED", message="Invalid token payload", status_code=401)
    except jwt.ExpiredSignatureError:
        logger.warning("expired_token")
        raise AppError(code="UNAUTHORIZED", message="Token has expired", status_code=401)
    except jwt.PyJWTError as e:
        logger.warning("invalid_token", error=str(e))
        raise AppError(code="UNAUTHORIZED", message="Invalid token", status_code=401)
        
    db = get_db()
    user = db.users.find_one({"_id": user_id})
    if not user:
        raise AppError(code="UNAUTHORIZED", message="User no longer exists", status_code=401)
        
    structlog.contextvars.bind_contextvars(user_id=user["_id"])
    return user
