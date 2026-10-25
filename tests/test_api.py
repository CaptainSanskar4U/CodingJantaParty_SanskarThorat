"""Integration tests for the Dhvani API.

These tests use a temporary SQLite database and a temporary upload directory.
The background model worker is disabled so the suite stays fast and does not
depend on a multi-minute CPU inference run.
"""
from __future__ import annotations

import math
import struct
import wave
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import config, db, gemini, jobs, main


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    database = tmp_path / "test.db"
    uploads = tmp_path / "uploads"
    uploads.mkdir()
    monkeypatch.setattr(config, "DB_PATH", database)
    monkeypatch.setattr(db, "DB_PATH", database)
    monkeypatch.setattr(config, "SECRET_PATH", tmp_path / "secret.key")
    monkeypatch.setattr(config, "UPLOAD_DIR", uploads)
    monkeypatch.setattr(jobs, "start_worker", lambda: None)
    with TestClient(main.app) as test_client:
        yield test_client


def login(client: TestClient) -> str:
    response = client.post("/api/auth/login", json={"username": "mehta", "password": "dhvani-demo"})
    assert response.status_code == 200, response.text
    return response.json()["csrf"]


def make_wav(path: Path, seconds: float = 1.0, rate: int = 16000) -> Path:
    frames = bytearray()
    for i in range(int(seconds * rate)):
        sample = int(9000 * math.sin(2 * math.pi * 440 * i / rate))
        frames += struct.pack("<h", sample)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(bytes(frames))
    return path


def test_authentication_and_csrf(client: TestClient):
    assert client.get("/api/health").status_code == 200
    anonymous = client.get("/api/me")
    assert anonymous.status_code == 200
    assert anonymous.json()["user"] is None
    assert client.get("/api/calls").status_code == 401
    assert client.post("/api/auth/login", json={"username": "mehta", "password": "wrong"}).status_code == 401

    csrf = login(client)
    me = client.get("/api/me")
    assert me.status_code == 200
    assert me.json()["user"]["username"] == "mehta"
    assert client.get("/api/calls").status_code == 200

    # A mutating request without the session CSRF token must be rejected.
    assert client.post("/api/cases", json={"title": "No token"}).status_code == 403
    assert client.post("/api/cases", json={"title": "Wrong token"}, headers={"X-CSRF-Token": "wrong"}).status_code == 403

    assert client.post("/api/auth/logout", headers={"X-CSRF-Token": csrf}).status_code == 200
    assert client.get("/api/calls").status_code == 401


def test_case_notes_reports_and_search(client: TestClient):
    csrf = login(client)
    created = client.post(
        "/api/cases",
        json={"title": "Digital arrest review", "summary": "Synthetic integration test case.", "priority": "high"},
        headers={"X-CSRF-Token": csrf},
    )
    assert created.status_code == 200, created.text
    case = created.json()["case"]
    assert case["case_number"].startswith("CASE-")
    case_id = case["id"]

    updated = client.patch(
        f"/api/cases/{case_id}",
        json={"status": "under_review"},
        headers={"X-CSRF-Token": csrf},
    )
    assert updated.status_code == 200
    assert updated.json()["case"]["status"] == "under_review"

    note = client.post(
        f"/api/cases/{case_id}/notes",
        json={"note": "Reviewed the synthetic transcript."},
        headers={"X-CSRF-Token": csrf},
    )
    assert note.status_code == 200

    detail = client.get(f"/api/cases/{case_id}")
    assert detail.status_code == 200
    assert detail.json()["case"]["title"] == "Digital arrest review"
    assert len(detail.json()["notes"]) == 1

    report = client.get(f"/api/cases/{case_id}/report?format=html")
    assert report.status_code == 200
    assert "text/html" in report.headers["content-type"]
    assert case["case_number"] in report.text
    assert "Decision-support only" in report.text
    assert "not proof of deception, guilt, coercion" in report.text

    evidence = client.get(f"/api/cases/{case_id}/report?format=json")
    assert evidence.status_code == 200
    assert evidence.json()["case"]["id"] == case_id

    search = client.get("/api/search?q=Digital")
    assert search.status_code == 200
    assert any(c["id"] == case_id for c in search.json()["cases"])

    # Report access must also be protected after logout.
    client.post("/api/auth/logout", headers={"X-CSRF-Token": csrf})
    assert client.get(f"/api/cases/{case_id}/report?format=html").status_code == 401


