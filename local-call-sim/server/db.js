import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, 'telephony.sqlite');

let dbInstance = null;

export function getDb() {
  if (!dbInstance) {
    dbInstance = new sqlite3.Database(DB_PATH);
  }
  return dbInstance;
}

export function runQuery(sql, params = []) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

export function getQuery(sql, params = []) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

export function allQuery(sql, params = []) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

export async function initDb() {
  await runQuery(`
    CREATE TABLE IF NOT EXISTS calls (
      id TEXT PRIMARY KEY,
      extension TEXT NOT NULL,
      caller_name TEXT NOT NULL,
      status TEXT NOT NULL, -- ringing, connected, completed, rejected, missed
      started_at INTEGER NOT NULL,
      answered_at INTEGER,
      ended_at INTEGER,
      duration_s INTEGER DEFAULT 0
    )
  `);

  await runQuery(`
    CREATE TABLE IF NOT EXISTS transcripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_id TEXT NOT NULL,
      speaker TEXT NOT NULL, -- caller, operator
      text TEXT NOT NULL,
      timestamp_ms INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (call_id) REFERENCES calls (id) ON DELETE CASCADE
    )
  `);

  await runQuery(`
    CREATE TABLE IF NOT EXISTS analysis_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_id TEXT NOT NULL,
      sentiment TEXT NOT NULL,
      intent TEXT NOT NULL,
      urgency TEXT NOT NULL,
      keywords_json TEXT,
      topics_json TEXT,
      questions_json TEXT,
      recommendations_json TEXT,
      summary TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (call_id) REFERENCES calls (id) ON DELETE CASCADE
    )
  `);

  console.log('[DB] SQLite database initialized at:', DB_PATH);
}

export async function createCall({ id, extension, callerName = 'Mobile Device' }) {
  const now = Date.now();
  await runQuery(
    `INSERT INTO calls (id, extension, caller_name, status, started_at) VALUES (?, ?, ?, 'ringing', ?)`,
    [id, extension, callerName, now]
  );
  return getCall(id);
}

export async function updateCallStatus(id, status, extra = {}) {
  const now = Date.now();
  if (status === 'connected') {
    await runQuery(
      `UPDATE calls SET status = ?, answered_at = ? WHERE id = ?`,
      [status, now, id]
    );
  } else if (['completed', 'rejected', 'missed'].includes(status)) {
    const call = await getCall(id);
    const duration = call && call.answered_at ? Math.max(0, Math.round((now - call.answered_at) / 1000)) : 0;
    await runQuery(
      `UPDATE calls SET status = ?, ended_at = ?, duration_s = ? WHERE id = ?`,
      [status, now, duration, id]
    );
  } else {
    await runQuery(`UPDATE calls SET status = ? WHERE id = ?`, [status, id]);
  }
  return getCall(id);
}

export async function getCall(id) {
  return getQuery(`SELECT * FROM calls WHERE id = ?`, [id]);
}

export async function addTranscript({ callId, speaker, text, timestampMs = 0 }) {
  const now = Date.now();
  const res = await runQuery(
    `INSERT INTO transcripts (call_id, speaker, text, timestamp_ms, created_at) VALUES (?, ?, ?, ?, ?)`,
    [callId, speaker, text, timestampMs, now]
  );
  return { id: res.lastID, callId, speaker, text, timestampMs, createdAt: now };
}

export async function getTranscripts(callId) {
  return allQuery(`SELECT * FROM transcripts WHERE call_id = ? ORDER BY id ASC`, [callId]);
}

export async function saveAnalysis({ callId, analysis }) {
  const now = Date.now();
  const res = await runQuery(
    `INSERT INTO analysis_snapshots (
      call_id, sentiment, intent, urgency, keywords_json, topics_json, questions_json, recommendations_json, summary, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      callId,
      analysis.sentiment || 'Neutral',
      analysis.intent || 'General Inquiry',
      analysis.urgency || 'LOW',
      JSON.stringify(analysis.keywords || []),
      JSON.stringify(analysis.topics || []),
      JSON.stringify(analysis.questions || []),
      JSON.stringify(analysis.recommendations || []),
      analysis.summary || '',
      now
    ]
  );
  return { id: res.lastID, callId, ...analysis, createdAt: now };
}

export async function getLatestAnalysis(callId) {
  const row = await getQuery(
    `SELECT * FROM analysis_snapshots WHERE call_id = ? ORDER BY id DESC LIMIT 1`,
    [callId]
  );
  if (!row) return null;
  return {
    id: row.id,
    callId: row.call_id,
    sentiment: row.sentiment,
    intent: row.intent,
    urgency: row.urgency,
    keywords: JSON.parse(row.keywords_json || '[]'),
    topics: JSON.parse(row.topics_json || '[]'),
    questions: JSON.parse(row.questions_json || '[]'),
    recommendations: JSON.parse(row.recommendations_json || '[]'),
    summary: row.summary,
    createdAt: row.created_at
  };
}

export async function getCallStats() {
  const total = (await getQuery(`SELECT COUNT(*) as count FROM calls`))?.count || 0;
  const active = (await getQuery(`SELECT COUNT(*) as count FROM calls WHERE status IN ('ringing', 'connected')`))?.count || 0;
  const completed = (await getQuery(`SELECT COUNT(*) as count FROM calls WHERE status = 'completed'`))?.count || 0;
  const missed = (await getQuery(`SELECT COUNT(*) as count FROM calls WHERE status IN ('missed', 'rejected')`))?.count || 0;
  const avgDuration = (await getQuery(`SELECT AVG(duration_s) as avg_d FROM calls WHERE status = 'completed'`))?.avg_d || 0;

  return {
    total,
    active,
    completed,
    missed,
    avgDurationSec: Math.round(avgDuration)
  };
}

export async function getRecentCalls(limit = 20) {
  return allQuery(`SELECT * FROM calls ORDER BY started_at DESC LIMIT ?`, [limit]);
}

