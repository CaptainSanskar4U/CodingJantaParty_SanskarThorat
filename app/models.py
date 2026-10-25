"""Lazy local model registry and model-specific adapters."""
from __future__ import annotations

import threading
from pathlib import Path
from typing import Any

import numpy as np

from . import config

_LOCK = threading.Lock()
_WHISPER: dict[str, Any] = {}
_AST = None
_EMOTION = None
_LOADED: set[str] = set()

HF_CACHE = Path.home() / ".cache" / "huggingface" / "hub"
WHISPER_CACHE = Path.home() / ".cache" / "whisper"


def _cached_dir(name: str) -> bool:
    return (HF_CACHE / f"models--{name.replace('/', '--')}").exists()


def model_status() -> dict:
    return {
        "whisper_base": {
            "name": config.WHISPER_MODEL,
            "cached": _cached_dir(f"Systran/faster-whisper-{config.WHISPER_MODEL}") or (WHISPER_CACHE / f"{config.WHISPER_MODEL}.pt").exists(),
            "loaded": config.WHISPER_MODEL in _LOADED,
            "kind": "faster-whisper (CPU int8)",
        },
        "whisper_hindi": {
            "name": config.WHISPER_HINDI_MODEL,
            "cached": _cached_dir(f"Systran/faster-whisper-{config.WHISPER_HINDI_MODEL}"),
            "loaded": config.WHISPER_HINDI_MODEL in _LOADED,
            "kind": "faster-whisper (CPU int8)",
        },
        "audio_events": {
            "name": config.AUDIO_EVENT_MODEL,
            "cached": _cached_dir(config.AUDIO_EVENT_MODEL),
            "loaded": _AST is not None,
            "kind": "AST / AudioSet (527 classes)",
        },
        "vocal_emotion": {
            "name": config.EMOTION_MODEL,
            "cached": _cached_dir(config.EMOTION_MODEL),
            "loaded": _EMOTION is not None,
            "kind": "wav2vec2 emotion classifier (English training)",
        },
    }


def get_whisper(name: str):
    global _LOADED
    with _LOCK:
        if name not in _WHISPER:
            from faster_whisper import WhisperModel
            _WHISPER[name] = WhisperModel(name, device="cpu", compute_type="int8")
            _LOADED.add(name)
        return _WHISPER[name]


def transcribe(audio: np.ndarray, model_name: str, task: str = "transcribe",
               language: str | None = None) -> dict:
    model = get_whisper(model_name)
    segments, info = model.transcribe(
        audio,
        beam_size=1,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 350},
        word_timestamps=True,
        condition_on_previous_text=False,
        language=language,
        task=task,
    )
    rows = []
    for seg in segments:
        words = []
        for word in (seg.words or []):
            words.append({"start": float(word.start), "end": float(word.end), "word": word.word})
        rows.append({
            "start_s": round(float(seg.start), 2),
            "end_s": round(float(seg.end), 2),
            "text": (seg.text or "").strip(),
            "words": words,
        })
    return {
        "segments": rows,
        "language": getattr(info, "language", None),
        "language_probability": round(float(getattr(info, "language_probability", 0) or 0), 3),
        "text": " ".join(r["text"] for r in rows).strip(),
    }


def _ast_pipeline():
    global _AST
    with _LOCK:
        if _AST is None:
            from transformers import pipeline
            _AST = pipeline(
                "audio-classification",
                model=config.AUDIO_EVENT_MODEL,
                device=-1,
            )
        return _AST


def _emotion_pipeline():
    global _EMOTION
    with _LOCK:
        if _EMOTION is None:
            from transformers import pipeline
            _EMOTION = pipeline(
                "audio-classification",
                model=config.EMOTION_MODEL,
                device=-1,
            )
        return _EMOTION


EVENT_MAP = [
    (("traffic", "roadway", "car", "vehicle", "motor", "truck", "bus", "engine"), "Traffic / roadway"),
    (("train", "rail"), "Train / rail"),
    (("horn", "honk"), "Vehicle horn"),
    (("crowd", "chatter", "babble", "conversation"), "Crowd / conversation"),
    (("typing", "keyboard"), "Typing / keyboard"),
    (("scream", "shout", "yell"), "Screaming / shouting"),
    (("siren",), "Siren"),
    (("alarm",), "Alarm"),
    (("music", "singing"), "Music"),
    (("dog", "bark"), "Dog"),
    (("footstep", "walking"), "Footsteps"),
    (("door", "knock"), "Door / knock"),
    (("synthesizer", "synthetic"), "Synthetic speech"),
    (("inside, small room",), "Indoor environment"),
    (("outside, urban", "urban or manmade"), "Outdoor urban environment"),
    (("silence",), "Silence"),
]


