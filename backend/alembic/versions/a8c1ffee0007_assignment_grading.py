"""manual grading: assignment max_score, submission score/feedback

Revision ID: a8c1ffee0007
Revises: c61c0bf2199b
Create Date: 2026-10-16 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a8c1ffee0007'
down_revision: Union[str, Sequence[str], None] = 'c61c0bf2199b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('assignments') as batch:
        batch.add_column(sa.Column('max_score', sa.Integer(), nullable=False, server_default='100'))
    with op.batch_alter_table('assignment_submissions') as batch:
        batch.add_column(sa.Column('score', sa.Float(), nullable=True))
        batch.add_column(sa.Column('feedback', sa.Text(), nullable=True))
        batch.add_column(sa.Column('graded_at', sa.DateTime(), nullable=True))
        batch.add_column(sa.Column('graded_by', sa.String(length=36), nullable=True))
        batch.create_foreign_key('fk_submission_graded_by', 'users', ['graded_by'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    with op.batch_alter_table('assignment_submissions') as batch:
        batch.drop_constraint('fk_submission_graded_by', type_='foreignkey')
        batch.drop_column('graded_by')
        batch.drop_column('graded_at')
        batch.drop_column('feedback')
        batch.drop_column('score')
    with op.batch_alter_table('assignments') as batch:
        batch.drop_column('max_score')
