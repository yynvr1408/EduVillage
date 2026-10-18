from datetime import datetime

from sqlalchemy import Enum, ForeignKey, ForeignKeyConstraint, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin, utcnow
from app.db.models.enums import CollegeStatus
from app.db.models.user import User


class College(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "colleges"
    __table_args__ = (UniqueConstraint("name_key", "location_key", name="uq_college_name_location"),)

    name: Mapped[str] = mapped_column(String(160), nullable=False)  # display name, exactly as entered
    name_key: Mapped[str] = mapped_column(String(160), nullable=False)  # normalized, for duplicate detection
    location: Mapped[str | None] = mapped_column(String(160), nullable=True)
    location_key: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    contact_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    # The unpredictable, human-shareable code. Unique at the DATABASE level; never the primary key.
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)
    code_generated_at: Mapped[datetime] = mapped_column(nullable=False, default=utcnow)
    status: Mapped[CollegeStatus] = mapped_column(
        Enum(CollegeStatus, native_enum=False), nullable=False, default=CollegeStatus.active, index=True
    )
    created_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


class CollegeCodeHistory(UUIDPrimaryKeyMixin, Base):
    """Every code a college has had. Codes are never reused (the code column is unique across history too),
    and relationships use college ids, so regenerating a code cannot detach users from their college."""

    __tablename__ = "college_code_history"

    college_id: Mapped[str] = mapped_column(String(36), ForeignKey("colleges.id", ondelete="CASCADE"), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)
    replaced_at: Mapped[datetime] = mapped_column(nullable=False, default=utcnow)
    replaced_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


class CollegeBranch(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A branch/department of a college (e.g. "Computer Science and Engineering"), managed by administrators."""

    __tablename__ = "college_branches"
    __table_args__ = (
        UniqueConstraint("college_id", "name_key", name="uq_college_branch_name"),
        # lets college_sections reference (branch, college) together, so a section can never name a college
        # other than its branch's own
        UniqueConstraint("id", "college_id", name="uq_branch_id_college"),
    )

    college_id: Mapped[str] = mapped_column(String(36), ForeignKey("colleges.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    name_key: Mapped[str] = mapped_column(String(120), nullable=False)
    short_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    status: Mapped[CollegeStatus] = mapped_column(Enum(CollegeStatus, native_enum=False), nullable=False, default=CollegeStatus.active)


class CollegeSection(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """An administrator-managed section of a branch (e.g. "Section A").

    Distinct from `sections` (a student cohort inside ONE course): a new teacher has no course yet, so the
    college needs its own list. A course section can be linked to one of these; nothing here grants
    course access or enrollment."""

    __tablename__ = "college_sections"
    __table_args__ = (
        UniqueConstraint("branch_id", "name_key", name="uq_college_section_branch_name"),
        ForeignKeyConstraint(
            ["branch_id", "college_id"],
            ["college_branches.id", "college_branches.college_id"],
            ondelete="CASCADE",
            name="fk_section_branch_college",
        ),
    )

    college_id: Mapped[str] = mapped_column(String(36), ForeignKey("colleges.id", ondelete="CASCADE"), nullable=False, index=True)
    branch_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    name_key: Mapped[str] = mapped_column(String(80), nullable=False)
    status: Mapped[CollegeStatus] = mapped_column(Enum(CollegeStatus, native_enum=False), nullable=False, default=CollegeStatus.active)


class UserCollegeSection(UUIDPrimaryKeyMixin, Base):
    """The college section a teacher teaches in / a student belongs to. Unrelated to course enrollment."""

    __tablename__ = "user_college_sections"
    __table_args__ = (UniqueConstraint("user_id", "college_section_id", name="uq_user_college_section"),)

    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    college_section_id: Mapped[str] = mapped_column(String(36), ForeignKey("college_sections.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(nullable=False, default=utcnow)


class UserBranchAssignment(UUIDPrimaryKeyMixin, Base):
    """Branch-wide teaching assignment ("All Sections"): covers every active section of the branch, including
    sections added later. Deliberately a different relationship from `user_college_sections`, so it never
    needs a fake section row and never reaches another branch or college."""

    __tablename__ = "user_branch_assignments"
    __table_args__ = (UniqueConstraint("user_id", "branch_id", name="uq_user_branch_assignment"),)

    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    branch_id: Mapped[str] = mapped_column(String(36), ForeignKey("college_branches.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(nullable=False, default=utcnow)


class CollegeAdministrator(UUIDPrimaryKeyMixin, Base):
    """A teacher delegated to manage ONE college's own branches/sections/code — so routine
    institutional setup (adding a branch, regenerating a leaked code, ...) doesn't bottleneck on
    the one platform admin for every single institution. Entirely separate from the platform
    admin's own auth system (UserRole.admin, a different session/cookie): this is checked as an
    additional permission layered on top of an ordinary teacher session. Granting/revoking it
    stays a platform-admin-only action (see college_service.assign_college_admin) — a teacher can
    never make themselves one."""

    __tablename__ = "college_administrators"
    __table_args__ = (UniqueConstraint("user_id", "college_id", name="uq_college_administrator"),)

    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    college_id: Mapped[str] = mapped_column(String(36), ForeignKey("colleges.id", ondelete="CASCADE"), nullable=False, index=True)
    assigned_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    assigned_at: Mapped[datetime] = mapped_column(nullable=False, default=utcnow)

    user: Mapped["User"] = relationship(lazy="selectin", foreign_keys=[user_id])

    @property
    def full_name(self) -> str:
        return self.user.full_name

    @property
    def email(self) -> str:
        return self.user.email
