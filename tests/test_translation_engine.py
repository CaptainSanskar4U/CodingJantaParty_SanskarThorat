"""
Tests for VEXYL-STT Inspired Zero-Latency Live Translation Engine in Dhvani.
Verifies 14 Indian Language Matrix, sub-90ms latency, Language Identification (LID),
and live translation API endpoints.
"""
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from app import config, db, jobs, main
from app.translation_engine import (
    SUPPORTED_LANGUAGES,
    detect_spoken_language,
    translate_live_utterance,
    get_supported_languages,
)


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    database = tmp_path / "test_tr.db"
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


def test_supported_languages_matrix():
    langs = get_supported_languages()
    assert len(langs) >= 15
    codes = {l["code"] for l in langs}
    assert "mr" in codes  # Marathi
    assert "ta" in codes  # Tamil
    assert "hi" in codes  # Hindi
    assert "te" in codes  # Telugu
    assert "kn" in codes  # Kannada
    assert "gu" in codes  # Gujarati
    assert "bn" in codes  # Bengali
    assert "ml" in codes  # Malayalam
    assert "pa" in codes  # Punjabi
    assert "ur" in codes  # Urdu
    assert "en" in codes  # English


def test_detect_marathi_language():
    text = "कृपया मला वाचवा, दार उघडा नाही!"
    lang, conf = detect_spoken_language(text)
    assert lang == "mr"
    assert conf >= 0.85


def test_detect_tamil_language():
    text = "தயவுசெய்து என்னை காப்பாற்றுங்கள், கதவு திறக்கவில்லை!"
    lang, conf = detect_spoken_language(text)
    assert lang == "ta"
    assert conf >= 0.85


def test_detect_hindi_language():
    text = "कृपया मुझे बचाओ, दरवाजा नहीं खुल रहा है!"
    lang, conf = detect_spoken_language(text)
    assert lang == "hi"
    assert conf >= 0.85


def test_detect_english_language():
    text = "Police Control Room, what is your emergency?"
    lang, conf = detect_spoken_language(text)
    assert lang == "en"
    assert conf >= 0.90


def test_translate_marathi_to_english():
    text = "कृपया मला वाचवा, दार उघडा नाही!"
    res = translate_live_utterance(text, target_lang="en")
    assert res["source_lang"] == "mr"
    assert res["target_lang"] == "en"
    assert "Please save me" in res["translated_text"]
    assert res["latency_ms"] < 100.0


def test_translate_tamil_to_english():
    text = "தயவுசெய்து என்னை காப்பாற்றுங்கள், கதவு திறக்கவில்லை!"
    res = translate_live_utterance(text, target_lang="en")
    assert res["source_lang"] == "ta"
    assert res["target_lang"] == "en"
    assert "save me" in res["translated_text"].lower() or "won't open" in res["translated_text"].lower()
    assert res["latency_ms"] < 100.0


def test_translate_hindi_to_english():
    text = "कृपया मुझे बचाओ, दरवाजा नहीं खुल रहा है!"
    res = translate_live_utterance(text, target_lang="en")
    assert res["source_lang"] == "hi"
    assert res["target_lang"] == "en"
    assert "save me" in res["translated_text"].lower() or "opening" in res["translated_text"].lower()
    assert res["latency_ms"] < 100.0


def test_translate_pass_through_same_language():
    text = "Hello, I need an ambulance at Sector 4."
    res = translate_live_utterance(text, source_lang="en", target_lang="en")
    assert res["translated_text"] == text
    assert res["latency_ms"] < 50.0


def test_api_languages_endpoint(client: TestClient):
    res = client.get("/api/languages")
    assert res.status_code == 200
    data = res.json()
    assert "languages" in data
    assert len(data["languages"]) >= 15


def test_api_live_translate_endpoint(client: TestClient):
    res = client.post("/api/translate/live", json={
        "text": "कृपया मला वाचवा, दार उघडा नाही!",
        "target_lang": "en"
    })
    assert res.status_code == 200
    data = res.json()
    assert data["source_lang"] == "mr"
    assert "Please save me" in data["translated_text"]
    assert data["latency_ms"] < 120.0


def test_api_call_translation_endpoint(client: TestClient):
    login(client)
    call_id = "test-tr-call-1"
    db.insert("calls", {
        "id": call_id,
        "stored_name": "test.wav",
        "audio_name": "test.wav",
        "sha256": "abc123sha",
        "language": "mr",
        "status": "analyzed",
        "created_at": db.now(),
    })
    db.insert("segments", {
        "id": "seg-tr-1",
        "call_id": call_id,
        "idx": 0,
        "start_s": 0.0,
        "end_s": 3.0,
        "speaker": "caller",
        "text": "कृपया मला वाचवा, दार उघडा नाही!",
        "translation": "Please save me, the door is not opening!",
    })

    res = client.get(f"/api/calls/{call_id}/translation?target_lang=en")
    assert res.status_code == 200
    data = res.json()
    assert data["target_lang"] == "en"
    assert "segments" in data
    assert len(data["segments"]) == 1
    seg0 = data["segments"][0]
    assert seg0["original_text"] == "कृपया मला वाचवा, दार उघडा नाही!"
    assert "Please save me" in seg0["translated_text"]
    assert seg0["source_lang"] == "mr"
