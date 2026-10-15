from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.dependencies import get_current_user, get_db
from app.db.models.user import User
from app.schemas.auth import (
    AuthResponse,
    ForgotPasswordRequest,
    LoginRequest,
    RegisterRequest,
    ResetPasswordRequest,
)
from app.schemas.user import UserOut
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


def _set_session_cookie(response: Response, token: str, settings: Settings) -> None:
    samesite = settings.session_cookie_samesite.lower()
    # SameSite=None is rejected by browsers unless the cookie is also Secure.
    secure = settings.is_production or samesite == "none"
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        httponly=True,
        secure=secure,
        samesite=samesite,
        max_age=settings.session_ttl_hours * 3600,
        path="/",
    )


@router.post("/register", response_model=AuthResponse, status_code=201)
def register(
    payload: RegisterRequest,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    user = auth_service.register_user(
        db, full_name=payload.full_name, email=payload.email, password=payload.password, role=payload.role,
        invite_code=payload.invite_code,
    )
    token = auth_service.create_session(db, user)
    _set_session_cookie(response, token, settings)
    return AuthResponse(user=UserOut.model_validate(user))


@router.post("/login", response_model=AuthResponse)
def login(
    payload: LoginRequest,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    user = auth_service.authenticate_user(db, email=payload.email, password=payload.password)
    token = auth_service.create_session(db, user)
    _set_session_cookie(response, token, settings)
    return AuthResponse(user=UserOut.model_validate(user))


@router.post("/logout", status_code=204)
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    _: User = Depends(get_current_user),
):
    token = request.cookies.get(settings.session_cookie_name)
    if token:
        auth_service.revoke_session(db, token)
    response.delete_cookie(settings.session_cookie_name, path="/")
    return None


@router.post("/forgot-password", status_code=202)
def forgot_password(
    payload: ForgotPasswordRequest,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    token = auth_service.request_password_reset(db, payload.email)
    # Always 202 regardless of whether the email exists, to avoid leaking account existence.
    if settings.is_production:
        return {"status": "if_exists_email_sent"}
    return {"status": "dev_mode_token_returned", "reset_token": token}


@router.post("/reset-password", status_code=204)
def reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_db)):
    auth_service.reset_password(db, token=payload.token, new_password=payload.new_password)
    return None
