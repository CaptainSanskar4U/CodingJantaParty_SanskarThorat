"""Tests for POST /api/telephony/save_recording endpoint."""
import io
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app import db, telephony


def test_save_recording_endpoint():
    client = TestClient(app)
    ext = telephony.get_active_extension()
    call = telephony.start_call(ext, "Test Phone Caller")
    call_id = call["id"]

    # Generate synthetic 1-second 16kHz WAV in memory
    import wave
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(16000)
        wf.writeframes(b"\x00\x00" * 16000)
    audio_bytes = buf.getvalue()

    response = client.post(
        "/api/telephony/save_recording",
        data={"call_id": call_id},
        files={"audio": ("test_call.wav", audio_bytes, "audio/wav")}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["call_id"] == call_id
    assert "acoustics" in data
    assert "peaks" in data

    # Verify db record updated
    row = db.query_one("SELECT status, waveform_json FROM calls WHERE id=?", (call_id,))
    assert row["status"] == "completed"
    assert row["waveform_json"] is not None

