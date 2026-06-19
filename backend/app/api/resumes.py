import io
import time
import base64
import uuid
import asyncio
from datetime import datetime, timezone

import fitz  # PyMuPDF
import structlog
import json_repair
from docx import Document
from fastapi import APIRouter, Depends, UploadFile, File, Response
from langchain_core.messages import HumanMessage

from app.db.client import get_db
from app.core.security import get_current_user
from app.core.errors import AppError
from app.core import config as cfg
from app.core.llm import get_llm

MEDIA_TYPES = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "txt": "text/plain; charset=utf-8",
    "md": "text/markdown; charset=utf-8",
}

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/api/resumes", tags=["resumes"])

MAX_SIZE = 5 * 1024 * 1024  # 5 MB upload cap


def extract_text(filename: str, content: bytes) -> str:
    """Extract plain text from an uploaded resume. Fails loudly (AppError)."""
    name = (filename or "").lower()

    if name.endswith(".pdf"):
        try:
            with fitz.open(stream=content, filetype="pdf") as doc:
                pages, links = [], []
                for page in doc:
                    pages.append(page.get_text())
                    for ln in page.get_links():
                        uri = (ln.get("uri") or "").strip()
                        if uri and uri not in links:
                            links.append(uri)
                text = "\n".join(pages)
                # Résumés put GitHub/LinkedIn/LeetCode behind hyperlinks ("GitHub"
                # text, URL hidden in the annotation). get_text() drops those URLs,
                # so we append them — otherwise github_profile/ATS can't find them.
                if links:
                    text += "\n\nLinks:\n" + "\n".join(links)
                return text
        except Exception as e:
            logger.error("pdf_extraction_failed", error=str(e))
            raise AppError(code="EXTRACTION_FAILED", message="Could not read the PDF file", status_code=400)

    if name.endswith(".docx"):
        try:
            document = Document(io.BytesIO(content))
            return "\n".join(p.text for p in document.paragraphs)
        except Exception as e:
            logger.error("docx_extraction_failed", error=str(e))
            raise AppError(code="EXTRACTION_FAILED", message="Could not read the Word document", status_code=400)

    if name.endswith(".txt") or name.endswith(".md"):
        return content.decode("utf-8", errors="ignore")

    raise AppError(
        code="UNSUPPORTED_FILE",
        message="Unsupported file type. Upload a PDF, DOCX, TXT, or MD file (legacy .doc is not supported).",
        status_code=400,
    )


def _strip_code_fences(text: str) -> str:
    """Drop a leading ```json / ``` fence and trailing ``` if the model added one.
    json_repair tolerates a lot, but stripping fences keeps the payload clean."""
    t = (text or "").strip()
    if t.startswith("```json"):
        t = t[7:]
    elif t.startswith("```"):
        t = t[3:]
    if t.endswith("```"):
        t = t[:-3]
    return t.strip()


async def _extract_skills(resume_text: str) -> dict:
    """LLM-extract interviewable skills, projects and primary role from a resume.

    Returns {"skills": [{"skill","confidence"}], "role": str, "projects": [str]}.
    Raises on failure — callers surface a real error, never fabricated skills.
    """
    prompt = f"""Extract interviewable technical skills, major projects, and the candidate's primary role from the following resume.

Do NOT extract: NPTEL, Coursera, Udemy, Certifications, Workshop names, Course titles, College subjects, Soft skills.

Output ONLY a JSON object with this exact structure:
{{
  "role": "Frontend Engineer (or whatever fits best; default to Software Engineer)",
  "skills": [
    {{"skill": "React", "confidence": 0.95}},
    {{"skill": "Python", "confidence": 0.85}}
  ],
  "projects": ["Project name one", "Project name two"]
}}
DO NOT include any markdown formatting or extra text.

Resume: {resume_text[:cfg.RESUME_PROMPT_MAX_CHARS]}"""

    llm = get_llm()
    response = await asyncio.wait_for(
        llm.ainvoke([HumanMessage(content=prompt)]),
        timeout=cfg.LLM_REPORT_TIMEOUT,
    )
    data = json_repair.loads(_strip_code_fences(response.content))
    if not isinstance(data, dict) or "skills" not in data:
        raise ValueError("LLM did not return the expected {skills, role, projects} object")

    skills = sorted(
        [s for s in data.get("skills", []) if isinstance(s, dict) and s.get("skill")],
        key=lambda x: x.get("confidence", 0),
        reverse=True,
    )[: cfg.SKILLS_TOP_N]
    role = (data.get("role") or "Software Engineer").strip()
    projects = [p for p in data.get("projects", []) if isinstance(p, str) and p.strip()]
    return {"skills": skills, "role": role, "projects": projects}


