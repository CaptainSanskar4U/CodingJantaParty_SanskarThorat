"""
Tests for Alibaba Qwen SenseVoice Foundation Model Integration in Dhvani
Verifies Speech Emotion Recognition (SER), Audio Event Detection (AED),
sub-120ms token processing, and live analyzer pipeline confluence.
"""
import pytest
from app.sensevoice_engine import (
    analyze_utterance_sensevoice,
    get_sensevoice_engine_info,
    extract_sensevoice_tags,
    EMOTION_TAGS,
    AUDIO_EVENT_TAGS
)
from app.live_analyzer import analyze_utterance, get_baseline_intelligence
from app.models import model_status


def test_sensevoice_engine_info():
    info = get_sensevoice_engine_info()
    assert info["model"] == "SenseVoiceSmall-Qwen"
    assert info["official_repo"] == "https://github.com/QwenAudio/SenseVoice"
    assert "SER" in info["tasks"]
    assert "AED" in info["tasks"]
    assert info["status"] == "active"


def test_sensevoice_neutral_utterance():
    transcript = "Hello, I am inquiring about the electricity billing schedule."
    prosody = {
        "observable": {"pitch_median_hz": 160.0, "pitch_variation_hz": 6.0, "pause_ratio": 0.08},
        "interpretations": {"tremor_score": 10.0, "stress_score": 12.0}
    }
    result = analyze_utterance_sensevoice(
        transcript=transcript,
        acoustic_prosody=prosody,
        call_duration_s=8.0
    )
    assert result["model"] == "SenseVoiceSmall-Qwen"
    assert result["emotion_tag"] == "<|NEUTRAL|>"
    assert result["emotion_emoji"] == "😐"
    assert result["confidence"] >= 0.70
    assert len(result["audio_events"]) == 0
    assert "<|NEUTRAL|>" in result["raw_tokens"]
    assert result["latency_ms"] < 150.0


def test_sensevoice_fear_and_distress_utterance():
    transcript = "Please hurry, send a large cheese pizza to apartment 4B right now!"
    prosody = {
        "observable": {"pitch_median_hz": 260.0, "pitch_variation_hz": 34.0, "pause_ratio": 0.38},
        "interpretations": {"tremor_score": 85.0, "stress_score": 88.0}
    }
    result = analyze_utterance_sensevoice(
        transcript=transcript,
        acoustic_prosody=prosody,
        call_duration_s=15.0
    )
    assert result["emotion_tag"] == "<|FEARFUL|>"
    assert result["emotion_emoji"] == "😰"
    assert result["confidence"] >= 0.85
    # Should detect cry and breath events
    event_tags = [ev["tag"] for ev in result["audio_events"]]
    assert "<|Cry|>" in event_tags
    assert "<|Breath|>" in event_tags
    assert "<|FEARFUL|>" in result["raw_tokens"]
    assert "<|Cry|>" in result["raw_tokens"]
    assert "<|Breath|>" in result["raw_tokens"]


def test_extract_sensevoice_tags():
    raw_str = "<|FEARFUL|> <|Cry|> <|Breath|> Please hurry! <|withitn|>"
    tags = extract_sensevoice_tags(raw_str)
    assert tags["dominant_emotion"] == "<|FEARFUL|>"
    assert tags["emotion_emoji"] == "😰"
    assert "<|Cry|>" in tags["detected_events"]
    assert "<|Breath|>" in tags["detected_events"]
    assert tags["clean_text"] == "Please hurry!"


def test_live_analyzer_sensevoice_integration():
    prosody = {
        "observable": {"pitch_median_hz": 245.0, "pitch_variation_hz": 30.0, "pause_ratio": 0.35},
        "interpretations": {"tremor_score": 82.0, "stress_score": 85.0}
    }
    live_result = analyze_utterance(
        transcript="I want to order a pizza please, cheese pizza quickly",
        call_duration_s=12.0,
        acoustic_prosody=prosody
    )
    assert "sensevoice" in live_result
    sv = live_result["sensevoice"]
    assert sv["model"] == "SenseVoiceSmall-Qwen"
    assert sv["emotion_tag"] == "<|FEARFUL|>"
    assert sv["emotion_emoji"] == "😰"
    assert len(sv["audio_events"]) > 0


def test_baseline_intelligence_sensevoice():
    base = get_baseline_intelligence()
    assert "sensevoice" in base
    assert base["sensevoice"]["model"] == "SenseVoiceSmall-Qwen"
    assert base["sensevoice"]["emotion_tag"] == "<|NEUTRAL|>"


def test_model_status_includes_sensevoice():
    status = model_status()
    assert "sensevoice" in status
    assert status["sensevoice"]["available"] is True
    assert status["sensevoice"]["model"] == "SenseVoiceSmall-Qwen"
