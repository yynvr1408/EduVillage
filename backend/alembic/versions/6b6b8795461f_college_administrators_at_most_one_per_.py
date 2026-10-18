"""college administrators: at most one per college

Revision ID: 6b6b8795461f
Revises: 6c458a0c5636
Create Date: 2026-10-18 22:31:37.451756

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6b6b8795461f'
down_revision: Union[str, Sequence[str], None] = '6c458a0c5636'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # batch mode: SQLite cannot ALTER a constraint directly (only Postgres can), so this goes
    # through Alembic's copy-and-move strategy there while staying a plain ALTER on Postgres.
    with op.batch_alter_table('college_administrators') as batch_op:
        batch_op.drop_index(op.f('ix_college_administrators_college_id'))
        batch_op.drop_constraint(op.f('uq_college_administrator'), type_='unique')
        batch_op.create_unique_constraint('uq_college_administrator_one_per_college', ['college_id'])


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('college_administrators') as batch_op:
        batch_op.drop_constraint('uq_college_administrator_one_per_college', type_='unique')
        batch_op.create_unique_constraint(op.f('uq_college_administrator'), ['user_id', 'college_id'])
        batch_op.create_index(op.f('ix_college_administrators_college_id'), ['college_id'], unique=False)
