"""
Study Plan API.
Theory courses: proportional quiz → lecture range mapping + time estimates.
Practical courses: task listing with type (cpp_runner | ai_marked).
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter

from ..db import SessionLocal
from ..models import Course, Item, Lecture, HandoutChunk, CourseProgress

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/study-plan", tags=["study-plan"])

THEORY = {"CS401", "CS502", "CS504", "CS603", "CS604"}
PRACTICAL_CPP = {"CS301P", "CS401P", "CS604P"}
PRACTICAL_AI  = {"CS504P", "CS502P", "CS603P"}

WORDS_PER_MINUTE = 200
FALLBACK_MINUTES_PER_LECTURE = 30


@router.get("/")
def get_study_plan():
    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        theory_out = []
        practical_out = []

        for course in db.query(Course).order_by(Course.code).all():
            code = course.code

            if code in THEORY:
                theory_out.append(_build_theory_plan(db, course, now))
            elif code in PRACTICAL_CPP:
                practical_out.append(_build_practical(db, course, now, "cpp_runner"))
            elif code in PRACTICAL_AI:
                practical_out.append(_build_practical(db, course, now, "ai_marked"))

        return {"theory": theory_out, "practicals": practical_out}
    finally:
        db.close()


def _build_theory_plan(db, course: Course, now: datetime) -> dict:
    lectures = sorted(course.lectures, key=lambda l: l.serial_no)
    total_lectures = len(lectures)

    progress = db.query(CourseProgress).filter_by(course_id=course.id).first()
    current_serial = progress.current_lecture_serial if progress else 0

    quizzes = sorted(
        [i for i in course.items if i.kind == "quiz" and i.due_at],
        key=lambda i: i.due_at,
    )
    total_quizzes = len(quizzes)

    deadlines = []
    backlog_lectures = 0

    def _due(item: Item) -> datetime:
        d = item.due_at
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)

    for idx, item in enumerate(quizzes):
        n = idx + 1
        lec_start, lec_end = _proportional_range(n, total_quizzes, total_lectures)

        lectures_needed = max(0, lec_end - max(current_serial, lec_start - 1))
        lectures_covered = (lec_end - lec_start + 1) - lectures_needed

        # Time estimate from enriched chunk word counts for uncovered lectures
        uncovered_chunks = db.query(HandoutChunk).filter(
            HandoutChunk.course_code == course.code,
            HandoutChunk.lecture_no > current_serial,
            HandoutChunk.lecture_no >= lec_start,
            HandoutChunk.lecture_no <= lec_end,
            HandoutChunk.enriched_md.isnot(None),
        ).all()

        total_words = sum(len((c.enriched_md or "").split()) for c in uncovered_chunks)
        estimated_minutes = (
            round(total_words / WORDS_PER_MINUTE)
            if total_words > 0
            else lectures_needed * FALLBACK_MINUTES_PER_LECTURE
        )

        due = _due(item)
        is_past = due < now
        days_left = max(0, (due - now).days) if not is_past else None

        if is_past and lectures_needed > 0:
            backlog_lectures += lectures_needed

        deadlines.append({
            "item_id": item.id,
            "title": item.title,
            "due_at": item.due_at.isoformat(),
            "is_past": is_past,
            "is_completed": item.completed_at is not None,
            "days_left": days_left,
            "quiz_number": n,
            "total_quizzes": total_quizzes,
            "lecture_range": [lec_start, lec_end],
            "lectures_needed": lectures_needed,
            "lectures_covered": lectures_covered,
            "estimated_minutes": estimated_minutes,
        })

    # Also include assignments (not split by lecture range — just deadline tracking)
    assignments = sorted(
        [i for i in course.items if i.kind in ("assignment", "gdb") and i.due_at],
        key=lambda i: i.due_at,
    )
    for item in assignments:
        due = _due(item)
        is_past = due < now
        deadlines.append({
            "item_id": item.id,
            "title": item.title,
            "due_at": item.due_at.isoformat(),
            "is_past": is_past,
            "is_completed": item.completed_at is not None,
            "days_left": max(0, (due - now).days) if not is_past else None,
            "quiz_number": None,
            "total_quizzes": None,
            "lecture_range": None,
            "lectures_needed": 0,
            "lectures_covered": 0,
            "estimated_minutes": 0,
        })

    deadlines.sort(key=lambda d: d["due_at"])

    return {
        "course_code": course.code,
        "course_title": course.title,
        "current_lecture": current_serial,
        "total_lectures": total_lectures,
        "backlog_lectures": backlog_lectures,
        "deadlines": deadlines,
    }


def _build_practical(db, course: Course, now: datetime, ptype: str) -> dict:
    items = sorted(
        [i for i in course.items if i.due_at],
        key=lambda i: i.due_at,
    )
    upcoming = []
    past = []
    for i in items:
        due = i.due_at if i.due_at.tzinfo else i.due_at.replace(tzinfo=timezone.utc)
        is_past = due < now
        entry = {
            "item_id": i.id,
            "title": i.title,
            "kind": i.kind,
            "due_at": i.due_at.isoformat(),
            "is_past": is_past,
            "is_completed": i.completed_at is not None,
            "days_left": max(0, (due - now).days) if not is_past else None,
            "status": i.status,
        }
        (past if is_past else upcoming).append(entry)

    return {
        "course_code": course.code,
        "course_title": course.title,
        "type": ptype,
        "upcoming": upcoming,
        "past": past,
    }


@router.get("/{course_code}")
def get_course_plan(course_code: str):
    """Full plan for one theory course with per-lecture breakdown — used by Playground."""
    from fastapi import HTTPException
    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        course = db.query(Course).filter_by(code=course_code).first()
        if not course or course_code not in THEORY:
            raise HTTPException(status_code=404, detail="Course not found or not a theory course")

        plan = _build_theory_plan(db, course, now)

        # Enrich each quiz deadline with per-lecture rows
        lec_by_serial: dict[int, Lecture] = {l.serial_no: l for l in course.lectures}
        chunk_by_lec: dict[int, int] = {}  # lecture_no → chunk_id
        for chunk in db.query(HandoutChunk).filter_by(course_code=course_code).all():
            chunk_by_lec[chunk.lecture_no] = chunk.id

        current = plan["current_lecture"]

        for dl in plan["deadlines"]:
            if dl["lecture_range"] is None:
                dl["lectures"] = []
                continue
            lec_start, lec_end = dl["lecture_range"]
            is_past = dl["is_past"]
            days_left = dl["days_left"]

            rows = []
            for sno in range(lec_start, lec_end + 1):
                lec = lec_by_serial.get(sno)
                title = lec.title if lec else f"Lecture {sno}"
                chunk_id = chunk_by_lec.get(sno)
                est = _lecture_minutes(db, course_code, sno, chunk_id)

                if sno <= current:
                    urgency = "done"
                elif is_past:
                    urgency = "behind"
                elif days_left is not None and days_left <= 7:
                    urgency = "soon"
                else:
                    urgency = "later"

                rows.append({
                    "serial_no": sno,
                    "title": title,
                    "urgency": urgency,
                    "estimated_minutes": est,
                    "chunk_id": chunk_id,
                })
            dl["lectures"] = rows

        # Playground grouping — flat list of all uncovered lectures by urgency
        behind, soon, later = [], [], []
        for dl in plan["deadlines"]:
            for lec in dl.get("lectures", []):
                if lec["urgency"] == "behind":
                    behind.append({**lec, "deadline_title": dl["title"]})
                elif lec["urgency"] == "soon":
                    soon.append({**lec, "deadline_title": dl["title"]})
                elif lec["urgency"] == "later":
                    later.append({**lec, "deadline_title": dl["title"]})

        plan["playground"] = {"behind": behind, "soon": soon, "later": later}
        return plan
    finally:
        db.close()


def _lecture_minutes(db, course_code: str, lecture_no: int, chunk_id: int | None) -> int:
    if chunk_id is None:
        return FALLBACK_MINUTES_PER_LECTURE
    chunk = db.query(HandoutChunk).get(chunk_id)
    if not chunk:
        return FALLBACK_MINUTES_PER_LECTURE
    text = chunk.enriched_md or chunk.raw_text or ""
    words = len(text.split())
    return round(words / WORDS_PER_MINUTE) if words > 0 else FALLBACK_MINUTES_PER_LECTURE


def _proportional_range(n: int, m: int, total: int) -> tuple[int, int]:
    """Quiz n of m covers lectures [start, end] (1-based, inclusive)."""
    start = int((n - 1) / m * total) + 1
    end   = int(n / m * total)
    return start, max(start, end)
