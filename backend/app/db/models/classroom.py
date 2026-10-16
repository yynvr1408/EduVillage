from datetime import datetime

from sqlalchemy import Boolean, Enum, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin, utcnow
from app.db.models.college import CollegeBranch
from app.db.models.enums import ClassStatus, ParticipationStatus, RecordingStatus
from app.db.models.user import User


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

    # Branch-wide audience ("All Sections" teacher): ONE class for every student of this branch, whatever their
    # section. NULL = the ordinary course / section-scoped class. No per-section duplicates, one LiveKit room.
    audience_branch_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("college_branches.id", ondelete="SET NULL"), nullable=True, index=True
    )
    audience_branch: Mapped["CollegeBranch | None"] = relationship(lazy="selectin")

    section_links: Mapped[list["ClassSection"]] = relationship(cascade="all, delete-orphan", lazy="selectin")

    @property
    def audience_branch_name(self) -> str | None:
        return self.audience_branch.name if self.audience_branch else None

    @property
    def section_ids(self) -> list[str]:
        return [link.section_id for link in self.section_links]


class ClassParticipant(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "class_participants"

    class_id: Mapped[str] = mapped_column(String(36), ForeignKey("classes.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    joined_at: Mapped[datetime | None] = mapped_column(nullable=True)
    left_at: Mapped[datetime | None] = mapped_column(nullable=True)
    participation_status: Mapped[ParticipationStatus] = mapped_column(
        Enum(ParticipationStatus, native_enum=False), nullable=False, default=ParticipationStatus.joined
    )
    # A student's "raise hand" request to speak; cleared once the teacher grants or denies it.
    speak_requested_at: Mapped[datetime | None] = mapped_column(nullable=True)
    # Live, teacher-granted mic permission — separate from the role-based publish grant a
    # teacher always has. Persisted so a page refresh/reconnect doesn't lose the grant.
    mic_granted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    user: Mapped["User"] = relationship(lazy="selectin")

    @property
    def full_name(self) -> str:
        return self.user.full_name

    @property
    def email(self) -> str:
        return self.user.email


class ClassRecording(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A recorded version of a live class, so students who missed it (or want to
    rewatch) can play it back later — distinct from the AI text summary, which is a
    different, lighter-weight catch-up path."""

    __tablename__ = "class_recordings"

    class_id: Mapped[str] = mapped_column(String(36), ForeignKey("classes.id", ondelete="CASCADE"), nullable=False, index=True)
    requested_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    egress_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    storage_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    status: Mapped[RecordingStatus] = mapped_column(
        Enum(RecordingStatus, native_enum=False), nullable=False, default=RecordingStatus.recording
    )
    started_at: Mapped[datetime] = mapped_column(nullable=False, default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(nullable=True)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    duration_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Recordings are private until a teacher explicitly publishes them (recording policy: opt-in).
    is_published: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index("uq_recording_egress_id", "egress_id", unique=True),  # webhooks look recordings up by egress id
        # At most one live recording job per class: makes a retried/concurrent start request
        # fail at the database instead of launching a second egress.
        Index(
            "uq_one_active_recording_per_class",
            "class_id",
            unique=True,
            sqlite_where=text("status = 'recording'"),
            postgresql_where=text("status = 'recording'"),
        ),
    )


class ClassSection(Base):
    """A live class may serve several sections at once; modelled explicitly instead of
    duplicating the class per section."""

    __tablename__ = "class_sections"

    class_id: Mapped[str] = mapped_column(String(36), ForeignKey("classes.id", ondelete="CASCADE"), primary_key=True)
    section_id: Mapped[str] = mapped_column(String(36), ForeignKey("sections.id", ondelete="CASCADE"), primary_key=True)


class RecordingSection(Base):
    """Shares one recording with a section without copying the media file. Deleting a row
    only revokes that section's access; the recording itself is untouched."""

    __tablename__ = "recording_sections"

    recording_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("class_recordings.id", ondelete="CASCADE"), primary_key=True
    )
    section_id: Mapped[str] = mapped_column(String(36), ForeignKey("sections.id", ondelete="CASCADE"), primary_key=True)
    shared_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    shared_at: Mapped[datetime] = mapped_column(nullable=False, default=utcnow)


class RecordingProgress(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "recording_progress"
    __table_args__ = (UniqueConstraint("recording_id", "user_id", name="uq_recording_progress_user"),)

    recording_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("class_recordings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    position_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    updated_at: Mapped[datetime] = mapped_column(nullable=False, default=utcnow, onupdate=utcnow)
