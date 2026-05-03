"""add lecture_videos table

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-05-02 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b2c3d4e5f6a7'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = inspector.get_table_names()

    # 1. Create the lecture_videos table (skip if already exists from a partial run)
    if 'lecture_videos' not in existing_tables:
        op.create_table(
            'lecture_videos',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('lecture_id', sa.Integer(), sa.ForeignKey('lectures.id'), nullable=False),
            sa.Column('seq', sa.Integer(), nullable=True),
            sa.Column('youtube_id', sa.String(20), nullable=True),
            sa.Column('transcript_raw', sa.Text(), nullable=True),
            sa.Column('transcript_en', sa.Text(), nullable=True),
            sa.Column('transcript_source', sa.String(20), nullable=True),
            sa.Column('transcript_quality', sa.String(10), nullable=True),
            sa.Column('transcript_retries', sa.Integer(), nullable=True),
            sa.Column('notes_md', sa.Text(), nullable=True),
            sa.Column('notes_generated_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('notes_status', sa.String(20), nullable=True),
            sa.PrimaryKeyConstraint('id'),
        )

    # 2. Add video_count column to lectures (skip if already exists)
    existing_lec_cols = [c['name'] for c in inspector.get_columns('lectures')]
    if 'video_count' not in existing_lec_cols:
        op.add_column(
            'lectures',
            sa.Column('video_count', sa.Integer(), server_default='1', nullable=True),
        )

    # 3. Data migration: copy existing lecture pipeline data into lecture_videos
    #    Only insert rows for lectures that don't already have a lecture_videos entry
    op.execute("""
        INSERT INTO lecture_videos (
            lecture_id,
            seq,
            youtube_id,
            transcript_raw,
            transcript_en,
            transcript_source,
            transcript_quality,
            transcript_retries,
            notes_md,
            notes_generated_at,
            notes_status
        )
        SELECT
            id,
            1,
            youtube_id,
            transcript_raw,
            transcript_en,
            transcript_source,
            transcript_quality,
            COALESCE(transcript_retries, 0),
            notes_md,
            notes_generated_at,
            COALESCE(notes_status, 'pending')
        FROM lectures
        WHERE youtube_id IS NOT NULL
          AND id NOT IN (SELECT lecture_id FROM lecture_videos)
    """)


def downgrade() -> None:
    op.drop_table('lecture_videos')
    op.drop_column('lectures', 'video_count')
