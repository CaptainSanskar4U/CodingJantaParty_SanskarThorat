"""Single background analysis worker. CPU models are loaded lazily."""
from __future__ import annotations

import queue
import threading

from . import db

_QUEUE: queue.Queue[str] = queue.Queue()
_STARTED = False
_LOCK = threading.Lock()


def _worker() -> None:
    while True:
        job_id = _QUEUE.get()
        try:
            job = db.query_one("SELECT * FROM jobs WHERE id=?", (job_id,))
            if not job:
                continue
            from .pipeline import process_call
            process_call(job["call_id"], job_id)
        except Exception:
            # process_call records the failure; keep the worker alive.
            pass
        finally:
            _QUEUE.task_done()


def start_worker() -> None:
    global _STARTED
    with _LOCK:
        if _STARTED:
            return
        # Any job left running from a previous process cannot still be alive.
        db.execute(
            "UPDATE jobs SET status='failed', stage='Interrupted', message='Server restarted before analysis completed', "
            "finished_at=? WHERE status IN ('running','queued')",
            (db.now(),),
        )
        db.execute(
            "UPDATE calls SET status='failed', error='Server restarted before analysis completed' "
            "WHERE status IN ('processing','queued')"
        )
        thread = threading.Thread(target=_worker, name="orbitwin-analysis", daemon=True)
        thread.start()
        _STARTED = True


def enqueue(call_id: str) -> dict:
    job = {
        "id": db.new_id("job"),
        "call_id": call_id,
        "status": "queued",
        "stage": "Queued",
        "progress": 0,
        "message": "Waiting for the local analysis worker",
        "error": None,
        "created_at": db.now(),
        "started_at": None,
        "finished_at": None,
    }
    db.insert("jobs", job)
    db.update("calls", call_id, {"status": "queued", "error": None})
    _QUEUE.put(job["id"])
    return job


def get_job(job_id: str) -> dict | None:
    return db.query_one("SELECT * FROM jobs WHERE id=?", (job_id,))
