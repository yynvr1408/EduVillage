from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.db.models.user import User
from app.schemas.section import SectionCreate, SectionMemberAdd, SectionMemberOut, SectionOut
from app.services import course_service, section_service

router = APIRouter(tags=["sections"])


@router.get("/courses/{course_id}/sections", response_model=list[SectionOut])
def list_sections(course_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    course = course_service.get_course_or_404(db, course_id)
    return [SectionOut.model_validate(s) for s in section_service.list_sections(db, user, course)]


@router.post("/courses/{course_id}/sections", response_model=SectionOut, status_code=201)
def create_section(course_id: str, payload: SectionCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    course = course_service.get_course_or_404(db, course_id)
    return SectionOut.model_validate(section_service.create_section(db, user, course, name=payload.name, code=payload.code))


@router.get("/sections/{section_id}/members", response_model=list[SectionMemberOut])
def list_members(section_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    section = section_service.get_section_or_404(db, section_id)
    return [SectionMemberOut.model_validate(m) for m in section_service.list_members(db, user, section)]


@router.post("/sections/{section_id}/members", response_model=SectionMemberOut, status_code=201)
def add_member(section_id: str, payload: SectionMemberAdd, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    section = section_service.get_section_or_404(db, section_id)
    return SectionMemberOut.model_validate(section_service.add_member(db, user, section, student_id=payload.student_id))


@router.delete("/sections/{section_id}/members/{student_id}", status_code=204)
def remove_member(section_id: str, student_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    section = section_service.get_section_or_404(db, section_id)
    section_service.remove_member(db, user, section, student_id=student_id)
    return None
