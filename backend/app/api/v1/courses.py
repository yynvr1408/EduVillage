from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.permissions import require_role
from app.dependencies import get_current_user, get_db
from app.db.models.enums import UserRole
from app.db.models.user import User
from app.schemas.course import CourseCreate, CourseOut, CourseUpdate, EnrollmentCreate, EnrollmentOut
from app.schemas.lesson import LessonCreate, LessonOut, LessonUpdate
from app.services import course_service

router = APIRouter(tags=["courses"])


@router.get("/courses", response_model=list[CourseOut])
def list_courses(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return [CourseOut.model_validate(c) for c in course_service.list_courses_for_user(db, user)]


@router.post("/courses", response_model=CourseOut, status_code=201)
def create_course(payload: CourseCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_role(user, UserRole.teacher)
    course = course_service.create_course(
        db, user, title=payload.title, description=payload.description, subject=payload.subject, status=payload.status
    )
    return CourseOut.model_validate(course)


@router.get("/courses/{course_id}", response_model=CourseOut)
def get_course(course_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    course = course_service.get_course_or_404(db, course_id)
    course_service.assert_can_view_course(db, user, course)
    return CourseOut.model_validate(course)


@router.patch("/courses/{course_id}", response_model=CourseOut)
def update_course(
    course_id: str, payload: CourseUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    course = course_service.get_course_or_404(db, course_id)
    course_service.assert_owns_course(user, course)
    course = course_service.update_course(db, course, **payload.model_dump())
    return CourseOut.model_validate(course)


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
    course_service.assert_owns_course(user, course)
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
    course_service.assert_owns_course(user, course)
    lesson = course_service.update_lesson(db, lesson, **payload.model_dump())
    return LessonOut.model_validate(lesson)


@router.get("/courses/{course_id}/enrollments", response_model=list[EnrollmentOut])
def list_enrollments(course_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    course = course_service.get_course_or_404(db, course_id)
    course_service.assert_owns_course(user, course)
    return [EnrollmentOut.model_validate(e) for e in course_service.list_enrollments(db, course_id)]


@router.post("/courses/{course_id}/enrollments", response_model=EnrollmentOut, status_code=201)
def create_enrollment(
    course_id: str, payload: EnrollmentCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    course = course_service.get_course_or_404(db, course_id)
    enrollment = course_service.enroll_student(db, course, acting_user=user, student_id=payload.student_id)
    return EnrollmentOut.model_validate(enrollment)
