from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import List, Optional
import uuid
from datetime import datetime, timezone
import structlog

from app.core.security import get_current_user
from app.core.errors import AppError
from app.db import repositories as repo

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/api/threads", tags=["threads"])


class ThreadCreateRequest(BaseModel):
    resume_id: Optional[str] = None
    type: Optional[str] = "chat"
    difficulty: Optional[str] = "medium"
    skills: Optional[List[str]] = []
    max_questions: Optional[int] = 5


class ThreadUpdateRequest(BaseModel):
    title: str


class AttachResumeRequest(BaseModel):
    resume_id: str


def _now():
    return datetime.now(timezone.utc).isoformat()


@router.post("/")
async def create_thread(req: ThreadCreateRequest, current_user: dict = Depends(get_current_user)):
    user_id = current_user["_id"]

    if req.resume_id and not repo.get_resume(user_id, req.resume_id):
        raise AppError(code="RESUME_NOT_FOUND", message="Resume not found", status_code=404)

    thread_id = str(uuid.uuid4())
    now = _now()
    repo.insert_thread({
        "_id": thread_id,
        "user_id": user_id,
        "resume_id": req.resume_id,
        "resume_ids": [req.resume_id] if req.resume_id else [],
        "type": req.type or "chat",
        "title": None,
        "status": "active",
        "difficulty": req.difficulty,
        "skills": req.skills,
        "max_questions": req.max_questions,
        "current_round": 1,
        "asked_questions": [],
        "running_summary": "",
        "summary_covers_until": 0,
        "counters": {"hints_used": 0, "tab_switches": 0},
        "deleted_at": None,
        "created_at": now,
        "updated_at": now,
    })
    logger.info("thread_created", thread_id=thread_id, type=req.type)
    return {"thread_id": thread_id}


@router.get("/")
async def get_threads(current_user: dict = Depends(get_current_user)):
    user_id = current_user["_id"]
    return [
        {
            "id": t["_id"],
            "title": t.get("title"),
            "type": t.get("type", "chat"),
            "date": (t.get("updated_at") or t.get("created_at") or "")[:10],
            "updated_at": t.get("updated_at"),
        }
        for t in repo.list_threads(user_id)
    ]


@router.get("/{thread_id}/messages")
async def get_thread_messages(thread_id: str, current_user: dict = Depends(get_current_user)):
    user_id = current_user["_id"]
    if not repo.get_thread(user_id, thread_id):
        raise AppError(code="THREAD_NOT_FOUND", message="Conversation not found", status_code=404)
    return [
        {
            "id": m["_id"],
            "role": m.get("role"),
            "content": m.get("content", ""),
            "metadata": m.get("metadata", {}),
            "created_at": m.get("created_at"),
        }
        for m in repo.list_messages(thread_id, user_id)
    ]


@router.patch("/{thread_id}")
async def rename_thread(thread_id: str, req: ThreadUpdateRequest, current_user: dict = Depends(get_current_user)):
    user_id = current_user["_id"]
    title = (req.title or "").strip()[:80]
    if not title:
        raise AppError(code="INVALID_TITLE", message="Title cannot be empty", status_code=400)
    result = repo.update_thread(user_id, thread_id, {"title": title})
    if result.matched_count == 0:
        raise AppError(code="THREAD_NOT_FOUND", message="Conversation not found", status_code=404)
    logger.info("thread_renamed", thread_id=thread_id)
    return {"ok": True, "title": title}


@router.delete("/{thread_id}")
async def delete_thread(thread_id: str, current_user: dict = Depends(get_current_user)):
    user_id = current_user["_id"]
    result = repo.soft_delete_thread(user_id, thread_id)
    if result.matched_count == 0:
        raise AppError(code="THREAD_NOT_FOUND", message="Conversation not found", status_code=404)
    logger.info("thread_deleted", thread_id=thread_id)
    return {"ok": True}


@router.post("/{thread_id}/attach-resume")
async def attach_resume(thread_id: str, req: AttachResumeRequest, current_user: dict = Depends(get_current_user)):
    user_id = current_user["_id"]
    if not repo.get_thread(user_id, thread_id):
        raise AppError(code="THREAD_NOT_FOUND", message="Conversation not found", status_code=404)
    if not repo.get_resume(user_id, req.resume_id):
        raise AppError(code="RESUME_NOT_FOUND", message="Resume not found", status_code=404)
    repo.set_thread_resume(user_id, thread_id, req.resume_id)  # active=latest, keep history
    logger.info("resume_attached", thread_id=thread_id, resume_id=req.resume_id)
    return {"ok": True}

@router.get("/{thread_id}/report")
async def get_thread_report(thread_id: str, current_user: dict = Depends(get_current_user)):
    user_id = current_user["_id"]
    if not repo.get_thread(user_id, thread_id):
        raise AppError(code="THREAD_NOT_FOUND", message="Conversation not found", status_code=404)
        
    from app.services.report import generate_interview_report
    
    try:
        report_data = await generate_interview_report(user_id, thread_id)
        return report_data
    except Exception as e:
        logger.error("get_report_error", error=str(e))
        raise AppError(code="REPORT_GENERATION_FAILED", message="Failed to generate report", status_code=500)

