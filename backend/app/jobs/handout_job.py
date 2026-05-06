"""
Handout ingestion and enrichment jobs.
Ingestion: scans handouts/ directory, splits by lecture, stores chunks.
Enrichment: picks pending chunks, calls Haiku, stores enriched_md.
"""

import asyncio
import logging

log = logging.getLogger(__name__)

_ingest_lock = asyncio.Lock()
_enrich_lock = asyncio.Lock()


def run_ingestion_job():
    from ..study.ingestion import run_ingestion
    try:
        run_ingestion()
    except Exception as e:
        log.exception("Handout ingestion job crashed: %s", e)


def run_enrichment_job():
    from ..study.enrichment import run_enrichment_batch
    try:
        run_enrichment_batch(batch_size=3)
    except Exception as e:
        log.exception("Handout enrichment job crashed: %s", e)
