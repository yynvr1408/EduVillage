from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.db.models.enums import ClassStatus, ParticipationStatus


class ClassCreate(BaseModel):
    title: str
    scheduled_start: datetime
    scheduled_end: datetime | None = None


class ClassUpdate(BaseModel):
    title: str | None = None
    scheduled_start: datetime | None = None
    scheduled_end: datetime | None = None


class ClassOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    course_id: str
    teacher_id: str
    title: str
    scheduled_start: datetime
    scheduled_end: datetime | None
    status: ClassStatus


class JoinTokenResponse(BaseModel):
    livekit_url: str
    token: str
    room_name: str
    can_publish: bool


class ParticipantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    joined_at: datetime | None
    left_at: datetime | None
    participation_status: ParticipationStatus
