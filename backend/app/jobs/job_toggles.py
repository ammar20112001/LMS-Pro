"""
Pipeline toggles — flip to True/False to enable/disable each background job.
Restart the backend (`./kill.sh && ./start.sh`) for changes to take effect.

Read by `scheduler.py` on startup. Each flag controls one APScheduler job.
"""

# ── LMS scraping ─────────────────────────────────────────────────────────────
# Fetches deadlines, assignments, quizzes, lectures from VU LMS via Playwright.
# No Anthropic API usage.
LMS_SYNC = True

# ── Notifications & email ────────────────────────────────────────────────────
# SMTP-based. No Anthropic API usage.
NOTIFY_DISPATCH = False     # every 5 min — sends pending deadline notifications
DAILY_DIGEST = False        # 7:00 AM local — daily summary email
DEADLINE_REMINDER = False   # hourly — pre-schedules 23:00 midnight reminder

# ── YouTube extraction ───────────────────────────────────────────────────────
# Playwright browsers (2 parallel) finding YouTube IDs for lectures.
# CPU-heavy. No Anthropic API usage.
YOUTUBE_EXTRACTION = False  # every 2 min

# ── Notes pipeline ───────────────────────────────────────────────────────────
# YouTube transcript → translate → Claude Haiku handout generation.
# USES ANTHROPIC API.
NOTES_GENERATION = False    # every 3 min

# ── Handout pipeline ─────────────────────────────────────────────────────────
# PDF ingestion + Claude Haiku/Sonnet enrichment of handout chunks.
HANDOUT_INGESTION = False        # hourly — splits PDFs into chunks (no API)
HANDOUT_INGESTION_STARTUP = False  # one-shot on startup
HANDOUT_ENRICHMENT = False       # every 2 min — USES ANTHROPIC API
