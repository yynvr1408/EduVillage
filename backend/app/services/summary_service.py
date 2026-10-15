import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError
from app.db.base import utcnow
from app.db.models.classroom import Class
from app.db.models.enums import JobStatus, JobType, SummaryStatus, TranscriptStatus, UserRole
from app.db.models.summary import BackgroundJob, LectureSummary, LectureTranscript
from app.db.models.user import User
from app.db.session import SessionLocal
from app.integrations import llm_provider
from app.services import classroom_service

logger = logging.getLogger(__name__)


def request_summary(db: Session, user: User, cls: Class, *, transcript_text: str | None, resource_id: str | None) -> BackgroundJob:
    classroom_service.assert_can_view_class(db, user, cls)
    if not transcript_text and not resource_id:
        raise ConflictError("Provide either transcript_text or resource_id.", code="MISSING_TRANSCRIPT_SOURCE")

    transcript = LectureTranscript(
        class_id=cls.id,
        resource_id=resource_id,
        content=transcript_text,
        status=TranscriptStatus.ready if transcript_text else TranscriptStatus.pending,
    )
    db.add(transcript)
    db.flush()

    summary = LectureSummary(class_id=cls.id, transcript_id=transcript.id, status=SummaryStatus.queued)
    db.add(summary)

    job = BackgroundJob(job_type=JobType.summary_generation, status=JobStatus.queued, reference_id=None)
    db.add(job)
    db.flush()
    job.reference_id = summary.id
    db.commit()
    db.refresh(job)
    return job


def process_summary_job(job_id: str) -> None:
    """Runs in a FastAPI BackgroundTask with its own DB session — the request session is
    already closed by the time this executes."""
    db = SessionLocal()
    try:
        job = db.get(BackgroundJob, job_id)
        if not job:
            return
        job.status = JobStatus.processing
        job.attempts += 1
        db.commit()

        summary = db.get(LectureSummary, job.reference_id)
        transcript = db.get(LectureTranscript, summary.transcript_id) if summary else None

        if not summary or not transcript:
            job.status = JobStatus.failed
            job.error_code = "MISSING_RECORDS"
            db.commit()
            return

        if transcript.status != TranscriptStatus.ready:
            if not transcript.resource_id:
                job.status = JobStatus.failed
                job.error_code = "NO_TRANSCRIPT_SOURCE"
                db.commit()
                return
            from app.integrations import speech_to_text
            from app.integrations.object_storage import LocalObjectStorage, get_storage
            from app.db.models.lesson import LearningResource

            resource = db.get(LearningResource, transcript.resource_id)
            storage = get_storage()
            if not resource or not isinstance(storage, LocalObjectStorage):
                job.status = JobStatus.failed
                job.error_code = "TRANSCRIPTION_UNAVAILABLE"
                db.commit()
                return
            transcript.content = speech_to_text.transcribe(storage.read_path(resource.storage_key))
            transcript.status = TranscriptStatus.ready
            db.commit()

        content = llm_provider.generate_summary(transcript.content or "")
        summary.content_json = content
        summary.status = SummaryStatus.needs_review
        job.status = JobStatus.completed
        job.completed_at = utcnow()
        db.commit()
    except Exception as exc:  # pragma: no cover - defensive catch-all for background execution
        logger.exception("summary job %s failed", job_id)
        db.rollback()
        job = db.get(BackgroundJob, job_id)
        if job:
            job.status = JobStatus.failed
            job.error_code = "UNEXPECTED_ERROR"
            db.commit()
    finally:
        db.close()


def get_job_or_404(db: Session, job_id: str) -> BackgroundJob:
    job = db.get(BackgroundJob, job_id)
    if not job:
        raise NotFoundError("Job not found.")
    return job


def get_summary_for_class(db: Session, user: User, cls: Class) -> LectureSummary:
    classroom_service.assert_can_view_class(db, user, cls)
    summary = db.execute(
        select(LectureSummary).where(LectureSummary.class_id == cls.id).order_by(LectureSummary.created_at.desc())
    ).scalars().first()
    if not summary:
        raise NotFoundError("No summary has been generated for this class yet.")

    is_teacher = user.role == UserRole.teacher and cls.teacher_id == user.id
    if not is_teacher and summary.status != SummaryStatus.completed:
        raise NotFoundError("No approved summary is available for this class yet.")
    return summary


def approve_summary(db: Session, teacher: User, summary: LectureSummary) -> LectureSummary:
    cls = db.get(Class, summary.class_id)
    classroom_service.assert_teaches_class(teacher, cls)
    if summary.status != SummaryStatus.needs_review:
        raise ConflictError(f"Cannot approve a summary in status '{summary.status.value}'.")
    summary.status = SummaryStatus.completed
    summary.reviewed_by = teacher.id
    summary.reviewed_at = utcnow()
    db.commit()
    db.refresh(summary)
    return summary


def request_changes(db: Session, teacher: User, summary: LectureSummary) -> LectureSummary:
    cls = db.get(Class, summary.class_id)
    classroom_service.assert_teaches_class(teacher, cls)
    summary.status = SummaryStatus.queued
    summary.reviewed_by = teacher.id
    summary.reviewed_at = utcnow()
    db.commit()
    db.refresh(summary)
    return summary
