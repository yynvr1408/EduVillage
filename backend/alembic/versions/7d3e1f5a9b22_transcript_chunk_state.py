"""transcript chunk state

Revision ID: 7d3e1f5a9b22
Revises: 5b7c2e9a4d11
Create Date: 2026-10-15 21:56:26.009128

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7d3e1f5a9b22'
down_revision: Union[str, Sequence[str], None] = '5b7c2e9a4d11'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('lecture_transcripts', sa.Column('chunk_state', sa.JSON(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('lecture_transcripts', 'chunk_state')
