"""Logging configuration.

App logs use structlog's human-readable ConsoleRenderer:
    2026-06-16T14:55:37.992888Z [info     ] request_started   func_name=dispatch lineno=42 module=middleware method=GET path=/api/threads/

uvicorn keeps its own standard logging format:
    2026-06-16 20:25:38,320 - uvicorn.access - INFO - 127.0.0.1 - "GET /api/threads/ HTTP/1.1" 200

Every line is also mirrored into `logs.txt` at the backend root (opened in
write/truncate mode at startup, ANSI stripped) so each (re)start gives a clean,
greppable log of the whole run to tail — the same pattern as Project Sophia.
"""
import logging
import sys
from pathlib import Path

import structlog

# logs.txt lives at the backend root (…/backend/logs.txt) regardless of CWD.
LOG_FILE = Path(__file__).resolve().parent.parent.parent / "logs.txt"

SHARED_PROCESSORS = [
    structlog.contextvars.merge_contextvars,
    structlog.stdlib.add_log_level,
    structlog.processors.TimeStamper(fmt="iso", utc=True),
    structlog.processors.CallsiteParameterAdder(
        {
            structlog.processors.CallsiteParameter.FUNC_NAME,
            structlog.processors.CallsiteParameter.LINENO,
            structlog.processors.CallsiteParameter.MODULE,
        }
    ),
    structlog.processors.StackInfoRenderer(),
    structlog.processors.format_exc_info,
]


def setup_logging():
    structlog.configure(
        processors=SHARED_PROCESSORS + [
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    # Pretty, colored console renderer for our app logs (terminal).
    console_formatter = structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=SHARED_PROCESSORS,
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            structlog.dev.ConsoleRenderer(colors=True),
        ],
    )
    app_handler = logging.StreamHandler(sys.stdout)
    app_handler.setFormatter(console_formatter)

    # Same render, no ANSI — mirrored into logs.txt (truncated each startup) so
    # the whole run is tailable/greppable in one plain-text file (Sophia pattern).
    file_formatter = structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=SHARED_PROCESSORS,
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            structlog.dev.ConsoleRenderer(colors=False),
        ],
    )
    file_handler = logging.FileHandler(LOG_FILE, mode="w", encoding="utf-8")
    file_handler.setFormatter(file_formatter)

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(app_handler)
    root.addHandler(file_handler)
    root.setLevel(logging.INFO)

    # uvicorn keeps its own standard logging format (separate from structlog),
    # mirrored to the same logs.txt so requests + app logs sit together.
    uvicorn_formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
    uvicorn_handler = logging.StreamHandler(sys.stdout)
    uvicorn_handler.setFormatter(uvicorn_formatter)
    uvicorn_file_handler = logging.FileHandler(LOG_FILE, mode="a", encoding="utf-8")
    uvicorn_file_handler.setFormatter(uvicorn_formatter)
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        lg = logging.getLogger(name)
        lg.handlers.clear()
        lg.addHandler(uvicorn_handler)
        lg.addHandler(uvicorn_file_handler)
        lg.propagate = False

    # Quiet noisy libraries — the raw per-request httpx/httpcore INFO lines just
    # clutter the stream; our own structured tool logs (e.g. web_search_ok with
    # latency_ms) are the signal we actually want.
    for noisy in ("httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
