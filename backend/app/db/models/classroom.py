from datetime import datetime

from sqlalchemy import Enum, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.db.models.enums import ClassStatus, ParticipationStatus


class Class(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "classes"

    course_id: Mapped[str] = mapped_column(String(36), ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True)
    teacher_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    scheduled_start: Mapped[datetime] = mapped_column(nullable=False)
    scheduled_end: Mapped[datetime | None] = mapped_column(nullable=True)
    status: Mapped[ClassStatus] = mapped_column(
        Enum(ClassStatus, native_enum=False), nullable=False, default=ClassStatus.scheduled
    )
    livekit_room_name: Mapped[str | None] = mapped_column(String(255), nullable=True)


class ClassParticipant(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "class_participants"

    class_id: Mapped[str] = mapped_column(String(36), ForeignKey("classes.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    joined_at: Mapped[datetime | None] = mapped_column(nullable=True)
    left_at: Mapped[datetime | None] = mapped_column(nullable=True)
    participation_status: Mapped[ParticipationStatus] = mapped_column(
        Enum(ParticipationStatus, native_enum=False), nullable=False, default=ParticipationStatus.joined
    )
