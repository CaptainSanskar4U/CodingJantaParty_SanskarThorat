"""Tests for Praat/Parselmouth acoustic forensic DSP engine."""
import numpy as np
import pytest
from app import acoustic_engine


def test_analyze_sound_object_synthetic_sine():
    # 440Hz sine wave (A4 note)
    sr = 16000
    duration = 1.0
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    samples = (0.5 * np.sin(2 * np.pi * 440.0 * t)).astype(np.float32)

    res = acoustic_engine.analyze_sound_object(samples, sr=sr)
    assert res["is_scientific_analysis"] is True
    assert 420.0 <= res["pitch_median_hz"] <= 460.0
    assert 0 <= res["tremor_score"] <= 100
    assert 0 <= res["stress_score"] <= 100
    assert "jitter_pct" in res
    assert "shimmer_pct" in res
    assert "hnr_db" in res


def test_analyze_sound_object_silence():
    sr = 16000
    samples = np.zeros(sr, dtype=np.float32)
    res = acoustic_engine.analyze_sound_object(samples, sr=sr)
    assert "pitch_median_hz" in res
    assert "tremor_score" in res


def test_generate_waveform_peaks():
    sr = 16000
    samples = np.random.uniform(-0.8, 0.8, sr * 2).astype(np.float32)
    peaks = acoustic_engine.generate_waveform_peaks(samples, num_peaks=60)
    assert len(peaks) == 60
    assert all(0.0 <= p <= 1.0 for p in peaks)
