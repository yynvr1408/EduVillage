from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError
from app.db.base import utcnow
from app.db.models.assignment import Assignment, AssignmentSubmission, SubmissionRevision
from app.db.models.enums import AssignmentStatus, SubmissionStatus, UserRole
from app.db.models.user import User
from app.services import course_service


def get_assignment_or_404(db: Session, assignment_id: str) -> Assignment:
    assignment = db.get(Assignment, assignment_id)
    if not assignment:
        raise NotFoundError("Assignment not found.")
    return assignment


def list_assignments(db: Session, course_id: str) -> list[Assignment]:
    stmt = select(Assignment).where(Assignment.course_id == course_id)
    return list(db.execute(stmt).scalars())


def create_assignment(db: Session, teacher: User, course_id: str, *, title: str, instructions: str | None, due_at, status) -> Assignment:
    course = course_service.get_course_or_404(db, course_id)
    course_service.assert_owns_course(db, teacher, course)
    assignment = Assignment(course_id=course_id, created_by=teacher.id, title=title, instructions=instructions, due_at=due_at, status=status)
    db.add(assignment)
    db.commit()
    db.refresh(assignment)
    return assignment


def update_assignment(db: Session, teacher: User, assignment: Assignment, **fields) -> Assignment:
    course = course_service.get_course_or_404(db, assignment.course_id)
    course_service.assert_owns_course(db, teacher, course)
    for key, value in fields.items():
        if value is not None:
            setattr(assignment, key, value)
    db.commit()
    db.refresh(assignment)
    return assignment


def _get_submission(db: Session, assignment_id: str, student_id: str) -> AssignmentSubmission | None:
    return db.execute(
        select(AssignmentSubmission).where(
            AssignmentSubmission.assignment_id == assignment_id, AssignmentSubmission.student_id == student_id
        )
    ).scalar_one_or_none()


def get_my_submission(db: Session, student: User, assignment: Assignment) -> AssignmentSubmission | None:
    return _get_submission(db, assignment.id, student.id)


def save_submission(db: Session, student: User, assignment: Assignment, *, answer: dict, submit: bool) -> AssignmentSubmission:
    if student.role != UserRole.student:
        raise ForbiddenError("Only students can submit assignments.")

    course = course_service.get_course_or_404(db, assignment.course_id)
    course_service.assert_enrolled(db, student, course)

    if assignment.status == AssignmentStatus.closed:
        raise ConflictError("This assignment is closed and no longer accepts submissions.", code="ASSIGNMENT_CLOSED")

    submission = _get_submission(db, assignment.id, student.id)
    if submission is None:
        submission = AssignmentSubmission(
            assignment_id=assignment.id,
            student_id=student.id,
            answer=answer,
            status=SubmissionStatus.draft,
            version=1,
            updated_at=utcnow(),
        )
        db.add(submission)
    else:
        # Any edit after a prior save (draft or submitted) is recorded as a new revision.
        submission.answer = answer
        submission.version += 1
        submission.updated_at = utcnow()

        db.add(
            SubmissionRevision(
                submission_id=submission.id,
                revision_number=submission.version,
                answer_snapshot=answer,
                created_at=utcnow(),
            )
        )

    if submit:
        submission.status = SubmissionStatus.submitted
        submission.submitted_at = utcnow()
    else:
        submission.status = SubmissionStatus.draft

    db.commit()
    db.refresh(submission)
    return submission


def list_submissions(db: Session, teacher: User, assignment: Assignment, *, limit: int = 50, offset: int = 0) -> list[AssignmentSubmission]:
    from app.utils.pagination import paginate

    course = course_service.get_course_or_404(db, assignment.course_id)
    course_service.assert_owns_course(db, teacher, course)
    stmt = select(AssignmentSubmission).where(AssignmentSubmission.assignment_id == assignment.id)
    return paginate(db, stmt, limit=limit, offset=offset)
