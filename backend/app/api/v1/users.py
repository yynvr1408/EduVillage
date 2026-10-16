from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.core.permissions import require_role
from app.dependencies import get_current_user, get_db
from app.db.models.enums import UserRole
from app.db.models.user import User
from app.schemas.admin import StudentVisibleTeacherOut
from app.schemas.auth import RevokeAllResponse, SessionOut
from app.schemas.user import UserOut, UserUpdate
from app.services import auth_service, teaching_scope_service

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserOut)
def read_me(user: User = Depends(get_current_user)):
    return UserOut.model_validate(user)


@router.get("/me/teaching-scope")
def teaching_scope(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """The branch / college section this teacher is assigned to ("none" for legacy or student accounts)."""
    return teaching_scope_service.describe(db, user)


@router.get("/me/college-teachers", response_model=list[StudentVisibleTeacherOut])
def college_teachers(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Teachers in the student's own college, assigned to their college section or branch-wide.
    Discovery only: does not enroll the student in any course or grant any additional access."""
    require_role(user, UserRole.student)
    return teaching_scope_service.list_teachers_for_student(db, user)


@router.patch("/me", response_model=UserOut)
def update_me(payload: UserUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if payload.full_name is not None:
        user.full_name = payload.full_name.strip()
        db.commit()
        db.refresh(user)
    return UserOut.model_validate(user)


@router.get("/me/sessions", response_model=list[SessionOut])
def list_my_sessions(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """For shared/public devices: shows every device currently signed in, so a student
    can confirm no one else's session is still open on a computer they're borrowing."""
    return [SessionOut.model_validate(s) for s in auth_service.list_active_sessions(db, user)]


@router.delete("/me/sessions/{session_id}", status_code=204)
def revoke_my_session(session_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    auth_service.revoke_session_by_id(db, user, session_id)
    return None


@router.post("/me/sessions/revoke-all", response_model=RevokeAllResponse)
def revoke_all_my_sessions(
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """Signs out every other device for this account, keeping the caller's own session."""
    current_token = request.cookies.get(settings.session_cookie_name)
    count = auth_service.revoke_all_sessions_except(db, user, keep_token=current_token)
    return RevokeAllResponse(revoked_count=count)
