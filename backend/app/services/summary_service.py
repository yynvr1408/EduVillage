"""Transcript + AI-summary pipeline.

Requests only create rows (a transcript source, a summary, a BackgroundJob); the work runs in
`process_summary_job`, kicked off by the API's BackgroundTasks and — for durability across
restarts and for retries — by the standalone worker (`python -m app.worker`). Both go through
the same atomic claim, so a job can never be processed twice concurrently.
"""

import hashlib
import logging
import tempfile
from pathlib import Path

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.exceptions import AppError, ConflictError, NotFoundError
from app.db.base import utcnow
from app.db.models.classroom import Class, ClassRecording
from app.db.models.enums import JobStatus, JobType, RecordingStatus, SummaryStatus, TranscriptStatus, UserRole
from app.db.models.lesson import LearningResource
from app.db.models.summary import BackgroundJob, LectureSummary, LectureTranscript
from app.db.models.user import User
from app.db.session import SessionLocal
from app.integrations import llm_provider
from app.integrations.object_storage import get_storage
from app.services import audit_service, classroom_service, course_service, transcription_service

logger = logging.getLogger(__name__)
settings = get_settings()

# Failures worth retrying automatically; configuration errors (e.g. no STT key) are not.
RETRYABLE_ERROR_CODES = {"UNEXPECTED_ERROR", "LLM_ERROR", "STT_CHUNK_FAILED", "MEDIA_TIMEOUT"}


def _source_hash(transcript_text: str | None, resource_id: str | None, recording_id: str | None) -> str:
    key = transcript_text.strip() if transcript_text else f"resource:{resource_id}|recording:{recording_id}"
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def _latest_job_for(db: Session, summary_id: str) -> BackgroundJob | None:
    return db.execute(
        select(BackgroundJob)
        .where(BackgroundJob.reference_id == summary_id, BackgroundJob.job_type == JobType.summary_generation)
        .order_by(BackgroundJob.created_at.desc())
    ).scalars().first()


def _queue_summary_job(
    db: Session, cls: Class, *, transcript_text: str | None, resource_id: str | None, recording_id: str | None
) -> BackgroundJob:
    """Shared core for both the teacher-initiated and the automatic (recording-ready) paths.
    Idempotent per source: asking again for the same transcript/recording returns the existing
    job instead of creating (and paying for) a duplicate."""
    if not transcript_text and not resource_id and not recording_id:
        raise ConflictError("Provide transcript_text, resource_id or a recording.", code="MISSING_TRANSCRIPT_SOURCE")

    if recording_id:
        recording = db.get(ClassRecording, recording_id)
        if not recording or recording.class_id != cls.id:
            raise NotFoundError("Recording not found for this class.")
        if not transcript_text and recording.status != RecordingStatus.available:
            raise ConflictError("The recording must be ready before it can be transcribed.", code="RECORDING_NOT_READY")

    content_hash = _source_hash(transcript_text, resource_id, recording_id)
    duplicate = db.execute(
        select(LectureSummary)
        .join(LectureTranscript, LectureTranscript.id == LectureSummary.transcript_id)
        .where(
            LectureSummary.class_id == cls.id,
            LectureTranscript.content_hash == content_hash,
            LectureSummary.status != SummaryStatus.failed,
        )
    ).scalars().first()
    if duplicate is not None:
        existing_job = _latest_job_for(db, duplicate.id)
        if existing_job is not None:
            return existing_job

    transcript = LectureTranscript(
        class_id=cls.id,
        resource_id=resource_id,
        recording_id=recording_id,
        content=transcript_text,
        content_hash=content_hash,
        status=TranscriptStatus.ready if transcript_text else TranscriptStatus.pending,
    )
    db.add(transcript)
    db.flush()

    summary = LectureSummary(class_id=cls.id, transcript_id=transcript.id, recording_id=recording_id, status=SummaryStatus.queued)
    db.add(summary)
    db.flush()

    job = BackgroundJob(job_type=JobType.summary_generation, status=JobStatus.queued, reference_id=summary.id)
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def request_summary(
    db: Session,
    user: User,
    cls: Class,
    *,
    transcript_text: str | None,
    resource_id: str | None,
    recording_id: str | None = None,
) -> BackgroundJob:
    """Teacher-initiated summary generation."""
    classroom_service.assert_teaches_class(db, user, cls)
    return _queue_summary_job(db, cls, transcript_text=transcript_text, resource_id=resource_id, recording_id=recording_id)


def auto_request_summary_for_recording(db: Session, recording: ClassRecording) -> BackgroundJob | None:
    """System-triggered: called the moment a recording finalizes to `available`, so a summary is
    ready for students without a teacher having to remember to click anything. No teacher-auth
    check (nothing initiated this besides the recording becoming ready) — everything else is
    identical to the manual path, including the idempotency guard, so a webhook replay or a
    concurrent poll-refresh can never double-queue the same recording."""
    cls = db.get(Class, recording.class_id)
    if cls is None:
        return None
    try:
        return _queue_summary_job(db, cls, transcript_text=None, resource_id=None, recording_id=recording.id)
    except (ConflictError, NotFoundError):
        # Nothing to transcribe, or the recording isn't really ready after all — stay silent;
        # a teacher can still request one manually later, same as for a recording that never
        # auto-triggered.
        return None


