"""Orbitwin FastAPI application."""
from __future__ import annotations

import json
import math
import re
import tempfile
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import auth, config, db, gemini, geo, jobs, models, reports, storage
from .phrases import load_pack

VERSION = "1.0.0"


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    auth.seed_demo_user()
    jobs.start_worker()
    yield


app = FastAPI(title="Dhvani Emergency Response Intelligence", version=VERSION, lifespan=lifespan)


@app.middleware("http")
async def require_authenticated_api(request: Request, call_next):
    path = request.url.path
    if config.AUTH_ENABLED and path.startswith("/api/") and path not in {"/api/auth/login", "/api/health", "/api/me"}:
        if not auth.current_user(request):
            return JSONResponse(status_code=401, content={"detail": "Authentication required"})
    return await call_next(request)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' data: https://tile.openstreetmap.org; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; "
        "connect-src 'self'; media-src 'self'; frame-ancestors 'none'",
    )
    return response


@app.exception_handler(Exception)
async def unhandled_exception(request: Request, exc: Exception):
    return JSONResponse(status_code=500, content={"detail": "An unexpected server error occurred. Check the server log."})


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

class LoginBody(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=200)


@app.post("/api/auth/login")
def login(body: LoginBody, request: Request, response: Response):
    if not config.AUTH_ENABLED:
        user = auth.demo_user()
        return {"user": user, "csrf": "local", "auth_enabled": False}
    key = auth.throttle_key(request, body.username)
    auth.check_login_throttle(key)
    result = auth.login(body.username, body.password)
    if not result:
        auth.record_login_failure(key)
        raise HTTPException(status_code=401, detail="Invalid username or password")
    auth.clear_login_failures(key)
    user, session_id, csrf = result
    auth.set_session_cookie(response, session_id)
    db.audit(user["id"], "login", "user", user["id"])
    return {"user": user, "csrf": csrf, "auth_enabled": True}


@app.post("/api/auth/logout")
def logout(request: Request, response: Response, user: dict = Depends(auth.require_csrf)):
    auth.logout(request)
    auth.clear_session_cookie(response)
    db.audit(user["id"], "logout", "user", user["id"])
    return {"ok": True}


@app.get("/api/me")
def me(request: Request):
    user = auth.current_user(request)
    if not user:
        return {"user": None, "csrf": None, "auth_enabled": config.AUTH_ENABLED}
    public = {k: user[k] for k in ("id", "username", "display_name", "role")}
    return {"user": public, "csrf": user.get("csrf", "local"), "auth_enabled": config.AUTH_ENABLED}


# ---------------------------------------------------------------------------
# Serialisation helpers
# ---------------------------------------------------------------------------

def _public_call(call: dict) -> dict:
    keys = (
        "id", "case_id", "source_type", "source_label", "is_simulated", "original_filename",
        "sha256", "mime", "size_bytes", "duration_s", "status", "priority", "urgency_score",
        "urgency_band", "language", "language_probability", "transcript_provider",
        "consent_note", "created_at", "processed_at", "error",
    )
    out = {k: call.get(k) for k in keys}
    out["short_id"] = (call.get("id") or "")[:8].upper()
    return out


def _public_finding(f: dict) -> dict:
    return {k: f.get(k) for k in (
        "id", "call_id", "case_id", "type", "subtype", "title", "description", "start_s", "end_s",
        "quote", "source_type", "source_ref", "method", "confidence", "status", "reviewer_note",
        "created_at", "reviewed_by", "reviewed_at",
    )}


def _public_location(l: dict) -> dict:
    return {k: l.get(k) for k in (
        "id", "call_id", "case_id", "label", "lat", "lon", "accuracy_m", "source_type",
        "source_detail", "geocode_provider", "verification_status", "created_at",
    )}


def _public_event(e: dict) -> dict:
    return {k: e.get(k) for k in (
        "id", "call_id", "label", "raw_label", "start_s", "end_s", "confidence", "model",
        "is_interpretation", "created_at",
    )}


