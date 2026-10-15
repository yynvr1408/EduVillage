from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from ..database.session import get_db
from ..database.models import User, Course, Lesson, Material
from ..schemas.schemas import CourseCreate, CourseOut, CourseDetailOut, LessonCreate, LessonOut, MaterialOut
from ..services.auth import get_current_user, require_role

router = APIRouter(prefix="/api", tags=["courses"])


@router.get("/courses", response_model=List[CourseOut])
def list_courses(db: Session = Depends(get_db)):
    courses = db.query(Course).all()
    out = []
    for c in courses:
        out.append(CourseOut(
            id=c.id,
            title=c.title,
            code=c.code,
            description=c.description,
            teacher_id=c.teacher_id,
            teacher_name=c.teacher.full_name if c.teacher else "Instructor",
            created_at=c.created_at,
            lessons_count=len(c.lessons),
        ))
    return out


@router.post("/courses", response_model=CourseOut)
def create_course(
    req: CourseCreate,
    current_user: User = Depends(require_role(["teacher"])),
    db: Session = Depends(get_db)
):
    course = Course(
        title=req.title,
        code=req.code,
        description=req.description,
        teacher_id=current_user.id,
    )
    db.add(course)
    db.commit()
    db.refresh(course)
    return CourseOut(
        id=course.id,
        title=course.title,
        code=course.code,
        description=course.description,
        teacher_id=course.teacher_id,
        teacher_name=current_user.full_name,
        created_at=course.created_at,
        lessons_count=0,
    )


@router.get("/courses/{course_id}", response_model=CourseDetailOut)
def get_course(course_id: str, db: Session = Depends(get_db)):
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    
    lessons_out = [
        LessonOut.from_orm(l) for l in sorted(course.lessons, key=lambda x: x.order_index)
    ]
    return CourseDetailOut(
        id=course.id,
        title=course.title,
        code=course.code,
        description=course.description,
        teacher_id=course.teacher_id,
        teacher_name=course.teacher.full_name if course.teacher else "Instructor",
        created_at=course.created_at,
        lessons_count=len(course.lessons),
        lessons=lessons_out,
    )


@router.post("/courses/{course_id}/lessons", response_model=LessonOut)
def create_lesson(
    course_id: str,
    req: LessonCreate,
    current_user: User = Depends(require_role(["teacher"])),
    db: Session = Depends(get_db)
):
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    if course.teacher_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only course teacher can add lessons")

    lesson = Lesson(
        course_id=course.id,
        title=req.title,
        description=req.description,
        order_index=req.order_index,
        content=req.content,
        offline_ready=req.offline_ready,
    )
    db.add(lesson)
    db.commit()
    db.refresh(lesson)
    return lesson


@router.get("/lessons/{lesson_id}", response_model=LessonOut)
def get_lesson(lesson_id: str, db: Session = Depends(get_db)):
    lesson = db.query(Lesson).filter(Lesson.id == lesson_id).first()
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    return lesson


@router.get("/lessons/{lesson_id}/assets", response_model=List[MaterialOut])
def get_lesson_assets(lesson_id: str, db: Session = Depends(get_db)):
    materials = db.query(Material).filter(Material.lesson_id == lesson_id, Material.is_published == True).all()
    return materials
