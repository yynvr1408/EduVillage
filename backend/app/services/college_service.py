"""College management and college codes.

Code guarantees:
  * unpredictable: drawn with `secrets` from a 32-symbol alphabet without look-alike characters
    (no 0/O/1/I), 8 symbols = 40 bits, formatted EV-XXXX-XXXX;
  * unique at the DATABASE level (unique index on colleges.code AND on every historical code), with a
    bounded retry when two requests collide, so concurrent creation is safe;
  * never the internal id; never reused; regenerating keeps the old code in history while all
    relationships keep pointing at the college id.
"""

import logging
import re
import secrets
from datetime import timedelta

from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError, ValidationFailedError
from app.core.security import hash_password, verify_password
from app.db.base import utcnow
from app.db.models.college import (
    College,
    CollegeAdministrator,
    CollegeCodeHistory,
    CollegeDeletionRequest,
    CollegeRegistrationRequest,
    UserBranchAssignment,
    UserCollegeSection,
)
from app.db.models.enums import CollegeDeletionRequestStatus, CollegeRegistrationRequestStatus, CollegeStatus, UserRole, UserStatus
from app.db.models.user import User
from app.services import audit_service, rate_limit_service

logger = logging.getLogger(__name__)

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # 32 symbols: letters without I/O, digits 2-9
CODE_PREFIX = "EV"
CODE_PATTERN = re.compile(r"^EV-[A-Z2-9]{4}-[A-Z2-9]{4}$")
MAX_CODE_ATTEMPTS = 8


def generate_code() -> str:
    body = "".join(secrets.choice(ALPHABET) for _ in range(8))
    return f"{CODE_PREFIX}-{body[:4]}-{body[4:]}"


def normalize_code(raw: str) -> str:
    """Case, spaces and dashes don't matter when a person types a code: 'ev k7qm 2xpd' == 'EV-K7QM-2XPD'."""
    cleaned = re.sub(r"[^A-Za-z0-9]", "", raw or "").upper()
    if cleaned.startswith(CODE_PREFIX) and len(cleaned) == 10:
        return f"{CODE_PREFIX}-{cleaned[2:6]}-{cleaned[6:]}"
    return (raw or "").strip().upper()


