"""
AI client abstraction — swap providers via AI_PROVIDER in .env.
Currently supports: gemini, anthropic
"""

import logging
from abc import ABC, abstractmethod

log = logging.getLogger(__name__)


class AIClient(ABC):
    @abstractmethod
    async def complete(self, system: str, user: str) -> str: ...


class GeminiClient(AIClient):
    def __init__(self, api_key: str):
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        self._model = genai.GenerativeModel(
            model_name="gemini-2.0-flash",
            system_instruction=None,
        )
        self._genai = genai

    async def complete(self, system: str, user: str) -> str:
        prompt = f"{system}\n\n{user}"
        response = self._model.generate_content(prompt)
        return response.text


class AnthropicClient(AIClient):
    def __init__(self, api_key: str):
        import anthropic
        self._client = anthropic.Anthropic(api_key=api_key)

    async def complete(self, system: str, user: str) -> str:
        msg = self._client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=4096,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        return msg.content[0].text


_client: AIClient | None = None


def get_ai_client() -> AIClient:
    global _client
    if _client is not None:
        return _client

    from ..config import settings
    if settings.ai_provider == "gemini":
        if not settings.gemini_api_key:
            raise RuntimeError("GEMINI_API_KEY not set in .env")
        _client = GeminiClient(settings.gemini_api_key)
        log.info("AI client: Gemini 2.0 Flash")
    elif settings.ai_provider == "anthropic":
        if not settings.anthropic_api_key:
            raise RuntimeError("ANTHROPIC_API_KEY not set in .env")
        _client = AnthropicClient(settings.anthropic_api_key)
        log.info("AI client: Claude Haiku")
    else:
        raise ValueError(f"Unknown AI_PROVIDER: {settings.ai_provider!r}")

    return _client
