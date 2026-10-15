from datetime import datetime

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin, utcnow


class Section(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A cohort of students within a course (e.g. a campus group or a rural field cohort)."""

    __tablename__ = "sections"
    __table_args__ = (UniqueConstraint("course_id", "code", name="uq_section_course_code"),)

    course_id: Mapped[str] = mapped_column(String(36), ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    code: Mapped[str] = mapped_column(String(40), nullable=False)


class SectionMember(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "section_members"
    __table_args__ = (UniqueConstraint("section_id", "student_id", name="uq_section_student"),)

    section_id: Mapped[str] = mapped_column(String(36), ForeignKey("sections.id", ondelete="CASCADE"), nullable=False, index=True)
    student_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    added_at: Mapped[datetime] = mapped_column(nullable=False, default=utcnow)
