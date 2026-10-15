from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.core.exceptions import UnauthorizedError
from app.db.models.enums import UserStatus
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
    return user
