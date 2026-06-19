import os
import re
import time
import uuid
import asyncio
import structlog
import jwt
from datetime import datetime, timezone
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from langchain_core.runnables import RunnableConfig

from app.db.client import get_db
from app.core.security import JWT_SECRET, ALGORITHM
from app.agent.graph import graph
from app.core.context import build_context, trigger_summary_if_needed, maybe_generate_title
from app.db import repositories as repo

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/api/ws", tags=["websocket"])

PROMPT_PATH = os.path.join(os.path.dirname(__file__), "..", "prompts", "agent.md")

TOOL_STATUS = {
    "get_resume_text": "Reading your resume…",
    "list_asked_questions": "Reviewing what we've covered…",
    "record_round_grade": "Noting your performance…",
    "web_search": "Searching the web…",
    "github_profile": "Checking your GitHub…",
}


def _now():
    return datetime.now(timezone.utc).isoformat()


_TOOL_NAMES = r"(?:list_asked_questions|get_resume_text|record_round_grade|function|tool_call|invoke|parameter)"


def _clean_reply(text: str) -> str:
    """Defensively strip artifacts a small model can emit as text: leaked tool-call
    tags/syntax and standby filler. The agent runs tool-less, but this guarantees a
    clean chat even if the model hallucinates tool syntax."""
    if not text:
        return ""
    import re
    # <list_asked_questions>...</list_asked_questions>, <|function...|>, <invoke ...> etc.
    text = re.sub(rf"<\|?/?\s*{_TOOL_NAMES}[^>]*\|?>", "", text, flags=re.IGNORECASE)
    # stray "*list_asked_questions>" / "[record_round_grade]" / "record_round_grade(...)"
    text = re.sub(rf"[*\[(]?\s*\b{_TOOL_NAMES}\b\s*\([^)]*\)", "", text, flags=re.IGNORECASE)
    text = re.sub(rf"[*\[(]?\s*\b{_TOOL_NAMES}\b\s*[>\])]?", "", text, flags=re.IGNORECASE)
    # standby / waiting filler
    text = re.sub(r"\(?\s*waiting for your response\s*[.…]*\s*\)?", "", text, flags=re.IGNORECASE)
    text = re.sub(r"(?im)^\s*also,?\s*i'?ll list the questions already asked.*$", "", text)
    # collapse excess blank lines left behind
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _load_system_prompt():
    try:
        with open(PROMPT_PATH, "r", encoding="utf-8") as f:
            return f.read()
    except Exception:
        return "You are Caliber, a senior engineer who reviews resumes and runs mock interviews."


