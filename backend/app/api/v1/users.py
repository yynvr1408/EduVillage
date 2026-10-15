from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.dependencies import get_current_user, get_db
from app.db.models.user import User
from app.schemas.auth import RevokeAllResponse, SessionOut
from app.schemas.user import UserOut, UserUpdate
from app.services import auth_service

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserOut)
def read_me(user: User = Depends(get_current_user)):
    return UserOut.model_validate(user)


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
