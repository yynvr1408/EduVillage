"""The one place that owns the recorded-lecture lifecycle:

  teacher starts (egress job) -> recording -> stop/webhook -> processing -> available | failed
  -> teacher publishes (opt-in) -> authorized students stream via short-lived signed URL
  -> teacher may share it with other sections (no media copy) or delete it (retention).

Playback availability is independent of transcripts and summaries: a recording can play
with no summary, and a failed summary never affects the recording.
"""

import logging

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError
from app.db.base import utcnow
from app.db.models.classroom import Class, ClassRecording, ClassSection, RecordingProgress, RecordingSection
from app.db.models.course import Course, CourseEnrollment
from app.db.models.enums import ClassStatus, EnrollmentStatus, RecordingStatus, SummaryStatus, UserRole
from app.db.models.section import Section
from app.db.models.summary import LectureSummary, LectureTranscript
from app.db.models.user import User
from app.integrations import livekit
from app.integrations.object_storage import get_storage
from app.services import audit_service, classroom_service, course_service, section_service, summary_service

logger = logging.getLogger(__name__)
settings = get_settings()

_TERMINAL = (RecordingStatus.available, RecordingStatus.failed, RecordingStatus.archived)


def _storage_key_for(class_id: str, recording_id: str) -> str:
    return f"recordings/{class_id}/{recording_id}.mp4"


def _room_name_for(cls: Class) -> str:
    return cls.livekit_room_name or f"eduvillage-class-{cls.id}"


def get_recording_or_404(db: Session, recording_id: str) -> ClassRecording:
    recording = db.get(ClassRecording, recording_id)
    if not recording:
        raise NotFoundError("Recording not found.")
    return recording


def _class_of(db: Session, recording: ClassRecording) -> Class:
    return classroom_service.get_class_or_404(db, recording.class_id)


def _course_of(db: Session, recording: ClassRecording) -> Course:
    return course_service.get_course_or_404(db, _class_of(db, recording).course_id)


def is_recording(db: Session, cls: Class) -> bool:
    return (
        db.execute(
            select(ClassRecording.id).where(ClassRecording.class_id == cls.id, ClassRecording.status == RecordingStatus.recording)
        ).first()
        is not None
    )


# --------------------------------------------------------------------------- lifecycle


async def start_recording(db: Session, teacher: User, cls: Class) -> ClassRecording:
    if not settings.recording_enabled:
        raise ForbiddenError("Recording is disabled by the institution's policy.", code="RECORDING_DISABLED")
    classroom_service.assert_teaches_class(db, teacher, cls)
    if cls.status != ClassStatus.live:
        raise ConflictError("Can only start recording a class that is currently live.", code="CLASS_NOT_LIVE")
    if is_recording(db, cls):
        raise ConflictError("This class is already being recorded.", code="ALREADY_RECORDING")

    # Reserve the row first: LiveKit needs the final storage path up front, and the partial
    # unique index (one active recording per class) turns a concurrent/retried start into a
    # database conflict *before* a second egress job can be launched.
    recording = ClassRecording(
        class_id=cls.id, requested_by=teacher.id, status=RecordingStatus.recording, title=f"{cls.title} (recording)"
    )
    db.add(recording)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise ConflictError("This class is already being recorded.", code="ALREADY_RECORDING")

    storage_key = _storage_key_for(cls.id, recording.id)
    try:
        egress_id = await livekit.start_recording(_room_name_for(cls), storage_key)
    except Exception:
        db.rollback()
        raise

    recording.egress_id = egress_id
    recording.storage_key = storage_key
    db.commit()
    db.refresh(recording)
    audit_service.record(
        db, actor_id=teacher.id, action="recording_started", resource_type="class_recording", resource_id=recording.id
    )
    logger.info("recording_started recording=%s class=%s egress=%s", recording.id, cls.id, egress_id)
    return recording


async def stop_recording(db: Session, teacher: User, cls: Class, recording: ClassRecording) -> ClassRecording:
    classroom_service.assert_teaches_class(db, teacher, cls)
    if recording.class_id != cls.id:
        raise NotFoundError("Recording not found for this class.")
    if recording.status != RecordingStatus.recording:
        return recording  # idempotent

    await livekit.stop_recording(recording.egress_id)
    recording.status = RecordingStatus.processing
    db.commit()
    db.refresh(recording)
    audit_service.record(
        db, actor_id=teacher.id, action="recording_stopped", resource_type="class_recording", resource_id=recording.id
    )
    logger.info("recording_stopped recording=%s", recording.id)
    return recording


