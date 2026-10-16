"""add error_message to background_jobs

Revision ID: 1c94b88c6434
Revises: c3e0ffee0003
Create Date: 2026-10-16 02:52:58.922725

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1c94b88c6434'
down_revision: Union[str, Sequence[str], None] = 'c3e0ffee0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Idempotent: a database that already got this column (e.g. from a developer's earlier run of this
    # revision on another branch) must not fail with "column already exists".
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("background_jobs")}
    if "error_message" not in columns:
        op.add_column('background_jobs', sa.Column('error_message', sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('background_jobs', 'error_message')
