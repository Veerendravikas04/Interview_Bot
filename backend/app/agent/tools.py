import os
import time
import structlog
import httpx
from datetime import datetime, timezone
from uuid import uuid4
from langchain_core.tools import tool
from app.db.client import get_db
from app.db import repositories as repo
from app.core import config as cfg

logger = structlog.get_logger(__name__)

from langchain_core.runnables import RunnableConfig
from app.services.github_service import fetch_github_profile, extract_github_username, format_profile_summary


@tool
def github_profile(query: str, config: RunnableConfig = None) -> str:
    """Fetch and review a candidate's PUBLIC GitHub profile.

    Call this whenever the user shares a GitHub URL or username (e.g.
    "https://github.com/octocat" or "octocat") and asks you to look at their
    GitHub, repos, activity, contributions, or how to improve it. It returns
    FACTUAL public data (repos, languages, stars, recent activity, streak) — use
    those real numbers in your review; never invent commits, stars, or streaks.
    Pass the github.com URL or the bare username as `query`.
    """
    thread_id = (config or {}).get("configurable", {}).get("thread_id") if config else None
    logger.info("tool_call", tool="github_profile", thread_id=thread_id, query=query)
    username = extract_github_username(query)
    if not username:
        return "No valid GitHub username or github.com URL was provided. Ask the user for their GitHub link."
    profile = fetch_github_profile(username)
    if not profile:
        return (f"Couldn't fetch the GitHub profile for '{username}' — it may not exist, be private, or GitHub is "
                "rate-limited right now. Ask the user to confirm their GitHub username.")
    return format_profile_summary(profile)


def _ws_artifact(query: str, results: list | None = None, error: str | None = None) -> dict:
    """The machine-readable half of web_search's return. The WS layer reads this
    (ToolMessage.artifact) to drive the 'Reasoning' card — query, the source list
    (title + url), and an error marker. The LLM never sees it; it gets the text."""
    srcs = [
        {"title": (r.get("title") or "").strip(), "url": (r.get("url") or "").strip()}
        for r in (results or [])
        if (r.get("url") or "").strip()
    ]
    return {"query": query, "results": srcs, "count": len(srcs), "error": error}


@tool("web_search", response_format="content_and_artifact")
def web_search(query: str, config: RunnableConfig = None):
    """Search the live web for up-to-date information.

    Use this for anything you cannot answer reliably from your own knowledge or
    the conversation: current events, recent news, prices, dates, releases,
    company/role/market facts, library versions, or anything that may have
    changed after your training. Do NOT use it for the candidate's resume
    (that is already in context) or for things you already know confidently.
    Pass a focused natural-language query and ground your reply in the results.

    Returns (text_for_model, artifact) — content_and_artifact: the model reads the
    text; the WS layer reads the artifact to render the live source list.
    """
    thread_id = (config or {}).get("configurable", {}).get("thread_id") if config else None
    logger.info("tool_call", tool="web_search", thread_id=thread_id, query=query)

    api_key = os.environ.get("TAVILY_API_KEY", "").strip()
    if not api_key:
        # Misconfiguration, not a model error — log loudly, fail soft to the model.
        logger.error("web_search_missing_key", thread_id=thread_id)
        return ("Web search is unavailable (the TAVILY_API_KEY is not configured on the server). "
                "Answer from what you already know, and tell the user live search is currently unavailable.",
                _ws_artifact(query, error="missing_key"))

    payload = {
        "api_key": api_key,
        "query": query,
        "max_results": cfg.TAVILY_MAX_RESULTS,
        "search_depth": cfg.TAVILY_SEARCH_DEPTH,
    }

    started = time.monotonic()
    try:
        resp = httpx.post(cfg.TAVILY_URL, json=payload, timeout=cfg.TAVILY_TIMEOUT)
    except httpx.TimeoutException:
        logger.warning("web_search_failed", thread_id=thread_id, reason="timeout",
                       timeout=cfg.TAVILY_TIMEOUT, query=query)
        return ("Web search timed out. Tell the user search is slow right now and answer from what you know.",
                _ws_artifact(query, error="timeout"))
    except Exception as e:  # network/DNS/etc. — never crash the graph
        logger.warning("web_search_failed", thread_id=thread_id, reason="request_error",
                       error=str(e), query=query)
        return ("Web search failed to reach the provider. Answer from what you know and note search is unavailable.",
                _ws_artifact(query, error="request_error"))

    latency_ms = int((time.monotonic() - started) * 1000)

    if resp.status_code != 200:
        logger.warning("web_search_failed", thread_id=thread_id, reason="http_error",
                       status=resp.status_code, body=resp.text[:300], query=query)
        if resp.status_code in (401, 403):
            return ("Web search rejected the API key (auth error). Tell the user live search is misconfigured.",
                    _ws_artifact(query, error="auth"))
        if resp.status_code == 429:
            return ("Web search is rate-limited right now. Answer from what you know and note search is temporarily unavailable.",
                    _ws_artifact(query, error="rate_limited"))
        return ("Web search returned an error. Answer from what you know and note search is unavailable.",
                _ws_artifact(query, error="http_error"))

    try:
        results = resp.json().get("results", []) or []
    except Exception as e:
        logger.warning("web_search_failed", thread_id=thread_id, reason="bad_json",
                       error=str(e), query=query)
        return ("Web search returned an unreadable response. Answer from what you know.",
                _ws_artifact(query, error="bad_json"))

    if not results:
        logger.info("web_search_ok", thread_id=thread_id, results=0,
                    latency_ms=latency_ms, query=query)
        return (f'No web results found for "{query}". Say so plainly; do not invent an answer.',
                _ws_artifact(query, results=[]))

    lines = [f'Live web results for "{query}" (cite the sources you use):', ""]
    for i, r in enumerate(results, 1):
        title = (r.get("title") or "Untitled").strip()
        url = (r.get("url") or "").strip()
        content = " ".join((r.get("content") or "").split())
        lines.append(f"{i}. {title}\n   {url}\n   {content}")
    formatted = "\n".join(lines)[: cfg.TAVILY_MAX_CHARS]

    logger.info("web_search_ok", thread_id=thread_id, results=len(results),
                latency_ms=latency_ms, query=query)
    return formatted, _ws_artifact(query, results=results)

