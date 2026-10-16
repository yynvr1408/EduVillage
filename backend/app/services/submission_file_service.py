"""PDF / Word files attached to a student's assignment submission.

Flow (same shape as teacher resource uploads): init -> the browser PUTs the bytes straight to storage -> complete.
`complete` measures the stored size and checks the file's real bytes against its extension, so a renamed file is
rejected and removed. Files are private to the student and the course's teachers."""

import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError, ValidationFailedError
from app.db.models.assignment import Assignment, SubmissionAttachment
from app.db.models.enums import UserRole
from app.db.models.user import User
from app.integrations.object_storage import get_storage
from app.services import assignment_service, audit_service, course_service, media_validation

settings = get_settings()

ALLOWED = {".pdf": "pdf", ".doc": "office_doc", ".docx": "office_zip"}
MAX_FILES = 5


def max_bytes() -> int:
    return settings.submission_max_mb * 1024 * 1024


def _storage_key(assignment_id: str, student_id: str, filename: str) -> str:
    return f"submissions/{assignment_id}/{student_id}/{uuid.uuid4()}-{filename}"


def _assert_may_change_files(db: Session, student: User, assignment: Assignment) -> None:
    """Adding or removing a file is part of editing the submission, so the same rules apply."""
    if student.role != UserRole.student:
        raise ForbiddenError("Only students can attach files to a submission.")
    course = course_service.get_course_or_404(db, assignment.course_id)
    course_service.assert_enrolled(db, student, course)
    assignment_service.assert_submission_open(assignment)
    assignment_service.assert_before_deadline(assignment)


def init_upload(db: Session, student: User, assignment: Assignment, *, filename: str, mime_type: str, size_bytes: int):
    _assert_may_change_files(db, student, assignment)
    clean = media_validation.sanitize_filename(filename)
    ext = media_validation.extension_of(clean)
    if ext not in ALLOWED:
        raise ValidationFailedError("Only PDF and Word documents (.pdf, .doc, .docx) can be attached.", code="UNSUPPORTED_FILE_TYPE")
    if size_bytes <= 0 or size_bytes > max_bytes():
        raise ValidationFailedError(f"Each file must be between 1 byte and {settings.submission_max_mb} MB.", code="FILE_TOO_LARGE")
    count = db.execute(
        select(func.count()).select_from(SubmissionAttachment).where(
            SubmissionAttachment.assignment_id == assignment.id, SubmissionAttachment.student_id == student.id
        )
    ).scalar_one()
    if count >= MAX_FILES:
        raise ConflictError(f"You can attach at most {MAX_FILES} files.", code="TOO_MANY_FILES")

    key = _storage_key(assignment.id, student.id, clean)
    attachment = SubmissionAttachment(
        assignment_id=assignment.id, student_id=student.id, storage_key=key, filename=clean, mime_type=mime_type[:120],
        size_bytes=0, status="pending",
    )
    db.add(attachment)
    db.commit()
    db.refresh(attachment)
    return attachment, get_storage().upload_target(key, mime_type)


def get_attachment_or_404(db: Session, assignment: Assignment, attachment_id: str) -> SubmissionAttachment:
    attachment = db.get(SubmissionAttachment, attachment_id)
    if not attachment or attachment.assignment_id != assignment.id:
        raise NotFoundError("Attachment not found.")
    return attachment


def _assert_owner(student: User, attachment: SubmissionAttachment) -> None:
    if attachment.student_id != student.id:
        raise NotFoundError("Attachment not found.")  # never confirm another student's file exists


def _discard(db: Session, attachment: SubmissionAttachment, storage) -> None:
    try:
        storage.delete(attachment.storage_key)
    except Exception:  # noqa: BLE001 - the rejection matters more than a cleanup failure
        pass
    db.delete(attachment)
    db.commit()


def complete_upload(db: Session, student: User, assignment: Assignment, attachment: SubmissionAttachment) -> SubmissionAttachment:
    _assert_owner(student, attachment)
    _assert_may_change_files(db, student, assignment)
    if attachment.status == "available":
        return attachment
    storage = get_storage()
    size = storage.verify_uploaded(attachment.storage_key)
    if size is None:
        raise ConflictError("The file was not found in storage. Upload it before completing.", code="UPLOAD_INCOMPLETE")
    if size <= 0 or size > max_bytes():
        _discard(db, attachment, storage)
        raise ValidationFailedError(f"Each file must be between 1 byte and {settings.submission_max_mb} MB.", code="FILE_TOO_LARGE")
    found = media_validation.sniff(storage.read_head(attachment.storage_key))
    expected = ALLOWED[media_validation.extension_of(attachment.filename)]
    if found.category != expected:
        _discard(db, attachment, storage)
        raise ValidationFailedError("The file's contents do not match its type; it was rejected.", code="CONTENT_MISMATCH")
    attachment.size_bytes = size
    attachment.detected_mime_type = found.mime_type
    attachment.status = "available"
    db.commit()
    db.refresh(attachment)
    audit_service.record(db, actor_id=student.id, action="submission_file_added", resource_type="assignment", resource_id=assignment.id)
    return attachment


def delete_attachment(db: Session, student: User, assignment: Assignment, attachment: SubmissionAttachment) -> None:
    _assert_owner(student, attachment)
    _assert_may_change_files(db, student, assignment)
    _discard(db, attachment, get_storage())
    audit_service.record(db, actor_id=student.id, action="submission_file_removed", resource_type="assignment", resource_id=assignment.id)


def list_for_student(db: Session, assignment_id: str, student_id: str) -> list[SubmissionAttachment]:
    return list(
        db.execute(
            select(SubmissionAttachment)
            .where(
                SubmissionAttachment.assignment_id == assignment_id,
                SubmissionAttachment.student_id == student_id,
                SubmissionAttachment.status == "available",
            )
            .order_by(SubmissionAttachment.created_at)
        ).scalars()
    )


def assert_can_download(db: Session, user: User, assignment: Assignment, attachment: SubmissionAttachment) -> None:
    course = course_service.get_course_or_404(db, assignment.course_id)
    if course_service.is_teaching(db, user, course):
        return
    if user.id == attachment.student_id:
        return
    raise NotFoundError("Attachment not found.")
