from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db.models.enums import CollegeRegistrationRequestStatus, CollegeStatus
from app.db.models.user import User
from app.dependencies import get_current_admin, get_db, require_admin_csrf
from app.schemas.admin import (
    AdminLoginRequest,
    AdminOut,
    AuditEventOut,
    AuditEventPage,
    CollegeAdministratorCreate,
    CollegeAdministratorOut,
    CollegeCreate,
    CollegeDeletionRequestOut,
    CollegeOut,
    CollegePage,
    CollegeRegistrationRequestOut,
    BranchCreate,
    BranchOut,
    BranchUpdate,
    CollegeSectionCreate,
    CollegeSectionOut,
    CollegeSectionUpdate,
    CollegeStatusChange,
    CollegeUpdate,
    DecisionReject,
    OverviewOut,
)
from app.services import admin_service, audit_service, auth_service, college_service

router = APIRouter(prefix="/admin", tags=["admin"])


def _admin_out(user: User) -> AdminOut:
    return AdminOut(username=user.email, display_name=user.full_name)


@router.post("/auth/login", response_model=AdminOut, dependencies=[Depends(require_admin_csrf)])
def admin_login(
    payload: AdminLoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    ip = request.client.host if request.client else None
    admin, token = admin_service.authenticate_admin(db, username=payload.username, password=payload.password, client_ip=ip)
    samesite = settings.session_cookie_samesite.lower()
    response.set_cookie(
        key=settings.admin_cookie_name,
        value=token,
        httponly=True,
        secure=settings.is_production or samesite == "none",
        samesite=samesite,
        max_age=settings.admin_session_ttl_minutes * 60,
        path="/",
    )
    response.headers["Cache-Control"] = "no-store"
    return _admin_out(admin)


@router.post("/auth/logout", status_code=204)
def admin_logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    admin: User = Depends(get_current_admin),
):
    token = request.cookies.get(settings.admin_cookie_name)
    if token:
        auth_service.revoke_session(db, token)
    response.delete_cookie(settings.admin_cookie_name, path="/")
    return None


@router.get("/auth/me", response_model=AdminOut)
def admin_me(response: Response, admin: User = Depends(get_current_admin)):
    response.headers["Cache-Control"] = "no-store"
    return _admin_out(admin)


@router.get("/overview", response_model=OverviewOut)
def overview(db: Session = Depends(get_db), _: User = Depends(get_current_admin)):
    return college_service.overview(db)