def test_upload_validation_and_audio_range(client: TestClient, tmp_path: Path):
    csrf = login(client)
    headers = {"X-CSRF-Token": csrf}

    rejected = client.post(
        "/api/calls/upload",
        files={"file": ("notes.txt", b"not audio", "text/plain")},
        data={"source_label": "bad"},
        headers=headers,
    )
    assert rejected.status_code == 400

    fake = client.post(
        "/api/calls/upload",
        files={"file": ("fake.wav", b"not really audio", "audio/wav")},
        data={"source_label": "bad"},
        headers=headers,
    )
    assert fake.status_code == 400

    empty = client.post(
        "/api/calls/upload",
        files={"file": ("empty.wav", b"", "audio/wav")},
        data={"source_label": "bad"},
        headers=headers,
    )
    assert empty.status_code == 400

    wav = make_wav(tmp_path / "tiny.wav")
    uploaded = client.post(
        "/api/calls/upload",
        files={"file": ("tiny.wav", wav.read_bytes(), "audio/wav")},
        data={"source_label": "Integration upload", "consent_note": "Authorised test recording."},
        headers=headers,
    )
    assert uploaded.status_code == 200, uploaded.text
    body = uploaded.json()
    call = body["call"]
    assert call["status"] == "queued"
    assert call["is_simulated"] == 0
    assert len(call["sha256"]) == 64
    assert body["job"]["status"] == "queued"

    detail = client.get(f"/api/calls/{call['id']}")
    assert detail.status_code == 200
    assert detail.json()["call"]["source_label"] == "Integration upload"
    assert len(detail.json()["waveform"]) == 640

    audio = client.get(f"/api/calls/{call['id']}/audio", headers={"Range": "bytes=0-99"})
    assert audio.status_code == 206
    assert len(audio.content) == 100
    assert audio.headers["content-range"].startswith("bytes 0-99/")

    waveform = client.get(f"/api/calls/{call['id']}/waveform")
    assert waveform.status_code == 200
    assert len(waveform.json()["peaks"]) == 640

    # Search covers persisted transcript text and location observations, not raw audio.
    db.insert("segments", {
        "id": db.new_id("seg_"), "call_id": call["id"], "idx": 0,
        "start_s": 0.0, "end_s": 0.5, "speaker": "Speaker A",
        "text": "मुझे मदद चाहिये", "translation": "I need help.",
        "language": "hi", "sentiment": "negative", "sentiment_score": -0.5,
    })
    db.insert("locations", {
        "id": db.new_id("loc_"), "call_id": call["id"], "label": "Dadar Station, Mumbai",
        "lat": 19.0192269, "lon": 72.8428479, "accuracy_m": 1000,
        "source_type": "spoken_landmark", "source_detail": "test fixture",
        "geocode_provider": "test", "verification_status": "unverified",
        "created_at": db.now(),
    })
    by_location = client.get("/api/search?q=Dadar")
    assert by_location.status_code == 200, by_location.text
    assert any(c["id"] == call["id"] for c in by_location.json()["calls"])
    by_transcript = client.get("/api/search?q=मदद")
    assert by_transcript.status_code == 200, by_transcript.text
    assert any(c["id"] == call["id"] for c in by_transcript.json()["calls"])


def test_login_rate_limit(client: TestClient):
    for _ in range(8):
        assert client.post("/api/auth/login", json={"username": "throttle-probe", "password": "wrong"}).status_code == 401
    blocked = client.post("/api/auth/login", json={"username": "throttle-probe", "password": "wrong"})
    assert blocked.status_code == 429


