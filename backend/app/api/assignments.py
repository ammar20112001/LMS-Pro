import logging
import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Item, Course
from ..config import settings
from ..ai.assignment_ai import get_hint, complete_solution, format_for_upload

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/assignments", tags=["assignments"])

TMP_DIR = Path("/tmp/lms-pro")


# ── Request bodies ────────────────────────────────────────────────────────────

class HintRequest(BaseModel):
    question: str
    solution_so_far: str = ""


class CompleteRequest(BaseModel):
    question: str


class FormatRequest(BaseModel):
    question: str
    solution: str


class SubmitRequest(BaseModel):
    filename: str


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_item(item_id: int, db: Session) -> Item:
    item = db.query(Item).get(item_id)
    if not item:
        raise HTTPException(404, "Assignment not found")
    return item


def _course_code(item: Item, db: Session) -> str:
    course = db.query(Course).get(item.course_id)
    return course.code if course else "unknown"


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/{item_id}/hint")
def hint(item_id: int, req: HintRequest, db: Session = Depends(get_db)):
    _get_item(item_id, db)
    try:
        result = get_hint(req.question, req.solution_so_far)
        return {"hint": result}
    except Exception as e:
        log.exception("Hint failed for item %d", item_id)
        raise HTTPException(500, f"AI error: {e}")


@router.post("/{item_id}/complete")
def complete(item_id: int, req: CompleteRequest, db: Session = Depends(get_db)):
    _get_item(item_id, db)
    try:
        result = complete_solution(req.question)
        return {"solution": result}
    except Exception as e:
        log.exception("Complete failed for item %d", item_id)
        raise HTTPException(500, f"AI error: {e}")


@router.post("/{item_id}/format")
def format_solution(item_id: int, req: FormatRequest, db: Session = Depends(get_db)):
    item = _get_item(item_id, db)
    course_code = _course_code(item, db)

    try:
        ai_result = format_for_upload(
            question=req.question,
            solution=req.solution,
            roll_number=settings.roll_number,
            student_name=settings.student_name,
            course_name=course_code,
        )
    except Exception as e:
        log.exception("Format AI call failed for item %d", item_id)
        raise HTTPException(500, f"AI error: {e}")

    filename: str = ai_result.get("filename", f"{settings.roll_number}_{course_code}")
    extension: str = ai_result.get("extension", "docx").lstrip(".")
    code: str = ai_result.get("code", "")

    # Prepare output path
    out_dir = TMP_DIR / str(item_id)
    out_dir.mkdir(parents=True, exist_ok=True)
    full_filename = f"{filename}.{extension}"
    output_path = out_dir / full_filename

    # Inject output_path and execute the generated code
    exec_code = f"output_path = r'{output_path}'\n{code}"
    try:
        proc = subprocess.run(
            [sys.executable, "-c", exec_code],
            capture_output=True,
            text=True,
            timeout=30,
            cwd=str(out_dir),
        )
        if proc.returncode != 0:
            log.error("Code execution failed:\n%s", proc.stderr)
            raise HTTPException(500, f"File generation failed: {proc.stderr[:500]}")
    except subprocess.TimeoutExpired:
        raise HTTPException(500, "File generation timed out (30s)")

    if not output_path.exists():
        raise HTTPException(500, "Code ran but file was not created")

    log.info("Generated %s for item %d", full_filename, item_id)
    return {
        "filename": full_filename,
        "file_url": f"/api/assignments/{item_id}/file/{full_filename}",
    }


@router.get("/{item_id}/file/{filename}")
def download_file(item_id: int, filename: str):
    """Serve the generated solution file for preview/download."""
    # Prevent path traversal
    if ".." in filename or "/" in filename:
        raise HTTPException(400, "Invalid filename")
    file_path = TMP_DIR / str(item_id) / filename
    if not file_path.exists():
        raise HTTPException(404, "File not found — generate it first")
    return FileResponse(str(file_path), filename=filename)


@router.post("/{item_id}/submit")
async def submit(item_id: int, req: SubmitRequest, db: Session = Depends(get_db)):
    item = _get_item(item_id, db)

    if ".." in req.filename or "/" in req.filename:
        raise HTTPException(400, "Invalid filename")

    file_path = TMP_DIR / str(item_id) / req.filename
    if not file_path.exists():
        raise HTTPException(400, "File not found — use Format for Upload first")

    from ..scraper.submit import submit_assignment
    result = await submit_assignment(item, str(file_path))
    return result
