"""add transcript_en and transcript_retries to lectures

Revision ID: a1b2c3d4e5f6
Revises: 374c72daeb02
Create Date: 2026-05-02 12:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '374c72daeb02'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('lectures', sa.Column('transcript_en', sa.Text(), nullable=True))
    op.add_column('lectures', sa.Column('transcript_retries', sa.Integer(), nullable=True))
    op.execute("UPDATE lectures SET transcript_retries = 0 WHERE transcript_retries IS NULL")


def downgrade() -> None:
    op.drop_column('lectures', 'transcript_en')
    op.drop_column('lectures', 'transcript_retries')
