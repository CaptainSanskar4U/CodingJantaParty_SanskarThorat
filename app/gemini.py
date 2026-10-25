"""Server-side Gemini audio transcription for the optional live mode.

The API key is read from the server environment only. Audio chunks are sent to
Google Gemini for provisional transcription; final analysis remains local.
"""
from __future__ import annotations

import base64
import re
import time

import httpx

from . import config


class GeminiUnavailable(RuntimeError):
    """Raised when Gemini cannot serve a live transcription request."""


_LANGUAGE_HINTS = {
    "auto": "Auto-detect the spoken language.",
    "hi": "The speakers are likely using Hindi or Hinglish.",
    "en": "The speakers are likely using English or Indian English.",
    "hinglish": "The speakers are likely code-switching between Hindi and English (Hinglish).",
}


def configured() -> bool:
    return bool(config.GEMINI_API_KEY)


def _prompt(language_hint: str) -> str:
    hint = _LANGUAGE_HINTS.get((language_hint or "auto").lower(), _LANGUAGE_HINTS["auto"])
    return (
        "Transcribe this short emergency-call audio segment verbatim. "
        "Preserve the speaker's original language and code-switching exactly as spoken, "
        "including Hindi, English and Hinglish. Do not translate. Do not summarise. "
        "Do not add speaker labels or commentary. Return only the transcript. "
        f"{hint}"
    )


def _clean_text(value: str) -> str:
    text = re.sub(r"\s+", " ", value or "").strip()
    if text.upper() in {"[NO SPEECH]", "NO SPEECH", "NO SPEECH DETECTED"}:
        return ""
    return text


def transcribe_chunk(wav_bytes: bytes, language_hint: str = "auto") -> dict:
    """Transcribe one small WAV chunk using Gemini.

    The caller must validate/normalise the audio first. Errors are deliberately
    sanitised so a key or raw provider response never reaches the browser.
    """
    if not configured():
        raise GeminiUnavailable("Gemini live transcription is not configured on this server.")
    if not wav_bytes:
        raise GeminiUnavailable("The audio chunk is empty.")

    url = f"{config.GEMINI_API_BASE}/v1beta/models/{config.GEMINI_MODEL}:generateContent"
    headers = {
        "x-goog-api-key": config.GEMINI_API_KEY,
        "Content-Type": "application/json",
    }
    body = {
        "contents": [{
            "parts": [
                {"text": _prompt(language_hint)},
                {
                    "inline_data": {
                        "mime_type": "audio/wav",
                        "data": base64.b64encode(wav_bytes).decode("ascii"),
                    }
                },
            ]
        }],
        "generationConfig": {
            "temperature": 0,
            "maxOutputTokens": 2048,
        },
    }

    last_error: Exception | None = None
    for attempt in range(2):
        try:
            with httpx.Client(timeout=config.GEMINI_TIMEOUT_SECONDS) as client:
                response = client.post(url, headers=headers, json=body)
        except (httpx.TimeoutException, httpx.NetworkError) as exc:
            last_error = exc
            if attempt == 0:
                time.sleep(0.5)
                continue
            raise GeminiUnavailable("Gemini did not respond in time. Recording continues locally.") from exc

        if response.status_code == 200:
            try:
                payload = response.json()
                candidates = payload.get("candidates") or []
                parts = (((candidates[0] or {}).get("content") or {}).get("parts") or []) if candidates else []
                text = _clean_text("".join(str(part.get("text", "")) for part in parts if isinstance(part, dict)))
                return {
                    "text": text,
                    "model": config.GEMINI_MODEL,
                    "usage": payload.get("usageMetadata") or {},
                }
            except (ValueError, TypeError, IndexError) as exc:
                raise GeminiUnavailable("Gemini returned an unreadable response. Recording continues locally.") from exc

        if response.status_code in {429, 500, 502, 503, 504} and attempt == 0:
            time.sleep(0.7)
            continue

        if response.status_code in {401, 403}:
            raise GeminiUnavailable("Gemini rejected the server key. Check the server-side GEMINI_API_KEY.")
        if response.status_code == 429:
            raise GeminiUnavailable("Gemini rate limit reached. Recording continues; final analysis runs locally.")
        if response.status_code == 400:
            raise GeminiUnavailable("Gemini rejected this audio chunk. Check the configured model and audio format.")
        raise GeminiUnavailable(f"Gemini transcription failed (HTTP {response.status_code}). Recording continues locally.")

    raise GeminiUnavailable("Gemini transcription is temporarily unavailable. Recording continues locally.") from last_error
