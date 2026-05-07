import hashlib
import json
from datetime import datetime, timezone
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Course(Base):
    __tablename__ = "courses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    lms_index: Mapped[int] = mapped_column(Integer, unique=True)  # 0-7
    ctl_id: Mapped[str] = mapped_column(String(10))               # "ctl00"
    postback_target: Mapped[str] = mapped_column(String(200))
    code: Mapped[str] = mapped_column(String(20))
    title: Mapped[str] = mapped_column(String(300))
    term: Mapped[str] = mapped_column(String(50), default="Spring 2026")
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    items: Mapped[list["Item"]] = relationship("Item", back_populates="course", cascade="all, delete-orphan")
    lectures: Mapped[list["Lecture"]] = relationship("Lecture", back_populates="course", order_by="Lecture.serial_no")
    progress: Mapped[list["CourseProgress"]] = relationship("CourseProgress", back_populates="course", uselist=False)


class Item(Base):
    __tablename__ = "items"
    __table_args__ = (UniqueConstraint("course_id", "kind", "lms_index"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    course_id: Mapped[int] = mapped_column(Integer, ForeignKey("courses.id"))
    lms_index: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(20))  # assignment | quiz | gdb

    title: Mapped[str] = mapped_column(String(500))
    lesson: Mapped[str | None] = mapped_column(String(500), nullable=True)
    total_marks: Mapped[str | None] = mapped_column(String(50), nullable=True)
    status: Mapped[str | None] = mapped_column(String(100), nullable=True)  # Open/Closed/Expired

    opens_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    file_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    file_local_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)

    course: Mapped["Course"] = relationship("Course", back_populates="items")
    notifications: Mapped[list["Notification"]] = relationship("Notification", back_populates="item", cascade="all, delete-orphan")

    def compute_hash(self) -> str:
        payload = f"{self.title}|{self.due_at}|{self.opens_at}|{self.total_marks}|{self.status}"
        return hashlib.sha256(payload.encode()).hexdigest()[:16]


class Lecture(Base):
    __tablename__ = "lectures"
    id = Column(Integer, primary_key=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False)
    week = Column(Integer, default=0)
    lms_index = Column(Integer, default=0)
    serial_no = Column(Integer, default=0)
    title = Column(String, nullable=False)
    has_video = Column(Boolean, default=False)
    has_reading = Column(Boolean, default=False)

    # Phase 2 — notes pipeline
    youtube_id = Column(String(20), nullable=True)
    transcript_raw = Column(Text, nullable=True)
    transcript_en = Column(Text, nullable=True)             # English translation of transcript
    transcript_source = Column(String(20), nullable=True)   # youtube_auto | whisper_local
    transcript_quality = Column(String(10), nullable=True)  # ok | poor | unavailable
    transcript_retries = Column(Integer, default=0)
    notes_md = Column(Text, nullable=True)
    notes_generated_at = Column(DateTime(timezone=True), nullable=True)
    notes_status = Column(String(20), default="pending")    # pending | transcribing | transcribed | generating | done | failed

    video_count = Column(Integer, default=1)
    videos_scraped = Column(Boolean, default=False)  # True once sync has confirmed video tab count
    videos = relationship("LectureVideo", back_populates="lecture", order_by="LectureVideo.seq", cascade="all, delete-orphan")

    course = relationship("Course", back_populates="lectures")


class LectureVideo(Base):
    __tablename__ = "lecture_videos"
    id = Column(Integer, primary_key=True)
    lecture_id = Column(Integer, ForeignKey("lectures.id"), nullable=False)
    seq = Column(Integer, default=1)          # 1-based: first video, second video, etc.
    youtube_id = Column(String(20), nullable=True)   # None=unchecked, "NONE"=not on YT
    transcript_raw = Column(Text, nullable=True)
    transcript_en = Column(Text, nullable=True)
    transcript_source = Column(String(20), nullable=True)
    transcript_quality = Column(String(10), nullable=True)
    transcript_retries = Column(Integer, default=0)
    notes_md = Column(Text, nullable=True)
    notes_generated_at = Column(DateTime(timezone=True), nullable=True)
    notes_status = Column(String(20), default="pending")

    lecture = relationship("Lecture", back_populates="videos")


