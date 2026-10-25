"""Safe audio ingestion, validation, conversion and waveform peaks."""
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import uuid
import wave
from pathlib import Path

from fastapi import HTTPException, UploadFile

from . import config


def _run(cmd: list[str], timeout: int = 120) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)


def probe_audio(path: Path) -> dict:
    result = _run([
        "ffprobe", "-v", "error", "-print_format", "json",
        "-show_format", "-show_streams", str(path),
    ], timeout=60)
    if result.returncode != 0:
        raise ValueError("The file is not a readable audio recording.")
    try:
        data = json.loads(result.stdout or "{}")
    except json.JSONDecodeError as exc:
        raise ValueError("The audio metadata could not be read.") from exc
    streams = [s for s in data.get("streams", []) if s.get("codec_type") == "audio"]
    if not streams:
        raise ValueError("No audio stream was found in this file.")
    duration = float(data.get("format", {}).get("duration") or streams[0].get("duration") or 0)
    if duration <= 0.2:
        raise ValueError("The recording is too short to analyse.")
    if duration > config.MAX_DURATION_SECONDS:
        raise ValueError(f"Recording exceeds the {config.MAX_DURATION_SECONDS}s limit.")
    return {"duration_s": round(duration, 2), "stream": streams[0]}


def convert_to_wav(source: Path, target: Path) -> None:
    result = _run([
        "ffmpeg", "-y", "-v", "error", "-i", str(source),
        "-vn", "-ac", "1", "-ar", "16000", "-acodec", "pcm_s16le", str(target),
    ], timeout=180)
    if result.returncode != 0 or not target.exists() or target.stat().st_size < 1000:
        raise ValueError("Audio conversion failed. Please upload a supported recording.")


def waveform_peaks(wav_path: Path, bins: int = 640) -> list[float]:
    try:
        with wave.open(str(wav_path), "rb") as wf:
            frames = wf.readframes(wf.getnframes())
            width = wf.getsampwidth()
        if width != 2:
            return []
        import numpy as np

        samples = np.frombuffer(frames, dtype=np.int16).astype("float32") / 32768.0
        if samples.size == 0:
            return []
        chunk = max(1, samples.size // bins)
        trimmed = samples[: chunk * bins].reshape(bins, chunk)
        peaks = np.max(np.abs(trimmed), axis=1)
        scale = float(peaks.max()) or 1.0
        return [round(float(v / scale), 4) for v in peaks]
    except Exception:
        return []


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def safe_extension(filename: str) -> str:
    suffix = Path(filename or "").suffix.lower()
    if suffix not in config.ALLOWED_EXTENSIONS:
        allowed = ", ".join(sorted(config.ALLOWED_EXTENSIONS))
        raise HTTPException(status_code=400, detail=f"Unsupported file type. Allowed: {allowed}")
    return suffix


async def save_upload(upload: UploadFile) -> dict:
    suffix = safe_extension(upload.filename or "")
    mime = (upload.content_type or "").lower()
    if mime and not mime.startswith(config.ALLOWED_MIME_PREFIXES):
        raise HTTPException(status_code=400, detail="Unsupported content type.")
    call_id = uuid.uuid4().hex
    original_name = f"{call_id}_original{suffix}"
    original_path = config.UPLOAD_DIR / original_name
    total = 0
    try:
        with original_path.open("wb") as out:
            while True:
                block = await upload.read(1024 * 1024)
                if not block:
                    break
                total += len(block)
                if total > config.MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail=f"File exceeds the {config.MAX_UPLOAD_MB} MB limit.")
                out.write(block)
    except HTTPException:
        original_path.unlink(missing_ok=True)
        raise
    if total == 0:
        original_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    try:
        meta = probe_audio(original_path)
        wav_path = config.UPLOAD_DIR / f"{call_id}.wav"
        convert_to_wav(original_path, wav_path)
        peaks = waveform_peaks(wav_path)
        digest = sha256_file(original_path)
    except ValueError as exc:
        original_path.unlink(missing_ok=True)
        (config.UPLOAD_DIR / f"{call_id}.wav").unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "call_id": call_id,
        "original_filename": upload.filename or original_name,
        "original_name": original_name,
        "audio_name": f"{call_id}.wav",
        "sha256": digest,
        "mime": mime,
        "size_bytes": total,
        "duration_s": meta["duration_s"],
        "sample_rate": int(meta["stream"].get("sample_rate") or 16000),
        "waveform": peaks,
    }


def ingest_demo_file(source: Path, scenario_id: str) -> dict:
    if not source.exists():
        raise HTTPException(status_code=404, detail="Demo recording not found.")
    call_id = uuid.uuid4().hex
    suffix = source.suffix.lower() or ".wav"
    original_name = f"{call_id}_original{suffix}"
    original_path = config.UPLOAD_DIR / original_name
    shutil.copyfile(source, original_path)
    meta = probe_audio(original_path)
    wav_path = config.UPLOAD_DIR / f"{call_id}.wav"
    convert_to_wav(original_path, wav_path)
    return {
        "call_id": call_id,
        "original_filename": source.name,
        "original_name": original_name,
        "audio_name": f"{call_id}.wav",
        "sha256": sha256_file(original_path),
        "mime": "audio/wav",
        "size_bytes": original_path.stat().st_size,
        "duration_s": meta["duration_s"],
        "sample_rate": int(meta["stream"].get("sample_rate") or 16000),
        "waveform": waveform_peaks(wav_path),
    }


def delete_call_files(original_name: str | None, audio_name: str | None) -> None:
    if original_name:
        (config.UPLOAD_DIR / Path(original_name).name).unlink(missing_ok=True)
    if audio_name:
        (config.UPLOAD_DIR / Path(audio_name).name).unlink(missing_ok=True)
