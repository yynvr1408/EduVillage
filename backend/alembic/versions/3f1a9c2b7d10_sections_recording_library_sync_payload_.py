"""sections, recording library, sync payload hash

Revision ID: 3f1a9c2b7d10
Revises: ad72faae9d99
Create Date: 2026-10-15 17:52:25.320924

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3f1a9c2b7d10'
down_revision: Union[str, Sequence[str], None] = 'ad72faae9d99'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('sections',
    sa.Column('course_id', sa.String(length=36), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('code', sa.String(length=40), nullable=False),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['course_id'], ['courses.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('course_id', 'code', name='uq_section_course_code')
    )
    op.create_index(op.f('ix_sections_course_id'), 'sections', ['course_id'], unique=False)
    op.create_table('class_sections',
    sa.Column('class_id', sa.String(length=36), nullable=False),
    sa.Column('section_id', sa.String(length=36), nullable=False),
    sa.ForeignKeyConstraint(['class_id'], ['classes.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['section_id'], ['sections.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('class_id', 'section_id')
    )
    op.create_table('section_members',
    sa.Column('section_id', sa.String(length=36), nullable=False),
    sa.Column('student_id', sa.String(length=36), nullable=False),
    sa.Column('added_at', sa.DateTime(), nullable=False),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.ForeignKeyConstraint(['section_id'], ['sections.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['student_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('section_id', 'student_id', name='uq_section_student')
    )
    op.create_index(op.f('ix_section_members_section_id'), 'section_members', ['section_id'], unique=False)
    op.create_index(op.f('ix_section_members_student_id'), 'section_members', ['student_id'], unique=False)
    op.create_table('recording_progress',
    sa.Column('recording_id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('position_seconds', sa.Integer(), nullable=False),
    sa.Column('completed', sa.Boolean(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.ForeignKeyConstraint(['recording_id'], ['class_recordings.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('recording_id', 'user_id', name='uq_recording_progress_user')
    )
    op.create_index(op.f('ix_recording_progress_recording_id'), 'recording_progress', ['recording_id'], unique=False)
    op.create_index(op.f('ix_recording_progress_user_id'), 'recording_progress', ['user_id'], unique=False)
    op.create_table('recording_sections',
    sa.Column('recording_id', sa.String(length=36), nullable=False),
    sa.Column('section_id', sa.String(length=36), nullable=False),
    sa.Column('shared_by', sa.String(length=36), nullable=False),
    sa.Column('shared_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['recording_id'], ['class_recordings.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['section_id'], ['sections.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['shared_by'], ['users.id'], ),
    sa.PrimaryKeyConstraint('recording_id', 'section_id')
    )
    op.create_table('resource_sections',
    sa.Column('resource_id', sa.String(length=36), nullable=False),
    sa.Column('section_id', sa.String(length=36), nullable=False),
    sa.Column('shared_by', sa.String(length=36), nullable=False),
    sa.Column('shared_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['resource_id'], ['learning_resources.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['section_id'], ['sections.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['shared_by'], ['users.id'], ),
    sa.PrimaryKeyConstraint('resource_id', 'section_id')
    )
    op.add_column('background_jobs', sa.Column('max_attempts', sa.Integer(), nullable=False, server_default='3'))
    op.add_column('class_recordings', sa.Column('title', sa.String(length=255), nullable=True))
    op.add_column('class_recordings', sa.Column('duration_seconds', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('class_recordings', sa.Column('size_bytes', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('class_recordings', sa.Column('is_published', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('class_recordings', sa.Column('error_message', sa.Text(), nullable=True))
    op.create_index('uq_recording_egress_id', 'class_recordings', ['egress_id'], unique=True)
    op.create_index('uq_one_active_recording_per_class', 'class_recordings', ['class_id'], unique=True, sqlite_where=sa.text("status = 'recording'"), postgresql_where=sa.text("status = 'recording'"))
    op.add_column('lecture_summaries', sa.Column('recording_id', sa.String(length=36), nullable=True))
    op.add_column('lecture_summaries', sa.Column('generator', sa.String(length=20), nullable=True))
    op.add_column('lecture_summaries', sa.Column('generator_model', sa.String(length=120), nullable=True))
    op.create_index(op.f('ix_lecture_summaries_recording_id'), 'lecture_summaries', ['recording_id'], unique=False)
    with op.batch_alter_table('lecture_summaries') as batch:
        batch.create_foreign_key('fk_lecture_summaries_recording_id', 'class_recordings', ['recording_id'], ['id'])
    op.add_column('lecture_transcripts', sa.Column('recording_id', sa.String(length=36), nullable=True))
    op.add_column('lecture_transcripts', sa.Column('content_hash', sa.String(length=64), nullable=True))
    op.create_index(op.f('ix_lecture_transcripts_content_hash'), 'lecture_transcripts', ['content_hash'], unique=False)
    op.create_index(op.f('ix_lecture_transcripts_recording_id'), 'lecture_transcripts', ['recording_id'], unique=False)
    with op.batch_alter_table('lecture_transcripts') as batch:
        batch.create_foreign_key('fk_lecture_transcripts_recording_id', 'class_recordings', ['recording_id'], ['id'])
    op.add_column('sync_operations', sa.Column('payload_hash', sa.String(length=64), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('sync_operations', 'payload_hash')
    with op.batch_alter_table('lecture_transcripts') as batch:
        batch.drop_constraint('fk_lecture_transcripts_recording_id', type_='foreignkey')
    op.drop_index(op.f('ix_lecture_transcripts_recording_id'), table_name='lecture_transcripts')
    op.drop_index(op.f('ix_lecture_transcripts_content_hash'), table_name='lecture_transcripts')
    op.drop_column('lecture_transcripts', 'content_hash')
    op.drop_column('lecture_transcripts', 'recording_id')
    with op.batch_alter_table('lecture_summaries') as batch:
        batch.drop_constraint('fk_lecture_summaries_recording_id', type_='foreignkey')
    op.drop_index(op.f('ix_lecture_summaries_recording_id'), table_name='lecture_summaries')
    op.drop_column('lecture_summaries', 'generator_model')
    op.drop_column('lecture_summaries', 'generator')
    op.drop_column('lecture_summaries', 'recording_id')
    op.drop_index('uq_recording_egress_id', table_name='class_recordings')
    op.drop_index('uq_one_active_recording_per_class', table_name='class_recordings', sqlite_where=sa.text("status = 'recording'"), postgresql_where=sa.text("status = 'recording'"))
    op.drop_column('class_recordings', 'error_message')
    op.drop_column('class_recordings', 'is_published')
    op.drop_column('class_recordings', 'size_bytes')
    op.drop_column('class_recordings', 'duration_seconds')
    op.drop_column('class_recordings', 'title')
    op.drop_column('background_jobs', 'max_attempts')
    op.drop_table('recording_sections')
    op.drop_table('resource_sections')
    op.drop_index(op.f('ix_recording_progress_user_id'), table_name='recording_progress')
    op.drop_index(op.f('ix_recording_progress_recording_id'), table_name='recording_progress')
    op.drop_table('recording_progress')
    op.drop_index(op.f('ix_section_members_student_id'), table_name='section_members')
    op.drop_index(op.f('ix_section_members_section_id'), table_name='section_members')
    op.drop_table('section_members')
    op.drop_table('class_sections')
    op.drop_index(op.f('ix_sections_course_id'), table_name='sections')
    op.drop_table('sections')
