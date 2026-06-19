import json
import time
import asyncio
import structlog
import json_repair
from typing import Dict, Any

from app.core.llm import get_llm
from app.core import config as cfg
from app.db.client import get_db
from app.services.github_service import extract_github_username, fetch_github_profile
from langchain_core.messages import HumanMessage

logger = structlog.get_logger(__name__)


def _github_facts_for_prompt(gh: dict) -> dict:
    """Compact, factual GitHub signals handed to the LLM as ground truth."""
    return {
        "username": gh.get("username"),
        "owned_repos": gh.get("owned_repos"),
        "public_repos": gh.get("public_repos"),
        "followers": gh.get("followers"),
        "total_stars": gh.get("total_stars"),
        "account_age_years": gh.get("account_age_years"),
        "languages": gh.get("languages"),
        "top_repos": [{"name": r["name"], "stars": r["stars"], "language": r["language"]}
                      for r in gh.get("top_repos", [])],
        "days_since_active": gh.get("days_since_active"),
        "active": gh.get("active"),
        "current_streak": gh.get("current_streak"),
        "longest_streak": gh.get("longest_streak"),
        "total_contributions_last_year": gh.get("total_contributions_last_year"),
    }


def _normalize_dev_review(raw: Any) -> Dict[str, Any]:
    """Coerce the LLM's developerProfile review into a stable shape (prose only)."""
    if not isinstance(raw, dict):
        return {"summary": "", "strengths": [], "concerns": [], "focusAreas": []}
    return {
        "summary": str(raw.get("summary", "")),
        "strengths": [str(s) for s in (raw.get("strengths") or [])],
        "concerns": [str(c) for c in (raw.get("concerns") or [])],
        "focusAreas": [str(f) for f in (raw.get("focusAreas") or [])],
    }


def _clean_role(role: str) -> str:
    """Sanitize a target-role string before it goes into an LLM prompt: collapse
    whitespace/newlines and cap length so it can't be used to smuggle instructions."""
    return " ".join((role or "").split())[: cfg.ROLE_MAX_CHARS].strip()


def _strip_code_fences(content: str) -> str:
    if "```json" in content:
        return content.split("```json")[1].split("```")[0].strip()
    if "```" in content:
        return content.split("```")[1].strip()
    return content.strip()


def _normalize_report(raw: Any) -> Dict[str, Any]:
    """Coerce the LLM output into the exact shape the frontend expects, so a
    slightly-off response never crashes the UI. No fabricated content — just shape."""
    if not isinstance(raw, dict):
        raise ValueError("ATS model output was not a JSON object")
    try:
        score = int(raw.get("atsScore", 0))
    except (TypeError, ValueError):
        score = 0
    score = max(0, min(100, score))
    bullets = []
    for b in raw.get("improvedBullets", []) or []:
        if isinstance(b, dict) and (b.get("original") or b.get("improved")):
            bullets.append({
                "original": str(b.get("original", "")),
                "improved": str(b.get("improved", "")),
                "reason": str(b.get("reason", "")),
            })
    return {
        "atsScore": score,
        "missingKeywords": [str(k) for k in (raw.get("missingKeywords") or [])],
        "resumeWeaknesses": [str(w) for w in (raw.get("resumeWeaknesses") or [])],
        "improvedBullets": bullets,
        "recommendations": [str(r) for r in (raw.get("recommendations") or [])],
    }


async def _resolve_role(db, repo, resume_id: str, user_id: str, provided_role: str) -> str:
    """Return a clean target role. Prefer the caller's role; else infer it from the
    most recent chat that uses this resume. Raises ValueError('NO_ROLE') if unknown."""
    if provided_role:
        return _clean_role(provided_role)

    thread = db.threads.find_one(
        {"user_id": user_id, "resume_ids": resume_id},
        sort=[("updated_at", -1)],
    )
    if not thread:
        raise ValueError("NO_ROLE")

    messages = repo.list_messages(str(thread["_id"]), user_id)
    chat_history = "\n".join(f"{m.get('role', 'unknown')}: {m.get('content', '')}" for m in messages[-10:])
    role_prompt = (
        "Based on the following chat history, what job role is the user applying for or targeting?\n"
        'If the user has not stated a role yet, output exactly "UNKNOWN". '
        "Otherwise output JUST the job title and nothing else.\n\n"
        f"CHAT HISTORY:\n{chat_history}"
    )
    resp = await asyncio.wait_for(
        get_llm().ainvoke([HumanMessage(content=role_prompt)]),
        timeout=cfg.LLM_REPORT_TIMEOUT,
    )
    role = _clean_role(resp.content)
    if not role or role.upper() == "UNKNOWN":
        raise ValueError("NO_ROLE")
    return role


