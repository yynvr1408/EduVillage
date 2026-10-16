from datetime import datetime

from app.schemas.common import UtcDatetime
from pydantic import BaseModel, ConfigDict, Field

from app.db.models.enums import ClassStatus, ParticipationStatus, RecordingStatus


class ClassCreate(BaseModel):
    title: str
    scheduled_start: UtcDatetime
    scheduled_end: UtcDatetime | None = None
    section_ids: list[str] = []  # empty => the whole course
    all_branch_sections: bool = False  # branch-wide teachers: every active section of their branch


class ClassUpdate(BaseModel):
    title: str | None = None
    scheduled_start: UtcDatetime | None = None
    scheduled_end: UtcDatetime | None = None


class ClassOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    course_id: str
    teacher_id: str
    title: str
    scheduled_start: UtcDatetime
    scheduled_end: UtcDatetime | None
    status: ClassStatus
    section_ids: list[str] = []
    audience_branch_id: str | None = None  # set for a branch-wide ("All Sections") class
    audience_branch_name: str | None = None


class JoinTokenResponse(BaseModel):
    livekit_url: str
    token: str
    room_name: str
    can_publish: bool
    recording_active: bool = False


class ParticipantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    joined_at: UtcDatetime | None
    left_at: UtcDatetime | None
    participation_status: ParticipationStatus


class RecordingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    class_id: str
    status: RecordingStatus
    started_at: UtcDatetime
    completed_at: UtcDatetime | None
    title: str | None = None
    is_published: bool = False
    duration_seconds: int = 0
    size_bytes: int = 0
    error_message: str | None = None


class RecordingLibraryItem(RecordingOut):
    """A recording as shown in the lecture library: adds course context, sharing scope,
    transcript/summary availability and the caller's own playback progress."""

    course_id: str
    course_title: str
    section_ids: list[str] = []
    has_transcript: bool = False
    summary_id: str | None = None
    summary_status: str | None = None
    progress_seconds: int = 0
    completed: bool = False


class RecordingDetail(RecordingLibraryItem):
    transcript: str | None = None


class PlaybackOut(BaseModel):
    url: str
    expires_in: int
    method: str = "GET"


class PublishRequest(BaseModel):
    published: bool


class ShareRequest(BaseModel):
    section_id: str


class ProgressUpdate(BaseModel):
    position_seconds: int = Field(ge=0)
    completed: bool = False


class ProgressOut(BaseModel):
    position_seconds: int
    completed: bool