def _claim(db: Session, job_id: str) -> bool:
    """Atomic queued -> processing transition: only one worker/task wins."""
    result = db.execute(
        update(BackgroundJob)
        .where(BackgroundJob.id == job_id, BackgroundJob.status == JobStatus.queued)
        .values(status=JobStatus.processing, attempts=BackgroundJob.attempts + 1, updated_at=utcnow())
    )
    db.commit()
    return result.rowcount == 1


def _transcribe(db: Session, transcript: LectureTranscript) -> str:
    """Speech-to-text from the stored recording or uploaded audio/video resource."""
    storage_key = None
    if transcript.recording_id:
        recording = db.get(ClassRecording, transcript.recording_id)
        storage_key = recording.storage_key if recording else None
    elif transcript.resource_id:
        resource = db.get(LearningResource, transcript.resource_id)
        storage_key = resource.storage_key if resource else None
    if not storage_key:
        raise AppError("No stored media to transcribe.", code="NO_TRANSCRIPT_SOURCE")

    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        media = get_storage().fetch_to_path(storage_key, work / "source")
        return transcription_service.transcribe_recording(db, transcript, media, work)


def process_summary_job(job_id: str) -> None:
    """Runs with its own DB session (the request session is closed by the time a background
    task executes)."""
    db = SessionLocal()
    try:
        if not _claim(db, job_id):
            return  # someone else has it, or it's already finished

        job = db.get(BackgroundJob, job_id)
        summary = db.get(LectureSummary, job.reference_id)
        transcript = db.get(LectureTranscript, summary.transcript_id) if summary else None
        if not summary or not transcript:
            _fail(db, job, summary, "MISSING_RECORDS")
            return

        summary.status = SummaryStatus.processing
        db.commit()

        if transcript.status != TranscriptStatus.ready:
            try:
                transcript.content = _transcribe(db, transcript)
                transcript.status = TranscriptStatus.ready
                db.commit()
            except AppError as exc:
                # Retryable failures keep their finished chunks and stay pending, so the next attempt resumes.
                if exc.code not in RETRYABLE_ERROR_CODES or job.attempts >= job.max_attempts:
                    transcript.status = TranscriptStatus.failed
                _fail(db, job, summary, exc.code)
                return

        try:
            content = llm_provider.generate_summary(transcript.content or "")
        except Exception:  # noqa: BLE001 - provider/network failure => retryable
            logger.exception("LLM call failed for job %s", job_id)
            db.rollback()
            _fail(db, db.get(BackgroundJob, job_id), db.get(LectureSummary, summary.id), "LLM_ERROR")
            return

        done, total = transcription_service.chunk_summary(transcript)
        # Provenance: a summary is only ever generated from a transcript that is complete.
        content["transcript_complete"] = True
        content["transcript_chunks"] = total or 1
        summary.content_json = content
        summary.generator = content.get("source")
        summary.generator_model = settings.llm_model if content.get("source") == "llm" else None
        summary.status = SummaryStatus.needs_review
        job.status = JobStatus.completed
        job.error_code = None
        job.completed_at = utcnow()
        db.commit()
        logger.info("summary_ready summary=%s generator=%s", summary.id, summary.generator)
    except Exception:  # noqa: BLE001 - last-resort guard for background execution
        logger.exception("summary job %s failed unexpectedly", job_id)
        db.rollback()
        job = db.get(BackgroundJob, job_id)
        if job:
            _fail(db, job, db.get(LectureSummary, job.reference_id), "UNEXPECTED_ERROR")
    finally:
        db.close()


def _fail(db: Session, job: BackgroundJob, summary: LectureSummary | None, error_code: str) -> None:
    job.status = JobStatus.failed
    job.error_code = error_code
    if summary is not None and (error_code not in RETRYABLE_ERROR_CODES or job.attempts >= job.max_attempts):
        summary.status = SummaryStatus.failed
    db.commit()
    logger.warning("summary_job_failed job=%s code=%s attempts=%s", job.id, error_code, job.attempts)


def requeue_retryable_jobs(db: Session, *, stale_after_minutes: int = 15) -> int:
    """For the worker: failed-but-retryable jobs under their attempt cap, and jobs stuck in
    'processing' (a crashed worker), go back to the queue."""
    from datetime import timedelta

    stale_before = utcnow() - timedelta(minutes=stale_after_minutes)
    candidates = db.execute(
        select(BackgroundJob).where(
            BackgroundJob.job_type == JobType.summary_generation,
            (
                (BackgroundJob.status == JobStatus.failed)
                & BackgroundJob.error_code.in_(RETRYABLE_ERROR_CODES)
                & (BackgroundJob.attempts < BackgroundJob.max_attempts)
            )
            | ((BackgroundJob.status == JobStatus.processing) & (BackgroundJob.updated_at < stale_before)),
        )
    ).scalars().all()
    for job in candidates:
        job.status = JobStatus.queued
    db.commit()
    return len(candidates)


