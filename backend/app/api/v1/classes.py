from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.permissions import require_role
from app.dependencies import get_current_user, get_db
from app.db.models.enums import UserRole
from app.db.models.user import User
from app.schemas.classroom import ClassCreate, ClassOut, ClassUpdate, JoinTokenResponse, ParticipantOut
from app.services import classroom_service

router = APIRouter(prefix="/classes", tags=["classes"])


@router.get("", response_model=list[ClassOut])
def list_classes(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return [ClassOut.model_validate(c) for c in classroom_service.list_classes_for_user(db, user)]


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
    classroom_service.assert_teaches_class(user, cls)
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
    classroom_service.assert_teaches_class(user, cls)
    return [ParticipantOut.model_validate(p) for p in classroom_service.list_participants(db, cls)]