async def stop_active_recordings(db: Session, teacher: User, cls: Class) -> None:
    """Called when a class ends. A failure to reach LiveKit must not block ending the class:
    the recording is marked failed (honestly) instead."""
    active = db.execute(
        select(ClassRecording).where(ClassRecording.class_id == cls.id, ClassRecording.status == RecordingStatus.recording)
    ).scalars().all()
    for recording in active:
        try:
            await stop_recording(db, teacher, cls, recording)
        except Exception as exc:  # noqa: BLE001 - never block ending a class on the media provider
            logger.warning("could not stop recording %s while ending class: %s", recording.id, exc)
            recording.status = RecordingStatus.failed
            recording.error_message = "Could not stop the recording when the class ended."
            recording.completed_at = utcnow()
            db.commit()


def finalize_from_provider(
    db: Session, recording: ClassRecording, *, complete: bool, failed: bool, duration_seconds: int = 0, error: str | None = None
) -> ClassRecording:
    """Single, idempotent state transition for provider results (webhook or poll). A replayed
    event for an already-finished recording changes nothing."""
    if recording.status in _TERMINAL:
        return recording

    if complete:
        size = get_storage().verify_uploaded(recording.storage_key) if recording.storage_key else None
        if size is None:
            recording.status = RecordingStatus.failed
            recording.error_message = "The recording finished but the media file was not found in storage."
        else:
            recording.status = RecordingStatus.available
            recording.size_bytes = size
            recording.duration_seconds = max(0, duration_seconds)
        recording.completed_at = utcnow()
    elif failed:
        recording.status = RecordingStatus.failed
        recording.error_message = (error or "The media provider reported a recording failure.")[:500]
        recording.completed_at = utcnow()
    else:
        return recording

    db.commit()
    db.refresh(recording)
    logger.info("recording_finalized recording=%s status=%s", recording.id, recording.status.value)
    return recording


def _auto_summary_if_just_finalized(db: Session, recording: ClassRecording, was_terminal: bool):
    """Fires exactly once, at the moment a recording transitions into `available` — not on a
    replayed webhook or a repeated poll for an already-finished recording. Real speech-to-text +
    AI summary, no teacher click required. Returns the queued job (for the caller to hand to
    BackgroundTasks) or None if nothing was triggered."""
    if was_terminal or recording.status != RecordingStatus.available:
        return None
    return summary_service.auto_request_summary_for_recording(db, recording)


async def refresh_status(db: Session, recording: ClassRecording):
    """Polling fallback for when the LiveKit webhook hasn't arrived. The webhook
    (POST /webhooks/livekit) is the primary path. Returns (recording, auto_summary_job_or_None)."""
    if recording.status not in (RecordingStatus.recording, RecordingStatus.processing) or not recording.egress_id:
        return recording, None

    info = await livekit.get_egress_status(recording.egress_id)
    if info is None:
        return recording, None

    from livekit.api import EgressStatus

    was_terminal = recording.status in _TERMINAL
    recording = finalize_from_provider(
        db,
        recording,
        complete=info.status == EgressStatus.EGRESS_COMPLETE,
        failed=info.status in (EgressStatus.EGRESS_FAILED, EgressStatus.EGRESS_ABORTED),
        error=getattr(info, "error", None) or None,
    )
    return recording, _auto_summary_if_just_finalized(db, recording, was_terminal)


def handle_egress_webhook(db: Session, *, egress_id: str, status_name: str, duration_seconds: int, error: str | None):
    """Returns (handled: bool, auto_summary_job_or_None)."""
    recording = db.execute(select(ClassRecording).where(ClassRecording.egress_id == egress_id)).scalar_one_or_none()
    if recording is None:
        return False, None
    was_terminal = recording.status in _TERMINAL
    recording = finalize_from_provider(
        db,
        recording,
        complete=status_name == "EGRESS_COMPLETE",
        failed=status_name in ("EGRESS_FAILED", "EGRESS_ABORTED", "EGRESS_LIMIT_REACHED"),
        duration_seconds=duration_seconds,
        error=error,
    )
    return True, _auto_summary_if_just_finalized(db, recording, was_terminal)


# --------------------------------------------------------------------------- access control


def _allowed_section_ids(db: Session, recording: ClassRecording) -> set[str]:
    shared = set(db.execute(select(RecordingSection.section_id).where(RecordingSection.recording_id == recording.id)).scalars())
    own = set(db.execute(select(ClassSection.section_id).where(ClassSection.class_id == recording.class_id)).scalars())
    return shared | own


def assert_teaches_recording(db: Session, user: User, recording: ClassRecording) -> None:
    if user.role != UserRole.teacher or not course_service.is_teaching(db, user, _course_of(db, recording)):
        raise ForbiddenError("Only a teacher on this recording's course can manage it.")