def _key(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").strip()).casefold()


def _code_taken(db: Session, code: str) -> bool:
    return (
        db.execute(select(College.id).where(College.code == code)).first() is not None
        or db.execute(select(CollegeCodeHistory.id).where(CollegeCodeHistory.code == code)).first() is not None
    )


def get_college_or_404(db: Session, college_id: str) -> College:
    college = db.get(College, college_id)
    if not college:
        raise NotFoundError("College not found.")
    return college


def create_college(db: Session, admin_id: str, *, name: str, location, contact_email, contact_phone, status, code: str | None) -> College:
    custom = normalize_code(code) if code else None
    if custom and not CODE_PATTERN.match(custom):
        raise ValidationFailedError("A custom code must look like EV-ABCD-2345 (letters A-Z without I/O, digits 2-9).", code="INVALID_COLLEGE_CODE")
    if custom and _code_taken(db, custom):
        raise ConflictError("This college code is already in use.", code="COLLEGE_CODE_TAKEN")

    for attempt in range(MAX_CODE_ATTEMPTS):
        candidate = custom or generate_code()
        college = College(
            name=name,
            name_key=_key(name),
            location=location,
            location_key=_key(location),
            contact_email=str(contact_email) if contact_email else None,
            contact_phone=contact_phone,
            code=candidate,
            code_generated_at=utcnow(),
            status=status,
            created_by=admin_id,
        )
        db.add(college)
        try:
            if not custom and _code_taken(db, candidate):  # collides with a retired code
                db.rollback()
                continue
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            if _is_name_conflict(db, name, location):
                raise ConflictError("A college with this name and location already exists.", code="COLLEGE_EXISTS") from exc
            if custom:
                raise ConflictError("This college code is already in use.", code="COLLEGE_CODE_TAKEN") from exc
            continue  # a concurrent request got the same random code: draw another
        db.refresh(college)
        audit_service.record(db, actor_id=admin_id, action="college_created", resource_type="college", resource_id=college.id)
        return college
    raise ConflictError("Could not allocate a unique college code; please try again.", code="CODE_ALLOCATION_FAILED")


def _is_name_conflict(db: Session, name: str, location: str | None, *, exclude_id: str | None = None) -> bool:
    stmt = select(College.id).where(College.name_key == _key(name), College.location_key == _key(location))
    if exclude_id:
        stmt = stmt.where(College.id != exclude_id)
    return db.execute(stmt).first() is not None


def list_colleges(db: Session, *, search: str | None, status: CollegeStatus | None, limit: int, offset: int) -> tuple[list[College], int]:
    from app.utils.pagination import clamp_limit

    limit = clamp_limit(limit)
    offset = max(0, offset)
    stmt = select(College)
    if status:
        stmt = stmt.where(College.status == status)
    if search and search.strip():
        like = f"%{search.strip().casefold()}%"
        stmt = stmt.where(
            or_(func.lower(College.name).like(like), func.lower(College.location).like(like), func.lower(College.code).like(like))
        )
    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    rows = list(db.execute(stmt.order_by(College.created_at.desc(), College.id).limit(limit).offset(offset)).scalars())
    return rows, total


def update_college(db: Session, admin_id: str, college: College, *, fields: dict) -> College:
    new_name = fields.get("name", college.name)
    new_location = fields["location"] if "location" in fields else college.location
    if _is_name_conflict(db, new_name, new_location, exclude_id=college.id):
        raise ConflictError("A college with this name and location already exists.", code="COLLEGE_EXISTS")
    if "name" in fields and fields["name"]:
        college.name, college.name_key = fields["name"], _key(fields["name"])
    if "location" in fields:
        college.location, college.location_key = fields["location"], _key(fields["location"])
    if "contact_email" in fields:
        college.contact_email = str(fields["contact_email"]) if fields["contact_email"] else None
    if "contact_phone" in fields:
        college.contact_phone = fields["contact_phone"]
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError("A college with this name and location already exists.", code="COLLEGE_EXISTS") from exc
    db.refresh(college)
    audit_service.record(db, actor_id=admin_id, action="college_updated", resource_type="college", resource_id=college.id)
    return college


def set_status(db: Session, admin_id: str, college: College, status: CollegeStatus) -> College:
    if status == CollegeStatus.pending:
        # Reachable only via the self-registration approval flow (approve_college_request), never
        # as a manual target on an existing, real college.
        raise ValidationFailedError("A college cannot be manually set to pending.", code="INVALID_STATUS")
    if college.status != status:
        college.status = status
        db.commit()
        db.refresh(college)
        audit_service.record(
            db, actor_id=admin_id, action="college_activated" if status == CollegeStatus.active else "college_deactivated",
            resource_type="college", resource_id=college.id,
        )
    return college


def regenerate_code(db: Session, admin_id: str, college: College) -> College:
    """Issues a new code. The old one is retired (kept in history, never reissued); users and other records
    reference the college by id, so nothing is detached by this."""
    for _ in range(MAX_CODE_ATTEMPTS):
        candidate = generate_code()
        if _code_taken(db, candidate):
            continue
        db.add(CollegeCodeHistory(college_id=college.id, code=college.code, replaced_by=admin_id))
        college.code = candidate
        college.code_generated_at = utcnow()
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            college = get_college_or_404(db, college.id)
            continue
        db.refresh(college)
        audit_service.record(db, actor_id=admin_id, action="college_code_regenerated", resource_type="college", resource_id=college.id)
        return college
    raise ConflictError("Could not allocate a unique college code; please try again.", code="CODE_ALLOCATION_FAILED")


def overview(db: Session) -> dict:
    total = db.execute(select(func.count(College.id))).scalar_one()
    active = db.execute(select(func.count(College.id)).where(College.status == CollegeStatus.active)).scalar_one()
    retired = db.execute(select(func.count(CollegeCodeHistory.id))).scalar_one()
    return {
        "total_colleges": total,
        "active_colleges": active,
        "inactive_colleges": total - active,
        "total_codes_generated": total + retired,
    }


def resolve_active_college_by_code(db: Session, raw_code: str) -> College | None:
    """For FUTURE onboarding: a code identifies a college for registration only. It never grants any
    privilege, and an inactive college or a retired code resolves to nothing."""
    college = db.execute(select(College).where(College.code == normalize_code(raw_code))).scalar_one_or_none()
    return college if college and college.status == CollegeStatus.active else None


# ---- branches and sections -----------------------------------------------------------------------

from app.db.models.college import CollegeBranch, CollegeSection  # noqa: E402


def get_branch_or_404(db: Session, branch_id: str) -> CollegeBranch:
    branch = db.get(CollegeBranch, branch_id)
    if not branch:
        raise NotFoundError("Branch not found.")
    return branch


def get_section_or_404(db: Session, section_id: str) -> CollegeSection:
    section = db.get(CollegeSection, section_id)
    if not section:
        raise NotFoundError("Section not found.")
    return section


def create_branch(db: Session, admin_id: str, college: College, *, name: str, short_code: str | None) -> CollegeBranch:
    branch = CollegeBranch(college_id=college.id, name=name, name_key=_key(name), short_code=short_code)
    db.add(branch)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError("This college already has a branch with that name.", code="BRANCH_EXISTS") from exc
    db.refresh(branch)
    audit_service.record(db, actor_id=admin_id, action="college_branch_created", resource_type="college_branch", resource_id=branch.id)
    return branch


def list_branches(db: Session, college_id: str, *, active_only: bool, search: str | None = None) -> list[CollegeBranch]:
    stmt = select(CollegeBranch).where(CollegeBranch.college_id == college_id)
    if active_only:
        stmt = stmt.where(CollegeBranch.status == CollegeStatus.active)
    if search and search.strip():
        like = f"%{search.strip().casefold()}%"
        stmt = stmt.where(or_(func.lower(CollegeBranch.name).like(like), func.lower(func.coalesce(CollegeBranch.short_code, "")).like(like)))
    return list(db.execute(stmt.order_by(CollegeBranch.name_key)).scalars())


def update_branch(db: Session, admin_id: str, branch: CollegeBranch, *, fields: dict) -> CollegeBranch:
    if "name" in fields and fields["name"]:
        branch.name, branch.name_key = fields["name"], _key(fields["name"])
    if "short_code" in fields:
        branch.short_code = fields["short_code"]
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError("This college already has a branch with that name.", code="BRANCH_EXISTS") from exc
    db.refresh(branch)
    audit_service.record(db, actor_id=admin_id, action="college_branch_updated", resource_type="college_branch", resource_id=branch.id)
    return branch


def set_branch_status(db: Session, admin_id: str, branch: CollegeBranch, status: CollegeStatus) -> CollegeBranch:
    """Deactivating hides the branch from new registrations; existing assignments and accounts are untouched."""
    if branch.status != status:
        branch.status = status
        db.commit()
        db.refresh(branch)
        audit_service.record(db, actor_id=admin_id, action="college_branch_status", resource_type="college_branch", resource_id=branch.id)
    return branch


def create_section(db: Session, admin_id: str, branch: CollegeBranch, *, name: str) -> CollegeSection:
    section = CollegeSection(college_id=branch.college_id, branch_id=branch.id, name=name, name_key=_key(name))
    db.add(section)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError("This branch already has a section with that name.", code="SECTION_EXISTS") from exc
    db.refresh(section)
    audit_service.record(db, actor_id=admin_id, action="college_section_created", resource_type="college_section", resource_id=section.id)
    return section


def list_sections(db: Session, branch_id: str, *, active_only: bool, search: str | None = None) -> list[CollegeSection]:
    stmt = select(CollegeSection).where(CollegeSection.branch_id == branch_id)
    if active_only:
        stmt = stmt.where(CollegeSection.status == CollegeStatus.active)
    if search and search.strip():
        stmt = stmt.where(func.lower(CollegeSection.name).like(f"%{search.strip().casefold()}%"))
    return list(db.execute(stmt.order_by(CollegeSection.name_key)).scalars())


def update_section(db: Session, admin_id: str, section: CollegeSection, *, name: str) -> CollegeSection:
    section.name, section.name_key = name, _key(name)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError("This branch already has a section with that name.", code="SECTION_EXISTS") from exc
    db.refresh(section)
    audit_service.record(db, actor_id=admin_id, action="college_section_updated", resource_type="college_section", resource_id=section.id)
    return section


def set_section_status(db: Session, admin_id: str, section: CollegeSection, status: CollegeStatus) -> CollegeSection:
    if section.status != status:
        section.status = status
        db.commit()
        db.refresh(section)
        audit_service.record(db, actor_id=admin_id, action="college_section_status", resource_type="college_section", resource_id=section.id)
    return section


def list_registerable_colleges(db: Session) -> list[College]:
    return list(db.execute(select(College).where(College.status == CollegeStatus.active).order_by(College.name_key)).scalars())


def validate_registration_target(
    db: Session,
    *,
    college_id: str | None,
    branch_id: str | None,
    section_id: str | None,
    all_sections: bool,
    college_code: str | None,
    require_code: bool,
    allow_all_sections: bool,
) -> tuple[College, CollegeBranch, CollegeSection | None] | None:
    """Server-side check of the college -> branch -> section a new account asks to join. Returns None only
    when the request names nothing at all (legacy callers); anything partial or inconsistent is rejected
    before any row is written. A teacher must also prove the code of THIS college. `all_sections` means
    branch-wide coverage: the section is None and no section row is involved."""
    import hmac

    if not any([college_id, branch_id, section_id, college_code, all_sections]):
        return None
    if not college_id:
        raise ValidationFailedError("Select a college.", code="COLLEGE_REQUIRED")
    college = db.get(College, college_id)
    if college is None:
        raise ValidationFailedError("The selected college was not found.", code="COLLEGE_NOT_FOUND")
    if college.status != CollegeStatus.active:
        raise ConflictError("This college is not accepting registrations.", code="COLLEGE_INACTIVE")
    if require_code:
        supplied = normalize_code(college_code or "")
        # One answer for a wrong code and for another college's code, so codes cannot be probed.
        if not college_code or not hmac.compare_digest(supplied.encode(), college.code.encode()):
            raise ValidationFailedError("The college code is incorrect for the selected college.", code="INVALID_COLLEGE_CODE")
    if not branch_id:
        raise ValidationFailedError("Select a branch.", code="BRANCH_REQUIRED")
    branch = db.get(CollegeBranch, branch_id)
    if branch is None or branch.college_id != college.id:
        raise ValidationFailedError("The selected branch does not belong to this college.", code="INVALID_BRANCH")
    if branch.status != CollegeStatus.active:
        raise ConflictError("This branch is not available.", code="BRANCH_INACTIVE")
    if all_sections:
        if section_id:
            raise ValidationFailedError("Choose either one section or all sections, not both.", code="INVALID_SECTION")
        if not allow_all_sections:
            raise ValidationFailedError("Only teachers can register for all sections.", code="INVALID_SECTION")
        return college, branch, None
    if not section_id:
        raise ValidationFailedError("Select a section.", code="SECTION_REQUIRED")
    section = db.get(CollegeSection, section_id)
    if section is None or section.branch_id != branch.id or section.college_id != college.id:
        raise ValidationFailedError("The selected section does not belong to this branch.", code="INVALID_SECTION")
    if section.status != CollegeStatus.active:
        raise ConflictError("This section is not available.", code="SECTION_INACTIVE")
    return college, branch, section


# ---- college administrators (delegated, scoped institution management) -------------------------
#
# A teacher can be delegated to manage ONE college's own branches/sections/code, so routine
# institutional setup doesn't bottleneck on the one platform admin for every single institution.
# Granting/revoking this is itself a platform-admin-only action (assign_college_admin /
# remove_college_admin below) — a teacher can never make themselves or anyone else one. Once
# granted, the teacher manages their college through app/api/v1/institution_admin.py, using their
# ordinary teacher session — this is checked as an extra permission on top of that, never a
# separate login.


def is_college_admin(db: Session, user_id: str, college_id: str) -> bool:
    return (
        db.execute(
            select(CollegeAdministrator.id).where(
                CollegeAdministrator.user_id == user_id, CollegeAdministrator.college_id == college_id
            )
        ).first()
        is not None
    )


def assert_can_manage_college(db: Session, user: User, college: College) -> None:
    """For the teacher-session self-serve routes only. The platform admin router never calls this —
    it's gated by its own, separate get_current_admin dependency and always has full access."""
    if not is_college_admin(db, user.id, college.id):
        raise ForbiddenError("You are not an administrator of this institution.")


def list_colleges_administered_by(db: Session, user_id: str) -> list[College]:
    stmt = (
        select(College)
        .join(CollegeAdministrator, CollegeAdministrator.college_id == College.id)
        .where(CollegeAdministrator.user_id == user_id)
        .order_by(College.name_key)
    )
    return list(db.execute(stmt).scalars())


def list_college_admins(db: Session, college_id: str) -> list[CollegeAdministrator]:
    stmt = select(CollegeAdministrator).where(CollegeAdministrator.college_id == college_id)
    return list(db.execute(stmt).scalars())


def assign_college_admin(db: Session, platform_admin_id: str, college: College, *, user_id: str) -> CollegeAdministrator:
    """Platform-admin-only. Idempotent for the SAME teacher (delegating them again just returns
    the existing record), but a college has at most one administrator at a time — delegating a
    DIFFERENT teacher while one is already in place is rejected; remove the existing delegation
    first (see remove_college_admin) to hand it to someone else."""
    target = db.get(User, user_id)
    if target is None:
        raise NotFoundError("User not found.")
    if target.role != UserRole.teacher:
        raise ValidationFailedError("Only a teacher can be made an institution administrator.", code="NOT_A_TEACHER")

    existing = db.execute(
        select(CollegeAdministrator).where(CollegeAdministrator.college_id == college.id)
    ).scalar_one_or_none()
    if existing:
        if existing.user_id == user_id:
            return existing
        raise ConflictError(
            "This institution already has an administrator. Remove them first before delegating someone new.",
            code="COLLEGE_ALREADY_HAS_ADMINISTRATOR",
        )

    admin_link = CollegeAdministrator(user_id=user_id, college_id=college.id, assigned_by=platform_admin_id)
    db.add(admin_link)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()  # a concurrent request delegated someone to this college first
        winner = db.execute(
            select(CollegeAdministrator).where(CollegeAdministrator.college_id == college.id)
        ).scalar_one()
        if winner.user_id != user_id:
            raise ConflictError(
                "This institution already has an administrator. Remove them first before delegating someone new.",
                code="COLLEGE_ALREADY_HAS_ADMINISTRATOR",
            ) from None
        return winner
    db.refresh(admin_link)
    audit_service.record(
        db, actor_id=platform_admin_id, action="college_administrator_assigned", resource_type="college", resource_id=college.id
    )
    return admin_link


def remove_college_admin(db: Session, platform_admin_id: str, college: College, *, user_id: str) -> None:
    existing = db.execute(
        select(CollegeAdministrator).where(
            CollegeAdministrator.user_id == user_id, CollegeAdministrator.college_id == college.id
        )
    ).scalar_one_or_none()
    if not existing:
        raise NotFoundError("This user is not an administrator of this college.")
    db.delete(existing)
    db.commit()
    audit_service.record(
        db, actor_id=platform_admin_id, action="college_administrator_removed", resource_type="college", resource_id=college.id
    )


# ---- self-service college registration (super-admin approved) ----------------------------------
# A college registers itself (public, no auth) instead of the platform admin creating it directly.
# The request sits pending until a platform admin approves or rejects it; approval atomically
# creates the real College AND its founding CollegeAdministrator in one step, so a newly-approved
# college is never left with nobody able to approve its own first students/teachers.


def submit_college_registration_request(
    db: Session, *, college_name: str, location: str | None, contact_email: str | None, contact_phone: str | None,
    admin_full_name: str, admin_email: str, admin_password: str, verification_token: str,
) -> CollegeRegistrationRequest:
    from app.services import auth_service

    normalized_admin_email = admin_email.strip().lower()
    # Proves control of the founding admin's own mailbox, exactly like student/teacher
    # registration — reuses the same email-verification mechanism and token, no new OTP code.
    auth_service.consume_registration_verification(db, email=normalized_admin_email, verification_token=verification_token)

    if db.execute(select(User.id).where(User.email == normalized_admin_email)).first() is not None:
        raise ConflictError("An account with this email already exists.", code="EMAIL_TAKEN")

    request = CollegeRegistrationRequest(
        college_name=college_name,
        location=location,
        contact_email=str(contact_email) if contact_email else None,
        contact_phone=contact_phone,
        admin_full_name=admin_full_name.strip(),
        admin_email=normalized_admin_email,
        admin_password_hash=hash_password(admin_password),
        status=CollegeRegistrationRequestStatus.pending,
    )
    db.add(request)
    db.commit()
    db.refresh(request)
    audit_service.record(db, actor_id=None, action="college_registration_requested", resource_type="college_registration_request", resource_id=request.id)
    return request


def list_college_requests(db: Session, *, status: CollegeRegistrationRequestStatus | None = None) -> list[CollegeRegistrationRequest]:
    stmt = select(CollegeRegistrationRequest)
    if status:
        stmt = stmt.where(CollegeRegistrationRequest.status == status)
    return list(db.execute(stmt.order_by(CollegeRegistrationRequest.created_at.desc())).scalars())


def get_college_request_or_404(db: Session, request_id: str) -> CollegeRegistrationRequest:
    request = db.get(CollegeRegistrationRequest, request_id)
    if not request:
        raise NotFoundError("College registration request not found.")
    return request


def approve_college_request(db: Session, platform_admin_id: str, request: CollegeRegistrationRequest) -> College:
    if request.status != CollegeRegistrationRequestStatus.pending:
        raise ConflictError("This request has already been decided.", code="REQUEST_ALREADY_DECIDED")
    if db.execute(select(User.id).where(User.email == request.admin_email)).first() is not None:
        raise ConflictError("An account with this email already exists.", code="EMAIL_TAKEN")

    college = create_college(
        db, platform_admin_id, name=request.college_name, location=request.location,
        contact_email=request.contact_email, contact_phone=request.contact_phone,
        status=CollegeStatus.active, code=None,
    )
    admin_user = User(
        full_name=request.admin_full_name,
        email=request.admin_email,
        password_hash=request.admin_password_hash,  # already hashed at submission time
        role=UserRole.teacher,
        status=UserStatus.active,  # vetted by the super-admin's approval of the whole request; no further gate
    )
    db.add(admin_user)
    db.flush()
    assign_college_admin(db, platform_admin_id, college, user_id=admin_user.id)

    request.status = CollegeRegistrationRequestStatus.approved
    request.decided_by = platform_admin_id
    request.decided_at = utcnow()
    request.resulting_college_id = college.id
    db.commit()
    audit_service.record(
        db, actor_id=platform_admin_id, action="college_registration_approved", resource_type="college_registration_request", resource_id=request.id
    )
    _notify_college_request_decision(request, approved=True, reason=None)
    return college


def reject_college_request(db: Session, platform_admin_id: str, request: CollegeRegistrationRequest, *, reason: str | None) -> CollegeRegistrationRequest:
    if request.status != CollegeRegistrationRequestStatus.pending:
        raise ConflictError("This request has already been decided.", code="REQUEST_ALREADY_DECIDED")
    request.status = CollegeRegistrationRequestStatus.rejected
    request.rejected_reason = reason
    request.decided_by = platform_admin_id
    request.decided_at = utcnow()
    db.commit()
    db.refresh(request)
    audit_service.record(
        db, actor_id=platform_admin_id, action="college_registration_rejected", resource_type="college_registration_request", resource_id=request.id
    )
    _notify_college_request_decision(request, approved=False, reason=reason)
    return request


def _notify_college_request_decision(request: CollegeRegistrationRequest, *, approved: bool, reason: str | None) -> None:
    """Best-effort courtesy email to the founding admin who submitted a college registration
    request — same "never block the real action on email delivery" rule as
    _notify_registration_decision below, just addressed before any User row exists for this
    person (the request itself carries their name/email)."""
    from app.integrations import email as email_integration

    try:
        email_integration.send_registration_decision_email(
            to=request.admin_email, full_name=request.admin_full_name, college_name=request.college_name,
            approved=approved, reason=reason,
        )
    except Exception:
        logger.exception("college_request_decision_email_failed request_id=%s", request.id)


# ---- student/teacher registration approval (the college administrator's own queue) --------------


def list_pending_registrations(db: Session, college_id: str, *, limit: int = 200, offset: int = 0) -> list[User]:
    from app.utils.pagination import paginate

    stmt = (
        select(User)
        .where(User.college_id == college_id, User.status == UserStatus.pending)
        .order_by(User.created_at)
    )
    return paginate(db, stmt, limit=limit, offset=offset)


def _get_pending_registration_or_404(db: Session, college_id: str, user_id: str) -> User:
    user = db.get(User, user_id)
    if not user or user.college_id != college_id or user.status != UserStatus.pending:
        raise NotFoundError("Pending registration not found.")
    return user


def _notify_registration_decision(db: Session, user: User, *, approved: bool, reason: str | None) -> None:
    """Best-effort courtesy email — the decision already took effect regardless of whether this
    send succeeds, same "never block the real action on email delivery" rule the OTP flows follow."""
    from app.integrations import email as email_integration

    college = db.get(College, user.college_id) if user.college_id else None
    try:
        email_integration.send_registration_decision_email(
            to=user.email, full_name=user.full_name, college_name=college.name if college else "your institution",
            approved=approved, reason=reason,
        )
    except Exception:
        logger.exception("registration_decision_email_failed user_id=%s", user.id)


def approve_registration(db: Session, college_admin_id: str, college_id: str, user_id: str) -> User:
    _check_admin_action_rate_limit(db, college_admin_id)
    user = _get_pending_registration_or_404(db, college_id, user_id)
    user.status = UserStatus.active
    db.commit()
    db.refresh(user)
    audit_service.record(db, actor_id=college_admin_id, action="registration_approved", resource_type="user", resource_id=user.id)
    _notify_registration_decision(db, user, approved=True, reason=None)
    return user


def reject_registration(db: Session, college_admin_id: str, college_id: str, user_id: str, *, reason: str | None) -> User:
    _check_admin_action_rate_limit(db, college_admin_id)
    user = _get_pending_registration_or_404(db, college_id, user_id)
    user.status = UserStatus.rejected
    db.commit()
    db.refresh(user)
    audit_service.record(db, actor_id=college_admin_id, action="registration_rejected", resource_type="user", resource_id=user.id)
    _notify_registration_decision(db, user, approved=False, reason=reason)
    return user


_ADMIN_ACTION_MAX = 60  # per college admin, per window
_ADMIN_ACTION_WINDOW = timedelta(minutes=5)


def _check_admin_action_rate_limit(db: Session, actor_id: str) -> None:
    """A brake on the roster/registration mutation endpoints: a real admin doing a bulk approval
    of, say, twenty students in a sitting is well within this; an automated/compromised session
    hammering the endpoint is not. Generous on purpose — this is a courtesy limit on an already
    authenticated, delegated session, not the primary defense."""
    key = f"college-admin-action:{actor_id}"
    if rate_limit_service.record(db, key, _ADMIN_ACTION_WINDOW) > _ADMIN_ACTION_MAX:
        raise ConflictError("Too many actions in a short time. Please wait a moment and try again.", code="RATE_LIMITED")


# ---- the college admin's student/teacher roster --------------------------------------------
# Distinct from the pending-registration queue above: this is everyone already admitted
# (active or suspended), with account-management actions scoped to this one college. A college
# admin can never act on another CollegeAdministrator of the same college (or on themselves)
# through here — that delegation is a platform-admin-only decision (see assign/remove_college_admin).


def list_college_members(db: Session, college_id: str, *, limit: int = 200, offset: int = 0) -> list[User]:
    from app.utils.pagination import paginate

    stmt = (
        select(User)
        .where(User.college_id == college_id, User.status.in_([UserStatus.active, UserStatus.suspended]))
        .order_by(User.role, User.full_name)
    )
    return paginate(db, stmt, limit=limit, offset=offset)


def _get_member_or_404(db: Session, college_id: str, user_id: str) -> User:
    user = db.get(User, user_id)
    if not user or user.college_id != college_id or user.status not in (UserStatus.active, UserStatus.suspended):
        raise NotFoundError("Member not found.")
    return user


def _assert_not_self(acting_college_admin_id: str, target: User) -> None:
    if target.id == acting_college_admin_id:
        raise ForbiddenError("You cannot take this action on your own account.", code="CANNOT_ACT_ON_SELF")


def suspend_member(db: Session, college_admin_id: str, college_id: str, user_id: str) -> User:
    _check_admin_action_rate_limit(db, college_admin_id)
    user = _get_member_or_404(db, college_id, user_id)
    _assert_not_self(college_admin_id, user)
    if user.status != UserStatus.suspended:
        user.status = UserStatus.suspended
        db.commit()
        db.refresh(user)
        audit_service.record(db, actor_id=college_admin_id, action="member_suspended", resource_type="user", resource_id=user.id)
    return user


def reactivate_member(db: Session, college_admin_id: str, college_id: str, user_id: str) -> User:
    _check_admin_action_rate_limit(db, college_admin_id)
    user = _get_member_or_404(db, college_id, user_id)
    _assert_not_self(college_admin_id, user)
    if user.status != UserStatus.active:
        user.status = UserStatus.active
        db.commit()
        db.refresh(user)
        audit_service.record(db, actor_id=college_admin_id, action="member_reactivated", resource_type="user", resource_id=user.id)
    return user


def remove_member_from_college(db: Session, college_admin_id: str, college_id: str, user_id: str) -> User:
    """Detaches the account from this college — the account itself, its role and its own data
    (courses, submissions, recordings, ...) are untouched; only the college/section/branch
    affiliation is cleared, exactly as a college deletion detaches everyone (see
    confirm_college_deletion)."""
    _check_admin_action_rate_limit(db, college_admin_id)
    user = _get_member_or_404(db, college_id, user_id)
    _assert_not_self(college_admin_id, user)
    db.execute(delete(UserCollegeSection).where(UserCollegeSection.user_id == user.id))
    db.execute(delete(UserBranchAssignment).where(UserBranchAssignment.user_id == user.id))
    user.college_id = None
    db.commit()
    db.refresh(user)
    audit_service.record(db, actor_id=college_admin_id, action="member_removed_from_college", resource_type="user", resource_id=user.id)
    return user


def reassign_member(
    db: Session, college_admin_id: str, college_id: str, user_id: str, *, branch_id: str, section_id: str | None, all_sections: bool,
) -> User:
    """Moves an already-admitted student/teacher to a different branch/section of the SAME
    college — the gap left by remove_member_from_college, which only detaches: a mis-registered
    student previously had no fix short of removal and re-registration. Reuses
    validate_registration_target with require_code=False: the acting college admin's own
    delegation is already the authority here, not a second proof of the college's own code."""
    _check_admin_action_rate_limit(db, college_admin_id)
    user = _get_member_or_404(db, college_id, user_id)
    _assert_not_self(college_admin_id, user)
    if all_sections and user.role != UserRole.teacher:
        raise ValidationFailedError("Only a teacher can be assigned to all sections of a branch.", code="INVALID_SECTION")

    target = validate_registration_target(
        db, college_id=college_id, branch_id=branch_id, section_id=section_id, all_sections=all_sections,
        college_code=None, require_code=False, allow_all_sections=user.role == UserRole.teacher,
    )
    if target is None:
        raise ValidationFailedError("Select a branch and section.", code="BRANCH_REQUIRED")
    _, branch, section = target

    db.execute(delete(UserCollegeSection).where(UserCollegeSection.user_id == user.id))
    db.execute(delete(UserBranchAssignment).where(UserBranchAssignment.user_id == user.id))
    if section is not None:
        db.add(UserCollegeSection(user_id=user.id, college_section_id=section.id))
    else:
        db.add(UserBranchAssignment(user_id=user.id, branch_id=branch.id))
    db.commit()
    db.refresh(user)
    audit_service.record(db, actor_id=college_admin_id, action="member_reassigned", resource_type="user", resource_id=user.id)
    return user


# ---- two-phase college deletion -------------------------------------------------------------
# The super admin can only REQUEST deletion; the college's own delegated administrator must
# separately confirm with their own password plus an OTP emailed to the college's contact
# address (see auth_service.request_deletion_otp / verify_deletion_otp) before anything is
# actually deleted — a super admin alone can never complete this unilaterally.


def request_college_deletion(db: Session, platform_admin_id: str, college: College) -> CollegeDeletionRequest:
    existing = db.execute(
        select(CollegeDeletionRequest).where(
            CollegeDeletionRequest.college_id == college.id, CollegeDeletionRequest.status == CollegeDeletionRequestStatus.pending
        )
    ).scalar_one_or_none()
    if existing:
        return existing
    if not list_college_admins(db, college.id):
        raise ConflictError(
            "This college has no delegated administrator to confirm the deletion. Delegate one first.", code="NO_COLLEGE_ADMIN"
        )
    request = CollegeDeletionRequest(college_id=college.id, requested_by=platform_admin_id, status=CollegeDeletionRequestStatus.pending)
    db.add(request)
    db.commit()
    db.refresh(request)
    audit_service.record(db, actor_id=platform_admin_id, action="college_deletion_requested", resource_type="college", resource_id=college.id)
    return request


def get_pending_deletion_request(db: Session, college_id: str) -> CollegeDeletionRequest | None:
    return db.execute(
        select(CollegeDeletionRequest).where(
            CollegeDeletionRequest.college_id == college_id, CollegeDeletionRequest.status == CollegeDeletionRequestStatus.pending
        )
    ).scalar_one_or_none()


def get_deletion_request_or_404(db: Session, college_id: str, request_id: str) -> CollegeDeletionRequest:
    request = db.get(CollegeDeletionRequest, request_id)
    if not request or request.college_id != college_id:
        raise NotFoundError("Deletion request not found.")
    return request


def request_deletion_confirmation_otp(
    db: Session, college: College, deletion_request: CollegeDeletionRequest, confirming_user: User, *, password: str, ip: str | None = None,
) -> tuple[bool, str | None]:
    from app.services import auth_service

    assert_can_manage_college(db, confirming_user, college)
    if deletion_request.status != CollegeDeletionRequestStatus.pending:
        raise ConflictError("This deletion request is no longer pending.", code="REQUEST_ALREADY_DECIDED")
    if not verify_password(password, confirming_user.password_hash):
        raise ForbiddenError("Incorrect password.", code="INVALID_CREDENTIALS")
    if not college.contact_email:
        raise ConflictError("This college has no registered contact email to send the confirmation code to.", code="NO_CONTACT_EMAIL")
    return auth_service.request_deletion_otp(db, confirming_user, send_to_email=college.contact_email, ip=ip)


def confirm_college_deletion(
    db: Session, college: College, deletion_request: CollegeDeletionRequest, confirming_user: User, *, otp: str, ip: str | None = None,
) -> None:
    from app.services import auth_service

    assert_can_manage_college(db, confirming_user, college)
    if deletion_request.status != CollegeDeletionRequestStatus.pending:
        raise ConflictError("This deletion request is no longer pending.", code="REQUEST_ALREADY_DECIDED")
    auth_service.verify_deletion_otp(db, confirming_user, otp=otp, ip=ip)

    deletion_request.status = CollegeDeletionRequestStatus.confirmed
    deletion_request.confirmed_by = confirming_user.id
    deletion_request.confirmed_at = utcnow()
    college_id = college.id
    # Branches/sections/administrators cascade (ondelete="CASCADE"); affected students'/teachers'
    # college_id is set to NULL (ondelete="SET NULL") — their accounts are never deleted, just
    # detached from the college.
    db.delete(college)
    db.commit()
    audit_service.record(db, actor_id=confirming_user.id, action="college_deleted", resource_type="college", resource_id=college_id)


def decline_college_deletion(db: Session, college: College, deletion_request: CollegeDeletionRequest, confirming_user: User) -> CollegeDeletionRequest:
    assert_can_manage_college(db, confirming_user, college)
    if deletion_request.status != CollegeDeletionRequestStatus.pending:
        raise ConflictError("This deletion request is no longer pending.", code="REQUEST_ALREADY_DECIDED")
    deletion_request.status = CollegeDeletionRequestStatus.cancelled
    deletion_request.confirmed_by = confirming_user.id
    deletion_request.confirmed_at = utcnow()
    db.commit()
    db.refresh(deletion_request)
    audit_service.record(db, actor_id=confirming_user.id, action="college_deletion_declined", resource_type="college", resource_id=college.id)
    return deletion_request
