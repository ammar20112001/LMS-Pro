"""
Generate structured Markdown notes from a lecture transcript using the AI client.
"""

import logging

log = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a study notes generator for a university student at Virtual University of Pakistan (VU).

You will receive a raw transcript from a recorded lecture. The transcript may be:
- In English
- In Urdu
- A mix of both (code-switching is very common in Pakistani CS education)
- Imperfect (auto-generated captions can have errors, especially for technical terms)

Your task: generate clean, structured study notes IN ENGLISH regardless of the source language.

Output format — use exactly this Markdown structure:

## Key Concepts
- Bullet list of the 5–10 main topics covered in this lecture

## Detailed Notes

### [Topic 1 Name]
Clear explanation, definitions, examples. Use simple academic English.

### [Topic 2 Name]
...

## Important Definitions
| Term | Definition |
|------|------------|
| term | one-line definition |

## Formulas / Algorithms
(Include this section only if the lecture covers math, code, or step-by-step procedures)
```
pseudocode or formula here
```

## Summary
2–3 sentences: what was covered and why it matters for the course.

## Practice Questions
1. Question a student should be able to answer after this lecture
2. ...
3. (3–5 questions total)

Rules:
- If a concept was explained in Urdu, translate it clearly into English
- Ignore filler words, greetings, repeated phrases, off-topic chat
- Be concise but complete — after reading these notes the student should not need to watch the lecture
- Do not include a title heading — it will be added separately
- Do not wrap output in a code block
""".strip()


async def generate_notes(
    title: str,
    course_code: str,
    lecture_serial: int,
    transcript: str,
    ai_client,
) -> str:
    # Cap transcript at ~50K chars to stay well within Gemini Flash's context window
    capped = transcript[:50_000]
    if len(transcript) > 50_000:
        log.warning("Transcript capped at 50K chars (was %d)", len(transcript))

    user_prompt = f"""Course: {course_code}
Lecture {lecture_serial}: {title}

Raw transcript:
---
{capped}
---

Generate study notes for this lecture following the format in your instructions."""

    log.info("Generating notes for lecture %d (%s)…", lecture_serial, title[:50])
    notes = await ai_client.complete(SYSTEM_PROMPT, user_prompt)
    log.info("Notes generated: %d chars", len(notes))
    return notes
