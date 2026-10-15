from datetime import datetime

from sqlalchemy import Enum, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin, utcnow
from app.db.models.enums import CourseStatus, CourseTeacherRole, EnrollmentStatus


class Course(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "courses"

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    subject: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # Discovery filters only (no separate Institution/Region entities — nothing elsewhere in the
    # app models multi-institution or administrative-region concerns, so a free-text field a
    # teacher fills in is deliberately simpler than inventing relational entities nothing needs yet).
    grade_level: Mapped[str | None] = mapped_column(String(60), nullable=True)
    language: Mapped[str | None] = mapped_column(String(60), nullable=True)
    institution: Mapped[str | None] = mapped_column(String(160), nullable=True, index=True)
    region: Mapped[str | None] = mapped_column(String(160), nullable=True, index=True)
    teacher_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    status: Mapped[CourseStatus] = mapped_column(
        Enum(CourseStatus, native_enum=False), nullable=False, default=CourseStatus.draft
    )

    enrollments: Mapped[list["CourseEnrollment"]] = relationship(
        back_populates="course", cascade="all, delete-orphan"
    )


class CourseEnrollment(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "course_enrollments"
    __table_args__ = (UniqueConstraint("course_id", "student_id", name="uq_course_student"),)

    course_id: Mapped[str] = mapped_column(String(36), ForeignKey("courses.id", ondelete="CASCADE"), nullable=False)
    student_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    status: Mapped[EnrollmentStatus] = mapped_column(
        Enum(EnrollmentStatus, native_enum=False), nullable=False, default=EnrollmentStatus.active
    )
    enrolled_at: Mapped[datetime] = mapped_column(nullable=False, default=utcnow)

    course: Mapped[Course] = relationship(back_populates="enrollments")


class CourseTeacher(UUIDPrimaryKeyMixin, Base):
    """Additional teachers on a course beyond its original owner (Course.teacher_id).
    Exists so one scarce qualified teacher can be shared across sections/colleges, or a
    course can have a backup teacher for continuity when the primary is unavailable —
    directly answering the "limited teachers" half of the problem statement."""

    __tablename__ = "course_teachers"
    __table_args__ = (UniqueConstraint("course_id", "teacher_id", name="uq_course_teacher"),)

    course_id: Mapped[str] = mapped_column(String(36), ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True)
    teacher_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    role: Mapped[CourseTeacherRole] = mapped_column(
        Enum(CourseTeacherRole, native_enum=False), nullable=False, default=CourseTeacherRole.co_teacher
    )
    added_at: Mapped[datetime] = mapped_column(nullable=False, default=utcnow)
