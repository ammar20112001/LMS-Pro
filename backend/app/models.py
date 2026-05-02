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
    transcript_source = Column(String(20), nullable=True)   # youtube_auto | whisper_local
    transcript_quality = Column(String(10), nullable=True)  # ok | poor | unavailable
    notes_md = Column(Text, nullable=True)
    notes_generated_at = Column(DateTime(timezone=True), nullable=True)
    notes_status = Column(String(20), default="pending")    # pending | transcribing | generating | done | failed

    course = relationship("Course", back_populates="lectures")


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
