from app.core.exceptions import ForbiddenError
from app.db.models.enums import UserRole
from app.db.models.user import User


def require_role(user: User, *roles: UserRole) -> None:
    if user.role not in roles:
        raise ForbiddenError(f"This action requires one of these roles: {', '.join(r.value for r in roles)}")


def require_owner(user: User, owner_id: str, *, message: str = "You do not have access to this resource.") -> None:
    if user.id != owner_id:
        raise ForbiddenError(message)
