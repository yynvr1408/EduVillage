import enum


class UserRole(str, enum.Enum):
    student = "student"
    teacher = "teacher"


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


class ClassStatus(str, enum.Enum):
    scheduled = "scheduled"
    live = "live"
    ended = "ended"
    cancelled = "cancelled"


class ParticipationStatus(str, enum.Enum):
    joined = "joined"
    left = "left"


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


class SyncOperationStatus(str, enum.Enum):
    accepted = "accepted"
    rejected = "rejected"
    conflict = "conflict"
