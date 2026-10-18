from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db.models.enums import UserStatus
from app.dependencies import get_current_user, get_db
from app.db.models.user import User
from app.schemas.auth import (
    AuthResponse,
    ForgotPasswordRequest,
    LoginOtpRequired,
    LoginRequest,
    RegisterRequest,
    RegistrationPendingOut,
    RegistrationVerificationOut,
    RequestRegistrationOtpRequest,
    ResetAuthorizationOut,
    ResetPasswordRequest,
    VerifyRegistrationOtpRequest,
    VerifyResetOtpRequest,
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


@router.post("/register/request-otp", status_code=202)
def register_request_otp(
    payload: RequestRegistrationOtpRequest,
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    sent, dev_otp = auth_service.request_registration_otp(db, payload.email, ip=request.client.host if request.client else None)
    body = {
        "message": "A verification code has been sent to that email address.",
        "otp_ttl_minutes": settings.otp_ttl_minutes,
        "resend_cooldown_seconds": settings.otp_request_cooldown_seconds,
    }
    if dev_otp:
        body["dev_otp"] = dev_otp
    return body


@router.post("/register/verify-otp", response_model=RegistrationVerificationOut)
def register_verify_otp(
    payload: VerifyRegistrationOtpRequest,
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    verification_token = auth_service.verify_registration_otp(
        db, email=payload.email, otp=payload.otp, ip=request.client.host if request.client else None
    )
    return RegistrationVerificationOut(verification_token=verification_token, expires_in_minutes=settings.reset_token_ttl_minutes)


@router.post("/register", response_model=AuthResponse, status_code=201, responses={202: {"model": RegistrationPendingOut}})
def register(
    payload: RegisterRequest,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    user = auth_service.register_user(
        db, full_name=payload.full_name, email=payload.email, password=payload.password, role=payload.role,
        invite_code=payload.invite_code, college_id=payload.college_id, college_code=payload.college_code,
        section_id=payload.section_id, branch_id=payload.branch_id, all_sections=payload.all_sections,
        verification_token=payload.verification_token,
    )
    if user.status == UserStatus.pending:
        # Awaiting the college administrator's approval: no session until they approve it.
        return JSONResponse(
            status_code=202,
            content=RegistrationPendingOut(
                message="Your registration has been submitted and is awaiting approval from your institution's administrator."
            ).model_dump(),
        )
    token = auth_service.create_session(db, user)
    _set_session_cookie(response, token, settings)
    return AuthResponse(user=UserOut.model_validate(user))


@router.post("/login", response_model=AuthResponse, responses={202: {"model": LoginOtpRequired}})
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    user = auth_service.authenticate_user(db, email=payload.email, password=payload.password)
    ip = request.client.host if request.client else None
    if auth_service.login_requires_otp(db, user, request.cookies.get(settings.session_cookie_name)):
        # Somebody is already signed in to this account: no session until the owner approves via emailed code.
        sent, dev_otp = auth_service.request_login_otp(db, user, ip=ip)
        body = {
            "otp_required": True,
            "email": user.email,
            "message": "This account is signed in on another device. Enter the verification code we emailed to approve this sign-in.",
            "otp_ttl_minutes": settings.otp_ttl_minutes,
            "resend_cooldown_seconds": settings.otp_request_cooldown_seconds,
        }
        if dev_otp:
            body["dev_otp"] = dev_otp
        return JSONResponse(status_code=202, content=body)
    token = auth_service.create_session(db, user)
    _set_session_cookie(response, token, settings)
    return AuthResponse(user=UserOut.model_validate(user))


@router.post("/login/verify-otp", response_model=AuthResponse)
def verify_login_otp(
    payload: VerifyResetOtpRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    user = auth_service.verify_login_otp(db, email=payload.email, otp=payload.otp, ip=request.client.host if request.client else None)
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
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    otp = auth_service.request_password_reset(db, payload.email, ip=request.client.host if request.client else None)
    # Always the same message and status regardless of whether the email exists, is eligible, or
    # is inside its resend cooldown — none of that is ever revealed. The raw OTP is never
    # included in production — only emailed.
    body = {"message": "If an account exists with that email address, a verification code will be sent."}
    if not settings.is_production:
        body["dev_otp"] = otp
    return body


@router.post("/verify-reset-otp", response_model=ResetAuthorizationOut)
def verify_reset_otp(
    payload: VerifyResetOtpRequest,
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    reset_token = auth_service.verify_reset_otp(
        db, email=payload.email, otp=payload.otp, ip=request.client.host if request.client else None
    )
    return ResetAuthorizationOut(reset_token=reset_token, expires_in_minutes=settings.reset_token_ttl_minutes)


@router.post("/reset-password", status_code=204)
def reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_db)):
    if payload.confirm_password is not None and payload.confirm_password != payload.new_password:
        from app.core.exceptions import ValidationFailedError

        raise ValidationFailedError("Passwords do not match.", code="PASSWORD_MISMATCH")
    auth_service.reset_password(db, reset_token=payload.reset_token, new_password=payload.new_password)
    return None
