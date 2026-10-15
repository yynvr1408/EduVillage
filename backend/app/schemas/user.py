from pydantic import BaseModel, ConfigDict

from app.db.models.enums import UserRole, UserStatus


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    full_name: str
    email: str
    role: UserRole
    status: UserStatus


class UserUpdate(BaseModel):
    full_name: str | None = None