def can_access(db: Session, user: User, recording: ClassRecording) -> bool:
    """Teachers on the recording's course: always. Students: only a published, available
    recording, and only if they belong to a section it is scoped/shared to — or, when it
    isn't section-scoped at all, are enrolled in its course."""
    course = _course_of(db, recording)
    if course_service.is_teaching(db, user, course):
        return True
    if user.role != UserRole.student:
        return False
    if recording.status != RecordingStatus.available or not recording.is_published:
        return False
    allowed = _allowed_section_ids(db, recording)
    if allowed:
        return section_service.is_member_of_any(db, user.id, allowed)
    return course_service._is_enrolled(db, course.id, user.id)


def assert_can_access(db: Session, user: User, recording: ClassRecording) -> None:
    if not can_access(db, user, recording):
        # 404 rather than 403 for students: don't confirm that a private recording exists.
        if user.role == UserRole.student:
            raise NotFoundError("Recording not found.")
        raise ForbiddenError("You do not have access to this recording.")


# --------------------------------------------------------------------------- library


def _summary_for(db: Session, recording: ClassRecording) -> LectureSummary | None:
    stmt = (
        select(LectureSummary)
        .where(LectureSummary.class_id == recording.class_id)
        .where((LectureSummary.recording_id == recording.id) | (LectureSummary.recording_id.is_(None)))
        .order_by(LectureSummary.created_at.desc())
    )
    return db.execute(stmt).scalars().first()


def _transcript_for(db: Session, recording: ClassRecording) -> LectureTranscript | None:
    stmt = (
        select(LectureTranscript)
        .where(LectureTranscript.class_id == recording.class_id, LectureTranscript.content.is_not(None))
        .where((LectureTranscript.recording_id == recording.id) | (LectureTranscript.recording_id.is_(None)))
        .order_by(LectureTranscript.created_at.desc())
    )
    return db.execute(stmt).scalars().first()


def describe(db: Session, user: User, recording: ClassRecording, *, with_transcript: bool = False) -> dict:
    cls = _class_of(db, recording)
    course = course_service.get_course_or_404(db, cls.course_id)
    is_teacher = course_service.is_teaching(db, user, course)
    summary = _summary_for(db, recording)
    # Students only learn a summary exists once the teacher has approved it.
    if summary is not None and not is_teacher and summary.status != SummaryStatus.completed:
        summary = None
    transcript = _transcript_for(db, recording) if (is_teacher or summary is not None) else None
    progress = db.execute(
        select(RecordingProgress).where(RecordingProgress.recording_id == recording.id, RecordingProgress.user_id == user.id)
    ).scalar_one_or_none()
    shared = list(db.execute(select(RecordingSection.section_id).where(RecordingSection.recording_id == recording.id)).scalars())
    out = {
        "id": recording.id,
        "class_id": recording.class_id,
        "status": recording.status,
        "started_at": recording.started_at,
        "completed_at": recording.completed_at,
        "title": recording.title,
        "is_published": recording.is_published,
        "duration_seconds": recording.duration_seconds,
        "size_bytes": recording.size_bytes,
        "error_message": recording.error_message if is_teacher else None,
        "course_id": course.id,
        "course_title": course.title,
        "section_ids": shared,
        "has_transcript": transcript is not None,
        "summary_id": summary.id if summary else None,
        "summary_status": summary.status.value if summary else None,
        "progress_seconds": progress.position_seconds if progress else 0,
        "completed": progress.completed if progress else False,
    }
    if with_transcript:
        out["transcript"] = transcript.content if transcript else None
    return out


def list_library(db: Session, user: User, *, course_id: str | None = None, section_id: str | None = None) -> list[ClassRecording]:
    base = select(ClassRecording).join(Class, Class.id == ClassRecording.class_id)
    if user.role == UserRole.teacher:
        taught = [c.id for c in course_service.list_courses_for_user(db, user, limit=200)]
        stmt = base.where(Class.course_id.in_(taught))
    else:
        enrolled = select(CourseEnrollment.course_id).where(
            CourseEnrollment.student_id == user.id, CourseEnrollment.status == EnrollmentStatus.active
        )
        shared_to_me = select(RecordingSection.recording_id).where(
            RecordingSection.section_id.in_(section_service.member_section_ids(db, user.id) or {""})
        )
        stmt = base.where((Class.course_id.in_(enrolled)) | (ClassRecording.id.in_(shared_to_me)))
        stmt = stmt.where(ClassRecording.is_published.is_(True), ClassRecording.status == RecordingStatus.available)
    if course_id:
        stmt = stmt.where(Class.course_id == course_id)
    if section_id:
        stmt = stmt.where(
            ClassRecording.id.in_(select(RecordingSection.recording_id).where(RecordingSection.section_id == section_id))
            | Class.id.in_(select(ClassSection.class_id).where(ClassSection.section_id == section_id))
        )
    recordings = db.execute(stmt.order_by(ClassRecording.started_at.desc())).scalars().all()
    return [r for r in recordings if can_access(db, user, r)]


