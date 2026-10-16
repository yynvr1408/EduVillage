from fastapi import APIRouter, BackgroundTasks, Depends
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.core.permissions import require_role
from app.dependencies import get_current_user, get_db
from app.db.models.enums import UserRole
from app.db.models.user import User
from app.schemas.classroom import ClassCreate, ClassOut, ClassUpdate, JoinTokenResponse, ParticipantOut, RecordingOut
from app.services import classroom_service, recording_service, summary_service

router = APIRouter(prefix="/classes", tags=["classes"])


@router.get("", response_model=list[ClassOut])
def list_classes(limit: int = 50, offset: int = 0, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    classes = classroom_service.list_classes_for_user(db, user, limit=limit, offset=offset)
    return [ClassOut.model_validate(c) for c in classes]


@router.post("", response_model=ClassOut, status_code=201)
def create_class(payload: ClassCreate, course_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_role(user, UserRole.teacher)
    cls = classroom_service.create_class(
        db,
        user,
        course_id,
        title=payload.title,
        scheduled_start=payload.scheduled_start,
        scheduled_end=payload.scheduled_end,
        section_ids=payload.section_ids,
        all_branch_sections=payload.all_branch_sections,
    )
    return ClassOut.model_validate(cls)


@router.get("/{class_id}", response_model=ClassOut)
def get_class(class_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cls = classroom_service.get_class_or_404(db, class_id)
    classroom_service.assert_can_view_class(db, user, cls)
    return ClassOut.model_validate(cls)


@router.patch("/{class_id}", response_model=ClassOut)
def update_class(class_id: str, payload: ClassUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cls = classroom_service.get_class_or_404(db, class_id)
    classroom_service.assert_teaches_class(db, user, cls)
    cls = classroom_service.update_class(db, cls, **payload.model_dump())
    return ClassOut.model_validate(cls)


@router.post("/{class_id}/cancel", response_model=ClassOut)
def cancel_class(class_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cls = classroom_service.get_class_or_404(db, class_id)
    cls = classroom_service.cancel_class(db, user, cls)
    return ClassOut.model_validate(cls)


@router.post("/{class_id}/start", response_model=ClassOut)
async def start_class(class_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cls = classroom_service.get_class_or_404(db, class_id)
    cls = await classroom_service.start_class(db, user, cls)
    return ClassOut.model_validate(cls)


@router.post("/{class_id}/end", response_model=ClassOut)
async def end_class(class_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cls = classroom_service.get_class_or_404(db, class_id)
    cls = await classroom_service.end_class(db, user, cls)
    return ClassOut.model_validate(cls)


@router.post("/{class_id}/join-token", response_model=JoinTokenResponse)
def join_token(class_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cls = classroom_service.get_class_or_404(db, class_id)
    return classroom_service.issue_join_token(db, user, cls)


@router.get("/{class_id}/participants", response_model=list[ParticipantOut])
def list_participants(class_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cls = classroom_service.get_class_or_404(db, class_id)
    classroom_service.assert_teaches_class(db, user, cls)
    return [ParticipantOut.model_validate(p) for p in classroom_service.list_participants(db, cls)]


@router.post("/{class_id}/participants/{student_id}/remove", status_code=204)
async def remove_participant(
    class_id: str, student_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    cls = classroom_service.get_class_or_404(db, class_id)
    await classroom_service.remove_participant(db, user, cls, student_id)


@router.post("/{class_id}/recordings/start", response_model=RecordingOut, status_code=201)
async def start_recording(class_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cls = classroom_service.get_class_or_404(db, class_id)
    recording = await recording_service.start_recording(db, user, cls)
    return RecordingOut.model_validate(recording)


@router.post("/{class_id}/recordings/{recording_id}/stop", response_model=RecordingOut)
async def stop_recording(class_id: str, recording_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cls = classroom_service.get_class_or_404(db, class_id)
    recording = recording_service.get_recording_or_404(db, recording_id)
    recording = await recording_service.stop_recording(db, user, cls, recording)
    return RecordingOut.model_validate(recording)


@router.get("/{class_id}/recordings", response_model=list[RecordingOut])
async def list_recordings(
    class_id: str, background_tasks: BackgroundTasks, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    cls = classroom_service.get_class_or_404(db, class_id)
    classroom_service.assert_enrolled_in_class(db, user, cls)
    recordings = [r for r in recording_service.list_recordings_for_class(db, cls) if recording_service.can_access(db, user, r)]
    refreshed = []
    for r in recordings:
        r, auto_job = await recording_service.refresh_status(db, r)
        if auto_job is not None:
            background_tasks.add_task(summary_service.process_summary_job, auto_job.id)
        refreshed.append(r)
    return [RecordingOut.model_validate(r) for r in refreshed]


@router.get("/recordings/{recording_id}/download")
def download_recording(recording_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Kept for existing clients; same authorization + signed URL as /recordings/{id}/playback."""
    recording = recording_service.get_recording_or_404(db, recording_id)
    info = recording_service.playback_info(db, user, recording)
    return RedirectResponse(url=info["url"])