def _map_event(label: str) -> str | None:
    lowered = label.lower()
    if lowered in {"speech", "male speech, man speaking", "female speech, woman speaking", "narration, monologue"}:
        return None
    for needles, display in EVENT_MAP:
        if any(needle in lowered for needle in needles):
            return display
    return None


def detect_audio_events(audio: np.ndarray, sr: int = 16000) -> list[dict]:
    pipeline = _ast_pipeline()
    events: list[dict] = []
    window = 10 * sr
    for start in range(0, max(1, len(audio)), window):
        chunk = audio[start:start + window]
        if len(chunk) < sr * 0.5:
            continue
        try:
            predictions = pipeline(chunk, top_k=10)
        except Exception:
            continue
        kept = []
        for pred in predictions:
            label = _map_event(str(pred.get("label", "")))
            score = float(pred.get("score", 0))
            if label and score >= 0.04:
                kept.append((label, score, str(pred.get("label"))))
        # Keep at most two distinct environmental interpretations per window.
        seen_labels = set()
        for label, score, raw in kept:
            if label in seen_labels:
                continue
            seen_labels.add(label)
            events.append({
                "label": label,
                "raw_label": raw,
                "start_s": round(start / sr, 2),
                "end_s": round(min(len(audio), start + window) / sr, 2),
                "confidence": round(score, 3),
                "model": config.AUDIO_EVENT_MODEL,
                "is_interpretation": 0,
            })
            if len(seen_labels) >= 2:
                break
    # Merge adjacent windows with the same label.
    merged: list[dict] = []
    for event in sorted(events, key=lambda e: (e["label"], e["start_s"])):
        if merged and merged[-1]["label"] == event["label"] and abs(merged[-1]["end_s"] - event["start_s"]) < 0.6:
            merged[-1]["end_s"] = event["end_s"]
            merged[-1]["confidence"] = max(merged[-1]["confidence"], event["confidence"])
        else:
            merged.append(dict(event))
    # Significant low-energy stretches are reported as an acoustic observation.
    frame = int(sr * 0.5)
    rms = []
    for start in range(0, len(audio), frame):
        chunk = audio[start:start + frame]
        rms.append(float(np.sqrt(np.mean(chunk.astype(np.float64) ** 2))) if len(chunk) else 0.0)
    if rms:
        threshold = max(0.006, float(np.percentile(rms, 20)) * 0.45)
        run_start = None
        for index, value in enumerate(rms + [1.0]):
            if value <= threshold and run_start is None:
                run_start = index
            elif value > threshold and run_start is not None:
                if (index - run_start) * 0.5 >= 2.0:
                    merged.append({
                        "label": "Silence / low audio",
                        "raw_label": "RMS energy below adaptive threshold",
                        "start_s": round(run_start * 0.5, 2),
                        "end_s": round(index * 0.5, 2),
                        "confidence": 0.8,
                        "model": "adaptive RMS (signal processing)",
                        "is_interpretation": 1,
                    })
                run_start = None
    return sorted(merged, key=lambda e: e["start_s"])


EMOTION_LABELS = {
    "ang": "Anger",
    "anger": "Anger",
    "hap": "Happiness",
    "happy": "Happiness",
    "sad": "Sadness",
    "sadness": "Sadness",
    "neu": "Neutral",
    "neutral": "Neutral",
    "fear": "Fear",
    "fearful": "Fear",
    "disgust": "Disgust",
    "surprise": "Surprise",
}


def emotion_scores(audio: np.ndarray, sr: int = 16000) -> list[dict]:
    pipeline = _emotion_pipeline()
    # Keep inference bounded; the model was trained on short emotional clips.
    max_len = 8 * sr
    if len(audio) > max_len:
        centre = len(audio) // 2
        audio = audio[max(0, centre - max_len // 2): centre + max_len // 2]
    if len(audio) < sr * 0.4:
        return []
    try:
        predictions = pipeline(audio, top_k=5)
    except Exception:
        return []
    return [
        {"label": EMOTION_LABELS.get(str(p.get("label", "")).lower(), str(p.get("label", ""))),
         "score": round(float(p.get("score", 0)), 3)}
        for p in predictions
    ]
