from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Course, Item, Lecture
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
    return LectureNotesOut(
        lecture_id=lec.id,
        notes_status=lec.notes_status,
        notes_md=lec.notes_md,
        transcript_quality=lec.transcript_quality,
        transcript_source=lec.transcript_source,
        notes_generated_at=lec.notes_generated_at,
        youtube_id=lec.youtube_id,
    )


notes_router = APIRouter(prefix="/api/notes", tags=["notes"])


@notes_router.post("/run")
async def trigger_notes(lecture_id: int):
    from ..jobs.notes_job import run_notes_for_lecture
    result = await run_notes_for_lecture(lecture_id)
    return result


@notes_router.get("/queue")
def notes_queue(db: Session = Depends(get_db)):
    pending = (
        db.query(Lecture)
        .filter(Lecture.has_video.is_(True))
        .filter(Lecture.youtube_id.isnot(None))
        .filter(Lecture.youtube_id != "NONE")
        .filter(Lecture.notes_status == "pending")
        .order_by(Lecture.serial_no)
        .all()
    )
    return [
        {
            "lecture_id": l.id,
            "course_id": l.course_id,
            "serial_no": l.serial_no,
            "title": l.title,
            "youtube_id": l.youtube_id,
        }
        for l in pending
    ]


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