def queued_job_ids(db: Session) -> list[str]:
    return list(
        db.execute(
            select(BackgroundJob.id).where(
                BackgroundJob.status == JobStatus.queued, BackgroundJob.job_type == JobType.summary_generation
            )
        ).scalars()
    )


def get_job_or_404(db: Session, job_id: str) -> BackgroundJob:
    job = db.get(BackgroundJob, job_id)
    if not job:
        raise NotFoundError("Job not found.")
    return job


def assert_can_view_job(db: Session, user: User, job: BackgroundJob) -> None:
    """A job id alone must not leak status to unrelated users."""
    summary = db.get(LectureSummary, job.reference_id) if job.reference_id else None
    cls = db.get(Class, summary.class_id) if summary else None
    if cls is None:
        raise NotFoundError("Job not found.")
    course = course_service.get_course_or_404(db, cls.course_id)
    if not course_service.is_teaching(db, user, course):
        raise NotFoundError("Job not found.")


def get_summary_for_class(db: Session, user: User, cls: Class) -> LectureSummary:
    classroom_service.assert_enrolled_in_class(db, user, cls)
    summary = db.execute(
        select(LectureSummary).where(LectureSummary.class_id == cls.id).order_by(LectureSummary.created_at.desc())
    ).scalars().first()
    if not summary:
        raise NotFoundError("No summary has been generated for this class yet.")

    course = course_service.get_course_or_404(db, cls.course_id)
    if not course_service.is_teaching(db, user, course) and summary.status != SummaryStatus.completed:
        raise NotFoundError("No approved summary is available for this class yet.")
    return summary


def approve_summary(db: Session, teacher: User, summary: LectureSummary) -> LectureSummary:
    cls = db.get(Class, summary.class_id)
    classroom_service.assert_teaches_class(db, teacher, cls)
    if summary.status != SummaryStatus.needs_review:
        raise ConflictError(f"Cannot approve a summary in status '{summary.status.value}'.")
    if (summary.content_json or {}).get("transcript_complete") is False:
        raise ConflictError("This summary was built from an incomplete transcript and cannot be published.", code="SUMMARY_SOURCE_INCOMPLETE")
    summary.status = SummaryStatus.completed
    summary.reviewed_by = teacher.id
    summary.reviewed_at = utcnow()
    db.commit()
    db.refresh(summary)
    audit_service.record(db, actor_id=teacher.id, action="summary_approved", resource_type="summary", resource_id=summary.id)
    return summary


def request_changes(db: Session, teacher: User, summary: LectureSummary) -> tuple[LectureSummary, BackgroundJob]:
    """Sends the summary back for regeneration (a new job over the same transcript)."""
    cls = db.get(Class, summary.class_id)
    classroom_service.assert_teaches_class(db, teacher, cls)
    summary.status = SummaryStatus.queued
    summary.reviewed_by = teacher.id
    summary.reviewed_at = utcnow()
    job = BackgroundJob(job_type=JobType.summary_generation, status=JobStatus.queued, reference_id=summary.id)
    db.add(job)
    db.commit()
    db.refresh(summary)
    db.refresh(job)
    audit_service.record(db, actor_id=teacher.id, action="summary_changes_requested", resource_type="summary", resource_id=summary.id)
    return summary, job


def list_summaries(db: Session, user: User) -> list[LectureSummary]:
    """Teachers: every summary for classes in courses they teach (all states, for review).
    Students: only teacher-approved summaries for classes they can actually attend."""
    courses = course_service.list_courses_for_user(db, user, limit=200)
    course_ids = [c.id for c in courses]
    if not course_ids:
        return []
    stmt = (
        select(LectureSummary)
        .join(Class, Class.id == LectureSummary.class_id)
        .where(Class.course_id.in_(course_ids))
        .order_by(LectureSummary.created_at.desc())
    )
    summaries = list(db.execute(stmt).scalars())
    if user.role == UserRole.teacher:
        return summaries
    visible = []
    for summary in summaries:
        if summary.status != SummaryStatus.completed:
            continue
        try:
            classroom_service.assert_enrolled_in_class(db, user, db.get(Class, summary.class_id))
        except AppError:
            continue
        visible.append(summary)
    return visible


def edit_summary(db: Session, teacher: User, summary: LectureSummary, changes: dict) -> LectureSummary:
    """Teacher correction of AI output during review. Marked in the content so students (and
    audits) can tell the text was human-edited, while generator/source metadata is preserved."""
    cls = db.get(Class, summary.class_id)
    classroom_service.assert_teaches_class(db, teacher, cls)
    if summary.status != SummaryStatus.needs_review:
        raise ConflictError("Only a summary awaiting review can be edited.", code="SUMMARY_NOT_IN_REVIEW")
    updated = dict(summary.content_json or {})
    updated.update({k: v for k, v in changes.items() if v is not None})
    updated["teacher_edited"] = True
    summary.content_json = updated  # reassign: SQLAlchemy doesn't track in-place JSON mutation
    db.commit()
    db.refresh(summary)
    audit_service.record(db, actor_id=teacher.id, action="summary_edited", resource_type="summary", resource_id=summary.id)
    return summary
