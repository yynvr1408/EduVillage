"""widen participation_status to fit removed value

Revision ID: 4f9ab885870b
Revises: 0302f05380c1
Create Date: 2026-10-16 10:13:18.581413

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4f9ab885870b'
down_revision: Union[str, Sequence[str], None] = '0302f05380c1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # "removed" (teacher kicked the student out) is 7 chars, wider than the original
    # VARCHAR(6) sized for "joined"/"left" only.
    with op.batch_alter_table('class_participants') as batch:
        batch.alter_column(
            'participation_status',
            existing_type=sa.Enum('joined', 'left', name='participationstatus', native_enum=False),
            type_=sa.Enum('joined', 'left', 'removed', name='participationstatus', native_enum=False),
            existing_nullable=False,
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('class_participants') as batch:
        batch.alter_column(
            'participation_status',
            existing_type=sa.Enum('joined', 'left', 'removed', name='participationstatus', native_enum=False),
            type_=sa.Enum('joined', 'left', name='participationstatus', native_enum=False),
            existing_nullable=False,
        )
