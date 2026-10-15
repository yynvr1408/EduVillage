from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError
from app.db.models.course import Course
from app.db.models.enums import UserRole
from app.db.models.section import Section, SectionMember
from app.db.models.user import User
from app.services import audit_service, course_service


def get_section_or_404(db: Session, section_id: str) -> Section:
    section = db.get(Section, section_id)
    if not section:
        raise NotFoundError("Section not found.")
    return section


def assert_teaches_section(db: Session, user: User, section: Section) -> Course:
    course = course_service.get_course_or_404(db, section.course_id)
    if not course_service.is_teaching(db, user, course):
        raise ForbiddenError("Only a teacher on this section's course can manage it.")
    return course


def create_section(db: Session, teacher: User, course: Course, *, name: str, code: str) -> Section:
    course_service.assert_owns_course(db, teacher, course)
    section = Section(course_id=course.id, name=name.strip(), code=code.strip().upper())
    db.add(section)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ConflictError("A section with this code already exists in the course.", code="SECTION_CODE_TAKEN")
    db.refresh(section)
    audit_service.record(db, actor_id=teacher.id, action="section_created", resource_type="section", resource_id=section.id)
    return section


def member_section_ids(db: Session, student_id: str) -> set[str]:
    return set(db.execute(select(SectionMember.section_id).where(SectionMember.student_id == student_id)).scalars())


def is_member_of_any(db: Session, student_id: str, section_ids) -> bool:
    if not section_ids:
        return False
    return bool(member_section_ids(db, student_id) & set(section_ids))


def list_sections(db: Session, user: User, course: Course) -> list[Section]:
    """Teachers see every section of a course they teach; a student sees only their own."""
    stmt = select(Section).where(Section.course_id == course.id).order_by(Section.code)
    if course_service.is_teaching(db, user, course):
        return list(db.execute(stmt).scalars())
    course_service.assert_enrolled(db, user, course)
    return list(db.execute(stmt.where(Section.id.in_(member_section_ids(db, user.id)))).scalars())


def add_member(db: Session, teacher: User, section: Section, *, student_id: str) -> SectionMember:
    course = assert_teaches_section(db, teacher, section)
    student = db.get(User, student_id)
    if not student or student.role != UserRole.student:
        raise NotFoundError("Student not found.")
    if not course_service._is_enrolled(db, course.id, student_id):
        raise ConflictError("The student must be enrolled in the course before joining a section.", code="NOT_ENROLLED")
    member = SectionMember(section_id=section.id, student_id=student_id)
    db.add(member)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ConflictError("The student is already in this section.", code="ALREADY_MEMBER")
    db.refresh(member)
    audit_service.record(db, actor_id=teacher.id, action="section_member_added", resource_type="section", resource_id=section.id)
    return member


def remove_member(db: Session, teacher: User, section: Section, *, student_id: str) -> None:
    assert_teaches_section(db, teacher, section)
    member = db.execute(
        select(SectionMember).where(SectionMember.section_id == section.id, SectionMember.student_id == student_id)
    ).scalar_one_or_none()
    if not member:
        raise NotFoundError("The student is not in this section.")
    db.delete(member)
    db.commit()
    audit_service.record(db, actor_id=teacher.id, action="section_member_removed", resource_type="section", resource_id=section.id)


def list_members(db: Session, teacher: User, section: Section) -> list[SectionMember]:
    assert_teaches_section(db, teacher, section)
    return list(db.execute(select(SectionMember).where(SectionMember.section_id == section.id)).scalars())
