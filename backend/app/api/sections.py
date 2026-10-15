from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from ..database.session import get_db
from ..database.models import User, Course, Section
from ..schemas.schemas import SectionCreate, SectionOut
from ..services.auth import require_role

router = APIRouter(prefix="/api/sections", tags=["sections"])


@router.get("", response_model=List[SectionOut])
def list_sections(course_id: Optional[str] = None, db: Session = Depends(get_db)):
    query = db.query(Section)
    if course_id:
        query = query.filter(Section.course_id == course_id)
    return query.all()


@router.post("", response_model=SectionOut)
def create_section(
    req: SectionCreate,
    current_user: User = Depends(require_role(["teacher"])),
    db: Session = Depends(get_db)
):
    course = db.query(Course).filter(Course.id == req.course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    if course.teacher_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only assigned course teacher can create sections")

    section = Section(
        course_id=req.course_id,
        name=req.name,
        code=req.code,
        student_count=req.student_count or 24,
    )
    db.add(section)
    db.commit()
    db.refresh(section)
    return section
