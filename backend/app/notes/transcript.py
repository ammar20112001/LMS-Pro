"""
Transcript fetching from YouTube auto-generated captions.
Videos without captions are marked failed and skipped.
"""

import logging
import re

log = logging.getLogger(__name__)


class TranscriptUnavailable(Exception):
    pass


def fetch_transcript(youtube_id: str) -> tuple[str, str]:
    """
    Fetch auto-generated transcript for a YouTube video.
    Returns (transcript_text, source) where source = "youtube_auto".
    Raises TranscriptUnavailable if no transcript exists.
    """
    from youtube_transcript_api import YouTubeTranscriptApi, NoTranscriptFound, TranscriptsDisabled

    try:
        api = YouTubeTranscriptApi()
        transcript_list = api.list(youtube_id)

        # Try English first, then any generated language (Urdu/Hindi auto-captions)
        try:
            transcript = transcript_list.find_transcript(["en", "en-US", "en-GB"])
        except NoTranscriptFound:
            transcript = transcript_list.find_generated_transcript(
                ["en", "ur", "hi", "en-US", "en-GB"]
            )

        fetched = transcript.fetch()
        text = " ".join(s.text.strip() for s in fetched.snippets if s.text.strip())
        log.info("Fetched transcript for %s: %d chars", youtube_id, len(text))
        return text, "youtube_auto"

    except (NoTranscriptFound, TranscriptsDisabled) as e:
        raise TranscriptUnavailable(f"No transcript for {youtube_id}: {e}") from e
    except Exception as e:
        raise TranscriptUnavailable(f"Transcript fetch failed for {youtube_id}: {e}") from e


def assess_quality(transcript: str) -> str:
    """
    Heuristic quality check. Returns "ok" or "poor".
    Poor: < 300 words, or high ratio of noise tags like [Music].
    """
    words = transcript.split()
    if len(words) < 300:
        return "poor"

    noise_tags = len(re.findall(r"\[(?:Music|Applause|Laughter|Inaudible|__)\]", transcript, re.IGNORECASE))
    if noise_tags / max(len(words), 1) > 0.05:
        return "poor"

    return "ok"
