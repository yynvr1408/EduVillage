from datetime import timezone

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


def assert_can_view_assignment(db: Session, user: User, assignment: Assignment) -> None:
    """Teachers on the course see everything (drafts included). Everyone else needs real
    enrollment, and unpublished (draft) assignments don't exist as far as they're concerned."""
    course = course_service.get_course_or_404(db, assignment.course_id)
    if course_service.is_teaching(db, user, course):
        return
    course_service.assert_enrolled(db, user, course)
    if assignment.status == AssignmentStatus.draft:
        raise NotFoundError("Assignment not found.")


def list_assignments(db: Session, user: User, course_id: str | None = None) -> list[Assignment]:
    """Assignments for one course, or (no course_id) across every course the user is on."""
    if course_id:
        course = course_service.get_course_or_404(db, course_id)
        course_ids = [course.id]
        teaching = course_service.is_teaching(db, user, course)
        if not teaching:
            course_service.assert_enrolled(db, user, course)
    else:
        courses = course_service.list_courses_for_user(db, user, limit=200)
        course_ids = [c.id for c in courses]
        teaching = user.role == UserRole.teacher
    if not course_ids:
        return []
    stmt = select(Assignment).where(Assignment.course_id.in_(course_ids)).order_by(Assignment.created_at.desc())
    if not teaching:
        stmt = stmt.where(Assignment.status != AssignmentStatus.draft)
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


def assert_before_deadline(assignment: Assignment, *, as_of=None) -> None:
    """The deadline is judged by SERVER time (`as_of` lets an offline submission be judged by when the
    student made it — see synchronization_service for the bounded grace policy)."""
    if assignment.due_at is None:
        return
    moment = as_of or utcnow()
    if moment > assignment.due_at:
        raise ConflictError(
            "The deadline for this assignment has passed; the submission was not accepted.", code="SUBMISSION_EXPIRED"
        )


def assert_submission_open(assignment: Assignment, *, is_teacher: bool = False) -> None:
    if assignment.status == AssignmentStatus.closed:
        raise ConflictError("This assignment is closed and no longer accepts submissions.", code="ASSIGNMENT_CLOSED")
    if assignment.status != AssignmentStatus.published and not is_teacher:
        raise ConflictError("This assignment is not open for submissions.", code="ASSIGNMENT_NOT_PUBLISHED")


def save_submission(
    db: Session, student: User, assignment: Assignment, *, answer: dict, submit: bool, commit: bool = True, as_of=None
) -> AssignmentSubmission:
    """commit=False leaves the transaction open (flushed) so the sync service can persist the
    submission and its idempotency record atomically."""
    if student.role != UserRole.student:
        raise ForbiddenError("Only students can submit assignments.")

    course = course_service.get_course_or_404(db, assignment.course_id)
    course_service.assert_enrolled(db, student, course)

    assert_submission_open(assignment, is_teacher=course_service.is_teaching(db, student, course))
    # The deadline applies to a final submission. Saving a draft after it is still allowed, so nothing the
    # student already typed is lost (a late draft is never counted as submitted).
    if submit:
        assert_before_deadline(assignment, as_of=as_of)

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

    if commit:
        db.commit()
        db.refresh(submission)
    else:
        db.flush()
    return submission


def list_submissions(db: Session, teacher: User, assignment: Assignment, *, limit: int = 50, offset: int = 0) -> list[AssignmentSubmission]:
    from app.utils.pagination import paginate

    course = course_service.get_course_or_404(db, assignment.course_id)
    course_service.assert_owns_course(db, teacher, course)
    stmt = select(AssignmentSubmission).where(AssignmentSubmission.assignment_id == assignment.id)
    return paginate(db, stmt, limit=limit, offset=offset)
