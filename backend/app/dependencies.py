from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.core.exceptions import ForbiddenError, UnauthorizedError
from app.db.models.enums import UserRole, UserStatus
from app.db.models.user import User
from app.db.session import get_db

__all__ = ["get_db", "get_settings", "get_current_user", "get_optional_user"]


def get_optional_user(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> User | None:
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        return None

    from app.services.auth_service import get_user_from_session_token

    return get_user_from_session_token(db, token)


def get_current_user(user: User | None = Depends(get_optional_user)) -> User:
    if user is None:
        raise UnauthorizedError("Authentication required.")
    if user.status != UserStatus.active:
        raise UnauthorizedError("This account is not active.")
    if user.role == UserRole.admin:  # an admin session never works on the student/teacher API
        raise UnauthorizedError("Authentication required.")
    return user


ADMIN_CSRF_HEADER = "x-eduvillage-admin"


def require_admin_csrf(request: Request) -> None:
    """State-changing admin requests must carry a custom header. A cross-site form or image cannot add one,
    and a cross-origin fetch that does is stopped by the CORS preflight (only our frontend origin is allowed)."""
    if request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get(ADMIN_CSRF_HEADER) != "1":
        raise ForbiddenError("Missing admin request header.", code="CSRF_REJECTED")


def get_current_admin(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    _csrf: None = Depends(require_admin_csrf),
) -> User:
    token = request.cookies.get(settings.admin_cookie_name)
    if not token:
        raise UnauthorizedError("Authentication required.")

    from app.services.auth_service import get_user_from_session_token

    user = get_user_from_session_token(db, token)
    # The role is checked on the server for every request; being logged in as anyone else is not enough.
    if user is None or user.role != UserRole.admin or user.status != UserStatus.active:
        raise UnauthorizedError("Authentication required.")
    return user
