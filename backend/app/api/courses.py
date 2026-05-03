from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Course, Item, Lecture, LectureVideo
from ..schemas import CourseOut, ItemOut, LectureOut, CourseProgressOut, LectureNotesOut

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


@router.get("/{course_id}/lectures", response_model=list[LectureOut])
def list_lectures(course_id: int, db: Session = Depends(get_db)):
    from ..models import Lecture
    lectures = db.query(Lecture).filter_by(course_id=course_id).order_by(Lecture.serial_no).all()
    return lectures


@router.get("/{course_id}/progress")
def get_progress(course_id: int, db: Session = Depends(get_db)):
    from ..models import CourseProgress, Lecture
    prog = db.query(CourseProgress).filter_by(course_id=course_id).first()
    total = db.query(Lecture).filter_by(course_id=course_id).count()
    current = prog.current_lecture_serial if prog else 0
    return {"course_id": course_id, "current_lecture_serial": current, "total_lectures": total}


@router.post("/{course_id}/progress")
def set_progress(course_id: int, serial: int, db: Session = Depends(get_db)):
    from ..models import CourseProgress
    prog = db.query(CourseProgress).filter_by(course_id=course_id).first()
    if not prog:
        prog = CourseProgress(course_id=course_id)
        db.add(prog)
    prog.current_lecture_serial = serial
    db.commit()
    return {"course_id": course_id, "current_lecture_serial": serial}


@router.get("/{course_id}/lectures/{lecture_id}/notes", response_model=LectureNotesOut)
def get_lecture_notes(course_id: int, lecture_id: int, db: Session = Depends(get_db)):
    lec = db.query(Lecture).filter_by(id=lecture_id, course_id=course_id).first()
    if not lec:
        raise HTTPException(404, "Lecture not found")
    return lec


@router.put("/{course_id}/lectures/{lecture_id}/youtube_id")
def set_lecture_youtube_id(course_id: int, lecture_id: int, body: dict, db: Session = Depends(get_db)):
    """Manually set or override a lecture's YouTube ID."""
    lec = db.query(Lecture).filter_by(id=lecture_id, course_id=course_id).first()
    if not lec:
        raise HTTPException(404, "Lecture not found")
    yt_id = (body.get("youtube_id") or "").strip()
    if not yt_id:
        raise HTTPException(400, "youtube_id required")
    lec.youtube_id = yt_id
    lec.notes_status = "pending"
    lec.transcript_retries = 0
    db.commit()
    return {"lecture_id": lec.id, "youtube_id": lec.youtube_id, "notes_status": lec.notes_status}


notes_router = APIRouter(prefix="/api/notes", tags=["notes"])


@notes_router.post("/run")
async def trigger_notes(lecture_id: int):
    from ..jobs.notes_job import run_notes_for_lecture
    result = await run_notes_for_lecture(lecture_id)
    return result


@notes_router.post("/retry/{lecture_id}")
async def retry_lecture(lecture_id: int, db: Session = Depends(get_db)):
    """Reset failed LectureVideo rows for a lecture back to pending."""
    lec = db.query(Lecture).get(lecture_id)
    if not lec:
        raise HTTPException(404, "Lecture not found")
    for v in lec.videos:
        if v.notes_status == "failed":
            v.notes_status = "pending"
            v.transcript_retries = 0
    db.commit()
    return {"lecture_id": lecture_id, "videos_reset": len(lec.videos)}


@notes_router.put("/video/{video_id}/youtube_id")
def set_video_youtube_id(video_id: int, body: dict, db: Session = Depends(get_db)):
    """Manually set or override a LectureVideo's YouTube ID."""
    video = db.query(LectureVideo).get(video_id)
    if not video:
        raise HTTPException(404, "Video not found")
    yt_id = (body.get("youtube_id") or "").strip()
    if len(yt_id) != 11:
        raise HTTPException(400, "youtube_id must be 11 chars")
    video.youtube_id = yt_id
    video.notes_status = "pending"
    video.transcript_retries = 0
    db.commit()
    return {"video_id": video.id, "youtube_id": video.youtube_id}