async def generate_ats_report(resume_id: str, user_id: str, provided_role: str = None,
                              refresh: bool = False) -> Dict[str, Any]:
    from app.db import repositories as repo
    db = get_db()

    resume = db.resumes.find_one({"_id": resume_id, "user_id": user_id})
    if not resume:
        raise ValueError("Resume not found")

    # Cached report wins (dynamic cache — regenerate on a new role OR an explicit refresh).
    cached = resume.get("ats_report")
    if cached and not provided_role and not refresh:
        logger.info("ats_report_cache_hit", resume_id=resume_id)
        return cached

    resume_text = resume.get("extracted_text", "")
    if not resume_text:
        raise ValueError("Resume text is empty. Cannot generate report.")

    target_role = await _resolve_role(db, repo, resume_id, user_id, provided_role)
    db.resumes.update_one({"_id": resume_id, "user_id": user_id}, {"$set": {"extracted_role": target_role}})

    # GitHub enrichment: pull factual signals from the candidate's GitHub (if their
    # resume links one) so the report can review it the way a recruiter would.
    gh_username = extract_github_username(resume_text)
    # github_service is sync (so the agent tool node can use it); run it off the loop.
    github = await asyncio.to_thread(fetch_github_profile, gh_username) if gh_username else None

    gh_block = ""
    gh_schema = ""
    if github:
        gh_block = (
            "\n\nCANDIDATE GITHUB ACTIVITY (FACTUAL — from the GitHub API; treat as ground truth, "
            "do NOT alter or invent any numbers):\n"
            + json.dumps(_github_facts_for_prompt(github))
            + "\n"
        )
        gh_schema = """,
  "developerProfile": {
    "summary": "<2-3 sentences: a recruiter's honest read of this GitHub activity (active vs dormant, depth, signal)>",
    "strengths": ["<real positive grounded in the GitHub facts above>"],
    "concerns": ["<real concern, e.g. inactivity, mostly forks, thin original work>"],
    "focusAreas": ["<concrete action to raise their developer signal for recruiters>"]
  }"""

    prompt_str = f"""
You are an elite Technical Recruiter and ATS (Applicant Tracking System) Expert.
Analyze the candidate's resume for the target role and output a detailed ATS Analysis Report as JSON.

TARGET ROLE: {target_role}

CANDIDATE RESUME:
{resume_text[:cfg.RESUME_PROMPT_MAX_CHARS]}{gh_block}

CRITICAL: Analyze the ACTUAL resume text above. Do NOT output generic examples — extract REAL missing
keywords, REAL weaknesses, and REAL bullet points pulled from the text. Judge fit for the {target_role} role.
{"When you write developerProfile, base it ONLY on the GITHUB ACTIVITY facts above — never invent commit counts, streaks, or repos." if github else ""}

Output EXACTLY these keys (values are FORMAT EXAMPLES — replace with your real analysis):
{{
  "atsScore": <integer 0-100 for this resume against the {target_role} role>,
  "missingKeywords": ["keyword 1", "keyword 2"],
  "resumeWeaknesses": ["specific weakness 1", "specific weakness 2"],
  "improvedBullets": [
    {{"original": "a real bullet from the resume", "improved": "rewritten bullet", "reason": "why it's better"}}
  ],
  "recommendations": ["actionable recommendation 1", "actionable recommendation 2"]{gh_schema}
}}

Output RAW JSON ONLY — no markdown, no text outside the JSON object.
"""

    started = time.monotonic()
    logger.info("ats_report_started", resume_id=resume_id, role=target_role,
                chars=len(resume_text), github=bool(github))
    response = await asyncio.wait_for(
        get_llm().ainvoke([HumanMessage(content=prompt_str)]),
        timeout=cfg.LLM_REPORT_TIMEOUT,
    )
    raw = json_repair.loads(_strip_code_fences(response.content))
    report = _normalize_report(raw)
    report["role"] = target_role
    if github:
        # Factual data straight from the API; the LLM only supplies the prose review.
        report["developerProfile"] = {
            "github": github,
            "review": _normalize_dev_review(raw.get("developerProfile") if isinstance(raw, dict) else None),
        }

    db.resumes.update_one({"_id": resume_id, "user_id": user_id}, {"$set": {"ats_report": report}})
    logger.info("ats_report_ok", resume_id=resume_id, role=target_role,
                ats_score=report["atsScore"], github=bool(github),
                latency_ms=int((time.monotonic() - started) * 1000))
    return report
