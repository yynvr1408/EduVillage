from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db.models.enums import CollegeStatus
from app.db.models.user import User
from app.dependencies import get_current_admin, get_db, require_admin_csrf
from app.schemas.admin import (
    AdminLoginRequest,
    AdminOut,
    CollegeCreate,
    CollegeOut,
    CollegePage,
    BranchCreate,
    BranchOut,
    BranchUpdate,
    CollegeSectionCreate,
    CollegeSectionOut,
    CollegeSectionUpdate,
    CollegeStatusChange,
    CollegeUpdate,
    OverviewOut,
)
from app.services import admin_service, auth_service, college_service

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
