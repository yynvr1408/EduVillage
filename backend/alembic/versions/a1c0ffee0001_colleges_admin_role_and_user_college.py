"""colleges admin role and user college

Revision ID: a1c0ffee0001
Revises: d4e9e92dd07b
Create Date: 2026-10-16 02:55:08.897159

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1c0ffee0001'
down_revision: Union[str, Sequence[str], None] = 'd4e9e92dd07b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('colleges',
    sa.Column('name', sa.String(length=160), nullable=False),
    sa.Column('name_key', sa.String(length=160), nullable=False),
    sa.Column('location', sa.String(length=160), nullable=True),
    sa.Column('location_key', sa.String(length=160), nullable=False),
    sa.Column('contact_email', sa.String(length=320), nullable=True),
    sa.Column('contact_phone', sa.String(length=40), nullable=True),
    sa.Column('code', sa.String(length=32), nullable=False),
    sa.Column('code_generated_at', sa.DateTime(), nullable=False),
    sa.Column('status', sa.Enum('active', 'inactive', name='collegestatus', native_enum=False), nullable=False),
    sa.Column('created_by', sa.String(length=36), nullable=True),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('name_key', 'location_key', name='uq_college_name_location')
    )
    op.create_index(op.f('ix_colleges_code'), 'colleges', ['code'], unique=True)
    op.create_index(op.f('ix_colleges_status'), 'colleges', ['status'], unique=False)
    op.create_table('college_code_history',
    sa.Column('college_id', sa.String(length=36), nullable=False),
    sa.Column('code', sa.String(length=32), nullable=False),
    sa.Column('replaced_at', sa.DateTime(), nullable=False),
    sa.Column('replaced_by', sa.String(length=36), nullable=True),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.ForeignKeyConstraint(['college_id'], ['colleges.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['replaced_by'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_college_code_history_code'), 'college_code_history', ['code'], unique=True)
    op.create_index(op.f('ix_college_code_history_college_id'), 'college_code_history', ['college_id'], unique=False)
    # Existing users are NOT assigned to a college; the column starts NULL for everyone.
    with op.batch_alter_table('users') as batch:
        batch.add_column(sa.Column('college_id', sa.String(length=36), nullable=True))
        batch.create_index(op.f('ix_users_college_id'), ['college_id'], unique=False)
        batch.create_foreign_key('fk_users_college_id_colleges', 'colleges', ['college_id'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('users') as batch:
        batch.drop_constraint('fk_users_college_id_colleges', type_='foreignkey')
        batch.drop_index(op.f('ix_users_college_id'))
        batch.drop_column('college_id')
    op.drop_index(op.f('ix_college_code_history_college_id'), table_name='college_code_history')
    op.drop_index(op.f('ix_college_code_history_code'), table_name='college_code_history')
    op.drop_table('college_code_history')
    op.drop_index(op.f('ix_colleges_status'), table_name='colleges')
    op.drop_index(op.f('ix_colleges_code'), table_name='colleges')
    op.drop_table('colleges')