@router.post("/")
async def upload_resume(file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    content = await file.read()

    if len(content) == 0:
        raise AppError(code="EMPTY_FILE", message="The uploaded file is empty", status_code=400)
    if len(content) > MAX_SIZE:
        raise AppError(code="FILE_TOO_LARGE", message="File exceeds the 5MB limit", status_code=400)

    text = extract_text(file.filename, content).strip()
    if not text:
        raise AppError(
            code="EXTRACTION_FAILED",
            message="No readable text found in the file (it may be a scanned image).",
            status_code=400,
        )

    resume_id = str(uuid.uuid4())
    file_type = file.filename.rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else "txt"

    db = get_db()
    db.resumes.insert_one({
        "_id": resume_id,
        "user_id": current_user["_id"],
        "filename": file.filename,
        "file_type": file_type,
        "extracted_text": text,
        "file_b64": base64.b64encode(content).decode("ascii"),  # original bytes for true preview
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    logger.info("resume_uploaded", resume_id=resume_id, file_type=file_type, chars=len(text))

    return {
        "resume_id": resume_id,
        "filename": file.filename,
        "chars_extracted": len(text),
        "extracted_text": text,
    }


@router.get("/{resume_id}")
async def get_resume(resume_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    resume = db.resumes.find_one({"_id": resume_id, "user_id": current_user["_id"]})
    if not resume:
        raise AppError(code="RESUME_NOT_FOUND", message="Resume not found", status_code=404)
    return {
        "resume_id": resume["_id"],
        "filename": resume.get("filename"),
        "file_type": resume.get("file_type"),
        "extracted_text": resume.get("extracted_text", ""),
    }


@router.get("/{resume_id}/file")
async def get_resume_file(resume_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    resume = db.resumes.find_one({"_id": resume_id, "user_id": current_user["_id"]})
    if not resume or not resume.get("file_b64"):
        raise AppError(code="FILE_NOT_FOUND", message="Original file not available", status_code=404)
    data = base64.b64decode(resume["file_b64"])
    media = MEDIA_TYPES.get((resume.get("file_type") or "").lower(), "application/octet-stream")
    return Response(
        content=data,
        media_type=media,
        headers={"Content-Disposition": f'inline; filename="{resume.get("filename", "resume")}"'},
    )


@router.get("/{resume_id}/ats-report")
async def get_ats_report(resume_id: str, role: str = None, refresh: bool = False, current_user: dict = Depends(get_current_user)):
    from app.services.ats_report import generate_ats_report
    try:
        return await generate_ats_report(resume_id, current_user["_id"], role, refresh=refresh)
    except ValueError as e:
        # NO_ROLE / empty resume / not found → client-actionable 400.
        raise AppError(code="RESUME_ERROR", message=str(e), status_code=400)
    except asyncio.TimeoutError:
        logger.warning("ats_report_timeout", resume_id=resume_id)
        raise AppError(code="REPORT_TIMEOUT", message="The ATS report timed out. Please try again.", status_code=504)
    except Exception as e:
        logger.error("get_ats_report_error", error=str(e), error_type=type(e).__name__)
        raise AppError(code="REPORT_GENERATION_FAILED", message="Failed to generate ATS report", status_code=500)


@router.get("/{resume_id}/latex")
async def get_latex_resume(resume_id: str, role: str = None, current_user: dict = Depends(get_current_user)):
    from app.services.latex_generator import generate_latex_resume
    try:
        latex_code = await generate_latex_resume(resume_id, current_user["_id"], role)
        return {"latex": latex_code}
    except ValueError as e:
        raise AppError(code="RESUME_ERROR", message=str(e), status_code=400)
    except asyncio.TimeoutError:
        logger.warning("latex_timeout", resume_id=resume_id)
        raise AppError(code="REPORT_TIMEOUT", message="LaTeX generation timed out. Please try again.", status_code=504)
    except Exception as e:
        logger.error("get_latex_resume_error", error=str(e), error_type=type(e).__name__)
        raise AppError(code="REPORT_GENERATION_FAILED", message="Failed to generate LaTeX resume", status_code=500)


@router.post("/extract-skills")
async def extract_skills(req: dict, current_user: dict = Depends(get_current_user)):
    """Extract interviewable skills/role/projects from a resume and cache them on
    the resume doc. No fabricated fallback — a real failure returns a real error."""
    resume_id = req.get("resume_id")
    if not resume_id:
        raise AppError(code="MISSING_RESUME_ID", message="resume_id is required", status_code=400)

    db = get_db()
    resume = db.resumes.find_one({"_id": resume_id, "user_id": current_user["_id"]})
    if not resume:
        raise AppError(code="RESUME_NOT_FOUND", message="Resume not found", status_code=404)

    # Prefer the stored resume text; fall back to client-supplied text only if needed.
    resume_text = (resume.get("extracted_text") or req.get("resumeText") or "").strip()
    if not resume_text:
        raise AppError(code="EMPTY_RESUME", message="Resume has no readable text", status_code=400)

    # Serve cached extraction if we already did it (dynamic cache, not hardcoded data).
    if resume.get("extracted_skills"):
        logger.info("skills_extraction_cache_hit", resume_id=resume_id)
        return {
            "skills": resume["extracted_skills"],
            "role": resume.get("extracted_role", "Software Engineer"),
            "projects": resume.get("extracted_projects", []),
        }

    started = time.monotonic()
    logger.info("skills_extraction_started", resume_id=resume_id, chars=len(resume_text))
    try:
        result = await _extract_skills(resume_text)
    except asyncio.TimeoutError:
        logger.warning("skills_extraction_timeout", resume_id=resume_id,
                       latency_ms=int((time.monotonic() - started) * 1000))
        raise AppError(code="EXTRACTION_TIMEOUT", message="Skill extraction timed out. Please try again.", status_code=504)
    except Exception as e:
        logger.error("skills_extraction_failed", resume_id=resume_id,
                     error=str(e), error_type=type(e).__name__,
                     latency_ms=int((time.monotonic() - started) * 1000))
        raise AppError(code="EXTRACTION_FAILED", message="Could not extract skills from this resume. Please try again.", status_code=502)

    db.resumes.update_one(
        {"_id": resume_id, "user_id": current_user["_id"]},
        {"$set": {
            "extracted_skills": result["skills"],
            "extracted_role": result["role"],
            "extracted_projects": result["projects"],
        }},
    )
    logger.info("skills_extraction_ok", resume_id=resume_id, n_skills=len(result["skills"]),
                role=result["role"], latency_ms=int((time.monotonic() - started) * 1000))
    return result
