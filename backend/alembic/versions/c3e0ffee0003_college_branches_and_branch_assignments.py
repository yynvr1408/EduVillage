"""college branches, branch-wide teacher assignments, course-section link

Revision ID: c3e0ffee0003
Revises: b2d0ffee0002
Create Date: 2026-10-16 12:00:00

Backward compatible: college sections created before branches existed are moved under a "General" branch of
their college (one per college that has sections) instead of being deleted or guessed into real departments.
"""
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c3e0ffee0003"
down_revision: Union[str, Sequence[str], None] = "b2d0ffee0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "college_branches",
        sa.Column("college_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("name_key", sa.String(length=120), nullable=False),
        sa.Column("short_code", sa.String(length=20), nullable=True),
        sa.Column("status", sa.Enum("active", "inactive", name="collegestatus", native_enum=False), nullable=False),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["college_id"], ["colleges.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("college_id", "name_key", name="uq_college_branch_name"),
        sa.UniqueConstraint("id", "college_id", name="uq_branch_id_college"),
    )
    op.create_index(op.f("ix_college_branches_college_id"), "college_branches", ["college_id"], unique=False)

    op.add_column("college_sections", sa.Column("branch_id", sa.String(length=36), nullable=True))

    bind = op.get_bind()
    colleges = bind.execute(sa.text("SELECT DISTINCT college_id FROM college_sections")).fetchall()
    for (college_id,) in colleges:
        branch_id = str(uuid.uuid4())
        bind.execute(
            sa.text(
                "INSERT INTO college_branches (id, college_id, name, name_key, status, created_at, updated_at) "
                "VALUES (:id, :cid, 'General', 'general', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {"id": branch_id, "cid": college_id},
        )
        bind.execute(
            sa.text("UPDATE college_sections SET branch_id = :bid WHERE college_id = :cid"),
            {"bid": branch_id, "cid": college_id},
        )

    with op.batch_alter_table("college_sections") as batch:
        batch.alter_column("branch_id", existing_type=sa.String(length=36), nullable=False)
        batch.drop_constraint("uq_college_section_name", type_="unique")
        batch.create_unique_constraint("uq_college_section_branch_name", ["branch_id", "name_key"])
        batch.create_foreign_key(
            "fk_section_branch_college", "college_branches", ["branch_id", "college_id"], ["id", "college_id"], ondelete="CASCADE"
        )
        batch.create_index(op.f("ix_college_sections_branch_id"), ["branch_id"], unique=False)

    op.create_table(
        "user_branch_assignments",
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("branch_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(["branch_id"], ["college_branches.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "branch_id", name="uq_user_branch_assignment"),
    )
    op.create_index(op.f("ix_user_branch_assignments_branch_id"), "user_branch_assignments", ["branch_id"], unique=False)
    op.create_index(op.f("ix_user_branch_assignments_user_id"), "user_branch_assignments", ["user_id"], unique=False)

    with op.batch_alter_table("sections") as batch:
        batch.add_column(sa.Column("college_section_id", sa.String(length=36), nullable=True))
        batch.create_index(op.f("ix_sections_college_section_id"), ["college_section_id"], unique=False)
        batch.create_foreign_key("fk_sections_college_section", "college_sections", ["college_section_id"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    with op.batch_alter_table("sections") as batch:
        batch.drop_constraint("fk_sections_college_section", type_="foreignkey")
        batch.drop_index(op.f("ix_sections_college_section_id"))
        batch.drop_column("college_section_id")

    op.drop_index(op.f("ix_user_branch_assignments_user_id"), table_name="user_branch_assignments")
    op.drop_index(op.f("ix_user_branch_assignments_branch_id"), table_name="user_branch_assignments")
    op.drop_table("user_branch_assignments")

    with op.batch_alter_table("college_sections") as batch:
        batch.drop_index(op.f("ix_college_sections_branch_id"))
        batch.drop_constraint("fk_section_branch_college", type_="foreignkey")
        batch.drop_constraint("uq_college_section_branch_name", type_="unique")
        batch.create_unique_constraint("uq_college_section_name", ["college_id", "name_key"])
        batch.drop_column("branch_id")

    op.drop_index(op.f("ix_college_branches_college_id"), table_name="college_branches")
    op.drop_table("college_branches")
