import time
import json
import asyncio
import structlog
import json_repair
from typing import Dict, Any

from app.db.client import get_db
from app.db import repositories as repo
from app.core.llm import get_llm
from app.core import config as cfg
from app.services.scoring import compute_overall_score
from langchain_core.messages import HumanMessage

logger = structlog.get_logger(__name__)


async def generate_interview_report(user_id: str, thread_id: str) -> Dict[str, Any]:
    db = get_db()
    thread = repo.get_thread(user_id, thread_id)
    if not thread:
        raise ValueError("Thread not found")

    resume_id = thread.get("resume_id")
    resume = repo.get_resume(user_id, resume_id) if resume_id else {}
    resume_text = resume.get("extracted_text", "") if resume else ""

    round_grades = list(db.round_grades.find({"thread_id": thread_id}).sort("round", 1))
    counters = thread.get("counters", {"hints_used": 0, "tab_switches": 0})
    score_data = compute_overall_score(round_grades, counters.get("tab_switches", 0), counters.get("hints_used", 0))

    performance = json.dumps([
        {"round": g.get("round"), "type": g.get("round_type"), "question": g.get("question"),
         "grade": g.get("grade"), "feedback": g.get("feedback_summary")}
        for g in round_grades
    ])

    prompt_str = f"""
You are an elite Tech Lead and Hiring Manager evaluating a candidate.
Using the candidate's resume and their interview performance, generate a JSON report with deep insights.

CANDIDATE RESUME:
{resume_text[:cfg.RESUME_PROMPT_MAX_CHARS // 3]}

INTERVIEW PERFORMANCE:
{performance}

Generate a JSON response with EXACTLY these keys:
1. "finalVerdict": A 2-3 sentence executive summary of the candidate's performance.
2. "communicationFeedback": A paragraph evaluating their communication style.
3. "atsInsights": Markdown bullet points on how well their resume aligns with the role they targeted.
4. "skillGapAnalysis": Markdown bullet points on the skills they should strengthen, based on their answers and resume.
5. "learningRoadmap": Markdown of a week-by-week actionable plan to bridge their gaps.
6. "metrics": An object of integer scores (0-100): "projectMastery", "technicalDepth", "communication", "problemSolving".

Output RAW JSON ONLY — no markdown blocks, no text outside the JSON object.
"""

    started = time.monotonic()
    logger.info("interview_report_started", thread_id=thread_id, rounds=len(round_grades))
    base = score_data["base_score"]
    try:
        response = await asyncio.wait_for(
            get_llm().ainvoke([HumanMessage(content=prompt_str)]),
            timeout=cfg.LLM_REPORT_TIMEOUT,
        )
        content = response.content
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0].strip()
        elif "```" in content:
            content = content.split("```")[1].strip()
        ai_insights = json_repair.loads(content)
        if not isinstance(ai_insights, dict):
            raise ValueError("report model output was not a JSON object")
        logger.info("interview_report_ok", thread_id=thread_id,
                    latency_ms=int((time.monotonic() - started) * 1000))
    except Exception as e:
        # Degrade to the deterministic score (NOT fabricated insight text) so the
        # report endpoint still returns a usable verdict if the LLM call fails.
        logger.warning("interview_report_insights_failed", thread_id=thread_id,
                       error=str(e), error_type=type(e).__name__,
                       latency_ms=int((time.monotonic() - started) * 1000))
        ai_insights = {
            "finalVerdict": "Interview completed. Detailed AI insights are unavailable for this run.",
            "communicationFeedback": "Not evaluated.",
            "atsInsights": "Not evaluated.",
            "skillGapAnalysis": "Not evaluated.",
            "learningRoadmap": "Not evaluated.",
            "metrics": {"projectMastery": base, "technicalDepth": base,
                        "communication": base, "problemSolving": base},
        }

    question_breakdown = [{
        "correctness": g.get("grade", "wrong"),
        "question": g.get("question", ""),
        "candidateAnswer": "Recorded in chat.",
        "feedback": g.get("feedback_summary", ""),
        "detailedExplanation": "Refer to the conversation for the optimal solution.",
    } for g in round_grades]

    return {
        "overallScore": score_data["overall_score"],
        "finalVerdict": ai_insights.get("finalVerdict", "Completed."),
        "metrics": ai_insights.get("metrics", {}),
        "questionBreakdown": question_breakdown,
        "communicationFeedback": ai_insights.get("communicationFeedback", ""),
        "atsInsights": ai_insights.get("atsInsights", ""),
        "skillGapAnalysis": ai_insights.get("skillGapAnalysis", ""),
        "learningRoadmap": ai_insights.get("learningRoadmap", ""),
        "counters": counters,
    }
