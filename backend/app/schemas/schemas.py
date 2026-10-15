from datetime import datetime
from typing import Optional, List, Any
from pydantic import BaseModel, EmailStr


# Auth schemas
class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    email: str
    full_name: str
    password: str
    role: str  # "student" or "teacher"


class UserOut(BaseModel):
    id: str
    email: str
    full_name: str
    role: str
    created_at: datetime

    class Config:
        from_attributes = True


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# Course schemas
class LessonCreate(BaseModel):
    title: str
    description: Optional[str] = None
    order_index: int = 0
    content: Optional[str] = None
    offline_ready: bool = True


class LessonOut(BaseModel):
    id: str
    course_id: str
    title: str
    description: Optional[str] = None
    order_index: int
    content: Optional[str] = None
    offline_ready: bool
    created_at: datetime

    class Config:
        from_attributes = True


class CourseCreate(BaseModel):
    title: str
    code: str
    description: Optional[str] = None


class CourseOut(BaseModel):
    id: str
    title: str
    code: str
    description: Optional[str] = None
    teacher_id: str
    teacher_name: Optional[str] = None
    created_at: datetime
    lessons_count: Optional[int] = 0

    class Config:
        from_attributes = True


class CourseDetailOut(CourseOut):
    lessons: List[LessonOut] = []


# Classroom schemas
class ClassCreate(BaseModel):
    course_id: str
    section_id: Optional[str] = None
    title: str
    scheduled_at: datetime


class ClassOut(BaseModel):
    id: str
    course_id: str
    section_id: Optional[str] = None
    section_name: Optional[str] = None
    course_title: Optional[str] = None
    course_code: Optional[str] = None
    teacher_id: str
    teacher_name: Optional[str] = None
    title: str
    status: str  # SCHEDULED, LIVE, ENDED, CANCELLED
    scheduled_at: datetime
    livekit_room_name: str
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class JoinTokenResponse(BaseModel):
    token: str
    url: str
    room_name: str
    participant_identity: str
    participant_name: str
    is_publisher: bool


# Assignment schemas
class AssignmentCreate(BaseModel):
    course_id: str
    title: str
    instructions: str
    due_date: datetime
    max_score: int = 100


class SubmissionCreate(BaseModel):
    content: str
    idempotency_key: Optional[str] = None


class SubmissionOut(BaseModel):
    id: str
    assignment_id: str
    student_id: str
    student_name: Optional[str] = None
    content: str
    status: str
    score: Optional[int] = None
    feedback: Optional[str] = None
    submitted_at: datetime
    idempotency_key: Optional[str] = None

    class Config:
        from_attributes = True


class AssignmentOut(BaseModel):
    id: str
    course_id: str
    course_title: Optional[str] = None
    title: str
    instructions: str
    due_date: datetime
    max_score: int
    created_at: datetime
    submissions_count: Optional[int] = 0
    my_submission: Optional[SubmissionOut] = None

    class Config:
        from_attributes = True


# Summary schemas
class SummaryOut(BaseModel):
    id: str
    class_id: str
    course_id: str
    status: str  # QUEUED, PROCESSING, NEEDS_REVIEW, COMPLETED, FAILED
    review_status: str  # PENDING, APPROVED, REVISION_REQUESTED
    overview: Optional[str] = None
    key_concepts: Optional[List[str]] = None
    definitions: Optional[List[dict]] = None
    examples: Optional[List[str]] = None
    revision_questions: Optional[List[str]] = None
    teacher_notes: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class SummaryReviewRequest(BaseModel):
    action: str  # "APPROVE" or "REVISE"
    teacher_notes: Optional[str] = None
    overview: Optional[str] = None
    key_concepts: Optional[List[str]] = None
    revision_questions: Optional[List[str]] = None


# Sync schemas
class SyncOperationItem(BaseModel):
    operation_id: str
    idempotency_key: str
    operation_type: str  # "submit_assignment" or "save_draft"
    entity_id: str
    payload: Any
    timestamp: datetime


class SyncBatchRequest(BaseModel):
    operations: List[SyncOperationItem]


class SyncOperationResult(BaseModel):
    operation_id: str
    idempotency_key: str
    status: str  # "SUCCESS", "RETRYABLE_ERROR", "FAILED"
    message: str
    server_entity_id: Optional[str] = None


class SyncBatchResponse(BaseModel):
    processed_count: int
    results: List[SyncOperationResult]


# Material schemas
class MaterialCreate(BaseModel):
    course_id: str
    lesson_id: Optional[str] = None
    title: str
    file_type: str = "pdf"
    file_url: str
    file_size: int = 0


class MaterialOut(BaseModel):
    id: str
    course_id: str
    lesson_id: Optional[str] = None
    title: str
    file_url: str
    file_type: str
    file_size: int
    is_published: bool
    created_at: datetime

    class Config:
        from_attributes = True


# Section schemas
class SectionCreate(BaseModel):
    course_id: str
    name: str
    code: str
    student_count: Optional[int] = 24


class SectionOut(BaseModel):
    id: str
    course_id: str
    name: str
    code: str
    student_count: int
    created_at: datetime

    class Config:
        from_attributes = True


# Recording schemas
class RecordingCreate(BaseModel):
    course_id: str
    class_id: Optional[str] = None
    title: str
    description: Optional[str] = None
    duration_seconds: int = 0
    video_url: Optional[str] = None
    download_url: Optional[str] = None
    file_size_bytes: int = 0
    transcript: Optional[str] = None
    section_ids: Optional[List[str]] = None
    summary_id: Optional[str] = None


class RecordingOut(BaseModel):
    id: str
    course_id: str
    course_title: Optional[str] = None
    course_code: Optional[str] = None
    class_id: Optional[str] = None
    teacher_id: str
    teacher_name: Optional[str] = None
    title: str
    description: Optional[str] = None
    duration_seconds: int
    video_url: Optional[str] = None
    download_url: Optional[str] = None
    file_size_bytes: int
    status: str  # PROCESSING, READY, FAILED, ARCHIVED
    has_transcript: bool = False
    has_summary: bool = False
    summary_id: Optional[str] = None
    section_ids: List[str] = []
    is_published: bool = True
    created_at: datetime
    user_progress_seconds: int = 0
    user_completed: bool = False

    class Config:
        from_attributes = True


class RecordingDetailOut(RecordingOut):
    transcript: Optional[str] = None
    summary: Optional[SummaryOut] = None


class RecordingReuseRequest(BaseModel):
    target_section_ids: List[str]


class RecordingProgressUpdate(BaseModel):
    position_seconds: int
    completed: Optional[bool] = False

