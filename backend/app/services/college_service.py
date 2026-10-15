"""College management and college codes.

Code guarantees:
  * unpredictable: drawn with `secrets` from a 32-symbol alphabet without look-alike characters
    (no 0/O/1/I), 8 symbols = 40 bits, formatted EV-XXXX-XXXX;
  * unique at the DATABASE level (unique index on colleges.code AND on every historical code), with a
    bounded retry when two requests collide, so concurrent creation is safe;
  * never the internal id; never reused; regenerating keeps the old code in history while all
    relationships keep pointing at the college id.
"""

import re
import secrets

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, NotFoundError, ValidationFailedError
from app.db.base import utcnow
from app.db.models.college import College, CollegeCodeHistory
from app.db.models.enums import CollegeStatus
from app.services import audit_service

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
