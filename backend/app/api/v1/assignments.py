from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError
from app.core.permissions import require_role
from app.dependencies import get_current_user, get_db
from app.db.models.enums import UserRole
from app.db.models.user import User
from app.schemas.assignment import AssignmentCreate, AssignmentOut, AssignmentUpdate, SubmissionOut, SubmissionSave
from app.services import assignment_service, course_service

router = APIRouter(prefix="/assignments", tags=["assignments"])


@router.get("", response_model=list[AssignmentOut])
def list_assignments(course_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    course = course_service.get_course_or_404(db, course_id)
    course_service.assert_can_view_course(db, user, course)
    return [AssignmentOut.model_validate(a) for a in assignment_service.list_assignments(db, course_id)]


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
    course = course_service.get_course_or_404(db, assignment.course_id)
    course_service.assert_can_view_course(db, user, course)
    return AssignmentOut.model_validate(assignment)


@router.patch("/{assignment_id}", response_model=AssignmentOut)
def update_assignment(assignment_id: str, payload: AssignmentUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    assignment = assignment_service.get_assignment_or_404(db, assignment_id)
    assignment = assignment_service.update_assignment(db, user, assignment, **payload.model_dump())
    return AssignmentOut.model_validate(assignment)


@router.get("/{assignment_id}/submissions/me", response_model=SubmissionOut)
def get_my_submission(assignment_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    assignment = assignment_service.get_assignment_or_404(db, assignment_id)
    submission = assignment_service.get_my_submission(db, user, assignment)
    if not submission:
        raise NotFoundError("No submission saved yet.")
    return SubmissionOut.model_validate(submission)


@router.put("/{assignment_id}/submissions/me", response_model=SubmissionOut)
def save_my_submission(assignment_id: str, payload: SubmissionSave, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    assignment = assignment_service.get_assignment_or_404(db, assignment_id)
    submission = assignment_service.save_submission(db, user, assignment, answer=payload.answer, submit=payload.submit)
    return SubmissionOut.model_validate(submission)


@router.get("/{assignment_id}/submissions", response_model=list[SubmissionOut])
def list_submissions(assignment_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    assignment = assignment_service.get_assignment_or_404(db, assignment_id)
    return [SubmissionOut.model_validate(s) for s in assignment_service.list_submissions(db, user, assignment)]
