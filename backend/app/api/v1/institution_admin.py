"""Self-serve institution management for a delegated college administrator.

Distinct from app/api/v1/admin.py: that router is the platform admin's own, gated by a wholly
separate session/cookie (get_current_admin). This one runs on an ordinary teacher session
(get_current_user) plus one extra check — is this teacher delegated to manage this particular
college (college_service.assert_can_manage_college) — so a teacher who's been handed this
responsibility doesn't have to wait on the platform admin for routine institutional setup.
Creating a new college, or suspending/activating one, stays platform-admin-only and is
deliberately not exposed here.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.permissions import require_role
from app.db.models.enums import UserRole
from app.db.models.user import User
from app.dependencies import get_current_user, get_db
from app.schemas.admin import (
    BranchCreate,
    BranchOut,
    BranchUpdate,
    CollegeOut,
    CollegeSectionCreate,
    CollegeSectionOut,
    CollegeSectionUpdate,
    CollegeStatusChange,
    CollegeUpdate,
)
from app.services import college_service

router = APIRouter(prefix="/institution-admin", tags=["institution-admin"])


def _require_teacher(user: User) -> None:
    require_role(user, UserRole.teacher)


@router.get("/colleges", response_model=list[CollegeOut])
def list_my_colleges(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """The colleges this teacher is delegated to administer — empty for almost every teacher.
    The frontend uses this to decide whether to show the institution-admin area at all."""
    _require_teacher(user)
    return college_service.list_colleges_administered_by(db, user.id)


@router.get("/colleges/{college_id}", response_model=CollegeOut)
def get_my_college(college_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_teacher(user)
    college = college_service.get_college_or_404(db, college_id)
    college_service.assert_can_manage_college(db, user, college)
    return college


@router.patch("/colleges/{college_id}", response_model=CollegeOut)
def update_my_college(
    college_id: str, payload: CollegeUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    _require_teacher(user)
    college = college_service.get_college_or_404(db, college_id)
    college_service.assert_can_manage_college(db, user, college)
    return college_service.update_college(db, user.id, college, fields=payload.model_dump(exclude_unset=True))


@router.post("/colleges/{college_id}/regenerate-code", response_model=CollegeOut)
def regenerate_my_college_code(college_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_teacher(user)
    college = college_service.get_college_or_404(db, college_id)
    college_service.assert_can_manage_college(db, user, college)
    return college_service.regenerate_code(db, user.id, college)


@router.get("/colleges/{college_id}/branches", response_model=list[BranchOut])
def list_my_branches(
    college_id: str, search: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    _require_teacher(user)
    college = college_service.get_college_or_404(db, college_id)
    college_service.assert_can_manage_college(db, user, college)
    return college_service.list_branches(db, college.id, active_only=False, search=search)


@router.post("/colleges/{college_id}/branches", response_model=BranchOut, status_code=201)
def create_my_branch(
    college_id: str, payload: BranchCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    _require_teacher(user)
    college = college_service.get_college_or_404(db, college_id)
    college_service.assert_can_manage_college(db, user, college)
    return college_service.create_branch(db, user.id, college, name=payload.name, short_code=payload.short_code)


@router.patch("/branches/{branch_id}", response_model=BranchOut)
def update_my_branch(
    branch_id: str, payload: BranchUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    _require_teacher(user)
    branch = college_service.get_branch_or_404(db, branch_id)
    college = college_service.get_college_or_404(db, branch.college_id)
    college_service.assert_can_manage_college(db, user, college)
    return college_service.update_branch(db, user.id, branch, fields=payload.model_dump(exclude_unset=True))


@router.post("/branches/{branch_id}/status", response_model=BranchOut)
def change_my_branch_status(
    branch_id: str, payload: CollegeStatusChange, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    _require_teacher(user)
    branch = college_service.get_branch_or_404(db, branch_id)
    college = college_service.get_college_or_404(db, branch.college_id)
    college_service.assert_can_manage_college(db, user, college)
    return college_service.set_branch_status(db, user.id, branch, payload.status)


@router.get("/branches/{branch_id}/sections", response_model=list[CollegeSectionOut])
def list_my_branch_sections(
    branch_id: str, search: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    _require_teacher(user)
    branch = college_service.get_branch_or_404(db, branch_id)
    college = college_service.get_college_or_404(db, branch.college_id)
    college_service.assert_can_manage_college(db, user, college)
    return college_service.list_sections(db, branch.id, active_only=False, search=search)


@router.post("/branches/{branch_id}/sections", response_model=CollegeSectionOut, status_code=201)
def create_my_branch_section(
    branch_id: str, payload: CollegeSectionCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    _require_teacher(user)
    branch = college_service.get_branch_or_404(db, branch_id)
    college = college_service.get_college_or_404(db, branch.college_id)
    college_service.assert_can_manage_college(db, user, college)
    return college_service.create_section(db, user.id, branch, name=payload.name)


@router.patch("/sections/{section_id}", response_model=CollegeSectionOut)
def update_my_section(
    section_id: str, payload: CollegeSectionUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    _require_teacher(user)
    section = college_service.get_section_or_404(db, section_id)
    college = college_service.get_college_or_404(db, section.college_id)
    college_service.assert_can_manage_college(db, user, college)
    return college_service.update_section(db, user.id, section, name=payload.name)


@router.post("/sections/{section_id}/status", response_model=CollegeSectionOut)
def change_my_section_status(
    section_id: str, payload: CollegeStatusChange, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    _require_teacher(user)
    section = college_service.get_section_or_404(db, section_id)
    college = college_service.get_college_or_404(db, section.college_id)
    college_service.assert_can_manage_college(db, user, college)
    return college_service.set_section_status(db, user.id, section, payload.status)
