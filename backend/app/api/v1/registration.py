from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError
from app.db.models.college import College, CollegeBranch
from app.db.models.enums import CollegeStatus
from app.dependencies import get_db
from app.schemas.admin import CollegeSectionOut, PublicBranchOut, PublicCollegeOut
from app.services import college_service

router = APIRouter(prefix="/registration", tags=["registration"])


@router.get("/colleges", response_model=list[PublicCollegeOut])
def registerable_colleges(response: Response, db: Session = Depends(get_db)):
    """Active colleges only, read live from the admin-managed table. Public, and never includes college codes."""
    response.headers["Cache-Control"] = "no-store"
    return college_service.list_registerable_colleges(db)


@router.get("/colleges/{college_id}/branches", response_model=list[PublicBranchOut])
def registerable_branches(college_id: str, response: Response, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    college = db.get(College, college_id)
    if college is None or college.status != CollegeStatus.active:
        raise NotFoundError("College not found.")
    return college_service.list_branches(db, college.id, active_only=True)


@router.get("/branches/{branch_id}/sections", response_model=list[CollegeSectionOut])
def registerable_sections(branch_id: str, response: Response, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    branch = db.get(CollegeBranch, branch_id)
    college = db.get(College, branch.college_id) if branch else None
    if branch is None or branch.status != CollegeStatus.active or college is None or college.status != CollegeStatus.active:
        raise NotFoundError("Branch not found.")
    return college_service.list_sections(db, branch.id, active_only=True)
