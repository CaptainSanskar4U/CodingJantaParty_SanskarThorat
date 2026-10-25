"""Dhvani analysis pipeline: real local models, traceable outputs."""
from __future__ import annotations

import json
import math
import re
from pathlib import Path

import numpy as np
from scipy.fftpack import dct
from scipy.cluster.vq import kmeans2

from . import config, db, geo, models, phrases, storage


def _load_audio(path: Path) -> tuple[np.ndarray, int]:
    from scipy.io import wavfile
    sr, data = wavfile.read(path)
    if data.ndim > 1:
        data = data.mean(axis=1)
    if data.dtype == np.int16:
        audio = data.astype(np.float32) / 32768.0
    elif data.dtype == np.int32:
        audio = data.astype(np.float32) / 2147483648.0
    else:
        audio = data.astype(np.float32)
    return audio, int(sr)


def _group_words(asr_segments: list[dict], max_duration: float = 7.0, max_words: int = 22) -> list[dict]:
    grouped: list[dict] = []
    for raw in asr_segments:
        words = raw.get("words") or []
        if not words:
            grouped.append({"start_s": raw["start_s"], "end_s": raw["end_s"], "text": raw["text"]})
            continue
        current: list[dict] = []
        for word in words:
            current.append(word)
            text = "".join(w["word"] for w in current).strip()
            duration = current[-1]["end"] - current[0]["start"]
            if (
                len(current) >= max_words
                or duration >= max_duration
                or re.search(r"[.!?।]$", text)
            ):
                grouped.append({
                    "start_s": round(float(current[0]["start"]), 2),
                    "end_s": round(float(current[-1]["end"]), 2),
                    "text": " ".join(w["word"].strip() for w in current).strip(),
                })
                current = []
        if current:
            grouped.append({
                "start_s": round(float(current[0]["start"]), 2),
                "end_s": round(float(current[-1]["end"]), 2),
                "text": " ".join(w["word"].strip() for w in current).strip(),
            })
    # Remove empty/duplicate rows and enforce monotonic timestamps.
    cleaned = []
    for row in grouped:
        text = re.sub(r"\s+", " ", row.get("text", "")).strip()
        if not text:
            continue
        if cleaned and row["start_s"] < cleaned[-1]["start_s"]:
            row["start_s"] = cleaned[-1]["start_s"]
        row["end_s"] = max(row["end_s"], row["start_s"] + 0.2)
        row["text"] = text
        cleaned.append(row)
    return cleaned


def _align_translation(original: list[dict], translated: list[dict]) -> list[str]:
    out: list[str] = []
    for seg in original:
        start, end = seg["start_s"], seg["end_s"]
        parts = []
        for tr in translated:
            overlap = min(end, tr["end_s"]) - max(start, tr["start_s"])
            if overlap > 0.05:
                parts.append(tr["text"])
        out.append(" ".join(parts).strip())
    return out


def _mfcc(y: np.ndarray, sr: int = 16000) -> np.ndarray | None:
    if len(y) < sr * 0.25:
        return None
    frame_len = int(sr * 0.025)
    hop = int(sr * 0.010)
    if len(y) < frame_len:
        return None
    frames = 1 + (len(y) - frame_len) // hop
    if frames < 3:
        return None
    idx = np.arange(frame_len)[None, :] + hop * np.arange(frames)[:, None]
    framed = y[idx] * np.hamming(frame_len)[None, :]
    spectrum = np.abs(np.fft.rfft(framed, n=512)) ** 2
    # 26 mel filters
    mel_points = np.linspace(0, 2595 * np.log10(1 + (sr / 2) / 700), 28)
    hz_points = 700 * (10 ** (mel_points / 2595) - 1)
    bins = np.floor((512 + 1) * hz_points / sr).astype(int)
    filters = np.zeros((26, 257))
    for m in range(1, 27):
        left, centre, right = bins[m - 1], bins[m], bins[m + 1]
        if centre == left:
            centre += 1
        if right == centre:
            right += 1
        for k in range(left, min(centre, 257)):
            filters[m - 1, k] = (k - left) / max(1, centre - left)
        for k in range(centre, min(right, 257)):
            filters[m - 1, k] = (right - k) / max(1, right - centre)
    energies = np.log(spectrum @ filters.T + 1e-9)
    coeffs = dct(energies, type=2, axis=1, norm="ortho")[:, 1:13]
    return np.concatenate([coeffs.mean(axis=0), coeffs.std(axis=0)])


