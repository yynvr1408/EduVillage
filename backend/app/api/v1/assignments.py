from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError
from app.core.permissions import require_role
from app.dependencies import get_current_user, get_db
from app.db.models.enums import UserRole
from app.db.models.user import User
from app.integrations.object_storage import LocalObjectStorage, get_storage
from app.schemas.assignment import (
    AssignmentCreate,
    AssignmentOut,
    AssignmentUpdate,
    AttachmentInitRequest,
    AttachmentInitResponse,
    AttachmentOut,
    SubmissionOut,
    SubmissionSave,
)
from app.services import assignment_service, course_service, submission_file_service


def _submission_out(db: Session, submission) -> SubmissionOut:
    out = SubmissionOut.model_validate(submission)
    out.attachments = [AttachmentOut.model_validate(a) for a in submission_file_service.list_for_student(db, submission.assignment_id, submission.student_id)]
    return out

router = APIRouter(prefix="/assignments", tags=["assignments"])


@router.get("", response_model=list[AssignmentOut])
def list_assignments(course_id: str | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return [AssignmentOut.model_validate(a) for a in assignment_service.list_assignments(db, user, course_id)]


@router.post("", response_model=AssignmentOut, status_code=201)
def create_assignment(payload: AssignmentCreate, course_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_role(user, UserRole.teacher)
    assignment = assignment_service.create_assignment(
        db, user, course_id, title=payload.title, instructions=payload.instructions, due_at=payload.due_at, status=payload.status
    )
    return AssignmentOut.model_validate(assignment)


@router.get("/{assignment_id}", response_model=AssignmentOut)
def get_assignment(assignment_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    assignment = assignment_service.get_assignment_or_404(db, assignment_id)
    assignment_service.assert_can_view_assignment(db, user, assignment)
    return AssignmentOut.model_validate(assignment)


@router.patch("/{assignment_id}", response_model=AssignmentOut)
def update_assignment(assignment_id: str, payload: AssignmentUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    assignment = assignment_service.get_assignment_or_404(db, assignment_id)
    assignment = assignment_service.update_assignment(db, user, assignment, **payload.model_dump())
    return AssignmentOut.model_validate(assignment)


@router.get("/{assignment_id}/submissions/me", response_model=SubmissionOut)
def get_my_submission(assignment_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    assignment = assignment_service.get_assignment_or_404(db, assignment_id)
    assignment_service.assert_can_view_assignment(db, user, assignment)
    submission = assignment_service.get_my_submission(db, user, assignment)
    if not submission:
        raise NotFoundError("No submission saved yet.")
    return _submission_out(db, submission)


@router.put("/{assignment_id}/submissions/me", response_model=SubmissionOut)
def save_my_submission(assignment_id: str, payload: SubmissionSave, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    assignment = assignment_service.get_assignment_or_404(db, assignment_id)
    submission = assignment_service.save_submission(db, user, assignment, answer=payload.answer, submit=payload.submit)
    return _submission_out(db, submission)


@router.get("/{assignment_id}/submissions", response_model=list[SubmissionOut])
def list_submissions(
    assignment_id: str, limit: int = 50, offset: int = 0, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    assignment = assignment_service.get_assignment_or_404(db, assignment_id)
    submissions = assignment_service.list_submissions(db, user, assignment, limit=limit, offset=offset)
    return [_submission_out(db, s) for s in submissions]


# ---- files attached to a submission (PDF / Word) ----------------------------------------------------

@router.get("/{assignment_id}/attachments", response_model=list[AttachmentOut])
def list_my_attachments(assignment_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """The caller's own attached files (a student sees theirs; teachers read files through the submissions list)."""
    assignment = assignment_service.get_assignment_or_404(db, assignment_id)
    assignment_service.assert_can_view_assignment(db, user, assignment)
    return [AttachmentOut.model_validate(a) for a in submission_file_service.list_for_student(db, assignment.id, user.id)]


@router.post("/{assignment_id}/attachments", response_model=AttachmentInitResponse, status_code=201)
def init_attachment(
    assignment_id: str, payload: AttachmentInitRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    assignment = assignment_service.get_assignment_or_404(db, assignment_id)
    attachment, target = submission_file_service.init_upload(
        db, user, assignment, filename=payload.filename, mime_type=payload.mime_type, size_bytes=payload.size_bytes
    )
    if target.get("url", "").startswith("/api/v1/resources/upload-content/"):
        # local storage: bytes go to this API (the student-specific endpoint below), not the teacher resource one
        target = {**target, "url": f"/api/v1/assignments/attachments/upload-content/{attachment.storage_key}"}
    return AttachmentInitResponse(attachment_id=attachment.id, upload=target)


@router.put("/attachments/upload-content/{storage_key:path}", status_code=204)
async def upload_attachment_content(storage_key: str, request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Local-storage upload target for submission files (S3/R2 uploads go straight to the presigned URL)."""
    from sqlalchemy import select

    from app.core.exceptions import ConflictError, ValidationFailedError
    from app.db.models.assignment import SubmissionAttachment

    attachment = db.execute(select(SubmissionAttachment).where(SubmissionAttachment.storage_key == storage_key)).scalar_one_or_none()
    if not attachment or attachment.student_id != user.id:
        raise NotFoundError("Attachment not found.")
    storage = get_storage()
    if not isinstance(storage, LocalObjectStorage):
        raise NotFoundError("This endpoint only applies to local storage.")
    if attachment.status != "pending":
        raise ConflictError("This upload has already been completed.", code="UPLOAD_ALREADY_COMPLETE")
    try:
        await storage.write_stream(storage_key, request.stream(), submission_file_service.max_bytes())
    except ValueError as exc:
        if str(exc) == "too_large":
            raise ValidationFailedError("The file is too large.", code="FILE_TOO_LARGE")
        raise ValidationFailedError("The uploaded file is empty.", code="EMPTY_FILE")
    return None


@router.post("/{assignment_id}/attachments/{attachment_id}/complete", response_model=AttachmentOut)
def complete_attachment(assignment_id: str, attachment_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    assignment = assignment_service.get_assignment_or_404(db, assignment_id)
    attachment = submission_file_service.get_attachment_or_404(db, assignment, attachment_id)
    return AttachmentOut.model_validate(submission_file_service.complete_upload(db, user, assignment, attachment))


@router.delete("/{assignment_id}/attachments/{attachment_id}", status_code=204)
def delete_attachment(assignment_id: str, attachment_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    assignment = assignment_service.get_assignment_or_404(db, assignment_id)
    attachment = submission_file_service.get_attachment_or_404(db, assignment, attachment_id)
    submission_file_service.delete_attachment(db, user, assignment, attachment)
    return None


@router.get("/{assignment_id}/attachments/{attachment_id}/download")
def download_attachment(assignment_id: str, attachment_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    assignment = assignment_service.get_assignment_or_404(db, assignment_id)
    attachment = submission_file_service.get_attachment_or_404(db, assignment, attachment_id)
    submission_file_service.assert_can_download(db, user, assignment, attachment)
    if attachment.status != "available":
        raise NotFoundError("Attachment not found.")
    storage = get_storage()
    if isinstance(storage, LocalObjectStorage):
        return FileResponse(storage.read_path(attachment.storage_key), filename=attachment.filename, media_type=attachment.detected_mime_type or attachment.mime_type)
    return RedirectResponse(url=storage.download_target(attachment.storage_key)["url"])
