"""SQLite persistence layer. Small, explicit, transactional."""
from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterable

from .config import DB_PATH

SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'Investigator',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    csrf_token TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cases (
    id TEXT PRIMARY KEY,
    case_number TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    priority TEXT NOT NULL DEFAULT 'medium',
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    closed_at TEXT
);

CREATE TABLE IF NOT EXISTS case_notes (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL,
    user_id TEXT,
    author TEXT NOT NULL,
    note TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS calls (
    id TEXT PRIMARY KEY,
    case_id TEXT,
    source_type TEXT NOT NULL DEFAULT 'upload',
    source_label TEXT NOT NULL DEFAULT 'Uploaded recording',
    is_simulated INTEGER NOT NULL DEFAULT 0,
    original_filename TEXT,
    stored_name TEXT NOT NULL,
    audio_name TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    mime TEXT,
    size_bytes INTEGER,
    duration_s REAL,
    sample_rate INTEGER,
    status TEXT NOT NULL DEFAULT 'queued',
    priority TEXT NOT NULL DEFAULT 'unscored',
    urgency_score REAL,
    urgency_band TEXT,
    language TEXT,
    language_probability REAL,
    transcript_provider TEXT,
    waveform_json TEXT,
    analysis_json TEXT,
    consent_note TEXT,
    created_at TEXT NOT NULL,
    processed_at TEXT,
    error TEXT,
    FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    call_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    stage TEXT NOT NULL DEFAULT 'Queued',
    progress REAL NOT NULL DEFAULT 0,
    message TEXT NOT NULL DEFAULT '',
    error TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    FOREIGN KEY(call_id) REFERENCES calls(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS transcripts (
    id TEXT PRIMARY KEY,
    call_id TEXT NOT NULL,
    language TEXT,
    text TEXT NOT NULL,
    translation TEXT,
    provider TEXT,
    model TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(call_id) REFERENCES calls(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS segments (
    id TEXT PRIMARY KEY,
    call_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    start_s REAL NOT NULL,
    end_s REAL NOT NULL,
    speaker TEXT,
    text TEXT NOT NULL,
    translation TEXT,
    language TEXT,
    sentiment TEXT,
    sentiment_score REAL,
    vocal_emotion TEXT,
    vocal_confidence REAL,
    method TEXT,
    FOREIGN KEY(call_id) REFERENCES calls(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS findings (
    id TEXT PRIMARY KEY,
    call_id TEXT NOT NULL,
    case_id TEXT,
    type TEXT NOT NULL,
    subtype TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    start_s REAL,
    end_s REAL,
    quote TEXT,
    source_type TEXT,
    source_ref TEXT,
    method TEXT,
    confidence REAL,
    status TEXT NOT NULL DEFAULT 'unreviewed',
    reviewer_note TEXT,
    created_at TEXT NOT NULL,
    reviewed_by TEXT,
    reviewed_at TEXT,
    FOREIGN KEY(call_id) REFERENCES calls(id) ON DELETE CASCADE,
    FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS locations (
    id TEXT PRIMARY KEY,
    call_id TEXT NOT NULL,
    case_id TEXT,
    label TEXT NOT NULL,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    accuracy_m REAL,
    source_type TEXT NOT NULL,
    source_detail TEXT,
    geocode_provider TEXT,
    verification_status TEXT NOT NULL DEFAULT 'unverified',
    created_at TEXT NOT NULL,
    FOREIGN KEY(call_id) REFERENCES calls(id) ON DELETE CASCADE,
    FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS audio_events (
    id TEXT PRIMARY KEY,
    call_id TEXT NOT NULL,
    label TEXT NOT NULL,
    raw_label TEXT,
    start_s REAL NOT NULL,
    end_s REAL NOT NULL,
    confidence REAL,
    model TEXT,
    is_interpretation INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY(call_id) REFERENCES calls(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    call_id TEXT,
    case_id TEXT,
    type TEXT NOT NULL,
    severity TEXT NOT NULL,
    title TEXT NOT NULL,
    detail TEXT NOT NULL,
    dedupe_key TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'unread',
    created_at TEXT NOT NULL,
    acknowledged_by TEXT,
    acknowledged_at TEXT,
    FOREIGN KEY(call_id) REFERENCES calls(id) ON DELETE CASCADE,
    FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    detail TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS geocache (
    query TEXT PRIMARY KEY,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    display_name TEXT,
    provider TEXT,
    accuracy_m REAL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);
CREATE INDEX IF NOT EXISTS idx_calls_case ON calls(case_id);
CREATE INDEX IF NOT EXISTS idx_case_notes_case ON case_notes(case_id);
CREATE INDEX IF NOT EXISTS idx_jobs_call ON jobs(call_id);
CREATE INDEX IF NOT EXISTS idx_segments_call ON segments(call_id, idx);
CREATE INDEX IF NOT EXISTS idx_findings_call ON findings(call_id);
CREATE INDEX IF NOT EXISTS idx_locations_call ON locations(call_id);
CREATE INDEX IF NOT EXISTS idx_events_call ON audio_events(call_id);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def new_id(prefix: str = "") -> str:
    value = uuid.uuid4().hex
    return f"{prefix}_{value}" if prefix else value


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


@contextmanager
def transaction():
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    conn = connect()
    try:
        conn.executescript(SCHEMA)
        conn.commit()
    finally:
        conn.close()


def query(sql: str, params: Iterable[Any] = ()) -> list[dict]:
    conn = connect()
    try:
        rows = conn.execute(sql, tuple(params)).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def query_one(sql: str, params: Iterable[Any] = ()) -> dict | None:
    rows = query(sql, params)
    return rows[0] if rows else None


def execute(sql: str, params: Iterable[Any] = ()) -> int:
    conn = connect()
    try:
        cur = conn.execute(sql, tuple(params))
        conn.commit()
        return cur.rowcount
    finally:
        conn.close()


def insert(table: str, data: dict) -> None:
    cols = ", ".join(data.keys())
    marks = ", ".join("?" for _ in data)
    with transaction() as conn:
        conn.execute(f"INSERT INTO {table} ({cols}) VALUES ({marks})", tuple(data.values()))


def update(table: str, record_id: str, data: dict) -> None:
    if not data:
        return
    assignments = ", ".join(f"{key}=?" for key in data)
    with transaction() as conn:
        conn.execute(
            f"UPDATE {table} SET {assignments} WHERE id=?",
            (*data.values(), record_id),
        )


def audit(user_id: str | None, action: str, entity_type: str | None = None,
          entity_id: str | None = None, detail: dict | str | None = None) -> None:
    if isinstance(detail, dict):
        detail = json.dumps(detail, ensure_ascii=False)
    insert("audit_log", {
        "id": new_id("aud"),
        "user_id": user_id,
        "action": action,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "detail": detail,
        "created_at": now(),
    })
