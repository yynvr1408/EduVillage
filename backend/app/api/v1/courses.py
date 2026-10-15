from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.permissions import require_role
from app.dependencies import get_current_user, get_db
from app.db.models.enums import UserRole
from app.db.models.user import User
from app.schemas.course import CoTeacherCreate, CoTeacherOut, CourseCreate, CourseDeleteOut, CourseOut, CourseUpdate, EnrollmentCreate, EnrollmentOut
from app.schemas.lesson import LessonCreate, LessonOut, LessonUpdate
from app.services import course_service

router = APIRouter(tags=["courses"])


def _course_out(db: Session, course) -> CourseOut:
    out = CourseOut.model_validate(course)
    teacher = db.get(User, course.teacher_id)
    out.teacher_name = teacher.full_name if teacher else None
    return out


@router.get("/courses", response_model=list[CourseOut])
def list_courses(limit: int = 50, offset: int = 0, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    courses = course_service.list_courses_for_user(db, user, limit=limit, offset=offset)
    return [_course_out(db, c) for c in courses]


@router.get("/courses/catalog", response_model=list[CourseOut])
def course_catalog(
    limit: int = 50,
    offset: int = 0,
    subject: str | None = None,
    grade_level: str | None = None,
    language: str | None = None,
    institution: str | None = None,
    region: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Published courses a student can browse and then self-enroll in."""
    courses = course_service.list_catalog(
        db, limit=limit, offset=offset, subject=subject, grade_level=grade_level, language=language, institution=institution, region=region
    )
    return [_course_out(db, c) for c in courses]


@router.post("/courses", response_model=CourseOut, status_code=201)
def create_course(payload: CourseCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_role(user, UserRole.teacher)
    course = course_service.create_course(
        db,
        user,
        title=payload.title,
        description=payload.description,
        subject=payload.subject,
        grade_level=payload.grade_level,
        language=payload.language,
        institution=payload.institution,
        region=payload.region,
        status=payload.status,
    )
    return CourseOut.model_validate(course)


@router.get("/courses/{course_id}", response_model=CourseOut)
def get_course(course_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    course = course_service.get_course_or_404(db, course_id)
    course_service.assert_can_view_course(db, user, course)
    return _course_out(db, course)


@router.patch("/courses/{course_id}", response_model=CourseOut)
def update_course(
    course_id: str, payload: CourseUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    course = course_service.get_course_or_404(db, course_id)
    course_service.assert_owns_course(db, user, course)
    course = course_service.update_course(db, course, **payload.model_dump())
    return CourseOut.model_validate(course)


@router.delete("/courses/{course_id}", response_model=CourseDeleteOut)
def delete_course(
    course_id: str, force: bool = False, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Permanently deletes an empty, untouched draft; archives (never destroys) anything with
    real activity. force=true permanently deletes an already-archived course regardless of its
    history — only honored once a course is already archived. See
    course_service.delete_or_archive_course."""
    course = course_service.get_course_or_404(db, course_id)
    deleted, remaining = course_service.delete_or_archive_course(db, user, course, force=force)
    return CourseDeleteOut(deleted=deleted, course=_course_out(db, remaining) if remaining else None)


@router.get("/courses/{course_id}/lessons", response_model=list[LessonOut])
def list_lessons(course_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    course = course_service.get_course_or_404(db, course_id)
    course_service.assert_can_view_course(db, user, course)
    return [LessonOut.model_validate(lesson) for lesson in course_service.list_lessons(db, course_id)]


@router.post("/courses/{course_id}/lessons", response_model=LessonOut, status_code=201)
def create_lesson(
    course_id: str, payload: LessonCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    course = course_service.get_course_or_404(db, course_id)
    course_service.assert_owns_course(db, user, course)
    lesson = course_service.create_lesson(
        db, course, title=payload.title, content=payload.content, position=payload.position, status=payload.status
    )
    return LessonOut.model_validate(lesson)


@router.get("/lessons/{lesson_id}", response_model=LessonOut)
def get_lesson(lesson_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    lesson = course_service.get_lesson_or_404(db, lesson_id)
    course = course_service.get_course_or_404(db, lesson.course_id)
    course_service.assert_can_view_course(db, user, course)
    return LessonOut.model_validate(lesson)


@router.patch("/lessons/{lesson_id}", response_model=LessonOut)
def update_lesson(
    lesson_id: str, payload: LessonUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    lesson = course_service.get_lesson_or_404(db, lesson_id)
    course = course_service.get_course_or_404(db, lesson.course_id)
    course_service.assert_owns_course(db, user, course)
    lesson = course_service.update_lesson(db, lesson, **payload.model_dump())
    return LessonOut.model_validate(lesson)


@router.get("/courses/{course_id}/enrollments", response_model=list[EnrollmentOut])
def list_enrollments(course_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    course = course_service.get_course_or_404(db, course_id)
    course_service.assert_owns_course(db, user, course)
    return [EnrollmentOut.model_validate(e) for e in course_service.list_enrollments(db, course_id)]


@router.post("/courses/{course_id}/enrollments", response_model=EnrollmentOut, status_code=201)
def create_enrollment(
    course_id: str, payload: EnrollmentCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    course = course_service.get_course_or_404(db, course_id)
    enrollment = course_service.enroll_student(db, course, acting_user=user, student_id=payload.student_id)
    return EnrollmentOut.model_validate(enrollment)


@router.get("/courses/{course_id}/teachers", response_model=list[CoTeacherOut])
def list_co_teachers(course_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    course = course_service.get_course_or_404(db, course_id)
    course_service.assert_owns_course(db, user, course)
    return [CoTeacherOut.model_validate(t) for t in course_service.list_co_teachers(db, course_id)]


@router.post("/courses/{course_id}/teachers", response_model=CoTeacherOut, status_code=201)
def add_co_teacher(
    course_id: str, payload: CoTeacherCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    course = course_service.get_course_or_404(db, course_id)
    co_teacher = course_service.add_co_teacher(db, user, course, teacher_id=payload.teacher_id)
    return CoTeacherOut.model_validate(co_teacher)


@router.delete("/courses/{course_id}/teachers/{teacher_id}", status_code=204)
def remove_co_teacher(course_id: str, teacher_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    course = course_service.get_course_or_404(db, course_id)
    course_service.remove_co_teacher(db, user, course, teacher_id=teacher_id)
    return None
