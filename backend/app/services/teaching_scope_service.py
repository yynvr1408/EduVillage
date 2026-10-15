"""Which college sections a teacher is authorized to address.

Two assignment kinds exist (see db/models/college.py):
  * one specific college section  -> `user_college_sections`
  * "All Sections" of one branch  -> `user_branch_assignments` (no section row; covers sections added later)
A teacher with neither (legacy accounts) is unscoped and keeps today's behaviour. A scoped teacher is confined
to their section / branch: never another branch, never another college.
"""

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, ForbiddenError, ValidationFailedError
from app.db.models.college import CollegeBranch, CollegeSection, UserBranchAssignment, UserCollegeSection
from app.db.models.course import Course
from app.db.models.enums import CollegeStatus
from app.db.models.section import Section
from app.db.models.user import User


@dataclass
class Scope:
    kind: str  # "none" | "section" | "branch"
    section_ids: set[str]  # single-section assignments
    branch_ids: set[str]  # branch-wide assignments


def get_scope(db: Session, user: User) -> Scope:
    sections = set(db.execute(select(UserCollegeSection.college_section_id).where(UserCollegeSection.user_id == user.id)).scalars())
    branches = set(db.execute(select(UserBranchAssignment.branch_id).where(UserBranchAssignment.user_id == user.id)).scalars())
    kind = "branch" if branches else "section" if sections else "none"
    return Scope(kind=kind, section_ids=sections, branch_ids=branches)


def covers(db: Session, scope: Scope, college_section: CollegeSection) -> bool:
    return college_section.id in scope.section_ids or college_section.branch_id in scope.branch_ids


def selectable_college_sections(db: Session, user: User) -> list[CollegeSection]:
    """Active college sections the teacher may link a course section to / address."""
    scope = get_scope(db, user)
    if scope.kind == "none":
        return []
    stmt = select(CollegeSection).where(CollegeSection.status == CollegeStatus.active)
    from sqlalchemy import or_

    conds = []
    if scope.section_ids:
        conds.append(CollegeSection.id.in_(scope.section_ids))
    if scope.branch_ids:
        conds.append(CollegeSection.branch_id.in_(scope.branch_ids))
    return list(db.execute(stmt.where(or_(*conds)).order_by(CollegeSection.name_key)).scalars())


def assert_may_link(db: Session, user: User, college_section_id: str) -> CollegeSection:
    """A teacher may tie a course section only to a college section they are assigned to / whose branch they cover."""
    scope = get_scope(db, user)
    cs = db.get(CollegeSection, college_section_id)
    if cs is None:
        raise ValidationFailedError("College section not found.", code="INVALID_COLLEGE_SECTION")
    if scope.kind == "none" or not covers(db, scope, cs):
        raise ForbiddenError("You are not assigned to that college section.", code="SECTION_NOT_AUTHORIZED")
    if cs.status != CollegeStatus.active:
        raise ConflictError("That college section is not active.", code="SECTION_INACTIVE")
    return cs


def filter_visible_course_sections(db: Session, user: User, sections: list[Section]) -> list[Section]:
    """A scoped teacher sees plain cohorts and the cohorts of their own scope, not other branches' cohorts."""
    scope = get_scope(db, user)
    if scope.kind == "none":
        return sections
    return [s for s in sections if s.college_section_id is None or _course_section_in_scope(db, scope, s)]


def _course_section_in_scope(db: Session, scope: Scope, section: Section) -> bool:
    cs = db.get(CollegeSection, section.college_section_id) if section.college_section_id else None
    return cs is None or covers(db, scope, cs)


def resolve_class_audience(
    db: Session, teacher: User, course: Course, section_ids: list[str], all_branch_sections: bool
) -> list[str]:
    """Server-side targeting rules for a new class. Returns the course-section ids the class will address.

    * unscoped teacher: unchanged behaviour (explicit ids, or empty = whole course);
    * scoped teacher: every explicit section must be a plain cohort or inside their scope; a whole-course class
      is refused when the course has cohorts outside their scope;
    * all_branch_sections: only for a branch-wide teacher; expands to every course section linked to an ACTIVE
      college section of that branch right now (sections added later are included next time).
    """
    scope = get_scope(db, teacher)
    ids = list(dict.fromkeys(section_ids))
    if all_branch_sections:
        if scope.kind != "branch":
            raise ForbiddenError("Only a teacher assigned to all sections of a branch can address the whole branch.", code="NOT_BRANCH_WIDE")
        if ids:
            raise ValidationFailedError("Choose either specific sections or the whole branch, not both.", code="INVALID_SECTION")
        rows = db.execute(
            select(Section.id)
            .join(CollegeSection, Section.college_section_id == CollegeSection.id)
            .where(
                Section.course_id == course.id,
                CollegeSection.branch_id.in_(scope.branch_ids),
                CollegeSection.status == CollegeStatus.active,
            )
        ).scalars()
        resolved = list(rows)
        if not resolved:
            raise ConflictError("This course has no sections linked to the active sections of your branch.", code="NO_SECTIONS_IN_BRANCH")
        return resolved
    if scope.kind == "none":
        return ids
    for sid in ids:
        section = db.get(Section, sid)
        if section is not None and section.course_id == course.id and not _course_section_in_scope(db, scope, section):
            raise ForbiddenError("You are not authorized to address that section.", code="SECTION_NOT_AUTHORIZED")
    if not ids:
        outside = [
            s
            for s in db.execute(select(Section).where(Section.course_id == course.id, Section.college_section_id.is_not(None))).scalars()
            if not _course_section_in_scope(db, scope, s)
        ]
        if outside:
            raise ConflictError("Choose the section(s) you teach; this course also has sections outside your assignment.", code="SECTION_REQUIRED")
    return ids


def describe(db: Session, user: User) -> dict:
    scope = get_scope(db, user)
    out: dict = {"kind": scope.kind, "branch": None, "section": None, "selectable_sections": []}
    if scope.kind == "branch":
        b = db.get(CollegeBranch, next(iter(scope.branch_ids)))
        out["branch"] = {"id": b.id, "name": b.name, "college_id": b.college_id}
    elif scope.kind == "section":
        cs = db.get(CollegeSection, next(iter(scope.section_ids)))
        b = db.get(CollegeBranch, cs.branch_id)
        out["section"] = {"id": cs.id, "name": cs.name, "branch_id": cs.branch_id}
        out["branch"] = {"id": b.id, "name": b.name, "college_id": b.college_id}
    out["selectable_sections"] = [
        {"id": s.id, "name": s.name, "branch_id": s.branch_id} for s in selectable_college_sections(db, user)
    ]
    return out
