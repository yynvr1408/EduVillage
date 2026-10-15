from datetime import datetime

from sqlalchemy import Enum, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.db.models.enums import JobStatus, JobType, SummaryStatus, TranscriptStatus


class LectureTranscript(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "lecture_transcripts"

    class_id: Mapped[str] = mapped_column(String(36), ForeignKey("classes.id", ondelete="CASCADE"), nullable=False, index=True)
    resource_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("learning_resources.id"), nullable=True)
    recording_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("class_recordings.id"), nullable=True, index=True)
    # Per-chunk progress for long recordings: {total, segment_seconds, done: {index: text}}
    chunk_state: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    language: Mapped[str] = mapped_column(String(10), nullable=False, default="en")
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)  # dedupes identical sources
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[TranscriptStatus] = mapped_column(
        Enum(TranscriptStatus, native_enum=False), nullable=False, default=TranscriptStatus.pending
    )


class LectureSummary(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "lecture_summaries"

    class_id: Mapped[str] = mapped_column(String(36), ForeignKey("classes.id", ondelete="CASCADE"), nullable=False, index=True)
    transcript_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("lecture_transcripts.id"), nullable=True)
    recording_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("class_recordings.id"), nullable=True, index=True)
    # Provenance: "llm" vs the labeled "stub" fallback, and which model produced it.
    generator: Mapped[str | None] = mapped_column(String(20), nullable=True)
    generator_model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    content_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    status: Mapped[SummaryStatus] = mapped_column(
        Enum(SummaryStatus, native_enum=False), nullable=False, default=SummaryStatus.queued
    )
    reviewed_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(nullable=True)


class BackgroundJob(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "background_jobs"

    job_type: Mapped[JobType] = mapped_column(Enum(JobType, native_enum=False), nullable=False)
    status: Mapped[JobStatus] = mapped_column(
        Enum(JobStatus, native_enum=False), nullable=False, default=JobStatus.queued
    )
    reference_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    error_code: Mapped[str | None] = mapped_column(String(120), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(nullable=True)
