from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.base import utcnow
from app.db.models.assignment import Assignment, AssignmentSubmission
from app.db.models.classroom import Class
from app.db.models.enums import AssignmentStatus, ClassStatus, SubmissionStatus, SummaryStatus
from app.db.models.summary import LectureSummary
from app.db.models.user import User
from app.services import course_service


def student_dashboard(db: Session, student: User) -> dict:
    courses = course_service.list_courses_for_user(db, student)
    course_ids = [c.id for c in courses]

    upcoming_classes: list[Class] = []
    pending_assignments: list[Assignment] = []
    if course_ids:
        upcoming_classes = list(
            db.execute(
                select(Class)
                .where(Class.course_id.in_(course_ids), Class.status.in_([ClassStatus.scheduled, ClassStatus.live]))
                .order_by(Class.scheduled_start)
                .limit(10)
            ).scalars()
        )
        assignments = list(
            db.execute(
                select(Assignment).where(
                    Assignment.course_id.in_(course_ids), Assignment.status == AssignmentStatus.published
                )
            ).scalars()
        )
        submitted_ids = {
            s.assignment_id
            for s in db.execute(
                select(AssignmentSubmission).where(
                    AssignmentSubmission.student_id == student.id, AssignmentSubmission.status == SubmissionStatus.submitted
                )
            ).scalars()
        }
        pending_assignments = [a for a in assignments if a.id not in submitted_ids]

    return {
        "user": {"id": student.id, "full_name": student.full_name, "role": student.role.value},
        "courses": courses,
        "upcoming_classes": upcoming_classes,
        "pending_assignments": pending_assignments,
    }


def teacher_dashboard(db: Session, teacher: User) -> dict:
    courses = course_service.list_courses_for_user(db, teacher)
    course_ids = [c.id for c in courses]

    upcoming_classes: list[Class] = []
    review_queue: list[LectureSummary] = []
    if course_ids:
        upcoming_classes = list(
            db.execute(
                select(Class)
                .where(Class.course_id.in_(course_ids), Class.status.in_([ClassStatus.scheduled, ClassStatus.live]))
                .order_by(Class.scheduled_start)
                .limit(10)
            ).scalars()
        )
        class_ids = [c.id for c in db.execute(select(Class).where(Class.course_id.in_(course_ids))).scalars()]
        if class_ids:
            review_queue = list(
                db.execute(
                    select(LectureSummary).where(
                        LectureSummary.class_id.in_(class_ids), LectureSummary.status == SummaryStatus.needs_review
                    )
                ).scalars()
            )

    return {
        "user": {"id": teacher.id, "full_name": teacher.full_name, "role": teacher.role.value},
        "courses": courses,
        "upcoming_classes": upcoming_classes,
        "review_queue": review_queue,
    }
