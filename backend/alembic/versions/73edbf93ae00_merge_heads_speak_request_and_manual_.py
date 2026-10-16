"""merge heads: speak request and manual grading

Revision ID: 73edbf93ae00
Revises: a8c1ffee0007, cba00dec50bd
Create Date: 2026-10-16 13:49:45.869600

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '73edbf93ae00'
down_revision: Union[str, Sequence[str], None] = ('a8c1ffee0007', 'cba00dec50bd')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