def _cluster_speakers(audio: np.ndarray, sr: int, segments: list[dict]) -> tuple[list[str], str, int]:
    features = []
    indices = []
    for i, seg in enumerate(segments):
        start = int(max(0, seg["start_s"] - 0.05) * sr)
        end = int(min(len(audio) / sr, seg["end_s"] + 0.05) * sr)
        feat = _mfcc(audio[start:end], sr)
        if feat is not None:
            features.append(feat)
            indices.append(i)
    labels = ["Speaker 1"] * len(segments)
    method = "No speaker clustering possible (segments too short)"
    if len(features) >= 3:
        arr = np.asarray(features, dtype=np.float64)
        arr = (arr - arr.mean(axis=0)) / (arr.std(axis=0) + 1e-6)
        try:
            centroids, clusters = kmeans2(arr, 2, minit="++", seed=42)
            counts = np.bincount(clusters, minlength=2)
            separation = float(np.linalg.norm(centroids[0] - centroids[1]))
            if counts.min() >= 1 and separation >= 1.15:
                order = sorted(range(2), key=lambda c: min(
                    (segments[indices[i]]["start_s"] for i in range(len(indices)) if clusters[i] == c),
                    default=9999,
                ))
                names = {order[0]: "Speaker A", order[1]: "Speaker B"}
                for local, seg_index in enumerate(indices):
                    labels[seg_index] = names[int(clusters[local])]
                method = "MFCC acoustic clustering (heuristic; not overlap detection)"
                return labels, method, 2
        except Exception:
            pass
    if len(features) >= 1:
        method = "Single speaker profile (MFCC clustering inconclusive)"
    return labels, method, 1


