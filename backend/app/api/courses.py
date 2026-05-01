from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Course, Item
from ..schemas import CourseOut, ItemOut

router = APIRouter(prefix="/api/courses", tags=["courses"])


def _item_out(item: Item) -> ItemOut:
    return ItemOut(
        id=item.id,
        course_id=item.course_id,
        course_code=item.course.code,
        course_title=item.course.title,
        kind=item.kind,
        title=item.title,
        lesson=item.lesson,
        total_marks=item.total_marks,
        status=item.status,
        opens_at=item.opens_at,
        due_at=item.due_at,
        file_url=item.file_url,
        completed_at=item.completed_at,
        first_seen_at=item.first_seen_at,
        last_seen_at=item.last_seen_at,
    )


@router.get("", response_model=list[CourseOut])
def list_courses(db: Session = Depends(get_db)):
    return db.query(Course).order_by(Course.code).all()


@router.get("/{course_id}", response_model=CourseOut)
def get_course(course_id: int, db: Session = Depends(get_db)):
    from fastapi import HTTPException
    course = db.query(Course).get(course_id)
    if not course:
        raise HTTPException(404, "Course not found")
    return course


@router.get("/{course_id}/items", response_model=list[ItemOut])
def course_items(course_id: int, db: Session = Depends(get_db)):
    items = (
        db.query(Item)
        .filter_by(course_id=course_id)
        .order_by(Item.due_at.nullslast())
        .all()
    )
    return [_item_out(i) for i in items]