@tool
def get_resume_text(config: RunnableConfig) -> str:
    """Gets the extracted text of the candidate's resume for the current thread."""
    user_id = config["configurable"]["user_id"]
    thread_id = config["configurable"]["thread_id"]
    logger.info("tool_call", tool="get_resume_text", thread_id=thread_id)
    thread = repo.get_thread(user_id, thread_id)
    if not thread or not thread.get("resume_id"):
        return "No resume provided."
    resume = repo.get_resume(user_id, thread.get("resume_id"))
    return resume.get("extracted_text", "No resume content found.") if resume else "No resume found."

@tool
def list_asked_questions(config: RunnableConfig) -> str:
    """Lists the topics/questions already asked in this thread to avoid repeating them."""
    user_id = config["configurable"]["user_id"]
    thread_id = config["configurable"]["thread_id"]
    logger.info("tool_call", tool="list_asked_questions", thread_id=thread_id)
    thread = repo.get_thread(user_id, thread_id)
    if not thread:
        return "No questions asked yet."
    questions = thread.get("asked_questions", [])
    if not questions:
        return "No questions asked yet."
    return "\n".join([f"Round {q.get('round')}: {q.get('question')}" for q in questions])

from pydantic import BaseModel, Field

class RecordRoundGradeInput(BaseModel):
    round_num: int = Field(description="The current round number.")
    round_type: str = Field(description="Must be exactly one of: 'project', 'technical', 'coding', 'design', 'behavioral'.")
    question: str = Field(description="The question asked.")
    grade: str = Field(description="Performance grade. Must be exactly one of: 'correct', 'partial', 'wrong'.")
    feedback_summary: str = Field(description="Brief summary of feedback for the candidate.")

@tool("record_round_grade", args_schema=RecordRoundGradeInput)
def record_round_grade(round_num: int, round_type: str, question: str, grade: str, feedback_summary: str, config: RunnableConfig) -> str:
    """
    Records the performance grade for the candidate's last answer.
    This tool MUST be called during the 'act' step.
    """
    user_id = config["configurable"]["user_id"]
    thread_id = config["configurable"]["thread_id"]
    logger.info("tool_call", tool="record_round_grade", thread_id=thread_id, round=round_num, grade=grade)
    
    valid_types = ['project', 'technical', 'coding', 'design', 'behavioral']
    valid_grades = ['correct', 'partial', 'wrong']
    
    if str(round_type).lower() not in valid_types or str(grade).lower() not in valid_grades:
        logger.info("invalid_enum_skipped", round_type=round_type, grade=grade)
        return "Grade skipped (no previous answer to grade, or invalid enum)."
        
    db = get_db()
    
    db.round_grades.update_one(
        {"thread_id": thread_id, "round": round_num},
        {
            "$set": {
                "user_id": user_id,
                "round_type": str(round_type).lower(),
                "question": question,
                "grade": str(grade).lower(),
                "feedback_summary": feedback_summary,
                "created_at": datetime.now(timezone.utc).isoformat()
            },
            "$setOnInsert": {
                "_id": str(uuid4())
            }
        },
        upsert=True
    )
    
    db.threads.update_one(
        {"_id": thread_id, "user_id": user_id},
        {"$push": {"asked_questions": {"round": round_num, "question": question}}}
    )
    
    return "Grade recorded successfully."

@tool
def record_hint_given(config: RunnableConfig) -> str:
    """Records that a hint was given, adding a penalty to the final score."""
    user_id = config["configurable"]["user_id"]
    thread_id = config["configurable"]["thread_id"]
    logger.info("tool_call", tool="record_hint_given", thread_id=thread_id)
    db = get_db()
    db.threads.update_one(
        {"_id": thread_id, "user_id": user_id},
        {"$inc": {"counters.hints_used": 1}}
    )
    return "Hint penalty applied."

# Active agent tools. The current pool model (Groq llama-3.3-70b-versatile, see
# core/llm.py) emits native tool_calls, so enabling tools no longer leaks tool
# syntax into the chat.
#   • web_search       — live, post-cutoff knowledge the model genuinely lacks.
#   • github_profile   — fetch + review a candidate's public GitHub when they
#     share a URL/username (repos, stars, streak, activity). Factual data only.
#   • record_round_grade — persists per-question grades during a mock interview;
#     the system prompt (prompts/agent.md) instructs the model to call it, and
#     services/report.py reads round_grades to build the final report. Without it
#     enabled the prompt would reference a non-existent tool.
#
# get_resume_text / list_asked_questions / record_hint_given stay OFF: the resume
# and full conversation are already in context, so the model doesn't need them.
agent_tools = [web_search, github_profile, record_round_grade]
