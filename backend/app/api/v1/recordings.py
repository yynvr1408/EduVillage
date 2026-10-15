"""Recorded-lecture library: the student/teacher-facing view over recordings.

Recording *capture* (start/stop for a live class) lives under /classes/{id}/recordings in
classes.py; both call the same recording_service, so there is one implementation."""

import logging

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.db.models.user import User
from app.schemas.classroom import (
    PlaybackOut,
    ProgressOut,
    ProgressUpdate,
    PublishRequest,
    RecordingDetail,
    RecordingLibraryItem,
    ShareRequest,
)
from app.schemas.summary import SummaryJobOut, SummaryJobRequest
from app.services import recording_service, summary_service

router = APIRouter(prefix="/recordings", tags=["recordings"])
logger = logging.getLogger("eduvillage.recordings")


def _get_visible(db: Session, user: User, recording_id: str):
    recording = recording_service.get_recording_or_404(db, recording_id)
    recording_service.assert_can_access(db, user, recording)
    return recording


@router.get("", response_model=list[RecordingLibraryItem])
async def list_recordings(
    course_id: str | None = None,
    section_id: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    recordings = recording_service.list_library(db, user, course_id=course_id, section_id=section_id)
    # Poll the provider for any still-processing recording the webhook hasn't resolved yet.
    refreshed = []
    for r in recordings:
        try:
            r = await recording_service.refresh_status(db, r)
        except Exception as exc:  # noqa: BLE001 - listing must not fail because the media provider is down
            logger.warning("recording_refresh_failed recording=%s egress=%s error=%s", r.id, r.egress_id, exc)
        refreshed.append(r)
    return [RecordingLibraryItem(**recording_service.describe(db, user, r)) for r in refreshed]


@router.get("/{recording_id}", response_model=RecordingDetail)
def get_recording(recording_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    recording = _get_visible(db, user, recording_id)
    return RecordingDetail(**recording_service.describe(db, user, recording, with_transcript=True))


@router.get("/{recording_id}/playback", response_model=PlaybackOut)
def playback(recording_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    recording = recording_service.get_recording_or_404(db, recording_id)
    return PlaybackOut(**recording_service.playback_info(db, user, recording))


@router.post("/{recording_id}/publish", response_model=RecordingLibraryItem)
def publish(recording_id: str, payload: PublishRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    recording = recording_service.get_recording_or_404(db, recording_id)
    recording = recording_service.set_published(db, user, recording, published=payload.published)
    return RecordingLibraryItem(**recording_service.describe(db, user, recording))


@router.post("/{recording_id}/sections", response_model=RecordingLibraryItem, status_code=201)
def share(recording_id: str, payload: ShareRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    recording = recording_service.get_recording_or_404(db, recording_id)
    recording_service.share_with_section(db, user, recording, section_id=payload.section_id)
    return RecordingLibraryItem(**recording_service.describe(db, user, recording))


@router.delete("/{recording_id}/sections/{section_id}", status_code=204)
def unshare(recording_id: str, section_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    recording = recording_service.get_recording_or_404(db, recording_id)
    recording_service.unshare_from_section(db, user, recording, section_id=section_id)
    return None


@router.post("/{recording_id}/progress", response_model=ProgressOut)
def progress(recording_id: str, payload: ProgressUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    recording = recording_service.get_recording_or_404(db, recording_id)
    p = recording_service.update_progress(
        db, user, recording, position_seconds=payload.position_seconds, completed=payload.completed
    )
    return ProgressOut(position_seconds=p.position_seconds, completed=p.completed)


@router.post("/{recording_id}/summary-jobs", response_model=SummaryJobOut, status_code=202)
def create_summary_for_recording(
    recording_id: str,
    payload: SummaryJobRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Teacher-triggered transcript + summary for a recording. Independent of playback: a failure
    here never touches the recording itself."""
    recording = recording_service.get_recording_or_404(db, recording_id)
    recording_service.assert_teaches_recording(db, user, recording)
    cls = recording_service._class_of(db, recording)
    job = summary_service.request_summary(
        db, user, cls, transcript_text=payload.transcript_text, resource_id=payload.resource_id, recording_id=recording.id
    )
    background_tasks.add_task(summary_service.process_summary_job, job.id)
    return SummaryJobOut(job_id=job.id, status=job.status)


@router.delete("/{recording_id}", status_code=204)
def delete_recording(recording_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    recording = recording_service.get_recording_or_404(db, recording_id)
    recording_service.delete_recording(db, user, recording)
    return None

