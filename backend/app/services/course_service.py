from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError
from app.db.models.assignment import Assignment
from app.db.models.classroom import Class
from app.db.models.course import Course, CourseEnrollment, CourseTeacher
from app.db.models.enums import CourseStatus, CourseTeacherRole, EnrollmentStatus, UserRole
from app.db.models.lesson import Lesson, LearningResource
from app.db.models.section import Section
from app.db.models.user import User
from app.services import audit_service


def _is_enrolled(db: Session, course_id: str, student_id: str) -> bool:
    enrollment = db.execute(
        select(CourseEnrollment).where(
            CourseEnrollment.course_id == course_id,
            CourseEnrollment.student_id == student_id,
            CourseEnrollment.status == EnrollmentStatus.active,
        )
    ).scalar_one_or_none()
    return enrollment is not None


def _is_co_teacher(db: Session, course_id: str, teacher_id: str) -> bool:
    row = db.execute(
        select(CourseTeacher).where(CourseTeacher.course_id == course_id, CourseTeacher.teacher_id == teacher_id)
    ).scalar_one_or_none()
    return row is not None


def is_teaching(db: Session, user: User, course: Course) -> bool:
    """True for the course owner and any added co-teacher. The single "do they manage
    this course" check — lets one scarce teacher be shared across sections/colleges."""
    if user.role != UserRole.teacher:
        return False
    return course.teacher_id == user.id or _is_co_teacher(db, course.id, user.id)


def get_course_or_404(db: Session, course_id: str) -> Course:
    course = db.get(Course, course_id)
    if not course:
        raise NotFoundError("Course not found.")
    return course


def assert_can_view_course(db: Session, user: User, course: Course) -> None:
    if is_teaching(db, user, course):
        return
    if user.role == UserRole.student and _is_enrolled(db, course.id, user.id):
        return
    if course.status == CourseStatus.published:
        return
    raise ForbiddenError("You do not have access to this course.")


def assert_enrolled(db: Session, user: User, course: Course) -> None:
    """Stricter than assert_can_view_course: a published course is viewable by anyone,
    but actions like submitting work require genuine enrollment (or being a teacher on it)."""
    if is_teaching(db, user, course):
        return
    if user.role == UserRole.student and _is_enrolled(db, course.id, user.id):
        return
    raise ForbiddenError("You must be enrolled in this course to do that.")


def assert_owns_course(db: Session, user: User, course: Course) -> None:
    if not is_teaching(db, user, course):
        raise ForbiddenError("Only a teacher on this course can manage it.")


def assert_is_primary_owner(user: User, course: Course) -> None:
    """Stricter than assert_owns_course: only the original course creator may add or
    remove co-teachers — a co-teacher can manage content but can't grant further access."""
    if user.role != UserRole.teacher or course.teacher_id != user.id:
        raise ForbiddenError("Only the course's original owner can manage its teacher list.")


def list_co_teachers(db: Session, course_id: str) -> list[CourseTeacher]:
    stmt = select(CourseTeacher).where(CourseTeacher.course_id == course_id)
    return list(db.execute(stmt).scalars())


def add_co_teacher(db: Session, owner: User, course: Course, *, teacher_id: str) -> CourseTeacher:
    assert_is_primary_owner(owner, course)
    if teacher_id == course.teacher_id:
        raise ConflictError("This user already owns the course.")
    existing = db.execute(
        select(CourseTeacher).where(CourseTeacher.course_id == course.id, CourseTeacher.teacher_id == teacher_id)
    ).scalar_one_or_none()
    if existing:
        raise ConflictError("This teacher is already added to the course.")

    co_teacher = CourseTeacher(course_id=course.id, teacher_id=teacher_id, role=CourseTeacherRole.co_teacher)
    db.add(co_teacher)
    db.commit()
    db.refresh(co_teacher)
    audit_service.record(
        db, actor_id=owner.id, action="co_teacher_added", resource_type="course", resource_id=course.id
    )
    return co_teacher


def remove_co_teacher(db: Session, owner: User, course: Course, *, teacher_id: str) -> None:
    assert_is_primary_owner(owner, course)
    existing = db.execute(
        select(CourseTeacher).where(CourseTeacher.course_id == course.id, CourseTeacher.teacher_id == teacher_id)
    ).scalar_one_or_none()
    if not existing:
        raise NotFoundError("This teacher is not on the course.")
    db.delete(existing)
    db.commit()
    audit_service.record(
        db, actor_id=owner.id, action="co_teacher_removed", resource_type="course", resource_id=course.id
    )


