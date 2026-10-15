"""Optional demo data: `python -m app.seed` (run `alembic upgrade head` first).

Creates the two README demo accounts, a published course with one section and an assignment.
Idempotent — safe to run repeatedly. Refuses to run in production: these passwords are public."""

from sqlalchemy import select

from app.config import get_settings
from app.db.models.course import Course
from app.db.models.enums import AssignmentStatus, CourseStatus, UserRole
from app.db.models.section import Section
from app.db.models.user import User
from app.db.session import SessionLocal
from app.services import assignment_service, auth_service, course_service, section_service

DEMO_TEACHER = ("Dr. Elena Rostova", "teacher@eduvillage.org", "teacher123")
DEMO_STUDENT = ("Amina Diallo", "student@eduvillage.org", "student123")


def _get_or_create_user(db, full_name: str, email: str, password: str, role: UserRole) -> User:
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user:
        return user
    settings = get_settings()
    # Seeding is an operator action, so it bypasses the teacher-invite policy deliberately.
    saved, settings.teacher_invite_code = settings.teacher_invite_code, None
    try:
        return auth_service.register_user(db, full_name=full_name, email=email, password=password, role=role)
    finally:
        settings.teacher_invite_code = saved


def seed() -> None:
    if get_settings().is_production:
        raise SystemExit("Refusing to seed demo accounts with public passwords in production.")
    with SessionLocal() as db:
        teacher = _get_or_create_user(db, *DEMO_TEACHER, UserRole.teacher)
        student = _get_or_create_user(db, *DEMO_STUDENT, UserRole.student)

        course = db.execute(select(Course).where(Course.teacher_id == teacher.id, Course.title == "Introduction to Biology")).scalar_one_or_none()
        if course is None:
            course = course_service.create_course(
                db, teacher, title="Introduction to Biology", description="Cells, genetics and ecosystems.", subject="Biology",
                status=CourseStatus.published,
            )
            assignment_service.create_assignment(
                db, teacher, course.id, title="Cell structure quiz", instructions="Describe the main organelles.", due_at=None,
                status=AssignmentStatus.published,
            )
        try:
            course_service.enroll_student(db, course, acting_user=student, student_id=None)
        except Exception:  # already enrolled
            db.rollback()
        section = db.execute(select(Section).where(Section.course_id == course.id, Section.code == "CAMPUS")).scalar_one_or_none()
        if section is None:
            section = section_service.create_section(db, teacher, course, name="Campus cohort", code="campus")
        try:
            section_service.add_member(db, teacher, section, student_id=student.id)
        except Exception:  # already a member
            db.rollback()
    print("Seeded demo accounts:", DEMO_TEACHER[1], "/", DEMO_STUDENT[1])


if __name__ == "__main__":
    seed()