def _call_detail(call_id: str) -> dict:
    call = db.query_one("SELECT * FROM calls WHERE id=?", (call_id,))
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    transcript = db.query_one("SELECT * FROM transcripts WHERE call_id=?", (call_id,))
    segments = db.query("SELECT * FROM segments WHERE call_id=? ORDER BY idx", (call_id,))
    findings = db.query("SELECT * FROM findings WHERE call_id=? ORDER BY start_s", (call_id,))
    locations = db.query("SELECT * FROM locations WHERE call_id=? ORDER BY created_at", (call_id,))
    events = db.query("SELECT * FROM audio_events WHERE call_id=? ORDER BY start_s", (call_id,))
    job = db.query_one("SELECT * FROM jobs WHERE call_id=? ORDER BY created_at DESC LIMIT 1", (call_id,))
    analysis = {}
    if call.get("analysis_json"):
        try:
            analysis = json.loads(call["analysis_json"])
        except json.JSONDecodeError:
            analysis = {}
    case = db.query_one("SELECT id, case_number, title, status, priority FROM cases WHERE id=?", (call["case_id"],)) if call.get("case_id") else None
    return {
        "call": _public_call(call),
        "transcript": transcript,
        "segments": segments,
        "findings": [_public_finding(f) for f in findings],
        "locations": [_public_location(l) for l in locations],
        "audio_events": [_public_event(e) for e in events],
        "analysis": analysis,
        "job": job,
        "case": case,
        "waveform": json.loads(call["waveform_json"]) if call.get("waveform_json") else [],
    }


def _case_summary(case: dict) -> dict:
    calls = db.query("SELECT id, status, priority, urgency_score, is_simulated FROM calls WHERE case_id=?", (case["id"],))
    findings = db.query("SELECT COUNT(*) AS n FROM findings WHERE case_id=?", (case["id"],))[0]["n"]
    return {
        **{k: case.get(k) for k in ("id", "case_number", "title", "summary", "status", "priority", "created_at", "updated_at", "closed_at")},
        "call_count": len(calls),
        "finding_count": findings,
        "high_priority_calls": sum(1 for c in calls if c.get("priority") == "high"),
    }


# ---------------------------------------------------------------------------
# Calls / jobs
# ---------------------------------------------------------------------------

@app.get("/api/calls")
def list_calls(q: str = "", priority: str = "", status: str = ""):
    sql = "SELECT * FROM calls WHERE 1=1"
    params: list = []
    if q:
        sql += " AND (source_label LIKE ? OR original_filename LIKE ? OR id LIKE ?)"
        params += [f"%{q}%", f"%{q}%", f"%{q}%"]
    if priority and priority != "all":
        sql += " AND priority=?"
        params.append(priority)
    if status and status != "all":
        sql += " AND status=?"
        params.append(status)
    sql += " ORDER BY CASE WHEN urgency_score IS NULL THEN 1 ELSE 0 END, urgency_score DESC, created_at DESC"
    rows = db.query(sql, params)
    return {"calls": [_public_call(c) for c in rows]}


@app.get("/api/calls/{call_id}")
def get_call(call_id: str):
    return _call_detail(call_id)


@app.get("/api/calls/{call_id}/audio")
def get_audio(call_id: str, request: Request):
    call = db.query_one("SELECT audio_name FROM calls WHERE id=?", (call_id,))
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    path = config.UPLOAD_DIR / Path(call["audio_name"]).name
    if not path.exists():
        raise HTTPException(status_code=404, detail="Audio file is no longer available")
    size = path.stat().st_size
    range_header = request.headers.get("range")
    if range_header:
        match = re.match(r"bytes=(\d*)-(\d*)", range_header)
        if not match:
            raise HTTPException(status_code=416, detail="Invalid range")
        start = int(match.group(1) or 0)
        end = int(match.group(2) or size - 1)
        end = min(end, size - 1)
        if start >= size or start > end:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})
        with path.open("rb") as handle:
            handle.seek(start)
            data = handle.read(end - start + 1)
        return Response(
            content=data,
            status_code=206,
            media_type="audio/wav",
            headers={
                "Content-Range": f"bytes {start}-{end}/{size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(len(data)),
            },
        )
    return FileResponse(path, media_type="audio/wav", headers={"Accept-Ranges": "bytes"})


