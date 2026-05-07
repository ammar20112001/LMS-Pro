"""Add HandoutSection, image page_no, chunk/section completion flags

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-05-07
"""
from alembic import op
import sqlalchemy as sa

revision = "e5f6a7b8c9d0"
down_revision = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None


def upgrade():
    # page_no on existing handout_images
    op.add_column("handout_images", sa.Column("page_no", sa.Integer(), nullable=False, server_default="0"))

    # lecture-level completion on handout_chunks
    op.add_column("handout_chunks", sa.Column("is_completed", sa.Boolean(), nullable=False, server_default="0"))

    # sections table
    op.create_table(
        "handout_sections",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("chunk_id", sa.Integer(), sa.ForeignKey("handout_chunks.id"), nullable=False),
        sa.Column("section_key", sa.String(200), nullable=False),
        sa.Column("level", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_completed", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("parsed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_handout_sections_chunk_id", "handout_sections", ["chunk_id"])


def downgrade():
    op.drop_table("handout_sections")
    op.drop_column("handout_chunks", "is_completed")
    op.drop_column("handout_images", "page_no")
