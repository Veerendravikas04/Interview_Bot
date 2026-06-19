"""Main application entry point."""
from dotenv import load_dotenv
load_dotenv()

import os
import traceback
import structlog
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from app.core.errors import AppError
from app.api.auth import router as auth_router
from app.api.ws import router as ws_router
from app.core.logging import setup_logging
from app.core.middleware import TraceMiddleware

setup_logging()

logger = structlog.get_logger(__name__)

app = FastAPI(title="Interview Bot v2")

app.add_middleware(TraceMiddleware)

# CORS origins come from env (comma-separated CORS_ORIGINS), so prod locks down to
# real frontends while dev keeps localhost working. Credentialed requests can't use
# a "*" wildcard per the CORS spec, so we always send an explicit allow-list.
_cors_env = os.environ.get("CORS_ORIGINS", "").strip()
CORS_ORIGINS = [o.strip() for o in _cors_env.split(",") if o.strip()] or [
    "http://localhost:3000", "http://127.0.0.1:3000",
    "http://localhost:5173", "http://127.0.0.1:5173",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
logger.info("cors_configured", origins=CORS_ORIGINS)

def get_trace_id():
    return structlog.contextvars.get_contextvars().get("trace_id", "unknown")

@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": True, "code": exc.code, "message": exc.message, "trace_id": get_trace_id()}
    )

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error("unhandled_exception", error=str(exc), traceback=traceback.format_exc())
    return JSONResponse(
        status_code=500,
        content={"error": True, "code": "INTERNAL", "message": "An unexpected error occurred", "trace_id": get_trace_id()}
    )

from app.api.resumes import router as resumes_router
from app.api.threads import router as threads_router

app.include_router(auth_router)
app.include_router(ws_router)
app.include_router(resumes_router)
app.include_router(threads_router)
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