@notes_router.get("/pipeline")
def pipeline_status(db: Session = Depends(get_db)):
    """Pipeline status: stage funnel counts + per-video stage flags."""
    from sqlalchemy import not_, exists

    # All video lectures (for the top-level count)
    n_video_lectures = db.query(Lecture).filter(Lecture.has_video.is_(True)).count()

    # All LectureVideo rows
    all_videos = db.query(LectureVideo).join(Lecture).all()

    n_yt = sum(1 for v in all_videos if v.youtube_id and v.youtube_id != "NONE")
    n_transcript = sum(1 for v in all_videos if v.transcript_raw)
    n_translation = sum(1 for v in all_videos if v.transcript_en)
    n_handout = sum(1 for v in all_videos if v.notes_md)

    def _yt_status(v: LectureVideo) -> str:
        if v.youtube_id is None:
            return "unchecked"
        if v.youtube_id == "NONE":
            return "none"
        return "found"

    def _video_dict(v: LectureVideo) -> dict:
        lec = v.lecture
        return {
            "id": v.id,
            "lecture_id": v.lecture_id,
            "course_id": lec.course_id if lec else None,
            "course_code": lec.course.code if lec and lec.course else "?",
            "lecture_serial": lec.serial_no if lec else 0,
            "lecture_title": lec.title if lec else "",
            "seq": v.seq,
            "notes_status": v.notes_status,
            "transcript_retries": v.transcript_retries or 0,
            "yt_status": _yt_status(v),
            "has_transcript": v.transcript_raw is not None,
            "has_translation": v.transcript_en is not None,
            "has_notes": v.notes_md is not None,
        }

    # Lectures that have has_video=True but NO LectureVideo rows yet (not scraped)
    unscraped_lecs = (
        db.query(Lecture)
        .filter(Lecture.has_video.is_(True))
        .filter(~exists().where(LectureVideo.lecture_id == Lecture.id))
        .all()
    )
    unscraped = [
        {
            "id": None,
            "lecture_id": lec.id,
            "course_id": lec.course_id,
            "course_code": lec.course.code if lec.course else "?",
            "lecture_serial": lec.serial_no,
            "lecture_title": lec.title,
            "seq": 1,
            "notes_status": "pending",
            "transcript_retries": 0,
            "yt_status": "unchecked",
            "has_transcript": False,
            "has_translation": False,
            "has_notes": False,
        }
        for lec in unscraped_lecs
    ]

    return {
        "stages": {
            "video": n_video_lectures,
            "youtube_id": n_yt,
            "transcript": n_transcript,
            "translation": n_translation,
            "handout": n_handout,
        },
        "lectures": [_video_dict(v) for v in all_videos] + unscraped,
    }


study_router = APIRouter(prefix="/api/study", tags=["study"])


@study_router.get("/guide")
def study_guide(db: Session = Depends(get_db)):
    """Aggregated data for the Study Guide page — one round-trip for all courses."""
    from ..models import CourseProgress
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    courses = db.query(Course).order_by(Course.code).all()
    result = []

    for course in courses:
        prog = db.query(CourseProgress).filter_by(course_id=course.id).first()
        current_serial = prog.current_lecture_serial if prog else 0
        total = db.query(Lecture).filter_by(course_id=course.id).count()

        # Next 12 unwatched lectures (enough to cover any near-term gap)
        next_lectures = (
            db.query(Lecture)
            .filter(Lecture.course_id == course.id, Lecture.serial_no > current_serial)
            .order_by(Lecture.serial_no)
            .limit(12)
            .all()
        )

        # Open items — not completed, not expired, with a future or recent due date
        open_items = (
            db.query(Item)
            .filter(
                Item.course_id == course.id,
                Item.completed_at.is_(None),
                Item.status != "Expired",
            )
            .order_by(Item.due_at.nullslast())
            .all()
        )

        result.append({
            "id": course.id,
            "code": course.code,
            "title": course.title,
            "term": course.term,
            "current_serial": current_serial,
            "total_lectures": total,
            "next_lectures": [
                {
                    "id": lec.id,
                    "serial_no": lec.serial_no,
                    "title": lec.title,
                    "has_video": lec.has_video,
                    "notes_status": lec.notes_status,
                }
                for lec in next_lectures
            ],
            "open_items": [
                {
                    "id": item.id,
                    "kind": item.kind,
                    "title": item.title,
                    "lesson": item.lesson,
                    "due_at": item.due_at.isoformat() if item.due_at else None,
                    "opens_at": item.opens_at.isoformat() if item.opens_at else None,
                    "status": item.status,
                }
                for item in open_items
            ],
        })

    return {"courses": result}


@notes_router.get("/status")
def notes_status(db: Session = Depends(get_db)):
    from sqlalchemy import func
    rows = (
        db.query(Lecture.notes_status, func.count(Lecture.id))
        .filter(Lecture.has_video.is_(True))
        .group_by(Lecture.notes_status)
        .all()
    )
    return {status: count for status, count in rows}
