from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Item
from ..schemas import ItemOut

router = APIRouter(prefix="/api/items", tags=["items"])


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


@router.get("", response_model=list[ItemOut])
def list_items(
    due_within_days: int = 14,
    kind: str = None,
    db: Session = Depends(get_db),
):
    from datetime import timedelta
    now = datetime.now(timezone.utc)
    cutoff = now + timedelta(days=due_within_days)
    q = db.query(Item).filter(
        Item.due_at >= now,
        Item.due_at <= cutoff,
        Item.completed_at.is_(None),
    )
    if kind:
        q = q.filter(Item.kind == kind)
    items = q.order_by(Item.due_at).all()
    return [_item_out(i) for i in items]


@router.get("/{item_id}", response_model=ItemOut)
def get_item(item_id: int, db: Session = Depends(get_db)):
    item = db.query(Item).get(item_id)
    if not item:
        raise HTTPException(404, "Item not found")
    return _item_out(item)


@router.post("/{item_id}/complete", response_model=ItemOut)
def mark_complete(item_id: int, db: Session = Depends(get_db)):
    item = db.query(Item).get(item_id)
    if not item:
        raise HTTPException(404, "Item not found")
    item.completed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(item)
    return _item_out(item)


@router.post("/{item_id}/uncomplete", response_model=ItemOut)
def mark_uncomplete(item_id: int, db: Session = Depends(get_db)):
    item = db.query(Item).get(item_id)
    if not item:
        raise HTTPException(404, "Item not found")
    item.completed_at = None
    db.commit()
    db.refresh(item)
    return _item_out(item)
