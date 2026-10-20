"""Self-serve institution management for a delegated college administrator.

Distinct from app/api/v1/admin.py: that router is the platform admin's own, gated by a wholly
separate session/cookie (get_current_admin). This one runs on an ordinary teacher session
(get_current_user) plus one extra check — is this teacher delegated to manage this particular
college (college_service.assert_can_manage_college) — so a teacher who's been handed this
responsibility doesn't have to wait on the platform admin for routine institutional setup.
Creating a new college, or suspending/activating one, stays platform-admin-only and is
deliberately not exposed here.
"""

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.permissions import require_role
from app.db.models.enums import UserRole
from app.db.models.user import User
from app.dependencies import get_current_user, get_db
from app.schemas.admin import (
    BranchCreate,
    BranchOut,
    BranchUpdate,
    CollegeDeletionRequestOut,
    CollegeOut,
    CollegeSectionCreate,
    CollegeSectionOut,
    CollegeSectionUpdate,
    CollegeStatusChange,
    CollegeUpdate,
    DecisionReject,
    DeletionOtpRequest,
    DeletionOtpVerify,
    MemberReassign,
    PendingUserOut,
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


# ---- student/teacher registration review -------------------------------------------------------
# Replaces instant self-registration: a student/teacher who registers against this college now
# waits here until the delegated administrator approves or rejects them.


@router.get("/colleges/{college_id}/registrations", response_model=list[PendingUserOut])
def list_pending_registrations(
    college_id: str, limit: int = 200, offset: int = 0, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    _require_teacher(user)
    college = college_service.get_college_or_404(db, college_id)
    college_service.assert_can_manage_college(db, user, college)
    return college_service.list_pending_registrations(db, college_id, limit=limit, offset=offset)


@router.post("/colleges/{college_id}/registrations/{user_id}/approve", response_model=PendingUserOut)
def approve_registration(
    college_id: str, user_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    _require_teacher(user)
    college = college_service.get_college_or_404(db, college_id)
    college_service.assert_can_manage_college(db, user, college)
    return college_service.approve_registration(db, user.id, college_id, user_id)


@router.post("/colleges/{college_id}/registrations/{user_id}/reject", response_model=PendingUserOut)
def reject_registration(
    college_id: str, user_id: str, payload: DecisionReject, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    _require_teacher(user)
    college = college_service.get_college_or_404(db, college_id)
    college_service.assert_can_manage_college(db, user, college)
    return college_service.reject_registration(db, user.id, college_id, user_id, reason=payload.reason)


# ---- the student/teacher roster: everyone already admitted (active or suspended) ----------------


@router.get("/colleges/{college_id}/members", response_model=list[PendingUserOut])
def list_members(
    college_id: str, limit: int = 200, offset: int = 0, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    _require_teacher(user)
    college = college_service.get_college_or_404(db, college_id)
    college_service.assert_can_manage_college(db, user, college)
    return college_service.list_college_members(db, college_id, limit=limit, offset=offset)


@router.post("/colleges/{college_id}/members/{user_id}/suspend", response_model=PendingUserOut)
def suspend_member(college_id: str, user_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_teacher(user)
    college = college_service.get_college_or_404(db, college_id)
    college_service.assert_can_manage_college(db, user, college)
    return college_service.suspend_member(db, user.id, college_id, user_id)


@router.post("/colleges/{college_id}/members/{user_id}/reactivate", response_model=PendingUserOut)
def reactivate_member(college_id: str, user_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_teacher(user)
    college = college_service.get_college_or_404(db, college_id)
    college_service.assert_can_manage_college(db, user, college)
    return college_service.reactivate_member(db, user.id, college_id, user_id)


@router.post("/colleges/{college_id}/members/{user_id}/remove", response_model=PendingUserOut)
def remove_member(college_id: str, user_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_teacher(user)
    college = college_service.get_college_or_404(db, college_id)
    college_service.assert_can_manage_college(db, user, college)
    return college_service.remove_member_from_college(db, user.id, college_id, user_id)


@router.post("/colleges/{college_id}/members/{user_id}/reassign", response_model=PendingUserOut)
def reassign_member(
    college_id: str, user_id: str, payload: MemberReassign, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    _require_teacher(user)
    college = college_service.get_college_or_404(db, college_id)
    college_service.assert_can_manage_college(db, user, college)
    return college_service.reassign_member(
        db, user.id, college_id, user_id, branch_id=payload.branch_id, section_id=payload.section_id, all_sections=payload.all_sections
    )


# ---- college deletion: the delegated administrator's confirmation side --------------------------
# The super admin can only REQUEST deletion (POST /admin/colleges/{id}/deletion-requests); it is
# completed only here, by the college's own administrator, with their own password + an OTP
# emailed to the college's contact address.


@router.get("/colleges/{college_id}/deletion-requests", response_model=CollegeDeletionRequestOut | None)
def get_my_college_deletion_request(college_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_teacher(user)
    college = college_service.get_college_or_404(db, college_id)
    college_service.assert_can_manage_college(db, user, college)
    return college_service.get_pending_deletion_request(db, college_id)


@router.post("/colleges/{college_id}/deletion-requests/{request_id}/request-otp", status_code=202)
def request_my_deletion_otp(
    college_id: str, request_id: str, payload: DeletionOtpRequest, request: Request,
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    _require_teacher(user)
    college = college_service.get_college_or_404(db, college_id)
    deletion_request = college_service.get_deletion_request_or_404(db, college_id, request_id)
    ip = request.client.host if request.client else None
    sent, dev_otp = college_service.request_deletion_confirmation_otp(
        db, college, deletion_request, user, password=payload.password, ip=ip
    )
    body = {"message": "A confirmation code has been sent to this college's registered contact email."}
    if dev_otp:
        body["dev_otp"] = dev_otp
    return body


@router.post("/colleges/{college_id}/deletion-requests/{request_id}/confirm", status_code=204)
def confirm_my_college_deletion(
    college_id: str, request_id: str, payload: DeletionOtpVerify, request: Request,
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    _require_teacher(user)
    college = college_service.get_college_or_404(db, college_id)
    deletion_request = college_service.get_deletion_request_or_404(db, college_id, request_id)
    ip = request.client.host if request.client else None
    college_service.confirm_college_deletion(db, college, deletion_request, user, otp=payload.otp, ip=ip)
    return None


@router.post("/colleges/{college_id}/deletion-requests/{request_id}/decline", response_model=CollegeDeletionRequestOut)
def decline_my_college_deletion(
    college_id: str, request_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    _require_teacher(user)
    college = college_service.get_college_or_404(db, college_id)
    deletion_request = college_service.get_deletion_request_or_404(db, college_id, request_id)
    return college_service.decline_college_deletion(db, college, deletion_request, user)