@router.get("/colleges", response_model=CollegePage)
def list_colleges(
    search: str | None = None,
    status: CollegeStatus | None = None,
    limit: int = 20,
    offset: int = 0,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    from app.utils.pagination import clamp_limit

    items, total = college_service.list_colleges(db, search=search, status=status, limit=limit, offset=offset)
    return CollegePage(items=items, total=total, limit=clamp_limit(limit), offset=max(0, offset))


@router.post("/colleges", response_model=CollegeOut, status_code=201)
def create_college(payload: CollegeCreate, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    return college_service.create_college(
        db, admin.id, name=payload.name, location=payload.location, contact_email=payload.contact_email,
        contact_phone=payload.contact_phone, status=payload.status, code=payload.code,
    )


@router.get("/colleges/{college_id}", response_model=CollegeOut)
def get_college(college_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_admin)):
    return college_service.get_college_or_404(db, college_id)


@router.patch("/colleges/{college_id}", response_model=CollegeOut)
def update_college(college_id: str, payload: CollegeUpdate, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    college = college_service.get_college_or_404(db, college_id)
    return college_service.update_college(db, admin.id, college, fields=payload.model_dump(exclude_unset=True))


@router.post("/colleges/{college_id}/status", response_model=CollegeOut)
def change_status(college_id: str, payload: CollegeStatusChange, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    college = college_service.get_college_or_404(db, college_id)
    return college_service.set_status(db, admin.id, college, payload.status)


@router.post("/colleges/{college_id}/regenerate-code", response_model=CollegeOut)
def regenerate_code(college_id: str, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    college = college_service.get_college_or_404(db, college_id)
    return college_service.regenerate_code(db, admin.id, college)


@router.get("/colleges/{college_id}/branches", response_model=list[BranchOut])
def list_branches(college_id: str, search: str | None = None, db: Session = Depends(get_db), _: User = Depends(get_current_admin)):
    college = college_service.get_college_or_404(db, college_id)
    return college_service.list_branches(db, college.id, active_only=False, search=search)


@router.post("/colleges/{college_id}/branches", response_model=BranchOut, status_code=201)
def create_branch(college_id: str, payload: BranchCreate, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    college = college_service.get_college_or_404(db, college_id)
    return college_service.create_branch(db, admin.id, college, name=payload.name, short_code=payload.short_code)


@router.patch("/branches/{branch_id}", response_model=BranchOut)
def update_branch(branch_id: str, payload: BranchUpdate, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    branch = college_service.get_branch_or_404(db, branch_id)
    return college_service.update_branch(db, admin.id, branch, fields=payload.model_dump(exclude_unset=True))


@router.post("/branches/{branch_id}/status", response_model=BranchOut)
def change_branch_status(branch_id: str, payload: CollegeStatusChange, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    branch = college_service.get_branch_or_404(db, branch_id)
    return college_service.set_branch_status(db, admin.id, branch, payload.status)


@router.get("/branches/{branch_id}/sections", response_model=list[CollegeSectionOut])
def list_branch_sections(branch_id: str, search: str | None = None, db: Session = Depends(get_db), _: User = Depends(get_current_admin)):
    branch = college_service.get_branch_or_404(db, branch_id)
    return college_service.list_sections(db, branch.id, active_only=False, search=search)


@router.post("/branches/{branch_id}/sections", response_model=CollegeSectionOut, status_code=201)
def create_branch_section(
    branch_id: str, payload: CollegeSectionCreate, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)
):
    branch = college_service.get_branch_or_404(db, branch_id)
    return college_service.create_section(db, admin.id, branch, name=payload.name)


@router.patch("/sections/{section_id}", response_model=CollegeSectionOut)
def update_college_section(
    section_id: str, payload: CollegeSectionUpdate, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)
):
    section = college_service.get_section_or_404(db, section_id)
    return college_service.update_section(db, admin.id, section, name=payload.name)


@router.post("/sections/{section_id}/status", response_model=CollegeSectionOut)
def change_section_status(
    section_id: str, payload: CollegeStatusChange, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)
):
    section = college_service.get_section_or_404(db, section_id)
    return college_service.set_section_status(db, admin.id, section, payload.status)


# ---- delegated institution administrators --------------------------------------------------------
# Granting/revoking this delegation is itself a platform-admin-only decision — stays behind
# get_current_admin like everything else in this router. The delegated teacher then manages their
# own college through app/api/v1/institution_admin.py, via their ordinary teacher session.


@router.get("/colleges/{college_id}/administrators", response_model=list[CollegeAdministratorOut])
def list_college_administrators(college_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_admin)):
    college_service.get_college_or_404(db, college_id)
    return college_service.list_college_admins(db, college_id)


@router.post("/colleges/{college_id}/administrators", response_model=CollegeAdministratorOut, status_code=201)
def add_college_administrator(
    college_id: str, payload: CollegeAdministratorCreate, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)
):
    college = college_service.get_college_or_404(db, college_id)
    return college_service.assign_college_admin(db, admin.id, college, user_id=payload.user_id)


@router.delete("/colleges/{college_id}/administrators/{user_id}", status_code=204)
def remove_college_administrator(
    college_id: str, user_id: str, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)
):
    college = college_service.get_college_or_404(db, college_id)
    college_service.remove_college_admin(db, admin.id, college, user_id=user_id)


# ---- self-service college registration requests ---------------------------------------------
# A college registered itself (POST /registration/colleges/request, public); the platform admin
# reviews and decides here. Approval creates the real college AND its founding administrator.


@router.get("/college-requests", response_model=list[CollegeRegistrationRequestOut])
def list_college_requests(
    status: CollegeRegistrationRequestStatus | None = None, db: Session = Depends(get_db), _: User = Depends(get_current_admin)
):
    return college_service.list_college_requests(db, status=status)


@router.post("/college-requests/{request_id}/approve", response_model=CollegeOut)
def approve_college_request(request_id: str, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    request = college_service.get_college_request_or_404(db, request_id)
    return college_service.approve_college_request(db, admin.id, request)


@router.post("/college-requests/{request_id}/reject", response_model=CollegeRegistrationRequestOut)
def reject_college_request(
    request_id: str, payload: DecisionReject, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)
):
    request = college_service.get_college_request_or_404(db, request_id)
    return college_service.reject_college_request(db, admin.id, request, reason=payload.reason)


# ---- college deletion: the super admin may only REQUEST it ------------------------------------
# Completing it needs the college's own delegated administrator to confirm, separately, with
# their own password + an OTP emailed to the college — see institution_admin.py's
# deletion-request endpoints, where the actual deletion happens.


@router.post("/colleges/{college_id}/deletion-requests", response_model=CollegeDeletionRequestOut, status_code=201)
def request_college_deletion(college_id: str, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    college = college_service.get_college_or_404(db, college_id)
    return college_service.request_college_deletion(db, admin.id, college)


@router.get("/colleges/{college_id}/deletion-requests", response_model=CollegeDeletionRequestOut | None)
def get_college_deletion_request(college_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_admin)):
    college_service.get_college_or_404(db, college_id)
    return college_service.get_pending_deletion_request(db, college_id)


# ---- audit trail ------------------------------------------------------------------------------


@router.get("/audit-events", response_model=AuditEventPage)
def list_audit_events(
    action: str | None = None,
    resource_type: str | None = None,
    actor_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    rows, total = audit_service.list_events(
        db, action=action, resource_type=resource_type, actor_id=actor_id, limit=limit, offset=offset
    )
    items = [
        AuditEventOut(
            id=event.id,
            actor_id=event.actor_id,
            actor_email=actor_email,
            action=event.action,
            resource_type=event.resource_type,
            resource_id=event.resource_id,
            created_at=event.created_at,
        )
        for event, actor_email in rows
    ]
    return AuditEventPage(items=items, total=total, limit=limit, offset=offset)
