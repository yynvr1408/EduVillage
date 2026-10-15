from fastapi import APIRouter, Depends
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError
from app.core.permissions import require_role
from app.dependencies import get_current_user, get_db
from app.db.models.enums import UserRole
from app.db.models.user import User
from app.schemas.classroom import ClassCreate, ClassOut, ClassUpdate, JoinTokenResponse, ParticipantOut, RecordingOut
from app.services import classroom_service, recording_service

router = APIRouter(prefix="/classes", tags=["classes"])


@router.get("", response_model=list[ClassOut])
def list_classes(limit: int = 50, offset: int = 0, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    classes = classroom_service.list_classes_for_user(db, user, limit=limit, offset=offset)
    return [ClassOut.model_validate(c) for c in classes]


@router.post("", response_model=ClassOut, status_code=201)
def create_class(payload: ClassCreate, course_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_role(user, UserRole.teacher)
    cls = classroom_service.create_class(
        db, user, course_id, title=payload.title, scheduled_start=payload.scheduled_start, scheduled_end=payload.scheduled_end
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


@router.post("/{class_id}/start", response_model=ClassOut)
async def start_class(class_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cls = classroom_service.get_class_or_404(db, class_id)
    cls = await classroom_service.start_class(db, user, cls)
    return ClassOut.model_validate(cls)


@router.post("/{class_id}/end", response_model=ClassOut)
def end_class(class_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cls = classroom_service.get_class_or_404(db, class_id)
    cls = classroom_service.end_class(db, user, cls)
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
async def list_recordings(class_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cls = classroom_service.get_class_or_404(db, class_id)
    classroom_service.assert_enrolled_in_class(db, user, cls)
    recordings = recording_service.list_recordings_for_class(db, cls)
    refreshed = [await recording_service.refresh_status(db, r) for r in recordings]
    return [RecordingOut.model_validate(r) for r in refreshed]


@router.get("/recordings/{recording_id}/download")
async def download_recording(recording_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    recording = recording_service.get_recording_or_404(db, recording_id)
    cls = classroom_service.get_class_or_404(db, recording.class_id)
    classroom_service.assert_enrolled_in_class(db, user, cls)
    recording = await recording_service.refresh_status(db, recording)
    if recording.status != "available":
        raise ConflictError("This recording isn't ready yet.", code="RECORDING_NOT_READY")
    target = recording_service.download_info(recording)
    return RedirectResponse(url=target["url"])
