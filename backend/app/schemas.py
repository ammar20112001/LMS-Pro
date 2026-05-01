from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class CourseOut(BaseModel):
    id: int
    code: str
    title: str
    term: str
    last_synced_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ItemOut(BaseModel):
    id: int
    course_id: int
    course_code: str
    course_title: str
    kind: str
    title: str
    lesson: Optional[str] = None
    total_marks: Optional[str] = None
    status: Optional[str] = None
    opens_at: Optional[datetime] = None
    due_at: Optional[datetime] = None
    file_url: Optional[str] = None
    completed_at: Optional[datetime] = None
    first_seen_at: datetime
    last_seen_at: datetime

    class Config:
        from_attributes = True


class SyncRunOut(BaseModel):
    id: int
    started_at: datetime
    finished_at: Optional[datetime] = None
    status: str
    error: Optional[str] = None
    items_added: int
    items_updated: int
    courses_synced: int

    class Config:
        from_attributes = True