def test_upload_size_limit(client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    csrf = login(client)
    monkeypatch.setattr(config, "MAX_UPLOAD_BYTES", 10)
    wav = make_wav(tmp_path / "too-big.wav", seconds=0.3)
    response = client.post(
        "/api/calls/upload",
        files={"file": ("too-big.wav", wav.read_bytes(), "audio/wav")},
        data={"source_label": "oversize"},
        headers={"X-CSRF-Token": csrf},
    )
    assert response.status_code == 413


def test_live_config_and_unconfigured_path(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(config, "GEMINI_API_KEY", "")
    assert client.get("/api/live/config").status_code == 401
    csrf = login(client)
    status = client.get("/api/live/config")
    assert status.status_code == 200
    assert status.json()["configured"] is False
    assert "privacy" in status.json()

    # The endpoint refuses before touching audio when no server key is present.
    response = client.post(
        "/api/live/transcribe",
        files={"audio": ("chunk.wav", b"not-audio", "audio/wav")},
        data={"session_id": "session-12345", "chunk_index": "0"},
        headers={"X-CSRF-Token": csrf},
    )
    assert response.status_code == 503
    assert "GEMINI_API_KEY" in response.json()["detail"]
    assert "test-key" not in response.text


def test_live_transcribe_with_mock_provider(client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(config, "GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(config, "LIVE_RATE_LIMIT_PER_MINUTE", 20)

    def fake_transcribe(wav_bytes: bytes, language_hint: str = "auto") -> dict:
        assert wav_bytes.startswith(b"RIFF")
        assert language_hint == "hinglish"
        return {"text": "मैं डर गया हूँ", "model": "fake-gemini", "usage": {"totalTokenCount": 4}}

    monkeypatch.setattr(gemini, "transcribe_chunk", fake_transcribe)
    csrf = login(client)
    wav = make_wav(tmp_path / "live-chunk.wav", seconds=0.5)
    response = client.post(
        "/api/live/transcribe",
        files={"audio": ("chunk.wav", wav.read_bytes(), "audio/wav")},
        data={"session_id": "session-abcde", "chunk_index": "0", "language_hint": "hinglish"},
        headers={"X-CSRF-Token": csrf},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["text"] == "मैं डर गया हूँ"
    assert body["model"] == "fake-gemini"
    assert body["duration_s"] == 0.5
    assert "test-key" not in response.text

    bad_csrf = client.post(
        "/api/live/transcribe",
        files={"audio": ("chunk.wav", wav.read_bytes(), "audio/wav")},
        data={"session_id": "session-abcde", "chunk_index": "1"},
    )
    assert bad_csrf.status_code == 403


def test_quick_demo_endpoints(client: TestClient, tmp_path: Path):
    csrf = login(client)

    # Insert a simulated call to test quick start retrieval
    db.insert("calls", {
        "id": "demo-call-123",
        "case_id": None,
        "source_type": "demo",
        "source_label": "Hinglish — distress + digital-arrest scam indicators",
        "is_simulated": 1,
        "original_filename": "demo.wav",
        "stored_name": "demo_original.wav",
        "audio_name": "demo.wav",
        "sha256": "fakehash",
        "mime": "audio/wav",
        "size_bytes": 1000,
        "duration_s": 30.0,
        "sample_rate": 16000,
        "status": "analyzed",
        "priority": "high",
        "urgency_score": 92,
        "urgency_band": "high",
        "language": "hi",
        "consent_note": "Demo only",
        "created_at": db.now(),
    })
    db.insert("findings", {
        "id": "fnd-1",
        "call_id": "demo-call-123",
        "title": "Digital arrest threat",
        "type": "scam_term",
        "quote": "डिजिटल अरेस्ट",
        "description": "Scam pattern",
        "start_s": 16.8,
        "confidence": 0.95,
        "status": "unreviewed",
        "created_at": db.now(),
    })

    # Test /api/demo/quick-start
    response = client.post("/api/demo/quick-start", headers={"X-CSRF-Token": csrf})
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["ok"] is True
    assert data["call_id"] == "demo-call-123"
    assert "detail" in data

    # Test /api/calls/{call_id}/confirm-all-findings
    confirm_res = client.post("/api/calls/demo-call-123/confirm-all-findings", headers={"X-CSRF-Token": csrf})
    assert confirm_res.status_code == 200, confirm_res.text
    assert confirm_res.json()["ok"] is True
    assert confirm_res.json()["count"] >= 1

