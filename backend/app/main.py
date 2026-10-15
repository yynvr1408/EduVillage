import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.router import api_router
from app.config import get_settings
from app.core.exceptions import AppError, app_error_handler
from app.core.logging import configure_logging
from app.core.middleware import RequestIdMiddleware

configure_logging()
logger = logging.getLogger("eduvillage")

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if settings.is_production and settings.session_secret == "dev-secret-change-me":
        raise RuntimeError("SESSION_SECRET must be set to a real secret in production.")
    if settings.is_production and not settings.teacher_invite_code:
        logger.warning("TEACHER_INVITE_CODE is unset — teacher self-registration is closed in production.")
    if not settings.livekit_configured:
        logger.warning("LiveKit is not configured — classroom start/join endpoints will return 503.")
    if not settings.llm_configured:
        logger.warning("No LLM provider configured — lecture summaries will use the labeled stub provider.")
    from app.db.session import SessionLocal
    from app.services import admin_service

    with SessionLocal() as db:
        try:
            admin_service.bootstrap_admin(db)
        except Exception:  # a missing table (migrations not yet applied) must not stop the API from starting
            logger.exception("Administrator bootstrap failed.")
    yield


app = FastAPI(title="EduVillage API", lifespan=lifespan)

app.add_middleware(RequestIdMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # Browsers on another origin can only read these response headers if they are exposed; resumable
    # downloads need Content-Range to learn a file's real size and verify each chunk.
    expose_headers=["Content-Range", "Accept-Ranges", "X-Request-ID"],
)

app.add_exception_handler(AppError, app_error_handler)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc: RequestValidationError):
    request_id = getattr(request.state, "request_id", None)
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "VALIDATION_FAILED",
                "message": "Request validation failed.",
                "request_id": request_id,
                "details": {"errors": exc.errors()},
            }
        },
    )


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request, exc: StarletteHTTPException):
    request_id = getattr(request.state, "request_id", None)
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": "HTTP_ERROR", "message": str(exc.detail), "request_id": request_id, "details": {}}},
    )


app.include_router(api_router, prefix=settings.api_v1_prefix)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/ready")
def ready():
    from sqlalchemy import text

    from app.db.session import SessionLocal

    try:
        db = SessionLocal()
        db.execute(text("SELECT 1"))
        db.close()
        return {"status": "ready"}
    except Exception as exc:
        logger.error("readiness check failed: %s", type(exc).__name__)
        return JSONResponse(status_code=503, content={"status": "not_ready"})  # no internals in a public endpoint
