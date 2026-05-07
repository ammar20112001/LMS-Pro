"""
Parse enriched_md into HandoutSection rows.
Called after enrichment completes and on-demand when a chunk is fetched.

Section structure from Haiku output:
  ## Main Section Title      → level 1
  ### Subsection Title       → level 2
  ---                        → treated as a continuation separator (not a new section)

Text before the first ## heading is captured as a level-0 "intro" section.
"""
import re
import logging
from datetime import datetime, timezone

from ..db import SessionLocal
from ..models import HandoutChunk, HandoutSection

log = logging.getLogger(__name__)

_HEADING = re.compile(r"^(#{2,3})\s+(.+)$", re.MULTILINE)


def parse_chunk_sections(chunk_id: int) -> list[dict]:
    """
    Parse or re-parse sections for a chunk.
    Deletes existing sections for the chunk, recreates from enriched_md.
    Returns the list of section dicts (also persisted to DB).
    """
    db = SessionLocal()
    try:
        chunk: HandoutChunk | None = db.query(HandoutChunk).get(chunk_id)
        if not chunk or not chunk.enriched_md:
            return []

        # Clear existing
        db.query(HandoutSection).filter_by(chunk_id=chunk_id).delete()
        db.flush()

        sections = _parse_md(chunk.enriched_md, chunk_id)
        for s in sections:
            db.add(HandoutSection(
                chunk_id=chunk_id,
                section_key=s["section_key"],
                level=s["level"],
                title=s["title"],
                body=s["body"],
                order=s["order"],
                parsed_at=datetime.now(timezone.utc),
            ))
        db.commit()
        return sections
    finally:
        db.close()


def get_or_parse_sections(chunk_id: int) -> list[dict]:
    """Return persisted sections, parsing on first call or when stale."""
    db = SessionLocal()
    try:
        chunk: HandoutChunk | None = db.query(HandoutChunk).get(chunk_id)
        if not chunk or not chunk.enriched_md:
            return []

        existing = (
            db.query(HandoutSection)
            .filter_by(chunk_id=chunk_id)
            .order_by(HandoutSection.order)
            .all()
        )
        if existing:
            return [_section_to_dict(s) for s in existing]
    finally:
        db.close()

    # Not yet parsed — do it now
    return parse_chunk_sections(chunk_id)


def _section_to_dict(s: HandoutSection) -> dict:
    return {
        "id": s.id,
        "section_key": s.section_key,
        "level": s.level,
        "title": s.title,
        "body": s.body or "",
        "order": s.order,
        "is_completed": s.is_completed,
    }


def _parse_md(md: str, chunk_id: int) -> list[dict]:
    """
    Split markdown into sections by ## and ### headings.
    Text before the first heading becomes the intro section (level 0).
    --- dividers are kept as-is inside body text (not new sections).
    """
    sections: list[dict] = []
    order = 0

    # Find all heading positions
    matches = list(_HEADING.finditer(md))

    # Intro block: text before first heading
    intro_text = md[:matches[0].start()].strip() if matches else md.strip()
    if intro_text:
        sections.append({
            "section_key": f"{chunk_id}-0",
            "level": 0,
            "title": "Overview",
            "body": intro_text,
            "order": order,
        })
        order += 1

    for i, m in enumerate(matches):
        hashes, title = m.group(1), m.group(2).strip()
        level = len(hashes) - 1  # ## → 1, ### → 2

        body_start = m.end()
        body_end = matches[i + 1].start() if i + 1 < len(matches) else len(md)
        body = md[body_start:body_end].strip()

        sections.append({
            "section_key": f"{chunk_id}-{order}",
            "level": level,
            "title": title,
            "body": body,
            "order": order,
        })
        order += 1

    return sections
