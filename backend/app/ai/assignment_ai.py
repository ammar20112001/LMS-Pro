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
    solution: str,
    roll_number: str,
    student_name: str,
    course_name: str,
) -> dict:
    """
    Returns dict with:
      filename: str  (without extension)
      extension: str
      code: str      (Python code; expects `output_path` variable already defined)
    """
    default_filename = f"{roll_number}_{course_name}"

    system = f"""You are an expert Python developer helping a student format their assignment for submission.

Analyze the assignment question to determine:
1. Required file format/extension (default: docx if not specified)
2. Required filename without extension (default: {default_filename} if not specified)
3. Whether student metadata (name, roll number) should appear in the document body

Then write Python code that:
- Saves the file to the path stored in the variable `output_path` (already defined — do NOT redefine it)
- Uses python-docx for .docx files, plain open() for .txt/.py, appropriate lib for others
- Wraps the solution in proper document structure
- Includes student name/roll number in the document ONLY if the assignment explicitly requires it

Return ONLY valid JSON, no markdown, no explanation:
{{"filename": "filename_without_extension", "extension": "docx", "code": "python code as single string with \\n for newlines"}}"""

    user = f"""Assignment Question:
{question}

Student's Solution:
{solution}

Student Name: {student_name}
Roll Number: {roll_number}
Course: {course_name}"""

    raw = _call_claude(system, user, max_tokens=2048)

    # Strip markdown fences if Claude wraps the JSON
    if "```json" in raw:
        raw = raw.split("```json")[1].split("```")[0].strip()
    elif "```" in raw:
        raw = raw.split("```")[1].split("```")[0].strip()

    return json.loads(raw.strip())
