"""User-scoped data access (the isolation contract lives here).

Every function REQUIRES user_id and puts it in the filter, so an unscoped query
is impossible to write by accident. Soft-deleted threads (``deleted_at`` set) are
excluded everywhere. In MongoDB, ``{"deleted_at": None}`` also matches documents
where the field is absent, so legacy rows are treated as not-deleted.
"""
import uuid
from datetime import datetime, timezone

from app.db.client import get_db


def _now():
    return datetime.now(timezone.utc).isoformat()


# ---------- threads ----------
def get_thread(user_id: str, thread_id: str):
    return get_db().threads.find_one({"_id": thread_id, "user_id": user_id, "deleted_at": None})


def list_threads(user_id: str):
    return list(
        get_db().threads.find({"user_id": user_id, "deleted_at": None}).sort("updated_at", -1)
    )


def insert_thread(doc: dict):
    doc.setdefault("deleted_at", None)
    get_db().threads.insert_one(doc)
    return doc


def update_thread(user_id: str, thread_id: str, fields: dict):
    fields = {**fields, "updated_at": _now()}
    return get_db().threads.update_one(
        {"_id": thread_id, "user_id": user_id, "deleted_at": None}, {"$set": fields}
    )


def set_thread_resume(user_id: str, thread_id: str, resume_id: str):
    """Make resume_id the ACTIVE (latest) resume for the thread, and keep the full
    history in resume_ids (ChatGPT-style: don't discard earlier uploads)."""
    return get_db().threads.update_one(
        {"_id": thread_id, "user_id": user_id, "deleted_at": None},
        {
            "$set": {"resume_id": resume_id, "updated_at": _now()},
            "$addToSet": {"resume_ids": resume_id},
        },
    )


def soft_delete_thread(user_id: str, thread_id: str):
    return get_db().threads.update_one(
        {"_id": thread_id, "user_id": user_id, "deleted_at": None},
        {"$set": {"deleted_at": _now()}},
    )


# ---------- messages ----------
def insert_message(thread_id: str, user_id: str, role: str, content: str, metadata: dict | None = None):
    doc = {
        "_id": str(uuid.uuid4()),
        "thread_id": thread_id,
        "user_id": user_id,
        "role": role,
        "content": content,
        "created_at": _now(),
    }
    if metadata:
        doc["metadata"] = metadata
    get_db().messages.insert_one(doc)
    return doc


def list_messages(thread_id: str, user_id: str):
    return list(
        get_db().messages.find({"thread_id": thread_id, "user_id": user_id}).sort("created_at", 1)
    )


def count_messages(thread_id: str, user_id: str):
    return get_db().messages.count_documents({"thread_id": thread_id, "user_id": user_id})


# ---------- resumes ----------
def get_resume(user_id: str, resume_id: str):
    return get_db().resumes.find_one({"_id": resume_id, "user_id": user_id})
