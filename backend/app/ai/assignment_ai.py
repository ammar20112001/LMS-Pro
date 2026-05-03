"""Claude Haiku prompts for Phase 3 assignment workspace."""

import json
import logging
import httpx

from ..config import settings

log = logging.getLogger(__name__)

HAIKU = "claude-haiku-4-5-20251001"


def _call_claude(system: str, user: str, max_tokens: int = 2048) -> str:
    response = httpx.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": settings.anthropic_api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json={
            "model": HAIKU,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [{"role": "user", "content": user}],
        },
        timeout=180,
    )
    response.raise_for_status()
    return response.json()["content"][0]["text"]


def get_hint(question: str, solution_so_far: str) -> str:
    system = """You are a helpful programming tutor. The student is working on a CS assignment.
Give a concise, specific hint (2-3 sentences max) about what they should do next.
Do NOT give away the complete answer. Focus on the immediate next concept or step to apply."""

    user = f"""Assignment Question:
{question}

Student's solution so far:
{solution_so_far.strip() if solution_so_far.strip() else "(nothing written yet)"}

What should the student focus on next?"""

    return _call_claude(system, user, max_tokens=300)


def complete_solution(question: str) -> str:
    system = """You are an expert CS student completing an assignment.
Write a complete, correct solution to the assignment question.
Write ONLY the answer content — no name, roll number, headers, file metadata, or submission formatting.
Pure solution only."""

    return _call_claude(system, f"Assignment:\n\n{question}", max_tokens=4096)


def format_for_upload(
    question: str,
    roll_number: str,
    student_name: str,
    course_name: str,
) -> dict:
    """
    Returns dict with:
      filename: str  (without extension)
      extension: str
      code: str      (Python 3 code; `output_path` and `solution_text` are pre-injected)
    """
    default_filename = f"{roll_number}_{course_name}"

    system = f"""You are a Python developer. Write Python 3 code that saves a student's assignment solution to a file.

Two variables are already defined when your code runs — do NOT redefine them:
- `output_path`: the file path where you must save the file (a string)
- `solution_text`: the student's complete solution text (a string)

Your code must:
1. Determine the correct file format from the assignment question (default: .docx)
2. Create the document at `output_path` using `solution_text` as the content
3. For .docx files: use python-docx (`from docx import Document`)
4. For .txt or .py files: use `open(output_path, 'w', encoding='utf-8')`
5. Include student name/roll number in the document header ONLY if the assignment explicitly requires it

Example for a .docx output:
```
from docx import Document
doc = Document()
doc.add_heading('{course_name} Assignment', 0)
doc.add_paragraph(solution_text)
doc.save(output_path)
```

Return ONLY valid JSON with exactly these three keys — no markdown fences, no explanation:
{{"filename": "name_without_extension", "extension": "docx", "code": "python 3 code with \\n for newlines"}}

The default filename is: {default_filename}"""

    user = f"""Assignment Question:
{question}

Student Name: {student_name}
Roll Number: {roll_number}
Course: {course_name}

What file format does this assignment require? Write Python code to create that file using `solution_text`."""

    raw = _call_claude(system, user, max_tokens=1024)

    # Strip markdown fences if Claude wraps the JSON
    if "```json" in raw:
        raw = raw.split("```json")[1].split("```")[0].strip()
    elif "```" in raw:
        raw = raw.split("```")[1].split("```")[0].strip()

    return json.loads(raw.strip())
