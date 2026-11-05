"""Telephony signaling, extension manager, and WebRTC coordination for local phone simulation."""
import json
import logging
import math
import random
import socket
import time
from typing import Dict, List, Optional
from fastapi import WebSocket, WebSocketDisconnect

from app import db, pipeline, guidance, config

logger = logging.getLogger("dhvani.telephony")

_ACTIVE_EXTENSION = "966"
_ACTIVE_CALLS: Dict[str, dict] = {}
_CONNECTED_OPERATORS: List[WebSocket] = []
_ACTIVE_SESSIONS: Dict[str, dict] = {}


def get_local_ip() -> str:
    """Detect the local Wi-Fi / LAN IP address."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def get_active_extension() -> str:
    return _ACTIVE_EXTENSION


def generate_extension() -> str:
    global _ACTIVE_EXTENSION
    presets = ["966", "007", "123", "415", "808", "555", "302", "911", "777", "212"]
    if random.random() > 0.5:
        choice = random.choice(presets)
        if choice != _ACTIVE_EXTENSION:
            _ACTIVE_EXTENSION = choice
            return _ACTIVE_EXTENSION
    _ACTIVE_EXTENSION = str(random.randint(100, 999))
    return _ACTIVE_EXTENSION


def validate_extension(ext: str) -> bool:
    if not ext:
        return False
    return str(ext).strip() == _ACTIVE_EXTENSION


def generate_synthetic_peaks(call_id: str, duration_s: float, num_peaks: int = 120) -> List[float]:
    """Labelled synthetic envelope for simulated calls that captured no audio.

    Ringback pulse at the start, speech-like bursts, taper at the end. Deterministic
    per call so the same call always renders the same shape.
    """
    rng = random.Random(abs(hash(call_id)))
    duration = max(1.0, float(duration_s or 0))
    _ = duration  # shape spans the timeline; absolute time not needed for the envelope
    peaks: List[float] = []
    for i in range(num_peaks):
        t = (i + 0.5) / num_peaks
        if t < 0.12:
            pulse = 0.55 if (int(t / 0.045) % 2 == 0) else 0.08
            v = pulse + rng.uniform(-0.03, 0.03)
        else:
            burst = max(0.0, math.sin(t * math.pi * 9 + rng.uniform(0, 0.6)) ** 2 * (0.45 + 0.5 * rng.random()))
            v = min(0.98, max(0.12, 0.16 + 0.74 * burst) + rng.uniform(-0.05, 0.05))
        if t > 0.955:
            v *= max(0.0, (1.0 - t) / 0.045)
        peaks.append(round(max(0.02, min(0.98, v)), 3))
    return peaks


def get_active_call() -> Optional[dict]:
    # Return first connected call if exists, else first ringing/active call
    connected = [c for c in _ACTIVE_CALLS.values() if c.get("status") == "connected"]
    if connected:
        return connected[0]
    if _ACTIVE_CALLS:
        return next(iter(_ACTIVE_CALLS.values()))
    return None


def get_call(call_id: str) -> Optional[dict]:
    return _ACTIVE_CALLS.get(call_id)


def get_active_calls() -> Dict[str, dict]:
    return _ACTIVE_CALLS


def has_connected_call() -> bool:
    return any(c.get("status") == "connected" for c in _ACTIVE_CALLS.values())


def start_call(extension: str, caller_name: str = "Mobile Smartphone") -> dict:
    call_id = f"call_sim_{int(time.time())}_{random.randint(100, 999)}"
    now = db.now()
    
    # Insert call record into OG SQLite calls table
    db.insert("calls", {
        "id": call_id,
        "audio_name": f"{call_id}.wav",
        "stored_name": f"{call_id}.wav",
        "original_filename": f"Incoming Call (Ext {extension})",
        "sha256": "simulated_local_call_stream",
        "source_label": f"Mobile Call · Ext {extension}",
        "source_type": "telephony_sim",
        "is_simulated": 1,
        "priority": "unscored",
        "urgency_score": None,
        "language": "en",
        "duration_s": 0.0,
        "status": "processing",
        "created_at": now,
    })

    call_data = {
        "id": call_id,
        "extension": extension,
        "caller_name": caller_name,
        "status": "ringing",
        "started_at": time.time(),
        "answered_at": None,
        "ended_at": None,
        "duration_s": 0,
        "transcripts": [],
    }
    _ACTIVE_CALLS[call_id] = call_data
    return call_data


def answer_call(call_id: str) -> Optional[dict]:
    call = _ACTIVE_CALLS.get(call_id)
    if not call:
        return None
    call["status"] = "connected"
    call["answered_at"] = time.time()
    return call


def end_call(call_id: str, ended_by: str = "caller") -> Optional[dict]:
    call = _ACTIVE_CALLS.pop(call_id, None)
    if not call:
        return None
    now_ts = time.time()
    duration = round(now_ts - (call["answered_at"] or call["started_at"]), 1)
    call["status"] = "completed"
    call["ended_at"] = now_ts
    call["duration_s"] = max(1.0, duration)
    call["ended_by"] = ended_by

    # Update in OG SQLite database
    row = db.query_one("SELECT waveform_json FROM calls WHERE id=?", (call_id,))
    has_waveform = bool(row and row.get("waveform_json"))
    update = {
        "duration_s": call["duration_s"],
        "status": "analyzed",
        "priority": "high" if len(call.get("transcripts", [])) >= 2 else "medium",
        "urgency_score": 88 if any("pizza" in t.get("text", "").lower() for t in call.get("transcripts", [])) else 45,
    }
    if not has_waveform:
        # No captured audio (e.g. WebRTC track never negotiated): give the call
        # detail panel a labelled synthetic envelope instead of a dead flat bar.
        update["waveform_json"] = json.dumps(generate_synthetic_peaks(call_id, call["duration_s"]))
    db.update("calls", call_id, update)

    return call


def reject_call(call_id: str) -> Optional[dict]:
    call = _ACTIVE_CALLS.pop(call_id, None)
    if not call:
        return None
    call["status"] = "rejected"
    call["ended_at"] = time.time()

    db.update("calls", call_id, {
        "status": "failed",
        "priority": "low",
        "error": "Call rejected by operator"
    })

    return call


def transfer_call(call_id: str, destination: str = "Secondary Dispatch Desk / Officer Patel") -> Optional[dict]:
    """Transfer an incoming call (e.g. from call waiting) to another dispatch queue/desk."""
    call = _ACTIVE_CALLS.pop(call_id, None)
    if not call:
        return None
    now_ts = time.time()
    call["status"] = "transferred"
    call["transferred_to"] = destination
    call["ended_at"] = now_ts

    db.update("calls", call_id, {
        "status": "processing",
        "priority": "high",
        "source_label": f"Transferred to {destination}",
        "error": f"Transferred to {destination} (Hold Queue)"
    })

    return call


class TelephonyHub:
    """Manages WebSocket connections between mobile dialers and OG dashboard operators."""

    def __init__(self):
        self.operators: List[WebSocket] = []
        self.dialers: Dict[str, WebSocket] = {}
        self.operator_target_lang: str = "hi"

    def set_operator_target_lang(self, lang: str):
        self.operator_target_lang = lang or "hi"

    def get_operator_target_lang(self) -> str:
        return self.operator_target_lang or "hi"

    async def register_operator(self, websocket: WebSocket):
        if websocket not in self.operators:
            self.operators.append(websocket)
        local_ip = get_local_ip()
        await websocket.send_json({
            "type": "operator_ready",
            "extension": get_active_extension(),
            "local_ip": local_ip,
            "port": 8000,
            "active_call": get_active_call(),
            "active_calls_count": len(_ACTIVE_CALLS),
        })

    def unregister_operator(self, websocket: WebSocket):
        if websocket in self.operators:
            self.operators.remove(websocket)

    def register_dialer(self, dialer_id: str, websocket: WebSocket):
        self.dialers[dialer_id] = websocket

    def unregister_dialer(self, dialer_id: str):
        self.dialers.pop(dialer_id, None)

    async def broadcast_operators(self, message: dict):
        dead = []
        for ws in self.operators:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.unregister_operator(ws)

    async def send_to_dialer(self, dialer_id: str, message: dict):
        ws = self.dialers.get(dialer_id)
        if ws:
            try:
                await ws.send_json(message)
            except Exception:
                self.unregister_dialer(dialer_id)


hub = TelephonyHub()


def save_call_audio(call_id: str, file_bytes: bytes, original_name: str = "call.webm") -> dict:
    """Save recorded phone call audio, convert to 16kHz mono WAV, and extract forensic acoustics."""
    import subprocess
    import tempfile
    from pathlib import Path
    from . import acoustic_engine

    upload_dir = config.UPLOAD_DIR
    upload_dir.mkdir(parents=True, exist_ok=True)
    out_wav_path = upload_dir / f"{call_id}.wav"

    suffix = Path(original_name).suffix or ".webm"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = Path(tmp.name)

    try:
        # Convert to 16kHz mono WAV via ffmpeg
        cmd = [
            "ffmpeg", "-y", "-i", str(tmp_path),
            "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
            str(out_wav_path)
        ]
        subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        if not out_wav_path.exists() or out_wav_path.stat().st_size == 0:
            out_wav_path.write_bytes(file_bytes)
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass

    # Extract acoustic metrics & waveform peaks
    acoustics = acoustic_engine.analyze_audio_file(out_wav_path)
    duration = acoustics.get("duration_s") or 5.0
    peaks = acoustic_engine.generate_waveform_peaks(out_wav_path, num_peaks=120)

    db.update("calls", call_id, {
        "status": "completed",
        "duration_s": duration,
        "sample_rate": 16000,
        "waveform_json": json.dumps(peaks),
        "analysis_json": json.dumps(acoustics),
    })

    return {
        "ok": True,
        "call_id": call_id,
        "duration_s": duration,
        "audio_name": f"{call_id}.wav",
        "audio_url": f"/api/calls/{call_id}/audio",
        "acoustics": acoustics,
        "peaks": peaks,
    }