@router.websocket("/threads/{thread_id}")
async def websocket_endpoint(websocket: WebSocket, thread_id: str, token: str = Query(...)):
    # 1. Verify token BEFORE accept
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            await websocket.close(code=4401)
            return
    except Exception as e:
        logger.warning("ws_auth_failed", error=str(e))
        await websocket.close(code=4401)
        return

    # 2. Verify thread ownership (scoped + soft-delete aware)
    thread = repo.get_thread(user_id, thread_id)
    if not thread:
        logger.warning("ws_thread_unauthorized", thread_id=thread_id)
        await websocket.close(code=4401)
        return

    await websocket.accept()
    structlog.contextvars.bind_contextvars(user_id=user_id, thread_id=thread_id)
    logger.info("ws_connected")

    queue = asyncio.Queue()

    # Consumer: drains the queue to the socket, with a 15s heartbeat ping.
    async def consumer():
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15.0)
                    if event is None:
                        break
                    await websocket.send_json(event)
                except asyncio.TimeoutError:
                    await websocket.send_json({"event_type": "ping", "thread_id": thread_id, "data": {}})
        except Exception as e:
            logger.error("ws_consumer_error", error=str(e))

    consumer_task = asyncio.create_task(consumer())

    try:
        while True:
            data = await websocket.receive_json()
            if data.get("action") != "answer":
                continue
            text = (data.get("text") or "").strip()
            if not text:
                continue

            # Persist the user message first (so nothing is lost if we crash).
            attach_meta = None
            rid = data.get("resume_id")
            if rid:
                r = repo.get_resume(user_id, rid)
                if r:
                    attach_meta = {"attachment": {"resume_id": rid, "filename": r.get("filename")}}
            repo.insert_message(thread_id, user_id, "user", text, metadata=attach_meta)

            thread_fresh = repo.get_thread(user_id, thread_id)
            if not thread_fresh:
                continue
            repo.update_thread(user_id, thread_id, {} if thread_fresh.get("title") else {"title": text[:40]})

            # Assemble context: system prompt + summary + history + dynamic (resume) + current turn.
            system_prompt = _load_system_prompt()
            all_msgs = repo.list_messages(thread_id, user_id)
            history_msgs = all_msgs[:-1] if all_msgs else []

            resume = repo.get_resume(user_id, thread_fresh["resume_id"]) if thread_fresh.get("resume_id") else None

            if resume:
                resume_ids = thread_fresh.get("resume_ids") or []
                multi_note = ""
                if len(resume_ids) > 1:
                    multi_note = (
                        f"\n\nNOTE: The user has uploaded {len(resume_ids)} resumes in this chat. "
                        f"The text below is the MOST RECENT one ('{resume.get('filename', 'resume')}'). "
                        "Work with this latest resume by default; only refer to an earlier upload if the user explicitly asks about it."
                    )
                dynamic_context = (
                    "A resume IS attached to this conversation. Ground every claim in it.\n"
                    'Resume text:\n"""\n' + (resume.get("extracted_text", "")[:12000]) + '\n"""' + multi_note
                )
            else:
                dynamic_context = (
                    "CRITICAL — NO resume is attached to this conversation. You do NOT have the user's resume. "
                    "You therefore CANNOT review, score, or analyze a resume, and you must NOT invent or assume ANY "
                    "resume content, skills, experience, employers, or an ATS score. "
                    "If the user asks to review their resume, give an ATS score, or run a resume-grounded interview, "
                    "respond with ONE short line asking them to upload their resume with the 📎 button — do NOT output "
                    "a score, strengths, fixes, or any made-up resume review. "
                    "For general questions (not about their specific resume), answer normally."
                )

            messages = build_context(
                system_prompt=system_prompt,
                running_summary=thread_fresh.get("running_summary", ""),
                messages=history_msgs,
                dynamic_context=dynamic_context,
                current_answer=text,
            )

            state = {"messages": messages, "thread_id": thread_id, "user_id": user_id}
            config = RunnableConfig(
                configurable={"user_id": user_id, "thread_id": thread_id},
                recursion_limit=12,
            )

            async def run_graph():
                final_content = ""
                # ── Per-turn timing + accumulators (Sophia streaming-logs pattern) ──
                turn_started_at = time.monotonic()
                stream_chunks = 0                 # how many token deltas we streamed
                tool_starts: dict[str, float] = {}  # run_id → monotonic start (for ms)
                turn_tool_calls: list[dict] = []  # {tool, ms, status} per tool fired
                turn_usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}

                logger.info(
                    "ws_turn_started",
                    msg_chars=len(text),
                    history_msgs=len(history_msgs),
                    resume_attached=bool(resume),
                    resume_count=len(thread_fresh.get("resume_ids") or []),
                )
                try:
                    async for event in graph.astream_events(state, config, version="v2"):
                        kind = event["event"]
                        if kind == "on_chat_model_stream":
                            chunk = event["data"]["chunk"].content
                            if not chunk:
                                continue
                            if isinstance(chunk, str):
                                final_content += chunk
                                stream_chunks += 1
                                await queue.put({"event_type": "token", "thread_id": thread_id, "data": {"delta": chunk}})
                            elif isinstance(chunk, list):
                                for c in chunk:
                                    if isinstance(c, dict) and c.get("type") == "text":
                                        tv = c.get("text", "")
                                        final_content += tv
                                        stream_chunks += 1
                                        await queue.put({"event_type": "token", "thread_id": thread_id, "data": {"delta": tv}})
                        elif kind == "on_tool_start":
                            name = event.get("name", "")
                            run_id = event.get("run_id", "")
                            tool_starts[run_id] = time.monotonic()
                            tool_input = event.get("data", {}).get("input", {}) or {}
                            query = tool_input.get("query") if isinstance(tool_input, dict) else None
                            logger.info("tool_started", tool=name, run_id=run_id, query=query)
                            # Live "Reasoning" card: tool_call opens a step in the card.
                            await queue.put({
                                "event_type": "tool_call",
                                "thread_id": thread_id,
                                "data": {"call_id": run_id, "tool": name, "query": query},
                            })
                            # Back-compat: plain status line for any client not rendering the card.
                            await queue.put({
                                "event_type": "status",
                                "thread_id": thread_id,
                                "data": {"message": TOOL_STATUS.get(name, f"Working ({name})…")},
                            })
                        elif kind == "on_tool_end":
                            name = event.get("name", "")
                            run_id = event.get("run_id", "")
                            start = tool_starts.pop(run_id, None)
                            ms = int((time.monotonic() - start) * 1000) if start else None
                            out = event.get("data", {}).get("output")
                            # web_search is content_and_artifact → structured sources live on .artifact.
                            artifact = getattr(out, "artifact", None) or {}
                            sources = artifact.get("results", []) if isinstance(artifact, dict) else []
                            status = "error" if (isinstance(artifact, dict) and artifact.get("error")) else "ok"
                            logger.info("tool_finished", tool=name, run_id=run_id, ms=ms,
                                        status=status, sources=len(sources))
                            turn_tool_calls.append({"tool": name, "ms": ms, "status": status,
                                                    "sources": len(sources)})
                            # Close the step on the card, then fan out the searched sources.
                            await queue.put({
                                "event_type": "tool_result",
                                "thread_id": thread_id,
                                "data": {"call_id": run_id, "tool": name, "status": status,
                                         "ms": ms, "count": len(sources)},
                            })
                            for s in sources:
                                await queue.put({
                                    "event_type": "source_found",
                                    "thread_id": thread_id,
                                    "data": {"call_id": run_id, "url": s.get("url"), "title": s.get("title")},
                                })
                        elif kind == "on_chat_model_end":
                            out = event.get("data", {}).get("output")
                            usage = getattr(out, "usage_metadata", None) or {}
                            rmeta = getattr(out, "response_metadata", None) or {}
                            for k in ("input_tokens", "output_tokens", "total_tokens"):
                                v = usage.get(k)
                                if isinstance(v, int):
                                    turn_usage[k] += v
                            logger.info(
                                "chat_model_end",
                                model=rmeta.get("model_name"),
                                finish_reason=rmeta.get("finish_reason"),
                                input_tokens=usage.get("input_tokens"),
                                output_tokens=usage.get("output_tokens"),
                            )

                    # Defensive cleanup of any leaked tool syntax / standby filler.
                    final_content = _clean_reply(final_content)
                    if not final_content:
                        final_content = "Sorry — I couldn't generate a response. Please try again."
                        logger.warning("ws_empty_reply", stream_chunks=stream_chunks,
                                       n_tool_calls=len(turn_tool_calls))

                    asst = repo.insert_message(thread_id, user_id, "assistant", final_content)
                    msg_id = asst["_id"]
                    repo.update_thread(user_id, thread_id, {})  # bump updated_at

                    await queue.put({
                        "event_type": "message_complete",
                        "thread_id": thread_id,
                        "data": {"message_id": msg_id, "content": final_content},
                    })

                    # One-line per-turn summary (Sophia `turn_persisted` analog): the
                    # whole turn's cost + shape at a glance, no log-trawling needed.
                    logger.info(
                        "turn_completed",
                        message_id=msg_id,
                        reply_chars=len(final_content),
                        stream_chunks=stream_chunks,
                        n_tool_calls=len(turn_tool_calls),
                        tools=[t["tool"] for t in turn_tool_calls],
                        input_tokens=turn_usage["input_tokens"],
                        output_tokens=turn_usage["output_tokens"],
                        latency_ms=int((time.monotonic() - turn_started_at) * 1000),
                    )

                    # Auto-name the conversation from the first exchange.
                    new_title = await maybe_generate_title(thread_id, user_id)
                    if new_title:
                        await queue.put({
                            "event_type": "title_update",
                            "thread_id": thread_id,
                            "data": {"title": new_title},
                        })

                    # Background, non-blocking: roll up older messages once over threshold.
                    fresh = repo.get_thread(user_id, thread_id)
                    msg_count = repo.count_messages(thread_id, user_id)
                    trigger_summary_if_needed(thread_id, user_id, msg_count, (fresh or {}).get("summary_covers_until", 0))
                except Exception as e:
                    logger.error(
                        "graph_execution_failed",
                        error=str(e),
                        error_type=type(e).__name__,
                        stream_chunks=stream_chunks,
                        n_tool_calls=len(turn_tool_calls),
                        latency_ms=int((time.monotonic() - turn_started_at) * 1000),
                    )
                    await queue.put({
                        "event_type": "error",
                        "thread_id": thread_id,
                        "data": {"error": True, "code": "GRAPH_ERROR", "message": "The assistant hit an error. Please try again."},
                    })

            asyncio.create_task(run_graph())

    except WebSocketDisconnect:
        logger.info("ws_disconnected")
    except Exception as e:
        logger.error("ws_error", error=str(e))
    finally:
        await queue.put(None)
        await consumer_task
