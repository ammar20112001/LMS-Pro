"""
Haiku enrichment pipeline — converts raw lecture text into detailed first-principles notes.
Sonnet on-demand enrichment for user-directed personalization.
"""

import logging
import httpx
from datetime import timezone

from ..db import SessionLocal
from ..models import HandoutChunk, utcnow
from ..config import settings

log = logging.getLogger(__name__)

HAIKU = "claude-haiku-4-5-20251001"
SONNET = "claude-sonnet-4-6"

HAIKU_SYSTEM = """\
You are an expert educator. Convert raw lecture notes into a comprehensive, \
first-principles learning document. The output must be detailed enough that \
a student with zero prior knowledge can learn the subject from scratch.

Use clear Markdown formatting:
- Start with a # heading matching the lecture title
- Use ## sections for each major concept
- Define every term when first introduced
- Include worked examples for algorithms, formulas, and procedures
- End with a ## Key Takeaways section listing the 3-5 most important points

Do not truncate. Cover every concept in the raw content.\
"""

SONNET_SYSTEM = """\
You are an expert educator refining existing lecture notes based on student instructions. \
Preserve the structure and accuracy of the original notes while incorporating the \
requested changes. Return complete Markdown.\
"""


def _call_haiku(user_prompt: str, max_tokens: int = 4096) -> str:
    return _call_claude(HAIKU, HAIKU_SYSTEM, user_prompt, max_tokens)


def _call_sonnet(user_prompt: str, max_tokens: int = 8192) -> str:
    return _call_claude(SONNET, SONNET_SYSTEM, user_prompt, max_tokens)


def _call_claude(model: str, system: str, user: str, max_tokens: int) -> str:
    response = httpx.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": settings.anthropic_api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json={
            "model": model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [{"role": "user", "content": user}],
        },
        timeout=180,
    )
    response.raise_for_status()
    return response.json()["content"][0]["text"]


def run_enrichment_batch(batch_size: int = 3):
    """Pick up to batch_size pending chunks and enrich with Haiku."""
    db = SessionLocal()
    try:
        pending = (
            db.query(HandoutChunk)
            .filter(HandoutChunk.enrich_status == "pending")
            .order_by(HandoutChunk.id)
            .limit(batch_size)
            .all()
        )
        if not pending:
            return

        log.info("Enrichment batch: %d chunks", len(pending))
        for chunk in pending:
            _enrich_chunk(db, chunk)
    except Exception:
        log.exception("Enrichment batch crashed")
        db.rollback()
    finally:
        db.close()


def _enrich_chunk(db, chunk: HandoutChunk):
    chunk.enrich_status = "enriching"
    db.commit()

    try:
        if not chunk.raw_text or len(chunk.raw_text.strip()) < 50:
            chunk.enriched_md = f"# {chunk.title}\n\n*No extractable content for this lecture.*"
            chunk.enrich_status = "done"
            chunk.enriched_at = utcnow()
            db.commit()
            return

        prompt = (
            f"Course: {chunk.course_code}\n"
            f"Lecture: {chunk.title}\n\n"
            f"--- RAW CONTENT ---\n{chunk.raw_text[:12000]}\n--- END ---\n\n"
            "Generate a complete, richly detailed learning document for this lecture."
        )

        result = _call_haiku(prompt)
        chunk.enriched_md = result
        chunk.enrich_status = "done"
        chunk.enriched_at = utcnow()
        db.commit()
        log.info("Enriched chunk %d (%s)", chunk.id, chunk.title[:50])
        # Parse sections immediately after enrichment
        try:
            from .sections import parse_chunk_sections
            parse_chunk_sections(chunk.id)
        except Exception:
            log.exception("Section parsing failed for chunk %d", chunk.id)
    except Exception as e:
        log.exception("Failed to enrich chunk %d: %s", chunk.id, e)
        chunk.enrich_status = "failed"
        db.commit()


def enrich_with_sonnet(chunk_id: int, instructions: str) -> str:
    """On-demand Sonnet enrichment. Returns updated enriched_md. Raises on failure."""
    db = SessionLocal()
    try:
        chunk = db.query(HandoutChunk).get(chunk_id)
        if not chunk:
            raise ValueError(f"Chunk {chunk_id} not found")

        base = chunk.enriched_md or chunk.raw_text or ""
        prompt = (
            f"Course: {chunk.course_code}\n"
            f"Lecture: {chunk.title}\n\n"
            f"--- CURRENT NOTES ---\n{base}\n--- END ---\n\n"
            f"Student instructions: {instructions}\n\n"
            "Rewrite or enhance the notes according to the student's instructions. "
            "Return the complete updated Markdown document."
        )

        result = _call_sonnet(prompt)
        chunk.enriched_md = result
        chunk.enriched_at = utcnow()
        db.commit()
        log.info("Sonnet enrichment done for chunk %d", chunk_id)
        try:
            from .sections import parse_chunk_sections
            parse_chunk_sections(chunk_id)
        except Exception:
            log.exception("Section parsing failed for chunk %d after Sonnet", chunk_id)
        return result
    finally:
        db.close()
