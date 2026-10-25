"""Tests for the server-side Gemini request adapter.

These tests never call Google. They pin the request shape, response parsing and
error redaction so a future provider change cannot silently leak the key or send
the wrong audio payload.
"""
from __future__ import annotations

import pytest

from app import config, gemini


class FakeResponse:
    def __init__(self, status_code: int, payload: dict | None = None):
        self.status_code = status_code
        self._payload = payload or {}

    def json(self):
        return self._payload


class FakeClient:
    def __init__(self, response: FakeResponse, captured: dict):
        self.response = response
        self.captured = captured

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def post(self, url, headers=None, json=None):
        self.captured.update({"url": url, "headers": headers, "body": json})
        return self.response


def test_gemini_request_shape_and_text_cleaning(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(config, "GEMINI_API_KEY", "server-test-key")
    monkeypatch.setattr(config, "GEMINI_MODEL", "gemini-test-model")
    captured: dict = {}
    response = FakeResponse(200, {
        "candidates": [{"content": {"parts": [{"text": "  मैं डर गया   हूँ  "}]}}],
        "usageMetadata": {"totalTokenCount": 7},
    })
    monkeypatch.setattr(gemini.httpx, "Client", lambda timeout: FakeClient(response, captured))

    result = gemini.transcribe_chunk(b"RIFF-test-wav", "hinglish")
    assert result["text"] == "मैं डर गया हूँ"
    assert result["model"] == "gemini-test-model"
    assert result["usage"]["totalTokenCount"] == 7

    assert captured["headers"]["x-goog-api-key"] == "server-test-key"
    assert "server-test-key" not in captured["url"]
    assert captured["url"].endswith("/v1beta/models/gemini-test-model:generateContent")
    parts = captured["body"]["contents"][0]["parts"]
    assert "Hinglish" in parts[0]["text"]
    assert parts[1]["inline_data"]["mime_type"] == "audio/wav"
    assert captured["body"]["generationConfig"]["temperature"] == 0


def test_gemini_error_is_redacted(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(config, "GEMINI_API_KEY", "server-test-key")
    captured: dict = {}
    response = FakeResponse(401, {"error": {"message": "server-test-key should never leak"}})
    monkeypatch.setattr(gemini.httpx, "Client", lambda timeout: FakeClient(response, captured))

    with pytest.raises(gemini.GeminiUnavailable) as exc:
        gemini.transcribe_chunk(b"RIFF-test-wav", "auto")
    message = str(exc.value)
    assert "server-test-key" not in message
    assert "should never leak" not in message
    assert "rejected the server key" in message
