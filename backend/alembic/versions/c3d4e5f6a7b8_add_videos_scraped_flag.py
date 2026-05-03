"""add videos_scraped flag to lectures

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-05-02
"""
from alembic import op
import sqlalchemy as sa

revision = 'c3d4e5f6a7b8'
down_revision = 'b2c3d4e5f6a7'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("lectures") as batch_op:
        batch_op.add_column(
            sa.Column("videos_scraped", sa.Boolean(), nullable=False, server_default="0")
        )
    # All existing rows start as unconfirmed — sync will re-check them
    op.execute("UPDATE lectures SET videos_scraped = 0")


def downgrade():
    with op.batch_alter_table("lectures") as batch_op:
        batch_op.drop_column("videos_scraped")
