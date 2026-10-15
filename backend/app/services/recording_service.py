from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, NotFoundError
from app.db.base import utcnow
from app.db.models.classroom import Class, ClassRecording
from app.db.models.enums import ClassStatus, RecordingStatus
from app.db.models.user import User
from app.integrations import livekit
from app.services import audit_service, classroom_service


def _storage_key_for(class_id: str, egress_id: str) -> str:
    return f"recordings/{class_id}/{egress_id}.mp4"


def _room_name_for(cls: Class) -> str:
    return cls.livekit_room_name or f"eduvillage-class-{cls.id}"


async def start_recording(db: Session, teacher: User, cls: Class) -> ClassRecording:
    classroom_service.assert_teaches_class(db, teacher, cls)
    if cls.status != ClassStatus.live:
        raise ConflictError("Can only start recording a class that is currently live.", code="CLASS_NOT_LIVE")

    existing = db.execute(
        select(ClassRecording).where(ClassRecording.class_id == cls.id, ClassRecording.status == RecordingStatus.recording)
    ).scalar_one_or_none()
    if existing:
        raise ConflictError("This class is already being recorded.", code="ALREADY_RECORDING")

    # LiveKit needs the final storage path up front, so reserve the row first to get an id
    # to key off of, then ask LiveKit to start, then fill in the real egress_id.
    recording = ClassRecording(class_id=cls.id, requested_by=teacher.id, status=RecordingStatus.recording)
    db.add(recording)
    db.flush()

    storage_key = _storage_key_for(cls.id, recording.id)
    egress_id = await livekit.start_recording(_room_name_for(cls), storage_key)

    recording.egress_id = egress_id
    recording.storage_key = storage_key
    db.commit()
    db.refresh(recording)
    audit_service.record(
        db, actor_id=teacher.id, action="recording_started", resource_type="class_recording", resource_id=recording.id
    )
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
    return recording


async def refresh_status(db: Session, recording: ClassRecording) -> ClassRecording:
    """Polls LiveKit for the egress job's current status and updates our record. There's no
    webhook receiver in this MVP, so this is called opportunistically whenever a 'processing'
    recording is read — good enough for a hackathon demo; a webhook is the production upgrade."""
    if recording.status not in (RecordingStatus.recording, RecordingStatus.processing) or not recording.egress_id:
        return recording

    info = await livekit.get_egress_status(recording.egress_id)
    if info is None:
        return recording

    from livekit.api import EgressStatus

    if info.status == EgressStatus.EGRESS_COMPLETE:
        recording.status = RecordingStatus.available
        recording.completed_at = utcnow()
    elif info.status in (EgressStatus.EGRESS_FAILED, EgressStatus.EGRESS_ABORTED):
        recording.status = RecordingStatus.failed
        recording.completed_at = utcnow()
    db.commit()
    db.refresh(recording)
    return recording


def get_recording_or_404(db: Session, recording_id: str) -> ClassRecording:
    recording = db.get(ClassRecording, recording_id)
    if not recording:
        raise NotFoundError("Recording not found.")
    return recording


def list_recordings_for_class(db: Session, cls: Class) -> list[ClassRecording]:
    stmt = select(ClassRecording).where(ClassRecording.class_id == cls.id).order_by(ClassRecording.started_at.desc())
    return list(db.execute(stmt).scalars())


def download_info(recording: ClassRecording) -> dict:
    from app.integrations.object_storage import get_storage

    return get_storage().download_target(recording.storage_key)
