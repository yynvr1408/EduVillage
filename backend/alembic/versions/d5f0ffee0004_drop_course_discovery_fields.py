"""drop unused course discovery fields (grade level, language, institution, region)

Revision ID: d5f0ffee0004
Revises: 1c94b88c6434
Create Date: 2026-10-16 18:00:00

Removed at the product owner's request: the fields were optional free text nobody needed. Downgrade restores
the (empty) columns; the values themselves are not recoverable.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d5f0ffee0004"
down_revision: Union[str, Sequence[str], None] = "1c94b88c6434"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index(op.f("ix_courses_region"), table_name="courses")
    op.drop_index(op.f("ix_courses_institution"), table_name="courses")
    with op.batch_alter_table("courses") as batch:
        batch.drop_column("region")
        batch.drop_column("institution")
        batch.drop_column("language")
        batch.drop_column("grade_level")


def downgrade() -> None:
    with op.batch_alter_table("courses") as batch:
        batch.add_column(sa.Column("grade_level", sa.String(length=60), nullable=True))
        batch.add_column(sa.Column("language", sa.String(length=60), nullable=True))
        batch.add_column(sa.Column("institution", sa.String(length=160), nullable=True))
        batch.add_column(sa.Column("region", sa.String(length=160), nullable=True))
    op.create_index(op.f("ix_courses_institution"), "courses", ["institution"], unique=False)
    op.create_index(op.f("ix_courses_region"), "courses", ["region"], unique=False)
