from datetime import datetime

from sqlalchemy import Enum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin, utcnow
from app.db.models.enums import LessonStatus, ResourceStatus


class Lesson(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "lessons"

    course_id: Mapped[str] = mapped_column(String(36), ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[LessonStatus] = mapped_column(
        Enum(LessonStatus, native_enum=False), nullable=False, default=LessonStatus.draft
    )


class LearningResource(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "learning_resources"

    course_id: Mapped[str] = mapped_column(String(36), ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True)
    lesson_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("lessons.id", ondelete="SET NULL"), nullable=True)
    uploaded_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(512), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(120), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[ResourceStatus] = mapped_column(
        Enum(ResourceStatus, native_enum=False), nullable=False, default=ResourceStatus.pending
    )


class ResourceSection(Base):
    """Shares one learning resource with a section (possibly of another course the same
    teacher teaches) without copying the stored file."""

    __tablename__ = "resource_sections"

    resource_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("learning_resources.id", ondelete="CASCADE"), primary_key=True
    )
    section_id: Mapped[str] = mapped_column(String(36), ForeignKey("sections.id", ondelete="CASCADE"), primary_key=True)
    shared_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    shared_at: Mapped[datetime] = mapped_column(nullable=False, default=utcnow)