class CourseProgress(Base):
    __tablename__ = "course_progress"
    id = Column(Integer, primary_key=True)
    course_id = Column(Integer, ForeignKey("courses.id"), unique=True, nullable=False)
    current_lecture_serial = Column(Integer, default=0)

    course = relationship("Course", back_populates="progress")


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    item_id: Mapped[int] = mapped_column(Integer, ForeignKey("items.id"))
    kind: Mapped[str] = mapped_column(String(30))  # deadline_72h | deadline_24h | deadline_2h | digest
    scheduled_for: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    item: Mapped["Item"] = relationship("Item", back_populates="notifications")


class HandoutSource(Base):
    __tablename__ = "handout_sources"

    id = Column(Integer, primary_key=True)
    course_code = Column(String(20), nullable=False)
    file_path = Column(String(1000), nullable=False, unique=True)
    file_type = Column(String(10), nullable=False)   # pdf | pptx
    total_chunks = Column(Integer, default=0)
    ingest_status = Column(String(20), default="pending")  # pending | ingesting | done | failed
    ingested_at = Column(DateTime(timezone=True), nullable=True)

    chunks = relationship("HandoutChunk", back_populates="source", cascade="all, delete-orphan")


class HandoutChunk(Base):
    __tablename__ = "handout_chunks"

    id = Column(Integer, primary_key=True)
    source_id = Column(Integer, ForeignKey("handout_sources.id"), nullable=False)
    course_code = Column(String(20), nullable=False)
    lecture_no = Column(Integer, default=0)
    title = Column(String(500), nullable=False)
    raw_text = Column(Text, nullable=True)
    page_start = Column(Integer, default=0)
    page_end = Column(Integer, default=0)
    enriched_md = Column(Text, nullable=True)
    enriched_at = Column(DateTime(timezone=True), nullable=True)
    enrich_status = Column(String(20), default="pending")  # pending | enriching | done | failed
    is_completed = Column(Boolean, default=False)

    source = relationship("HandoutSource", back_populates="chunks")
    images = relationship("HandoutImage", back_populates="chunk", order_by="HandoutImage.seq", cascade="all, delete-orphan")


class HandoutImage(Base):
    __tablename__ = "handout_images"

    id = Column(Integer, primary_key=True)
    chunk_id = Column(Integer, ForeignKey("handout_chunks.id"), nullable=False)
    seq = Column(Integer, default=1)
    page_no = Column(Integer, default=0)  # PDF page index (0-based) within the chunk
    file_path = Column(String(1000), nullable=False)

    chunk = relationship("HandoutChunk", back_populates="images")


class HandoutSection(Base):
    """One heading-delimited section within an enriched chunk."""
    __tablename__ = "handout_sections"

    id = Column(Integer, primary_key=True)
    chunk_id = Column(Integer, ForeignKey("handout_chunks.id"), nullable=False)
    section_key = Column(String(200), nullable=False)  # stable slug: "{chunk_id}-{order}"
    level = Column(Integer, default=1)     # 1 = ## heading, 2 = ### heading
    title = Column(String(500), nullable=False)
    body = Column(Text, nullable=True)
    order = Column(Integer, default=0)     # position within chunk
    is_completed = Column(Boolean, default=False)
    parsed_at = Column(DateTime(timezone=True), nullable=True)

    chunk = relationship("HandoutChunk")


class SyncRun(Base):
    __tablename__ = "sync_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="running")  # running | ok | error
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    items_added: Mapped[int] = mapped_column(Integer, default=0)
    items_updated: Mapped[int] = mapped_column(Integer, default=0)
    courses_synced: Mapped[int] = mapped_column(Integer, default=0)
