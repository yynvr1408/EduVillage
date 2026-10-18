from datetime import timedelta

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError, UnauthorizedError
from app.db.models.college import College, CollegeBranch
from app.db.models.enums import CollegeStatus
from app.dependencies import get_db
from app.schemas.admin import CollegeRegistrationRequestCreate, CollegeRegistrationRequestOut, CollegeSectionOut, PublicBranchOut, PublicCollegeOut
from app.services import college_service, rate_limit_service

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


_COLLEGE_REQUEST_MAX_ATTEMPTS = 5
_COLLEGE_REQUEST_WINDOW = timedelta(hours=1)


@router.post("/colleges/request", response_model=CollegeRegistrationRequestOut, status_code=202)
def request_college_registration(
    payload: CollegeRegistrationRequestCreate, request: Request, db: Session = Depends(get_db)
):
    """Public: a college registering itself. Pending platform-admin approval — see
    POST /admin/college-requests/{id}/approve."""
    ip = request.client.host if request.client else None
    key = f"college-register-email:{payload.admin_email.lower()}"
    if rate_limit_service.record(db, key, _COLLEGE_REQUEST_WINDOW) > _COLLEGE_REQUEST_MAX_ATTEMPTS:
        raise UnauthorizedError("Too many attempts. Please try again later.", code="RATE_LIMITED", status_code=429)
    if ip:
        ip_key = f"college-register-ip:{ip}"
        if rate_limit_service.record(db, ip_key, _COLLEGE_REQUEST_WINDOW) > _COLLEGE_REQUEST_MAX_ATTEMPTS * 3:
            raise UnauthorizedError("Too many attempts. Please try again later.", code="RATE_LIMITED", status_code=429)

    return college_service.submit_college_registration_request(
        db, college_name=payload.college_name, location=payload.location, contact_email=payload.contact_email,
        contact_phone=payload.contact_phone, admin_full_name=payload.admin_full_name, admin_email=payload.admin_email,
        admin_password=payload.admin_password, verification_token=payload.verification_token,
    )