def list_recordings_for_class(db: Session, cls: Class) -> list[ClassRecording]:
    stmt = select(ClassRecording).where(ClassRecording.class_id == cls.id).order_by(ClassRecording.started_at.desc())
    return list(db.execute(stmt).scalars())


# --------------------------------------------------------------------------- playback / management


def playback_info(db: Session, user: User, recording: ClassRecording) -> dict:
    """Short-lived signed URL, issued only after an authorization check on every call."""
    assert_can_access(db, user, recording)
    if recording.status == RecordingStatus.failed:
        raise ConflictError("This recording failed and cannot be played.", code="RECORDING_FAILED")
    if recording.status == RecordingStatus.archived:
        raise ConflictError("This recording has been removed.", code="RECORDING_ARCHIVED")
    if recording.status != RecordingStatus.available:
        raise ConflictError("This recording isn't ready yet.", code="RECORDING_NOT_READY")
    storage = get_storage()
    if storage.verify_uploaded(recording.storage_key) is None:
        raise NotFoundError("The recording's media file is missing from storage.", code="RECORDING_MEDIA_MISSING")
    target = storage.download_target(recording.storage_key, ttl_seconds=settings.signed_url_ttl_seconds)
    return {"url": target["url"], "expires_in": settings.signed_url_ttl_seconds, "method": "GET"}


def set_published(db: Session, teacher: User, recording: ClassRecording, *, published: bool) -> ClassRecording:
    assert_teaches_recording(db, teacher, recording)
    if published and recording.status != RecordingStatus.available:
        raise ConflictError("Only a recording that is ready can be published.", code="RECORDING_NOT_READY")
    recording.is_published = published
    db.commit()
    db.refresh(recording)
    audit_service.record(
        db,
        actor_id=teacher.id,
        action="recording_published" if published else "recording_unpublished",
        resource_type="class_recording",
        resource_id=recording.id,
    )
    return recording


def share_with_section(db: Session, teacher: User, recording: ClassRecording, *, section_id: str) -> RecordingSection:
    """Reuse without copying: the teacher must teach BOTH the recording's course and the
    target section's course, so a recording can never be pushed into a course/section the
    sharing teacher has no authority over."""
    assert_teaches_recording(db, teacher, recording)
    section = db.get(Section, section_id)
    if not section:
        raise NotFoundError("Section not found.")
    section_service.assert_teaches_section(db, teacher, section)
    existing = db.get(RecordingSection, (recording.id, section.id))
    if existing:
        return existing
    link = RecordingSection(recording_id=recording.id, section_id=section.id, shared_by=teacher.id)
    db.add(link)
    db.commit()
    audit_service.record(db, actor_id=teacher.id, action="recording_shared", resource_type="class_recording", resource_id=recording.id)
    return link


def unshare_from_section(db: Session, teacher: User, recording: ClassRecording, *, section_id: str) -> None:
    assert_teaches_recording(db, teacher, recording)
    link = db.get(RecordingSection, (recording.id, section_id))
    if not link:
        raise NotFoundError("This recording is not shared with that section.")
    db.delete(link)  # only the association: the recording and its other shares are untouched
    db.commit()
    audit_service.record(db, actor_id=teacher.id, action="recording_unshared", resource_type="class_recording", resource_id=recording.id)


def delete_recording(db: Session, teacher: User, recording: ClassRecording) -> ClassRecording:
    """Retention/deletion: removes the media, keeps the metadata row (status=archived)."""
    assert_teaches_recording(db, teacher, recording)
    if recording.status == RecordingStatus.recording:
        raise ConflictError("Stop the recording before deleting it.", code="RECORDING_IN_PROGRESS")
    if recording.status != RecordingStatus.archived:
        if recording.storage_key:
            get_storage().delete(recording.storage_key)
        recording.status = RecordingStatus.archived
        recording.is_published = False
        db.commit()
        db.refresh(recording)
        audit_service.record(db, actor_id=teacher.id, action="recording_deleted", resource_type="class_recording", resource_id=recording.id)
    return recording


def update_progress(db: Session, user: User, recording: ClassRecording, *, position_seconds: int, completed: bool) -> RecordingProgress:
    assert_can_access(db, user, recording)
    progress = db.execute(
        select(RecordingProgress).where(RecordingProgress.recording_id == recording.id, RecordingProgress.user_id == user.id)
    ).scalar_one_or_none()
    if progress is None:
        progress = RecordingProgress(recording_id=recording.id, user_id=user.id)
        db.add(progress)
    progress.position_seconds = position_seconds
    progress.completed = progress.completed or completed
    db.commit()
    db.refresh(progress)
    return progress
