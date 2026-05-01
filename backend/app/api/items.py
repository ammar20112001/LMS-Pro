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


async def _fetch_and_cache_file(item: Item) -> tuple[bytes, str]:
    """Download assignment file via Playwright and cache it locally. Returns (bytes, filename)."""
    from ..scraper import VULMSScraper, CourseDTO
    from ..config import settings

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

        # Cache the raw file
        cache_path = settings.files_dir / f"{item.id}_{filename}"
        cache_path.write_bytes(data)

        # Also write a pointer file so we can find it without knowing the filename
        ptr = settings.files_dir / f"{item.id}.ptr"
        ptr.write_text(filename)

        return data, filename
    finally:
        await scraper.stop()


def _get_cached_file(item_id: int) -> tuple[bytes, str] | None:
    """Return (bytes, filename) from cache, or None if not cached."""
    from ..config import settings

    ptr = settings.files_dir / f"{item_id}.ptr"
    if not ptr.exists():
        return None
    filename = ptr.read_text().strip()
    cache_path = settings.files_dir / f"{item_id}_{filename}"
    if not cache_path.exists():
        return None
    return cache_path.read_bytes(), filename


@router.get("/{item_id}/file")
async def download_file(item_id: int, db: Session = Depends(get_db)):
    """Download raw assignment file (.docx). Cached after first fetch."""
    from fastapi.responses import StreamingResponse
    import io

    item = db.query(Item).get(item_id)
    if not item:
        raise HTTPException(404, "Item not found")
    if item.kind != "assignment":
        raise HTTPException(400, "Only assignment files supported")

    cached = _get_cached_file(item_id)
    if cached:
        data, filename = cached
    else:
        try:
            data, filename = await _fetch_and_cache_file(item)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(500, f"Download failed: {e}")

    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{item_id}/file/view")
async def view_file(item_id: int, db: Session = Depends(get_db)):
    """Convert assignment .docx to HTML and return for inline viewing."""
    from fastapi.responses import HTMLResponse
    import mammoth
    import io

    item = db.query(Item).get(item_id)
    if not item:
        raise HTTPException(404, "Item not found")
    if item.kind != "assignment":
        raise HTTPException(400, "Only assignment files supported")

    cached = _get_cached_file(item_id)
    if cached:
        data, _ = cached
    else:
        try:
            data, _ = await _fetch_and_cache_file(item)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(500, f"Download failed: {e}")

    result = mammoth.convert_to_html(io.BytesIO(data))
    body_html = result.value

    html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {{
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 14px;
    line-height: 1.8;
    color: #1a1a1a;
    max-width: 780px;
    margin: 0 auto;
    padding: 32px 24px 64px;
    background: #fff;
  }}
  h1, h2, h3, h4 {{ font-weight: 700; margin: 1.2em 0 0.4em; color: #111; }}
  h1 {{ font-size: 1.5em; }}
  h2 {{ font-size: 1.25em; }}
  h3 {{ font-size: 1.1em; }}
  p {{ margin: 0.6em 0; }}
  table {{ border-collapse: collapse; width: 100%; margin: 1em 0; }}
  td, th {{ border: 1px solid #d1d5db; padding: 8px 12px; text-align: left; }}
  th {{ background: #f3f4f6; font-weight: 600; }}
  ul, ol {{ padding-left: 1.5em; margin: 0.6em 0; }}
  li {{ margin: 0.3em 0; }}
  strong {{ font-weight: 700; }}
  em {{ font-style: italic; }}
  img {{ max-width: 100%; height: auto; }}
  pre, code {{ font-family: monospace; background: #f3f4f6; padding: 2px 6px; border-radius: 3px; font-size: 13px; }}
</style>
</head>
<body>
{body_html}
</body>
</html>"""

    return HTMLResponse(content=html)
