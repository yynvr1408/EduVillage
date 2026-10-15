from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError
from app.db.models.course import Course, CourseEnrollment
from app.db.models.enums import CourseStatus, EnrollmentStatus, UserRole
from app.db.models.lesson import Lesson
from app.db.models.user import User


def _is_enrolled(db: Session, course_id: str, student_id: str) -> bool:
    enrollment = db.execute(
        select(CourseEnrollment).where(
            CourseEnrollment.course_id == course_id,
            CourseEnrollment.student_id == student_id,
            CourseEnrollment.status == EnrollmentStatus.active,
        )
    ).scalar_one_or_none()
    return enrollment is not None


def get_course_or_404(db: Session, course_id: str) -> Course:
    course = db.get(Course, course_id)
    if not course:
        raise NotFoundError("Course not found.")
    return course


def assert_can_view_course(db: Session, user: User, course: Course) -> None:
    if user.role == UserRole.teacher and course.teacher_id == user.id:
        return
    if user.role == UserRole.student and _is_enrolled(db, course.id, user.id):
        return
    if course.status == CourseStatus.published:
        return
    raise ForbiddenError("You do not have access to this course.")


def assert_enrolled(db: Session, user: User, course: Course) -> None:
    """Stricter than assert_can_view_course: a published course is viewable by anyone,
    but actions like submitting work require genuine enrollment (or being the owning teacher)."""
    if user.role == UserRole.teacher and course.teacher_id == user.id:
        return
    if user.role == UserRole.student and _is_enrolled(db, course.id, user.id):
        return
    raise ForbiddenError("You must be enrolled in this course to do that.")


def assert_owns_course(user: User, course: Course) -> None:
    if user.role != UserRole.teacher or course.teacher_id != user.id:
        raise ForbiddenError("Only the owning teacher can manage this course.")


def list_courses_for_user(db: Session, user: User) -> list[Course]:
    if user.role == UserRole.teacher:
        stmt = select(Course).where(Course.teacher_id == user.id)
    else:
        stmt = (
            select(Course)
            .join(CourseEnrollment, CourseEnrollment.course_id == Course.id)
            .where(CourseEnrollment.student_id == user.id, CourseEnrollment.status == EnrollmentStatus.active)
        )
    return list(db.execute(stmt.order_by(Course.created_at.desc())).scalars())


def create_course(db: Session, teacher: User, *, title: str, description: str | None, subject: str | None, status: CourseStatus) -> Course:
    course = Course(title=title, description=description, subject=subject, teacher_id=teacher.id, status=status)
    db.add(course)
    db.commit()
    db.refresh(course)
    return course


def update_course(db: Session, course: Course, **fields) -> Course:
    for key, value in fields.items():
        if value is not None:
            setattr(course, key, value)
    db.commit()
    db.refresh(course)
    return course


def list_lessons(db: Session, course_id: str) -> list[Lesson]:
    stmt = select(Lesson).where(Lesson.course_id == course_id).order_by(Lesson.position)
    return list(db.execute(stmt).scalars())


def get_lesson_or_404(db: Session, lesson_id: str) -> Lesson:
    lesson = db.get(Lesson, lesson_id)
    if not lesson:
        raise NotFoundError("Lesson not found.")
    return lesson


def create_lesson(db: Session, course: Course, *, title: str, content: str | None, position: int, status) -> Lesson:
    lesson = Lesson(course_id=course.id, title=title, content=content, position=position, status=status)
    db.add(lesson)
    db.commit()
    db.refresh(lesson)
    return lesson


def update_lesson(db: Session, lesson: Lesson, **fields) -> Lesson:
    for key, value in fields.items():
        if value is not None:
            setattr(lesson, key, value)
    db.commit()
    db.refresh(lesson)
    return lesson


def list_enrollments(db: Session, course_id: str) -> list[CourseEnrollment]:
    stmt = select(CourseEnrollment).where(CourseEnrollment.course_id == course_id)
    return list(db.execute(stmt).scalars())


def enroll_student(db: Session, course: Course, *, acting_user: User, student_id: str | None) -> CourseEnrollment:
    target_student_id = student_id or acting_user.id

    if acting_user.role == UserRole.student:
        if target_student_id != acting_user.id:
            raise ForbiddenError("Students may only enroll themselves.")
        if course.status != CourseStatus.published:
            raise ForbiddenError("This course is not open for self-enrollment.")
    else:
        assert_owns_course(acting_user, course)
        if not target_student_id:
            raise ForbiddenError("student_id is required when a teacher enrolls a student.")

    existing = db.execute(
        select(CourseEnrollment).where(
            CourseEnrollment.course_id == course.id, CourseEnrollment.student_id == target_student_id
        )
    ).scalar_one_or_none()
    if existing:
        if existing.status == EnrollmentStatus.active:
            raise ConflictError("This student is already enrolled.")
        existing.status = EnrollmentStatus.active
        db.commit()
        db.refresh(existing)
        return existing

    enrollment = CourseEnrollment(course_id=course.id, student_id=target_student_id, status=EnrollmentStatus.active)
    db.add(enrollment)
    db.commit()
    db.refresh(enrollment)
    return enrollment
