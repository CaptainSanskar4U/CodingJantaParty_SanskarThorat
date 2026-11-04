"""Tests for real-time live analysis, vocal biometrics, keyword tracking, and guidance."""
import io
import wave
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app import guidance, pipeline


def _create_sine_wav_bytes(duration_s: float = 3.0, freq_hz: float = 220.0, sr: int = 16000) -> bytes:
    t = np.linspace(0, duration_s, int(sr * duration_s), endpoint=False)
    # Add a slight frequency tremor/modulation
    tremor = 10.0 * np.sin(2 * np.pi * 5.0 * t)
    audio = 0.5 * np.sin(2 * np.pi * (freq_hz + tremor) * t)
    pcm16 = (audio * 32767).astype(np.int16)
    
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(pcm16.tobytes())
    return buf.getvalue()


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def _get_csrf_cookie(client: TestClient):
    res = client.post("/api/auth/login", json={"username": "mehta", "password": "dhvani-demo"})
    assert res.status_code == 200
    csrf = res.json()["csrf"]
    return csrf, client.cookies


def test_guidance_empty_and_calibrating():
    # When data is insufficient (< 5s) or transcript is empty
    res = guidance.generate_guidance(transcript="", observable_prosody={}, has_sufficient_data=False)
    assert res["status"] == "calibrating"
    assert "CALIBRATING" in res["phase"]
    assert len(res["checklist"]) >= 4
    assert res["checklist"][0]["checked"] is False


def test_guidance_pizza_repetition_progression():
    # 1. First occurrence of pizza
    res1 = guidance.generate_guidance(
        transcript="Hello I need a pepperoni pizza please",
        observable_prosody={"pitch_variation_hz": 12.0, "pause_ratio": 0.15},
        keyword_hits=1,
        has_sufficient_data=True
    )
    assert res1["status"] == "active"
    assert "FOOD ORDER ANOMALY" in res1["phase"]
    # Check that it doesn't assume victim status automatically
    assert "prank" in res1["rationale"].lower() or "commercial" in res1["rationale"].lower() or "verify" in res1["rationale"].lower()

    # 2. Repeated occurrence (3 hits) with elevated vocal stress
    res3 = guidance.generate_guidance(
        transcript="I need a pizza, a regular pepperoni pizza, deliver the pizza to apartment 302",
        observable_prosody={"pitch_variation_hz": 34.0, "pause_ratio": 0.42},
        keyword_hits=3,
        has_sufficient_data=True
    )
    assert res3["status"] == "active"
    assert "COVERT DURESS" in res3["phase"]
    # Recommends closed yes/no protocol
    assert "yes or no" in res3["prompt"].lower() or "closed" in res3["prompt"].lower()
    # Checklist marks disguise identified
    assert res3["checklist"][0]["checked"] is True


def test_live_analyze_endpoint_short_and_sufficient(client: TestClient):
    csrf, cookies = _get_csrf_cookie(client)
    headers = {"X-CSRF-Token": csrf}
    session_id = "test-live-session-12345678"

    # 1. Send short 3s chunk (< 5s threshold)
    wav_3s = _create_sine_wav_bytes(duration_s=3.0, freq_hz=220.0)
    files = {"audio": ("chunk.wav", wav_3s, "audio/wav")}
    data = {
        "session_id": session_id,
        "chunk_index": "0",
        "provisional_text": "dispatcher control room how can I assist you",
    }
    
    res1 = client.post("/api/live/analyze", headers=headers, files=files, data=data)
    assert res1.status_code == 200
    r1 = res1.json()
    assert r1["ok"] is True
    assert r1["duration_s"] == 3.0
    assert r1["has_sufficient_data"] is False
    assert r1["location"]["lat"] == 19.0760
    assert r1["location"]["lon"] == 72.8777
    assert r1["location"]["is_demo_location"] is True

    # 2. Send second 3s chunk (total 6.0s >= 5s threshold) with "pizza" keyword
    wav_next_3s = _create_sine_wav_bytes(duration_s=3.0, freq_hz=240.0)
    files2 = {"audio": ("chunk2.wav", wav_next_3s, "audio/wav")}
    data2 = {
        "session_id": session_id,
        "chunk_index": "1",
        "provisional_text": "I need a pepperoni pizza",
    }
    
    res2 = client.post("/api/live/analyze", headers=headers, files=files2, data=data2)
    assert res2.status_code == 200
    r2 = res2.json()
    assert r2["ok"] is True
    assert r2["duration_s"] == 6.0
    assert r2["has_sufficient_data"] is True
    
    # Biometrics populated
    assert "observable" in r2["prosody"]
    assert "pitch_median_hz" in r2["prosody"]["observable"]
    assert r2["prosody"]["disclaimer"] is not None
    
    # Keyword detection active: < 3 hits displays "Find the Victim's Hint"
    assert r2["keywords"]["target"] == "Find the Victim's Hint"
    assert r2["keywords"]["count"] == 1
    
    # 3. Send third chunk bringing pizza count to >= 3
    wav_third_3s = _create_sine_wav_bytes(duration_s=3.0, freq_hz=260.0)
    files3 = {"audio": ("chunk3.wav", wav_third_3s, "audio/wav")}
    data3 = {
        "session_id": session_id,
        "chunk_index": "2",
        "provisional_text": "Please bring a pizza, I want another pizza right now",
    }
    res3 = client.post("/api/live/analyze", headers=headers, files=files3, data=data3)
    assert res3.status_code == 200
    r3 = res3.json()
    assert r3["keywords"]["count"] >= 3
    assert r3["keywords"]["target"] == "Pizza Detected"

    # Guidance dynamic
    assert r2["guidance"]["status"] == "active"
    assert len(r2["guidance"]["checklist"]) >= 4

    # Clean up session
    client.post("/api/live/clear", headers=headers, json={"session_id": session_id})

