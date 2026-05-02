"""
Write generated notes as Markdown files into the Obsidian vault.
"""

import logging
import re
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger(__name__)


def _sanitize(name: str) -> str:
    """Remove characters that are invalid in filenames."""
    name = re.sub(r'[\\/:*?"<>|]', "", name)
    return name.strip()[:120]  # keep filenames reasonable


def write_note(
    vault_root: str,
    course_code: str,
    course_title: str,
    lecture_serial: int,
    lecture_title: str,
    notes_md: str,
    youtube_id: str | None = None,
) -> Path:
    """
    Write notes to:
      {vault_root}/LMS-Pro/{course_code} — {course_title}/Lecture_{nn} — {title}.md

    Returns the path written.
    """
    folder_name = _sanitize(f"{course_code} — {course_title}")
    folder = Path(vault_root) / "LMS-Pro" / folder_name
    folder.mkdir(parents=True, exist_ok=True)

    file_name = _sanitize(f"Lecture_{lecture_serial:02d} — {lecture_title}") + ".md"
    path = folder / file_name

    yt_link = f"https://www.youtube.com/watch?v={youtube_id}" if youtube_id else ""
    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    frontmatter = f"""---
course: {course_code}
lecture: {lecture_serial}
title: "{lecture_title}"
{"youtube: " + yt_link if yt_link else ""}
generated_at: {generated_at}
tags: [lms-pro, {course_code.lower()}]
---

"""

    heading = f"# Lecture {lecture_serial} — {lecture_title}\n\n"

    path.write_text(frontmatter + heading + notes_md, encoding="utf-8")
    log.info("Note written: %s", path)
    return path


def obsidian_uri(vault_name: str, file_path: Path, vault_root: str) -> str:
    """
    Build an obsidian:// URI to open the note directly in Obsidian.
    Example: obsidian://open?vault=LMS+Pro&file=LMS-Pro%2FCS301P...
    """
    import urllib.parse
    relative = file_path.relative_to(Path(vault_root))
    encoded = urllib.parse.quote(str(relative).replace("\\", "/"))
    vault_encoded = urllib.parse.quote(vault_name)
    return f"obsidian://open?vault={vault_encoded}&file={encoded}"
