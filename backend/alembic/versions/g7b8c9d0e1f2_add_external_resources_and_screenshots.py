"""Add ExternalResource and SectionScreenshot tables

Revision ID: g7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-05-07
"""
from alembic import op
import sqlalchemy as sa

revision = "g7b8c9d0e1f2"
down_revision = "f6a7b8c9d0e1"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "external_resources",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("section_id", sa.Integer(), sa.ForeignKey("handout_sections.id"), nullable=False),
        sa.Column("selected_text", sa.Text(), nullable=False),
        sa.Column("instructions", sa.Text(), nullable=True),
        sa.Column("resources", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_external_resources_section_id", "external_resources", ["section_id"])

    op.create_table(
        "section_screenshots",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("section_id", sa.Integer(), sa.ForeignKey("handout_sections.id"), nullable=False),
        sa.Column("file_path", sa.String(1000), nullable=False),
        sa.Column("caption", sa.String(500), nullable=True),
        sa.Column("seq", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_section_screenshots_section_id", "section_screenshots", ["section_id"])


def downgrade():
    op.drop_table("section_screenshots")
    op.drop_table("external_resources")
