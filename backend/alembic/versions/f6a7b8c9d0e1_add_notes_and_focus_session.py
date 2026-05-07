"""Add SectionNote and FocusSession tables

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-05-07
"""
from alembic import op
import sqlalchemy as sa

revision = "f6a7b8c9d0e1"
down_revision = "e5f6a7b8c9d0"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "section_notes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("section_id", sa.Integer(), sa.ForeignKey("handout_sections.id"), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_section_notes_section_id", "section_notes", ["section_id"])

    op.create_table(
        "focus_sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("course_code", sa.String(20), nullable=False),
        sa.Column("chunk_ids", sa.Text(), nullable=False),
        sa.Column("label", sa.String(200), nullable=True),
        sa.Column("budget_minutes", sa.Integer(), nullable=False, server_default="60"),
        sa.Column("elapsed_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_chunk_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_focus_sessions_course_code", "focus_sessions", ["course_code"])


def downgrade():
    op.drop_table("focus_sessions")
    op.drop_table("section_notes")
