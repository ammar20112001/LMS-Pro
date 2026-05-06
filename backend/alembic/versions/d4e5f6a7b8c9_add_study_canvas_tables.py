"""add study canvas tables

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-05-07
"""
from alembic import op
import sqlalchemy as sa

revision = 'd4e5f6a7b8c9'
down_revision = 'c3d4e5f6a7b8'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'handout_sources',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('course_code', sa.String(20), nullable=False),
        sa.Column('file_path', sa.String(1000), nullable=False, unique=True),
        sa.Column('file_type', sa.String(10), nullable=False),
        sa.Column('total_chunks', sa.Integer(), default=0),
        sa.Column('ingest_status', sa.String(20), default='pending'),
        sa.Column('ingested_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        'handout_chunks',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('source_id', sa.Integer(), sa.ForeignKey('handout_sources.id'), nullable=False),
        sa.Column('course_code', sa.String(20), nullable=False),
        sa.Column('lecture_no', sa.Integer(), default=0),
        sa.Column('title', sa.String(500), nullable=False),
        sa.Column('raw_text', sa.Text(), nullable=True),
        sa.Column('page_start', sa.Integer(), default=0),
        sa.Column('page_end', sa.Integer(), default=0),
        sa.Column('enriched_md', sa.Text(), nullable=True),
        sa.Column('enriched_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('enrich_status', sa.String(20), default='pending'),
    )
    op.create_table(
        'handout_images',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('chunk_id', sa.Integer(), sa.ForeignKey('handout_chunks.id'), nullable=False),
        sa.Column('seq', sa.Integer(), default=1),
        sa.Column('file_path', sa.String(1000), nullable=False),
    )


def downgrade():
    op.drop_table('handout_images')
    op.drop_table('handout_chunks')
    op.drop_table('handout_sources')
