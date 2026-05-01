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
    from sqlalchemy import or_
    now = datetime.now(timezone.utc)
    cutoff = now + timedelta(days=due_within_days)
    q = db.query(Item).filter(
        Item.completed_at.is_(None),
    ).filter(
        or_(
            # upcoming items within window
            (Item.due_at >= now) & (Item.due_at <= cutoff),
            # past-due but LMS still shows open
            (Item.due_at < now) & (Item.status == "Open"),
        )
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


@router.get("/{item_id}/file")
async def download_file(item_id: int, db: Session = Depends(get_db)):
    from fastapi.responses import StreamingResponse
    from ..scraper import VULMSScraper, CourseDTO
    import io

    item = db.query(Item).get(item_id)
    if not item:
        raise HTTPException(404, "Item not found")
    if item.kind != "assignment":
        raise HTTPException(400, "Only assignment files supported")

    course = item.course
    course_dto = CourseDTO(
        index=course.lms_index,
        ctl_id=course.ctl_id,
        postback_target=course.postback_target,
        code=course.code,
        title=course.title,
    )

    scraper = VULMSScraper()
    try:
        await scraper.start(headless=True)
        ok = await scraper.ensure_logged_in()
        if not ok:
            raise HTTPException(503, "Could not authenticate with LMS")

        data, filename = await scraper.download_assignment_file(course_dto, item.lms_index)

        return StreamingResponse(
            io.BytesIO(data),
            media_type="application/octet-stream",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Download failed: {e}")
    finally:
        await scraper.stop()
