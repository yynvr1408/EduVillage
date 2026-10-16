"""classes.audience_branch_id: branch-wide class audience

Revision ID: e6a0ffee0005
Revises: 815ac36126a9
Create Date: 2026-10-16 20:00:00

Nullable and defaults to NULL, so every existing class keeps its current (course / section) audience.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e6a0ffee0005"
down_revision: Union[str, Sequence[str], None] = "815ac36126a9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("classes") as batch:
        batch.add_column(sa.Column("audience_branch_id", sa.String(length=36), nullable=True))
        batch.create_index(op.f("ix_classes_audience_branch_id"), ["audience_branch_id"], unique=False)
        batch.create_foreign_key("fk_classes_audience_branch", "college_branches", ["audience_branch_id"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    with op.batch_alter_table("classes") as batch:
        batch.drop_constraint("fk_classes_audience_branch", type_="foreignkey")
        batch.drop_index(op.f("ix_classes_audience_branch_id"))
        batch.drop_column("audience_branch_id")
