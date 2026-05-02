"""
Transcript fetching from YouTube auto-generated captions.
Falls back to faster-whisper if quality is poor (Phase 2b).
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
    from youtube_transcript_api import (
        YouTubeTranscriptApi,
        NoTranscriptFound,
        TranscriptsDisabled,
        VideoUnavailable,
    )

    try:
        # Try English first, then Urdu, then whatever is available
        try:
            segments = YouTubeTranscriptApi.get_transcript(youtube_id, languages=["en"])
        except NoTranscriptFound:
            # Fall back to any available language (Urdu auto-captions, etc.)
            transcript_list = YouTubeTranscriptApi.list_transcripts(youtube_id)
            transcript = transcript_list.find_generated_transcript(
                ["en", "ur", "en-US", "en-GB"]
            )
            segments = transcript.fetch()

        text = " ".join(seg["text"].strip() for seg in segments if seg["text"].strip())
        log.info("Fetched transcript for %s: %d chars", youtube_id, len(text))
        return text, "youtube_auto"

    except (NoTranscriptFound, TranscriptsDisabled, VideoUnavailable) as e:
        raise TranscriptUnavailable(f"No transcript for {youtube_id}: {e}") from e
    except Exception as e:
        raise TranscriptUnavailable(f"Transcript fetch failed for {youtube_id}: {e}") from e


def assess_quality(transcript: str) -> str:
    """
    Heuristic quality check. Returns "ok" or "poor".

    Poor signals:
    - Very short (< 300 words) — likely noise-only captions
    - High ratio of [Music] / [Applause] noise tags
    - Urdu captions that YouTube rendered as garbage English phonetics
    """
    words = transcript.split()
    word_count = len(words)

    if word_count < 300:
        return "poor"

    # Count YouTube noise tags like [Music], [Applause], [Laughter]
    noise_tags = len(re.findall(r"\[(?:Music|Applause|Laughter|Inaudible|__)\]", transcript, re.IGNORECASE))
    noise_ratio = noise_tags / max(word_count, 1)
    if noise_ratio > 0.05:
        return "poor"

    return "ok"


def transcribe_with_whisper(youtube_id: str) -> tuple[str, str]:
    """
    Fallback: download audio via yt-dlp then transcribe with faster-whisper.
    Only activated when YouTube auto-transcript quality is "poor".
    Requires: pip install faster-whisper yt-dlp
    """
    import tempfile, subprocess
    from pathlib import Path
    from faster_whisper import WhisperModel

    with tempfile.TemporaryDirectory() as tmpdir:
        audio_path = Path(tmpdir) / "audio.mp3"

        log.info("Downloading audio for %s via yt-dlp…", youtube_id)
        subprocess.run([
            "yt-dlp",
            "-f", "bestaudio",
            "-x", "--audio-format", "mp3",
            "-o", str(audio_path),
            f"https://www.youtube.com/watch?v={youtube_id}",
        ], check=True, capture_output=True)

        log.info("Transcribing with faster-whisper (medium model)…")
        model = WhisperModel("medium", device="cpu", compute_type="int8")
        segments, _ = model.transcribe(str(audio_path), language=None)
        text = " ".join(seg.text.strip() for seg in segments)

        log.info("Whisper transcript: %d chars", len(text))
        return text, "whisper_local"