@app.get("/api/calls/{call_id}/waveform")
def get_waveform(call_id: str):
    row = db.query_one("SELECT waveform_json FROM calls WHERE id=?", (call_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Call not found")
    return {"peaks": json.loads(row["waveform_json"]) if row["waveform_json"] else []}


@app.post("/api/calls/upload")
async def upload_call(
    request: Request,
    file: UploadFile = File(...),
    source_label: str = Form(""),
    case_id: str = Form(""),
    consent_note: str = Form(""),
    user: dict = Depends(auth.require_csrf),
):
    if case_id and not db.query_one("SELECT id FROM cases WHERE id=?", (case_id,)):
        raise HTTPException(status_code=400, detail="Case not found")
    stored = await storage.save_upload(file)
    call_id = stored["call_id"]
    label = (source_label or stored["original_filename"])[:200]
    db.insert("calls", {
        "id": call_id,
        "case_id": case_id or None,
        "source_type": "upload",
        "source_label": label,
        "is_simulated": 0,
        "original_filename": stored["original_filename"],
        "stored_name": stored["original_name"],
        "audio_name": stored["audio_name"],
        "sha256": stored["sha256"],
        "mime": stored["mime"],
        "size_bytes": stored["size_bytes"],
        "duration_s": stored["duration_s"],
        "sample_rate": stored["sample_rate"],
        "status": "queued",
        "priority": "unscored",
        "waveform_json": json.dumps(stored["waveform"]),
        "consent_note": consent_note[:500] or "Investigator confirmed authorisation to process this recording.",
        "created_at": db.now(),
    })
    job = jobs.enqueue(call_id)
    db.audit(user["id"], "call_uploaded", "call", call_id, {"filename": stored["original_filename"], "sha256": stored["sha256"]})
    return {"ok": True, "call": _public_call(db.query_one("SELECT * FROM calls WHERE id=?", (call_id,))), "job": job}


_live_lock = threading.Lock()
_live_user_events: dict[str, list[float]] = {}
_live_sessions: dict[str, dict] = {}


def _check_live_limits(user_id: str, session_id: str) -> None:
    now = time.time()
    with _live_lock:
        events = [t for t in _live_user_events.get(user_id, []) if now - t < 60]
        if len(events) >= config.LIVE_RATE_LIMIT_PER_MINUTE:
            raise HTTPException(status_code=429, detail="Live transcription rate limit reached. Wait a moment or stop and analyse locally.")
        events.append(now)
        _live_user_events[user_id] = events

        state = _live_sessions.get(session_id)
        if state and state.get("user_id") != user_id:
            raise HTTPException(status_code=403, detail="This live session belongs to another user.")
        if not state:
            state = {"user_id": user_id, "started": now, "chunks": 0}
            _live_sessions[session_id] = state
        if now - state["started"] > config.LIVE_MAX_SECONDS + 30:
            raise HTTPException(status_code=429, detail="Live session time limit reached. Stop and analyse the recording.")
        max_chunks = math.ceil(config.LIVE_MAX_SECONDS / config.LIVE_CHUNK_SECONDS) + 2
        if state["chunks"] >= max_chunks:
            raise HTTPException(status_code=429, detail="Live session chunk limit reached. Stop and analyse the recording.")
        state["chunks"] += 1

        # Keep the in-memory limiter bounded during a long-running process.
        if len(_live_sessions) > 200:
            cutoff = now - config.LIVE_MAX_SECONDS - 300
            for key in [k for k, v in _live_sessions.items() if v.get("started", 0) < cutoff]:
                _live_sessions.pop(key, None)


@app.get("/api/live/config")
def live_config():
    return {
        "configured": gemini.configured(),
        "provider": "Google Gemini",
        "model": config.GEMINI_MODEL,
        "chunk_seconds": config.LIVE_CHUNK_SECONDS,
        "max_seconds": config.LIVE_MAX_SECONDS,
        "privacy": "While live mode is active, microphone audio is sent to Google Gemini for provisional transcription. Final analysis and evidence storage remain local.",
    }


@app.post("/api/live/transcribe")
def live_transcribe(
    audio: UploadFile = File(...),
    session_id: str = Form(...),
    chunk_index: int = Form(0),
    language_hint: str = Form("auto"),
    user: dict = Depends(auth.require_csrf),
):
    if not gemini.configured():
        raise HTTPException(status_code=503, detail="Gemini live transcription is not configured. Add GEMINI_API_KEY to the server .env, or record and analyse locally.")
    if not re.fullmatch(r"[A-Za-z0-9_-]{8,80}", session_id or ""):
        raise HTTPException(status_code=400, detail="Invalid live session id.")
    if chunk_index < 0 or chunk_index > 10000:
        raise HTTPException(status_code=400, detail="Invalid live chunk index.")
    _check_live_limits(user["id"], session_id)

    raw = audio.file.read(config.LIVE_MAX_CHUNK_BYTES + 1)
    if not raw:
        raise HTTPException(status_code=400, detail="The live audio chunk is empty.")
    if len(raw) > config.LIVE_MAX_CHUNK_BYTES:
        raise HTTPException(status_code=413, detail=f"Live chunk exceeds the {config.LIVE_MAX_CHUNK_MB} MB limit.")
    if audio.content_type and not audio.content_type.startswith(("audio/", "application/octet-stream")):
        raise HTTPException(status_code=400, detail="Unsupported live audio content type.")

    with tempfile.TemporaryDirectory(dir=str(config.UPLOAD_DIR)) as tmp:
        source = Path(tmp) / "live_chunk.wav"
        source.write_bytes(raw)
        try:
            meta = storage.probe_audio(source)
            duration = float(meta["duration_s"] or 0)
            if duration > config.LIVE_CHUNK_SECONDS + 8:
                raise HTTPException(status_code=400, detail="Live chunks must be short recordings.")
            normalized = Path(tmp) / "live_chunk_16k.wav"
            storage.convert_to_wav(source, normalized)
            wav_bytes = normalized.read_bytes()
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        result = gemini.transcribe_chunk(wav_bytes, language_hint)
    except gemini.GeminiUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if chunk_index == 0:
        db.audit(user["id"], "live_transcription_started", "live", session_id, {
            "model": result.get("model"), "chunk_seconds": config.LIVE_CHUNK_SECONDS,
        })
    return {
        "ok": True,
        "text": result.get("text", ""),
        "model": result.get("model"),
        "usage": result.get("usage") or {},
        "duration_s": round(duration, 2),
    }


@app.post("/api/calls/{call_id}/reprocess")
def reprocess_call(call_id: str, user: dict = Depends(auth.require_csrf)):
    call = db.query_one("SELECT * FROM calls WHERE id=?", (call_id,))
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    job = jobs.enqueue(call_id)
    db.audit(user["id"], "call_reprocess_requested", "call", call_id, {"job_id": job["id"]})
    return {"ok": True, "job": job}


@app.patch("/api/calls/{call_id}")
def update_call(call_id: str, body: dict, user: dict = Depends(auth.require_csrf)):
    call = db.query_one("SELECT * FROM calls WHERE id=?", (call_id,))
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    allowed = {}
    if "case_id" in body:
        case_id = body.get("case_id") or None
        if case_id and not db.query_one("SELECT id FROM cases WHERE id=?", (case_id,)):
            raise HTTPException(status_code=400, detail="Case not found")
        allowed["case_id"] = case_id
    if "source_label" in body:
        allowed["source_label"] = str(body["source_label"])[:200]
    if allowed:
        db.update("calls", call_id, allowed)
        if "case_id" in allowed:
            db.execute("UPDATE findings SET case_id=? WHERE call_id=?", (allowed["case_id"], call_id))
            db.execute("UPDATE locations SET case_id=? WHERE call_id=?", (allowed["case_id"], call_id))
        db.audit(user["id"], "call_updated", "call", call_id, allowed)
    return {"ok": True, "call": _public_call(db.query_one("SELECT * FROM calls WHERE id=?", (call_id,)))}


@app.delete("/api/calls/{call_id}")
def delete_call(call_id: str, user: dict = Depends(auth.require_csrf)):
    call = db.query_one("SELECT * FROM calls WHERE id=?", (call_id,))
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    db.execute("DELETE FROM calls WHERE id=?", (call_id,))
    storage.delete_call_files(call.get("stored_name"), call.get("audio_name"))
    db.audit(user["id"], "call_deleted", "call", call_id, {"sha256": call.get("sha256")})
    return {"ok": True}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    job = jobs.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"job": job}


# ---------------------------------------------------------------------------
# Findings / locations / events
# ---------------------------------------------------------------------------

class FindingReview(BaseModel):
    status: Literal["unreviewed", "confirmed", "dismissed"]
    note: str = Field(default="", max_length=2000)


@app.patch("/api/findings/{finding_id}")
def review_finding(finding_id: str, body: FindingReview, user: dict = Depends(auth.require_csrf)):
    finding = db.query_one("SELECT * FROM findings WHERE id=?", (finding_id,))
    if not finding:
        raise HTTPException(status_code=404, detail="Finding not found")
    db.update("findings", finding_id, {
        "status": body.status, "reviewer_note": body.note.strip() or None,
        "reviewed_by": user["display_name"], "reviewed_at": db.now(),
    })
    db.audit(user["id"], "finding_reviewed", "finding", finding_id, {"status": body.status})
    return {"ok": True, "finding": _public_finding(db.query_one("SELECT * FROM findings WHERE id=?", (finding_id,)))}


class LocationBody(BaseModel):
    label: str = Field(min_length=2, max_length=200)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    accuracy_m: float = Field(default=50, ge=0, le=100000)
    note: str = Field(default="", max_length=1000)


@app.post("/api/calls/{call_id}/locations")
def add_location(call_id: str, body: LocationBody, user: dict = Depends(auth.require_csrf)):
    call = db.query_one("SELECT * FROM calls WHERE id=?", (call_id,))
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    location_id = db.new_id("loc")
    db.insert("locations", {
        "id": location_id, "call_id": call_id, "case_id": call.get("case_id"),
        "label": body.label.strip(), "lat": body.lat, "lon": body.lon,
        "accuracy_m": body.accuracy_m, "source_type": "investigator",
        "source_detail": body.note.strip() or "Location entered manually by an investigator. Not derived from the caller's device.",
        "geocode_provider": "investigator", "verification_status": "investigator_entered",
        "created_at": db.now(),
    })
    db.audit(user["id"], "location_added", "call", call_id, {"label": body.label, "lat": body.lat, "lon": body.lon})
    return {"ok": True, "location": _public_location(db.query_one("SELECT * FROM locations WHERE id=?", (location_id,)))}


class LocationVerify(BaseModel):
    verification_status: Literal["unverified", "verified", "rejected", "investigator_entered"]


@app.patch("/api/locations/{location_id}")
def verify_location(location_id: str, body: LocationVerify, user: dict = Depends(auth.require_csrf)):
    location = db.query_one("SELECT * FROM locations WHERE id=?", (location_id,))
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    db.update("locations", location_id, {"verification_status": body.verification_status})
    db.audit(user["id"], "location_verified", "location", location_id, {"status": body.verification_status})
    return {"ok": True, "location": _public_location(db.query_one("SELECT * FROM locations WHERE id=?", (location_id,)))}


# ---------------------------------------------------------------------------
# Cases / notes / reports
# ---------------------------------------------------------------------------

class CaseBody(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    summary: str = Field(default="", max_length=4000)
    priority: Literal["low", "medium", "high"] = "medium"


class CaseUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=200)
    summary: str | None = Field(default=None, max_length=4000)
    status: Literal["open", "under_review", "closed"] | None = None
    priority: Literal["low", "medium", "high"] | None = None


class NoteBody(BaseModel):
    note: str = Field(min_length=1, max_length=4000)


@app.get("/api/cases")
def list_cases(q: str = "", status: str = ""):
    sql = "SELECT * FROM cases WHERE 1=1"
    params: list = []
    if q:
        sql += " AND (case_number LIKE ? OR title LIKE ? OR summary LIKE ?)"
        params += [f"%{q}%"] * 3
    if status and status != "all":
        sql += " AND status=?"
        params.append(status)
    sql += " ORDER BY updated_at DESC"
    return {"cases": [_case_summary(c) for c in db.query(sql, params)]}


@app.post("/api/cases")
def create_case(body: CaseBody, user: dict = Depends(auth.require_csrf)):
    year = datetime.now(timezone.utc).year
    count = db.query_one("SELECT COUNT(*) AS n FROM cases")["n"] + 1
    case_number = f"CASE-{year}-{count:04d}"
    case_id = db.new_id("case")
    timestamp = db.now()
    db.insert("cases", {
        "id": case_id, "case_number": case_number, "title": body.title.strip(),
        "summary": body.summary.strip(), "status": "open", "priority": body.priority,
        "created_by": user["display_name"], "created_at": timestamp,
        "updated_at": timestamp, "closed_at": None,
    })
    db.audit(user["id"], "case_created", "case", case_id, {"case_number": case_number})
    return {"ok": True, "case": _case_summary(db.query_one("SELECT * FROM cases WHERE id=?", (case_id,)))}


@app.get("/api/cases/{case_id}")
def get_case(case_id: str):
    case = db.query_one("SELECT * FROM cases WHERE id=?", (case_id,))
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    calls = [_public_call(c) for c in db.query("SELECT * FROM calls WHERE case_id=? ORDER BY created_at DESC", (case_id,))]
    notes = db.query("SELECT * FROM case_notes WHERE case_id=? ORDER BY created_at DESC", (case_id,))
    findings = db.query("SELECT * FROM findings WHERE case_id=? ORDER BY created_at DESC", (case_id,))
    return {"case": _case_summary(case), "calls": calls, "notes": notes,
            "findings": [_public_finding(f) for f in findings]}


@app.patch("/api/cases/{case_id}")
def update_case(case_id: str, body: CaseUpdate, user: dict = Depends(auth.require_csrf)):
    case = db.query_one("SELECT * FROM cases WHERE id=?", (case_id,))
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    changes = {k: v for k, v in body.model_dump().items() if v is not None}
    if "status" in changes:
        changes["closed_at"] = db.now() if changes["status"] == "closed" else None
    if changes:
        changes["updated_at"] = db.now()
        db.update("cases", case_id, changes)
        db.audit(user["id"], "case_updated", "case", case_id, changes)
    return {"ok": True, "case": _case_summary(db.query_one("SELECT * FROM cases WHERE id=?", (case_id,)))}


@app.delete("/api/cases/{case_id}")
def delete_case(case_id: str, user: dict = Depends(auth.require_csrf)):
    case = db.query_one("SELECT * FROM cases WHERE id=?", (case_id,))
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    count = db.query_one("SELECT COUNT(*) AS n FROM calls WHERE case_id=?", (case_id,))["n"]
    if count:
        raise HTTPException(status_code=400, detail="Unlink or delete calls before deleting this case.")
    db.execute("DELETE FROM cases WHERE id=?", (case_id,))
    db.audit(user["id"], "case_deleted", "case", case_id, {"case_number": case["case_number"]})
    return {"ok": True}


@app.post("/api/cases/{case_id}/notes")
def add_note(case_id: str, body: NoteBody, user: dict = Depends(auth.require_csrf)):
    case = db.query_one("SELECT id FROM cases WHERE id=?", (case_id,))
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    note_id = db.new_id("note")
    db.insert("case_notes", {
        "id": note_id, "case_id": case_id, "user_id": user["id"],
        "author": user["display_name"], "note": body.note.strip(), "created_at": db.now(),
    })
    db.execute("UPDATE cases SET updated_at=? WHERE id=?", (db.now(), case_id))
    db.audit(user["id"], "case_note_added", "case", case_id, {"note_id": note_id})
    return {"ok": True, "note": db.query_one("SELECT * FROM case_notes WHERE id=?", (note_id,))}


@app.get("/api/cases/{case_id}/report")
def download_report(case_id: str, format: str = "html", user: dict = Depends(auth.require_user)):
    data = reports.build_case_data(case_id)
    if not data:
        raise HTTPException(status_code=404, detail="Case not found")
    investigator = user["display_name"]
    case_number = data["case"]["case_number"]
    if format == "json":
        content = reports.render_report_json(data)
        media = "application/json"
        filename = f"{case_number}_evidence.json"
    else:
        content = reports.render_report_html(data, investigator)
        media = "text/html"
        filename = f"{case_number}_report.html"
    return Response(
        content=content,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# Alerts / search / status / demo
# ---------------------------------------------------------------------------

@app.get("/api/alerts")
def list_alerts(status: str = ""):
    sql = "SELECT * FROM alerts WHERE 1=1"
    params: list = []
    if status:
        sql += " AND status=?"
        params.append(status)
    sql += " ORDER BY created_at DESC LIMIT 100"
    return {"alerts": db.query(sql, params), "unread": db.query_one("SELECT COUNT(*) AS n FROM alerts WHERE status='unread'")["n"]}


class AlertAction(BaseModel):
    status: Literal["acknowledged", "dismissed"]


@app.patch("/api/alerts/{alert_id}")
def act_on_alert(alert_id: str, body: AlertAction, user: dict = Depends(auth.require_csrf)):
    alert = db.query_one("SELECT * FROM alerts WHERE id=?", (alert_id,))
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    db.update("alerts", alert_id, {
        "status": body.status, "acknowledged_by": user["display_name"], "acknowledged_at": db.now(),
    })
    db.audit(user["id"], "alert_" + body.status, "alert", alert_id)
    return {"ok": True}


@app.get("/api/search")
def search(q: str = ""):
    term = (q or "").strip()
    if len(term) < 2:
        return {"calls": [], "cases": [], "findings": []}
    like = f"%{term}%"
    # Search only persisted, reviewable records. Raw audio is never searched.
    calls = [_public_call(c) for c in db.query(
        "SELECT * FROM calls c WHERE c.source_label LIKE ? OR c.original_filename LIKE ? "
        "OR c.id LIKE ? OR c.language LIKE ? "
        "OR EXISTS (SELECT 1 FROM segments s WHERE s.call_id=c.id AND (s.text LIKE ? OR s.translation LIKE ?)) "
        "OR EXISTS (SELECT 1 FROM locations l WHERE l.call_id=c.id AND (l.label LIKE ? OR l.source_detail LIKE ?)) "
        "OR EXISTS (SELECT 1 FROM transcripts t WHERE t.call_id=c.id AND (t.text LIKE ? OR t.translation LIKE ?)) "
        "LIMIT 20",
        (like, like, like, like, like, like, like, like, like, like),
    )]
    cases = [_case_summary(c) for c in db.query(
        "SELECT * FROM cases WHERE case_number LIKE ? OR title LIKE ? OR summary LIKE ? LIMIT 20",
        (like, like, like),
    )]
    findings = [_public_finding(f) for f in db.query(
        "SELECT * FROM findings WHERE title LIKE ? OR quote LIKE ? OR description LIKE ? LIMIT 20",
        (like, like, like),
    )]
    return {"calls": calls, "cases": cases, "findings": findings}


@app.get("/api/stats")
def stats():
    queue = db.query_one("SELECT COUNT(*) AS n FROM calls WHERE status IN ('queued','processing')")["n"]
    active = db.query_one("SELECT COUNT(*) AS n FROM jobs WHERE status='running'")["n"]
    analyzed = db.query_one("SELECT COUNT(*) AS n FROM calls WHERE status='analyzed'")["n"]
    cases_open = db.query_one("SELECT COUNT(*) AS n FROM cases WHERE status != 'closed'")["n"]
    unread = db.query_one("SELECT COUNT(*) AS n FROM alerts WHERE status='unread'")["n"]
    avg = db.query_one(
        "SELECT AVG((julianday(finished_at)-julianday(started_at))*86400) AS v FROM jobs "
        "WHERE status='completed' AND started_at IS NOT NULL AND finished_at IS NOT NULL"
    )["v"]
    return {
        "calls_in_queue": queue, "active_analysis": active, "analyzed": analyzed,
        "open_cases": cases_open, "unread_alerts": unread,
        "avg_processing_seconds": round(float(avg), 1) if avg else None,
    }


@app.get("/api/config/status")
def config_status():
    pack = load_pack()
    scenarios = _demo_scenarios()
    return {
        "version": VERSION,
        "auth_enabled": config.AUTH_ENABLED,
        "models": models.model_status(),
        "map": {"provider": "Leaflet + Esri Satellite", "tile_url": config.MAP_TILE_URL, "attribution": config.MAP_ATTRIBUTION, "geocoder": "Nominatim with local gazetteer fallback", **geo.cache_summary()},
        "telephony": {"configured": config.TELEPHONY_CONFIGURED, "provider": config.TELEPHONY_PROVIDER,
                      "note": "No telephony provider is configured. Uploaded recordings and labelled synthetic demo scenarios are active. Auto-answer is not available."},
        "limits": {"max_upload_mb": config.MAX_UPLOAD_MB, "max_duration_seconds": config.MAX_DURATION_SECONDS},
        "live": {
            "configured": gemini.configured(),
            "provider": "Google Gemini",
            "model": config.GEMINI_MODEL,
            "chunk_seconds": config.LIVE_CHUNK_SECONDS,
            "max_seconds": config.LIVE_MAX_SECONDS,
            "privacy": "Microphone audio is sent to Google Gemini only while live mode is active. Final analysis and evidence storage remain local.",
        },
        "reference_pack": {"name": pack["pack"]["name"], "version": pack["pack"]["version"], "authority": pack["pack"]["authority"], "entries": len(pack["entries"])},
        "demo_scenarios": scenarios,
        "data_retention": "Local SQLite + local audio files. Delete a call to remove its recording and derived rows.",
    }


@app.get("/api/map/status")
def map_status():
    summary = geo.cache_summary()
    return {
        "provider": "Leaflet + Esri Satellite",
        "tile_url": config.MAP_TILE_URL,
        "attribution": config.MAP_ATTRIBUTION,
        "geocoder": "Nominatim with local gazetteer fallback",
        **summary,
        "note": "Map markers are caller-spoken landmarks, not device GPS. Tile availability depends on the network; cached demo landmarks are available without a live Nominatim call.",
    }


def _demo_scenarios() -> list[dict]:
    path = config.DEMO_DIR / "scenarios.json"
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data.get("scenarios", [])
    except Exception:
        return []


@app.get("/api/demo/scenarios")
def demo_scenarios():
    return {"scenarios": _demo_scenarios()}


@app.post("/api/demo/quick-start")
def demo_quick_start(user: dict = Depends(auth.require_csrf)):
    # Prioritize the user's covert pizza distress demo (demo video.mp3)
    call = db.query_one("SELECT * FROM calls WHERE id='call_covert_pizza_distress' AND status='analyzed'")
    if not call:
        call = db.query_one(
            "SELECT * FROM calls WHERE is_simulated=1 AND status='analyzed' AND (source_label LIKE '%pizza%' OR source_label LIKE '%Hinglish%' OR audio_name LIKE '%pizza%' OR audio_name LIKE '%hinglish%') ORDER BY created_at DESC LIMIT 1"
        )
    if not call:
        call = db.query_one("SELECT * FROM calls WHERE is_simulated=1 AND status='analyzed' ORDER BY created_at DESC LIMIT 1")
    if not call:
        call = db.query_one("SELECT * FROM calls WHERE source_type='demo' ORDER BY created_at DESC LIMIT 1")
    if not call:
        res = load_demo("covert_pizza_distress", user)
        call_id = res["call"]["id"]
        call = db.query_one("SELECT * FROM calls WHERE id=?", (call_id,))
    else:
        call_id = call["id"]

    case = None
    if call and call.get("case_id"):
        case = db.query_one("SELECT * FROM cases WHERE id=?", (call["case_id"],))
    if not case:
        case = db.query_one("SELECT * FROM cases WHERE case_number IN ('CASE-2026-0002', 'CASE-2026-0001') ORDER BY created_at DESC LIMIT 1")
        if case and call and not call.get("case_id"):
            db.execute("UPDATE calls SET case_id=? WHERE id=?", (case["id"], call_id))

    db.audit(user["id"], "quick_demo_started", "call", call_id, {})
    return {
        "ok": True,
        "call_id": call_id,
        "case_id": case["id"] if case else None,
        "detail": _call_detail(call_id),
    }


@app.post("/api/demo/{scenario_id}")
def load_demo(scenario_id: str, user: dict = Depends(auth.require_csrf)):
    scenarios = {s["id"]: s for s in _demo_scenarios()}
    scenario = scenarios.get(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="Demo scenario not found")
    source = config.DEMO_DIR / Path(scenario["file"]).name
    stored = storage.ingest_demo_file(source, scenario_id)
    call_id = stored["call_id"]
    db.insert("calls", {
        "id": call_id, "case_id": None, "source_type": "demo",
        "source_label": scenario["title"], "is_simulated": 1,
        "original_filename": stored["original_filename"], "stored_name": stored["original_name"],
        "audio_name": stored["audio_name"], "sha256": stored["sha256"], "mime": stored["mime"],
        "size_bytes": stored["size_bytes"], "duration_s": stored["duration_s"],
        "sample_rate": stored["sample_rate"], "status": "queued", "priority": "unscored",
        "waveform_json": json.dumps(stored["waveform"]),
        "consent_note": scenario.get("consent_note", "Synthetic demonstration audio. Not a real emergency call."),
        "created_at": db.now(),
    })
    job = jobs.enqueue(call_id)
    db.audit(user["id"], "demo_loaded", "call", call_id, {"scenario": scenario_id})
    return {"ok": True, "call": _public_call(db.query_one("SELECT * FROM calls WHERE id=?", (call_id,))), "job": job, "scenario": scenario}


@app.post("/api/calls/{call_id}/confirm-all-findings")
def confirm_all_findings(call_id: str, user: dict = Depends(auth.require_csrf)):
    db.execute(
        "UPDATE findings SET status='confirmed', reviewed_by=?, reviewed_at=? WHERE call_id=?",
        (user["display_name"], db.now(), call_id),
    )
    db.audit(user["id"], "all_findings_confirmed", "call", call_id, {})
    count = db.query_one("SELECT COUNT(*) AS n FROM findings WHERE call_id=? AND status='confirmed'", (call_id,))["n"]
    return {"ok": True, "count": count}


@app.post("/api/telephony/incoming")
def telephony_incoming():
    if not config.TELEPHONY_CONFIGURED:
        raise HTTPException(
            status_code=503,
            detail="Telephony is not configured. Dhvani will not pretend to auto-answer a real call. Use an uploaded recording or a labelled demo scenario.",
        )
    raise HTTPException(
        status_code=501,
        detail="A telephony provider is configured but no provider-specific adapter is implemented in this build. Uploaded recordings remain available.",
    )


@app.get("/api/health")
def health():
    return {"ok": True, "version": VERSION, "time": db.now()}


@app.get("/api/reference-pack")
def reference_pack():
    return load_pack()


# ---------------------------------------------------------------------------
# Static frontend
# ---------------------------------------------------------------------------

app.mount("/static", StaticFiles(directory=str(config.STATIC_DIR)), name="static")


@app.get("/")
def landing():
    if not config.LANDING.exists():
        raise HTTPException(status_code=500, detail="Landing page file missing")
    return FileResponse(config.LANDING, media_type="text/html")


@app.get("/console")
def console():
    if not config.FRONTEND.exists():
        raise HTTPException(status_code=500, detail="Frontend file missing")
    return FileResponse(config.FRONTEND, media_type="text/html")


@app.get("/Orbitwin_Emergency_Response_Intelligence.html")
def legacy_console():
    return RedirectResponse(url="/console", status_code=307)


@app.get("/favicon.ico")
def favicon():
    return Response(status_code=204)