def list_courses_for_user(db: Session, user: User, *, limit: int = 50, offset: int = 0) -> list[Course]:
    from app.utils.pagination import paginate

    if user.role == UserRole.teacher:
        co_taught_ids = select(CourseTeacher.course_id).where(CourseTeacher.teacher_id == user.id)
        stmt = select(Course).where((Course.teacher_id == user.id) | Course.id.in_(co_taught_ids))
    else:
        stmt = (
            select(Course)
            .join(CourseEnrollment, CourseEnrollment.course_id == Course.id)
            .where(CourseEnrollment.student_id == user.id, CourseEnrollment.status == EnrollmentStatus.active)
        )
    return paginate(db, stmt.order_by(Course.created_at.desc()), limit=limit, offset=offset)


def list_catalog(
    db: Session,
    *,
    limit: int = 50,
    offset: int = 0,
    subject: str | None = None,
) -> list[Course]:
    """Published courses anyone can browse before enrolling. The subject filter is a discovery aid, not
    access control — a student not matching it can still find and enroll in a course
    by browsing without filters; nothing here restricts who may enroll (see enroll_student)."""
    from app.utils.pagination import paginate

    stmt = select(Course).where(Course.status == CourseStatus.published)
    if subject:
        stmt = stmt.where(Course.subject == subject)
    stmt = stmt.order_by(Course.created_at.desc())
    return paginate(db, stmt, limit=limit, offset=offset)


def create_course(
    db: Session,
    teacher: User,
    *,
    title: str,
    description: str | None,
    subject: str | None,
    status: CourseStatus,
) -> Course:
    course = Course(
        title=title,
        description=description,
        subject=subject,
        teacher_id=teacher.id,
        status=status,
    )
    db.add(course)
    db.commit()
    db.refresh(course)
    audit_service.record(db, actor_id=teacher.id, action="course_created", resource_type="course", resource_id=course.id)
    return course


def update_course(db: Session, course: Course, **fields) -> Course:
    for key, value in fields.items():
        if value is not None:
            setattr(course, key, value)
    db.commit()
    db.refresh(course)
    return course


def _course_has_activity(db: Session, course_id: str) -> bool:
    """True if anything beyond the bare course record exists for it — any one of these is
    enough reason to archive instead of destroy (never silently drop student work, content a
    teacher authored, or scheduled/historical classes)."""
    checks = (
        select(CourseEnrollment.id).where(CourseEnrollment.course_id == course_id),
        select(Lesson.id).where(Lesson.course_id == course_id),
        select(LearningResource.id).where(LearningResource.course_id == course_id),
        select(Class.id).where(Class.course_id == course_id),
        select(Section.id).where(Section.course_id == course_id),
        select(Assignment.id).where(Assignment.course_id == course_id),
        select(CourseTeacher.id).where(CourseTeacher.course_id == course_id),
    )
    return any(db.execute(stmt.limit(1)).first() is not None for stmt in checks)


def delete_or_archive_course(db: Session, teacher: User, course: Course, *, force: bool = False) -> tuple[bool, Course | None]:
    """The real delete action. A genuinely empty, untouched draft is permanently removed
    (returns (True, None)); anything with real activity is archived instead, same as
    archive_course (returns (False, course)) — this is the hard guardrail the plan itself
    calls for: "do not cascade-delete ... simply because a course is deleted".

    force=True is a second, more deliberate action only honored when the course is ALREADY
    archived: it has no active role left (out of the catalog, out of self-enrollment, already a
    teacher's conscious decision to retire it), so a teacher explicitly asking to permanently
    remove it from that state is let through even with historical activity attached. force on a
    still-active course is ignored — that path keeps the automatic archive fallback."""
    assert_owns_course(db, teacher, course)
    if force and course.status == CourseStatus.archived:
        course_id = course.id
        db.delete(course)
        db.commit()
        audit_service.record(db, actor_id=teacher.id, action="course_force_deleted", resource_type="course", resource_id=course_id)
        return True, None

    if _course_has_activity(db, course.id):
        return False, archive_course(db, teacher, course)

    course_id = course.id
    db.delete(course)
    db.commit()
    audit_service.record(db, actor_id=teacher.id, action="course_deleted", resource_type="course", resource_id=course_id)
    return True, None


def archive_course(db: Session, teacher: User, course: Course) -> Course:
    """The only supported "delete": always archives rather than removing the row. A course
    may already carry enrollments, lessons, assignments and class history, and this app never
    cascade-deletes that activity just because a teacher wants a course off their active list.
    Archived courses drop out of the catalog (list_catalog filters on published) and out of
    self-enrollment, but stay visible to their teacher and already-enrolled students — nothing
    is hidden or lost. Idempotent: archiving an already-archived course is a no-op."""
    assert_owns_course(db, teacher, course)
    if course.status == CourseStatus.archived:
        return course
    course.status = CourseStatus.archived
    db.commit()
    db.refresh(course)
    audit_service.record(db, actor_id=teacher.id, action="course_archived", resource_type="course", resource_id=course.id)
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
        assert_owns_course(db, acting_user, course)
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