def _prosody(audio: np.ndarray, sr: int, word_count: int, duration: float) -> dict:
    if len(audio) == 0:
        return {}
    frame = int(sr * 0.05)
    rms_values = []
    zcr_values = []
    for start in range(0, len(audio), frame):
        chunk = audio[start:start + frame]
        if len(chunk) < 10:
            continue
        rms_values.append(float(np.sqrt(np.mean(chunk.astype(np.float64) ** 2))))
        zcr_values.append(float(np.mean(np.abs(np.diff(np.sign(chunk))) > 0)))
    if not rms_values:
        return {}
    rms = np.asarray(rms_values)
    threshold = max(0.008, float(np.percentile(rms, 25)) * 0.6)
    pause_ratio = float(np.mean(rms < threshold))
    # Pitch via autocorrelation on a bounded sample of voiced frames.
    pitch_values = []
    step = max(1, len(audio) // (sr * 2))
    for start in range(0, len(audio) - 800, 400 * step):
        chunk = audio[start:start + 800].astype(np.float64)
        if np.sqrt(np.mean(chunk ** 2)) < 0.015:
            continue
        chunk = chunk - chunk.mean()
        corr = np.correlate(chunk, chunk, mode="full")[len(chunk) - 1:]
        corr /= (corr[0] + 1e-9)
        lo, hi = int(sr / 400), int(sr / 70)
        if hi <= lo or hi >= len(corr):
            continue
        peak = int(np.argmax(corr[lo:hi])) + lo
        if corr[peak] > 0.25:
            pitch_values.append(sr / peak)
        if len(pitch_values) >= 120:
            break
    pitch = float(np.median(pitch_values)) if pitch_values else None
    pitch_var = float(np.std(pitch_values)) if pitch_values else None
    return {
        "rms_mean": round(float(rms.mean()), 4),
        "rms_variation": round(float(rms.std()), 4),
        "pause_ratio": round(pause_ratio, 3),
        "zero_crossing_rate": round(float(np.mean(zcr_values)), 3),
        "pitch_median_hz": round(pitch, 1) if pitch else None,
        "pitch_variation_hz": round(pitch_var, 1) if pitch_var else None,
        "speech_rate_words_per_sec": round(word_count / max(1.0, duration), 2),
    }


def _emotion_summary(segments: list[dict]) -> dict:
    totals: dict[str, float] = {}
    weights = 0.0
    for seg in segments:
        label = seg.get("vocal_emotion")
        score = float(seg.get("vocal_confidence") or 0)
        if not label:
            continue
        weight = max(0.5, float(seg["end_s"]) - float(seg["start_s"]))
        totals[label] = totals.get(label, 0.0) + score * weight
        weights += weight
    if not totals or weights == 0:
        return {}
    return {k: round(v / weights, 3) for k, v in sorted(totals.items(), key=lambda x: -x[1])}


def _arousal(emotion_summary: dict) -> float:
    if not emotion_summary:
        return 0.0
    non_neutral = {k: v for k, v in emotion_summary.items() if k != "Neutral"}
    if not non_neutral:
        return 0.0
    top = max(non_neutral.values())
    fear = emotion_summary.get("Fear", 0)
    anger = emotion_summary.get("Anger", 0)
    sadness = emotion_summary.get("Sadness", 0)
    return float(min(1.0, 0.55 * top + 0.25 * fear + 0.15 * anger + 0.05 * sadness))


def _urgency(segments: list[dict], findings: list[dict], events: list[dict],
             speaker_count: int, discrepancy: bool) -> tuple[float, str, dict, list[str]]:
    emotion_summary = _emotion_summary(segments)
    arousal = _arousal(emotion_summary)
    distress = sum(1 for f in findings if f["type"] in {"distress_phrase", "emergency_number"})
    scam = sum(1 for f in findings if f["type"] == "scam_term")
    contextual = sum(1 for f in findings if f["type"] == "contextual_risk")
    risky_event = any(
        e["label"] in {"Screaming / shouting", "Siren", "Alarm"} and float(e.get("confidence") or 0) >= 0.08
        for e in events
    )
    contributions = {
        "acoustic_arousal": round(arousal * 35, 1),
        "distress_phrases": min(20, distress * 12),
        "scam_terms": min(12, scam * 6),
        "contextual_language": min(8, contextual * 8),
        "multiple_speakers": 10 if speaker_count >= 2 else 0,
        "risk_audio_event": 8 if risky_event else 0,
        "transcript_acoustic_discrepancy": 7 if discrepancy else 0,
        "co_occurring_risk_indicators": 10 if distress >= 1 and scam >= 2 else 0,
    }
    score = round(min(100.0, sum(contributions.values())), 1)
    if score >= 70:
        band = "high"
    elif score >= 40:
        band = "medium"
    else:
        band = "low"
    notes = []
    if not emotion_summary:
        notes.append("Vocal-emotion model produced no usable prediction; acoustic arousal is not scored.")
    notes.append("Urgency is a decision-support estimate from the listed contributions, not a diagnosis or proof of danger.")
    return score, band, contributions, notes


def _insert_alert(call: dict, type_: str, severity: str, title: str, detail: str, dedupe_suffix: str) -> None:
    key = f"{call['id']}:{type_}:{dedupe_suffix}"
    if db.query_one("SELECT id FROM alerts WHERE dedupe_key=?", (key,)):
        return
    db.insert("alerts", {
        "id": db.new_id("alr"),
        "call_id": call["id"],
        "case_id": call.get("case_id"),
        "type": type_,
        "severity": severity,
        "title": title,
        "detail": detail,
        "dedupe_key": key,
        "status": "unread",
        "created_at": db.now(),
    })


def clear_results(call_id: str) -> None:
    for table in ("transcripts", "segments", "findings", "locations", "audio_events"):
        db.execute(f"DELETE FROM {table} WHERE call_id=?", (call_id,))


def process_call(call_id: str, job_id: str) -> None:
    call = db.query_one("SELECT * FROM calls WHERE id=?", (call_id,))
    if not call:
        return
    try:
        db.update("jobs", job_id, {"status": "running", "started_at": db.now(), "stage": "Loading audio", "progress": 2, "message": "Validating recording"})
        db.update("calls", call_id, {"status": "processing", "error": None})
        clear_results(call_id)
        audio_path = config.UPLOAD_DIR / call["audio_name"]
        audio, sr = _load_audio(audio_path)
        if sr != 16000:
            raise ValueError("Converted audio is not 16 kHz")
        duration = len(audio) / sr
        db.update("calls", call_id, {"duration_s": round(duration, 2)})

        db.update("jobs", job_id, {"stage": "Speech recognition", "progress": 10, "message": "Detecting language and transcribing"})
        base_model = config.WHISPER_MODEL
        hindi_model = config.WHISPER_HINDI_MODEL
        language, language_prob = None, 0.0
        try:
            detected = models.get_whisper(base_model).detect_language(audio)
            language, language_prob = str(detected[0]), float(detected[1])
        except Exception:
            language = None
        asr_model = base_model
        if language in {"hi", "ur"} and hindi_model and hindi_model != base_model:
            asr_model = hindi_model
        asr = models.transcribe(audio, asr_model, task="transcribe", language=language)
        if not asr["language"]:
            asr["language"] = language or "unknown"
        segments = _group_words(asr["segments"])
        if not segments:
            raise ValueError("No speech was detected in this recording.")
        original_text = " ".join(s["text"] for s in segments).strip()
        language = asr.get("language") or language or "unknown"
        language_prob = asr.get("language_probability") or language_prob

        db.update("jobs", job_id, {"stage": "Translation", "progress": 30, "message": "Preparing English translation"})
        translated_text = original_text
        translations = [s["text"] for s in segments]
        if language not in {"en", "eng"}:
            try:
                translation_model = hindi_model if language in {"hi", "ur"} and hindi_model else base_model
                tr = models.transcribe(audio, translation_model, task="translate", language=language)
                tr_segments = _group_words(tr["segments"])
                translations = _align_translation(segments, tr_segments)
                translated_text = " ".join(tr["segments"][i]["text"] for i in range(len(tr["segments"]))) or original_text
            except Exception:
                translation_model = base_model
                translations = ["" for _ in segments]
                translated_text = ""

        db.update("jobs", job_id, {"stage": "Speaker attribution", "progress": 42, "message": "Clustering speaker profiles"})
        speaker_labels, speaker_method, speaker_count = _cluster_speakers(audio, sr, segments)

        db.update("jobs", job_id, {"stage": "Vocal emotion", "progress": 52, "message": "Analysing acoustic emotion signals"})
        # Limit inference to the four longest segments to keep the demo responsive.
        order = sorted(range(len(segments)), key=lambda i: segments[i]["end_s"] - segments[i]["start_s"], reverse=True)[:4]
        for i, seg in enumerate(segments):
            seg["speaker"] = speaker_labels[i]
            seg["translation"] = translations[i] if i < len(translations) else ""
            label, score = phrases.sentiment(seg["text"])
            seg["sentiment"], seg["sentiment_score"] = label, score
            seg["language"] = language
            seg["vocal_emotion"], seg["vocal_confidence"] = None, None
            seg["method"] = speaker_method
            if i in order:
                start = int(seg["start_s"] * sr)
                end = int(seg["end_s"] * sr)
                scores = models.emotion_scores(audio[start:end], sr)
                if scores:
                    top = max(scores, key=lambda x: x["score"])
                    seg["vocal_emotion"], seg["vocal_confidence"] = top["label"], top["score"]
                    seg["emotion_scores"] = scores
        emotion_summary = _emotion_summary(segments)
        prosody = _prosody(audio, sr, len(original_text.split()), duration)

        db.update("jobs", job_id, {"stage": "Background audio", "progress": 64, "message": "Classifying acoustic events"})
        events = models.detect_audio_events(audio, sr)

        db.update("jobs", job_id, {"stage": "Findings and locations", "progress": 78, "message": "Matching reference pack and landmarks"})
        matched = phrases.match_phrases(segments)
        # Discrepancy is computed from actual acoustic and text signals.
        arousal = _arousal(emotion_summary)
        avg_sent = float(np.mean([s["sentiment_score"] for s in segments])) if segments else 0.0
        discrepancy = (arousal >= 0.55 and avg_sent > -0.05) or (arousal <= 0.30 and any(
            f["type"] in {"distress_phrase", "emergency_number"} for f in matched
        ))
        if discrepancy:
            matched.append({
                "type": "discrepancy",
                "subtype": "acoustic_transcript_divergence",
                "title": "Possible acoustic / transcript discrepancy",
                "description": (
                    "Acoustic arousal and the transcript's distress language do not align. This is a prompt for human review, "
                    "not evidence of deception. Acoustic emotion models are sensitive to language, recording quality and speaker variation."
                ),
                "start_s": segments[0]["start_s"] if segments else None,
                "end_s": segments[-1]["end_s"] if segments else None,
                "quote": None,
                "source_type": "model_output",
                "source_ref": f"{config.EMOTION_MODEL}; bilingual lexicon sentiment",
                "method": "transparent rule: arousal/sentiment divergence",
                "confidence": 0.55,
            })
        if speaker_count >= 2:
            matched.append({
                "type": "speaker_observation",
                "subtype": "multiple_speaker_profiles",
                "title": "Possible additional speaker",
                "description": (
                    "Acoustic clustering found two distinct speaker profiles. This is a lead, not confirmation of a second person "
                    "or of overlapping speech. Review the audio segments before relying on it."
                ),
                "start_s": segments[0]["start_s"] if segments else None,
                "end_s": segments[-1]["end_s"] if segments else None,
                "quote": None,
                "source_type": "model_output",
                "source_ref": speaker_method,
                "method": speaker_method,
                "confidence": 0.65,
            })
        locations = geo.extract_locations(segments)
        urgency_score, urgency_band, contributions, urgency_notes = _urgency(
            segments, matched, events, speaker_count, discrepancy
        )
        limitations = [
            "Speech recognition can mis-transcribe names, landmarks and code-switched words; the original audio remains the primary evidence.",
            "Vocal-emotion model is trained on English emotional speech; predictions for Hindi/Hinglish are not validated and must not be read as deception or guilt.",
            "Speaker labels come from acoustic clustering, not verified diarisation or overlap detection.",
            "Audio-event labels are model predictions from AudioSet categories; unsupported categories are not invented.",
            "Landmark coordinates are approximate and do not establish a caller's exact location.",
        ]

        # Persist transcript
        transcript_id = db.new_id("trn")
        db.insert("transcripts", {
            "id": transcript_id, "call_id": call_id, "language": language,
            "text": original_text, "translation": translated_text,
            "provider": "faster-whisper", "model": asr_model, "created_at": db.now(),
        })
        for idx, seg in enumerate(segments):
            db.insert("segments", {
                "id": db.new_id("seg"), "call_id": call_id, "idx": idx,
                "start_s": seg["start_s"], "end_s": seg["end_s"],
                "speaker": seg.get("speaker"), "text": seg["text"],
                "translation": seg.get("translation"), "language": language,
                "sentiment": seg.get("sentiment"), "sentiment_score": seg.get("sentiment_score"),
                "vocal_emotion": seg.get("vocal_emotion"), "vocal_confidence": seg.get("vocal_confidence"),
                "method": speaker_method,
            })
        for finding in matched:
            db.insert("findings", {
                "id": db.new_id("fnd"), "call_id": call_id, "case_id": call.get("case_id"),
                "type": finding["type"], "subtype": finding.get("subtype"),
                "title": finding["title"], "description": finding["description"],
                "start_s": finding.get("start_s"), "end_s": finding.get("end_s"),
                "quote": finding.get("quote"), "source_type": finding.get("source_type"),
                "source_ref": finding.get("source_ref"), "method": finding.get("method"),
                "confidence": finding.get("confidence"), "status": "unreviewed",
                "reviewer_note": None, "created_at": db.now(),
                "reviewed_by": None, "reviewed_at": None,
            })
        for loc in locations:
            db.insert("locations", {
                "id": db.new_id("loc"), "call_id": call_id, "case_id": call.get("case_id"),
                "label": loc["label"], "lat": loc["lat"], "lon": loc["lon"],
                "accuracy_m": loc.get("accuracy_m"), "source_type": loc["source_type"],
                "source_detail": loc.get("source_detail"), "geocode_provider": loc.get("geocode_provider"),
                "verification_status": loc.get("verification_status", "unverified"),
                "created_at": db.now(),
            })
        for event in events:
            db.insert("audio_events", {
                "id": db.new_id("evt"), "call_id": call_id,
                "label": event["label"], "raw_label": event.get("raw_label"),
                "start_s": event["start_s"], "end_s": event["end_s"],
                "confidence": event.get("confidence"), "model": event.get("model"),
                "is_interpretation": int(event.get("is_interpretation", 0)),
                "created_at": db.now(),
            })

        analysis = {
            "emotion_summary": emotion_summary,
            "prosody": prosody,
            "speaker_count": speaker_count,
            "speaker_method": speaker_method,
            "urgency_contributions": contributions,
            "urgency_notes": urgency_notes,
            "limitations": limitations,
            "models": {
                "asr": f"faster-whisper {asr_model}",
                "translation": f"faster-whisper {translation_model} (translate task)" if language not in {"en", "eng"} else "not required (English)",
                "audio_events": config.AUDIO_EVENT_MODEL,
                "vocal_emotion": config.EMOTION_MODEL,
                "speaker": speaker_method,
                "sentiment": "bilingual lexicon v1 (transparent, not an LLM)",
            },
            "language_probability": language_prob,
            "duration_s": round(duration, 2),
            "word_count": len(original_text.split()),
        }
        db.update("calls", call_id, {
            "status": "analyzed", "priority": urgency_band, "urgency_score": urgency_score,
            "urgency_band": urgency_band, "language": language,
            "language_probability": language_prob, "transcript_provider": f"faster-whisper {asr_model}",
            "analysis_json": json.dumps(analysis, ensure_ascii=False), "processed_at": db.now(),
        })
        # Alerts are rule-driven and deduplicated.
        if urgency_band == "high":
            _insert_alert(call, "urgency", "high", "High urgency estimate",
                          f"Call {call_id[:8]} scored {urgency_score}/100. Review the contribution breakdown.", "high")
        for finding in matched:
            if finding["type"] in {"distress_phrase", "emergency_number"}:
                _insert_alert(call, "distress", "high", finding["title"],
                              f"Reference match at {finding.get('start_s', 0):.1f}s. {finding.get('quote') or ''}", finding.get("subtype") or "match")
            if finding["type"] == "discrepancy":
                _insert_alert(call, "discrepancy", "medium", finding["title"],
                              "Acoustic and transcript signals diverge. Human review required.", "divergence")
            if finding["type"] == "speaker_observation":
                _insert_alert(call, "speaker", "medium", finding["title"],
                              "Two acoustic speaker profiles were clustered. Verify by listening.", "speaker")
        db.update("jobs", job_id, {
            "status": "completed", "stage": "Complete", "progress": 100,
            "message": "Analysis complete", "finished_at": db.now(),
        })
        db.audit(None, "analysis_completed", "call", call_id, {"job_id": job_id, "urgency": urgency_score})
    except Exception as exc:
        db.update("calls", call_id, {"status": "failed", "error": str(exc)[:500]})
        db.update("jobs", job_id, {
            "status": "failed", "stage": "Failed", "error": str(exc)[:1000],
            "message": "Analysis failed. See details.", "finished_at": db.now(),
        })
        db.audit(None, "analysis_failed", "call", call_id, {"error": str(exc)[:500]})
        raise
