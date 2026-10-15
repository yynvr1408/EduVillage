"""resource metadata, publication and processing state

Revision ID: 5b7c2e9a4d11
Revises: 3f1a9c2b7d10
Create Date: 2026-10-15 19:51:34.085747

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5b7c2e9a4d11'
down_revision: Union[str, Sequence[str], None] = '3f1a9c2b7d10'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('learning_resources', sa.Column('title', sa.String(length=255), nullable=True))
    op.add_column('learning_resources', sa.Column('description', sa.Text(), nullable=True))
    op.add_column('learning_resources', sa.Column('resource_type', sa.Enum('video', 'audio', 'document', 'presentation', 'notes', 'other', name='resourcetype', native_enum=False), nullable=True))
    op.add_column('learning_resources', sa.Column('is_published', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('learning_resources', sa.Column('processing_status', sa.Enum('pending', 'processing', 'ready', 'failed', name='processingstatus', native_enum=False), nullable=False, server_default='pending'))
    op.add_column('learning_resources', sa.Column('processing_error', sa.String(length=500), nullable=True))
    op.add_column('learning_resources', sa.Column('version', sa.Integer(), nullable=False, server_default='1'))
    op.add_column('learning_resources', sa.Column('checksum_sha256', sa.String(length=64), nullable=True))
    op.add_column('learning_resources', sa.Column('detected_mime_type', sa.String(length=120), nullable=True))
    # Backfill: files that students could already download keep being downloadable (published, ready).
    op.execute("UPDATE learning_resources SET is_published = :t, processing_status = 'ready' WHERE status = 'available'".replace(":t", "TRUE" if op.get_bind().dialect.name == "postgresql" else "1"))
    op.execute("UPDATE learning_resources SET title = filename WHERE title IS NULL")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('learning_resources', 'detected_mime_type')
    op.drop_column('learning_resources', 'checksum_sha256')
    op.drop_column('learning_resources', 'version')
    op.drop_column('learning_resources', 'processing_error')
    op.drop_column('learning_resources', 'processing_status')
    op.drop_column('learning_resources', 'is_published')
    op.drop_column('learning_resources', 'resource_type')
    op.drop_column('learning_resources', 'description')
    op.drop_column('learning_resources', 'title')
