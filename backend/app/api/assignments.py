import logging
import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, HTMLResponse
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
    extra_instructions: str = ""


class CompleteRequest(BaseModel):
    question: str
    extra_instructions: str = ""


class FormatRequest(BaseModel):
    question: str
    solution: str
    extra_instructions: str = ""
    image_paths: list[str] = []


class RunRequest(BaseModel):
    code: str
    stdin: str = ""


class SubmitRequest(BaseModel):
    filename: str


class AiMarkRequest(BaseModel):
    task_description: str       # what the task asks for
    solution: str               # student's submitted solution text
    max_marks: int = 10


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
        result = get_hint(req.question, req.solution_so_far, req.extra_instructions)
        return {"hint": result}
    except Exception as e:
        log.exception("Hint failed for item %d", item_id)
        raise HTTPException(500, f"AI error: {e}")


@router.post("/{item_id}/complete")
def complete(item_id: int, req: CompleteRequest, db: Session = Depends(get_db)):
    _get_item(item_id, db)
    try:
        result = complete_solution(req.question, roll_number=settings.roll_number, extra_instructions=req.extra_instructions)
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
            roll_number=settings.roll_number,
            student_name=settings.student_name,
            course_name=course_code,
            extra_instructions=req.extra_instructions,
            image_paths=req.image_paths,
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

    # Inject output_path + solution_text so Claude-generated code can use them directly
    image_paths_repr = repr([str(p) for p in req.image_paths])
    exec_code = f"output_path = r'{output_path}'\nsolution_text = {repr(req.solution)}\nimage_paths = {image_paths_repr}\n{code}"
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


@router.post("/{item_id}/run")
def run_code(item_id: int, req: RunRequest):
    import tempfile
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        src = tmp / "solution.cpp"
        exe = tmp / "solution"
        src.write_text(req.code, encoding="utf-8")

        compile_proc = subprocess.run(
            ["g++", "-o", str(exe), str(src), "-std=c++17"],
            capture_output=True, text=True, timeout=30,
        )
        if compile_proc.returncode != 0:
            return {"success": False, "output": compile_proc.stderr, "stage": "compile"}

        try:
            run_proc = subprocess.run(
                [str(exe)],
                input=req.stdin,
                capture_output=True, text=True, timeout=10,
                cwd=tmpdir,
            )
            output = run_proc.stdout
            if run_proc.stderr:
                output += ("\n" if output else "") + run_proc.stderr
            return {"success": True, "output": output or "(no output)", "exit_code": run_proc.returncode}
        except subprocess.TimeoutExpired:
            return {"success": False, "output": "Execution timed out (10s limit)", "stage": "run"}


@router.post("/{item_id}/upload-image")
async def upload_image(item_id: int, file: UploadFile = File(...)):
    img_dir = TMP_DIR / str(item_id) / "images"
    img_dir.mkdir(parents=True, exist_ok=True)

    filename = (file.filename or "image.png").replace("/", "_").replace("..", "_")
    dest = img_dir / filename
    stem, suffix = Path(filename).stem, Path(filename).suffix
    counter = 1
    while dest.exists():
        dest = img_dir / f"{stem}_{counter}{suffix}"
        counter += 1

    dest.write_bytes(await file.read())
    return {
        "path": str(dest),
        "filename": dest.name,
        "url": f"/api/assignments/{item_id}/images/{dest.name}",
    }


@router.get("/{item_id}/images/{filename}")
def serve_image(item_id: int, filename: str):
    if ".." in filename or "/" in filename:
        raise HTTPException(400, "Invalid filename")
    img_path = TMP_DIR / str(item_id) / "images" / filename
    if not img_path.exists():
        raise HTTPException(404, "Image not found")
    return FileResponse(str(img_path))


@router.get("/{item_id}/file/{filename}/view")
def view_generated_file(item_id: int, filename: str):
    if ".." in filename or "/" in filename:
        raise HTTPException(400, "Invalid filename")
    file_path = TMP_DIR / str(item_id) / filename
    if not file_path.exists():
        raise HTTPException(404, "File not found — generate it first")

    suffix = file_path.suffix.lower()

    if suffix in (".cpp", ".c", ".py", ".java", ".cs", ".txt"):
        code = file_path.read_text(encoding="utf-8", errors="replace")
        escaped = code.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        html = (
            "<!DOCTYPE html><html><head><meta charset='utf-8'>"
            "<style>body{margin:0;background:#0d1117;color:#e6edf3;"
            "font-family:'Fira Code',Consolas,monospace;font-size:13px;}"
            "pre{padding:1.5rem 2rem;margin:0;white-space:pre-wrap;"
            "word-break:break-all;line-height:1.7;}</style></head>"
            f"<body><pre>{escaped}</pre></body></html>"
        )
        return HTMLResponse(content=html)

    if suffix == ".docx":
        from .items import _word_to_html, PAGE_CSS
        try:
            body_html = _word_to_html(file_path)
            html = f"<!DOCTYPE html><html><head><meta charset='utf-8'><style>{PAGE_CSS}</style></head><body>{body_html}</body></html>"
            return HTMLResponse(content=html)
        except Exception as e:
            raise HTTPException(500, f"Conversion failed: {e}")

    raise HTTPException(400, f"Cannot preview {suffix} files inline")


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


@router.post("/{item_id}/ai-mark")
def ai_mark(item_id: int, req: AiMarkRequest, db: Session = Depends(get_db)):
    """Grade a practical submission using Haiku. Returns marks, feedback, and breakdown."""
    item = _get_item(item_id, db)
    from ..ai.assignment_ai import _call_claude, HAIKU
    import json

    system = (
        "You are a strict but fair university practical examiner. "
        "Evaluate the student's submission against the task requirements. "
        "Return ONLY valid JSON in this exact format: "
        '{"marks": <int>, "max_marks": <int>, "grade": "<A/B/C/D/F>", '
        '"summary": "<one sentence verdict>", '
        '"strengths": ["<point>"], "issues": ["<point>"], '
        '"feedback": "<detailed paragraph>"}'
    )
    prompt = (
        f"Task: {req.task_description}\n\n"
        f"Max marks: {req.max_marks}\n\n"
        f"Student submission:\n{req.solution}"
    )
    raw = _call_claude(system, prompt, max_tokens=1024)

    # Parse JSON — fall back to plain text if model doesn't cooperate
    try:
        start = raw.index("{")
        end = raw.rindex("}") + 1
        result = json.loads(raw[start:end])
    except Exception:
        result = {
            "marks": None,
            "max_marks": req.max_marks,
            "grade": "?",
            "summary": "Could not parse AI response.",
            "strengths": [],
            "issues": [],
            "feedback": raw,
        }
    return result


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
