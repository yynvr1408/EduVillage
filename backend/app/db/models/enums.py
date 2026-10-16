import enum


class UserRole(str, enum.Enum):
    student = "student"
    teacher = "teacher"
    admin = "admin"  # platform administrator: created only by server-side bootstrap, never by registration


class CollegeStatus(str, enum.Enum):
    active = "active"
    inactive = "inactive"


class UserStatus(str, enum.Enum):
    active = "active"
    pending = "pending"
    suspended = "suspended"


class CourseStatus(str, enum.Enum):
    draft = "draft"
    published = "published"
    archived = "archived"


class EnrollmentStatus(str, enum.Enum):
    active = "active"
    removed = "removed"


class LessonStatus(str, enum.Enum):
    draft = "draft"
    published = "published"


class ResourceStatus(str, enum.Enum):
    pending = "pending"
    available = "available"
    deleted = "deleted"


class ResourceType(str, enum.Enum):
    video = "video"
    audio = "audio"
    document = "document"
    presentation = "presentation"
    notes = "notes"
    other = "other"


class ProcessingStatus(str, enum.Enum):
    """Post-upload processing (validation now; audio extraction / transcription later)."""

    pending = "pending"
    processing = "processing"
    ready = "ready"
    failed = "failed"


class ClassStatus(str, enum.Enum):
    scheduled = "scheduled"
    live = "live"
    ended = "ended"
    cancelled = "cancelled"


class ParticipationStatus(str, enum.Enum):
    joined = "joined"
    left = "left"
    removed = "removed"  # kicked out by the teacher; blocks rejoining this class


class AssignmentStatus(str, enum.Enum):
    draft = "draft"
    published = "published"
    closed = "closed"


class SubmissionStatus(str, enum.Enum):
    draft = "draft"
    submitted = "submitted"


class TranscriptStatus(str, enum.Enum):
    pending = "pending"
    ready = "ready"
    failed = "failed"


class SummaryStatus(str, enum.Enum):
    queued = "queued"
    processing = "processing"
    needs_review = "needs_review"
    completed = "completed"
    failed = "failed"


class JobType(str, enum.Enum):
    transcription = "transcription"
    summary_generation = "summary_generation"
    resource_processing = "resource_processing"


class JobStatus(str, enum.Enum):
    queued = "queued"
    processing = "processing"
    completed = "completed"
    failed = "failed"


class SyncOperationType(str, enum.Enum):
    assignment_submission = "assignment_submission"
    unsupported = "unsupported"  # an operation_type the server doesn't handle; recorded so retries stay idempotent


class SyncOperationStatus(str, enum.Enum):
    accepted = "accepted"
    rejected = "rejected"
    conflict = "conflict"


class RecordingStatus(str, enum.Enum):
    recording = "recording"
    processing = "processing"
    available = "available"
    failed = "failed"
    archived = "archived"  # media deleted per retention policy; metadata kept


class CourseTeacherRole(str, enum.Enum):
    owner = "owner"
    co_teacher = "co_teacher"
