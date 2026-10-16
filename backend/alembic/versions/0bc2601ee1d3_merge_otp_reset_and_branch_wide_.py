"""merge otp-reset and branch-wide-audience heads

Revision ID: 0bc2601ee1d3
Revises: 815ac36126a9, e6a0ffee0005
Create Date: 2026-10-16 08:01:24.177733

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0bc2601ee1d3'
down_revision: Union[str, Sequence[str], None] = ('815ac36126a9', 'e6a0ffee0005')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
