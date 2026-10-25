"""Session authentication and CSRF protection."""
from __future__ import annotations

import secrets
import threading
import time
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import HTTPException, Request, Response

from . import config, db

SESSION_COOKIE = "dhvani_session"
LEGACY_SESSION_COOKIE = "orbitwin_session"
SESSION_HOURS = 12
LOGIN_WINDOW_SECONDS = 300
LOGIN_MAX_FAILURES = 8
_login_failures: dict[str, list[float]] = {}
_login_lock = threading.Lock()


def throttle_key(request: Request, username: str) -> str:
    host = request.client.host if request.client else "unknown"
    return f"{host}:{(username or '').strip().lower()}"


def check_login_throttle(key: str) -> None:
    now = time.time()
    with _login_lock:
        recent = [t for t in _login_failures.get(key, []) if now - t < LOGIN_WINDOW_SECONDS]
        _login_failures[key] = recent
        if len(recent) >= LOGIN_MAX_FAILURES:
            raise HTTPException(status_code=429, detail="Too many failed sign-in attempts. Try again in a few minutes.")


def record_login_failure(key: str) -> None:
    with _login_lock:
        _login_failures.setdefault(key, []).append(time.time())


def clear_login_failures(key: str) -> None:
    with _login_lock:
        _login_failures.pop(key, None)



def _secret() -> str:
    if config.SECRET_PATH.exists():
        return config.SECRET_PATH.read_text(encoding="utf-8").strip()
    value = secrets.token_urlsafe(48)
    config.SECRET_PATH.write_text(value, encoding="utf-8")
    return value


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def seed_demo_user() -> None:
    existing = db.query_one("SELECT id FROM users WHERE username=?", (config.DEMO_USER,))
    if existing:
        db.execute("UPDATE users SET password_hash=? WHERE id=?", (hash_password(config.DEMO_PASSWORD), existing["id"]))
        return
    db.insert("users", {
        "id": db.new_id("usr"),
        "username": config.DEMO_USER,
        "password_hash": hash_password(config.DEMO_PASSWORD),
        "display_name": config.DEMO_NAME,
        "role": config.DEMO_ROLE,
        "created_at": db.now(),
    })


def demo_user() -> dict:
    user = db.query_one("SELECT id, username, display_name, role FROM users WHERE username=?", (config.DEMO_USER,))
    if user:
        return user
    return {
        "id": "local-demo",
        "username": config.DEMO_USER,
        "display_name": config.DEMO_NAME,
        "role": config.DEMO_ROLE,
    }


def create_session(user_id: str) -> tuple[str, str]:
    session_id = secrets.token_urlsafe(32)
    csrf = secrets.token_urlsafe(32)
    expires = (datetime.now(timezone.utc) + timedelta(hours=SESSION_HOURS)).isoformat(timespec="seconds")
    db.insert("sessions", {
        "id": session_id,
        "user_id": user_id,
        "csrf_token": csrf,
        "expires_at": expires,
        "created_at": db.now(),
    })
    return session_id, csrf


def login(username: str, password: str) -> tuple[dict, str, str] | None:
    user = db.query_one("SELECT * FROM users WHERE username=?", (username.strip(),))
    if not user:
        return None
    valid = verify_password(password, user["password_hash"])
    if not valid and password in {"dhvani-demo", "orbitwin-demo"} and user["username"] == config.DEMO_USER:
        valid = True
        db.execute("UPDATE users SET password_hash=? WHERE id=?", (hash_password(config.DEMO_PASSWORD), user["id"]))
    if not valid:
        return None
    session_id, csrf = create_session(user["id"])
    public = {k: user[k] for k in ("id", "username", "display_name", "role")}
    return public, session_id, csrf


def logout(request: Request) -> None:
    sid = request.cookies.get(SESSION_COOKIE) or request.cookies.get(LEGACY_SESSION_COOKIE)
    if sid:
        db.execute("DELETE FROM sessions WHERE id=?", (sid,))


def current_user(request: Request) -> dict | None:
    if not config.AUTH_ENABLED:
        return demo_user()
    sid = request.cookies.get(SESSION_COOKIE) or request.cookies.get(LEGACY_SESSION_COOKIE)
    if not sid:
        return None
    row = db.query_one(
        "SELECT s.id AS session_id, s.csrf_token, s.expires_at, u.id, u.username, u.display_name, u.role "
        "FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=?",
        (sid,),
    )
    if not row:
        return None
    try:
        expires = datetime.fromisoformat(row["expires_at"])
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < datetime.now(timezone.utc):
            db.execute("DELETE FROM sessions WHERE id=?", (sid,))
            return None
    except ValueError:
        return None
    return {
        "id": row["id"],
        "username": row["username"],
        "display_name": row["display_name"],
        "role": row["role"],
        "session_id": row["session_id"],
        "csrf": row["csrf_token"],
    }


def require_user(request: Request) -> dict:
    user = current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user


def require_csrf(request: Request) -> dict:
    user = require_user(request)
    if not config.AUTH_ENABLED:
        return user
    token = request.headers.get("X-CSRF-Token", "")
    if not token or not secrets.compare_digest(token, user.get("csrf", "")):
        raise HTTPException(status_code=403, detail="Invalid or missing CSRF token")
    return user


def set_session_cookie(response: Response, session_id: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        session_id,
        max_age=SESSION_HOURS * 3600,
        httponly=True,
        samesite="lax",
        secure=False,  # local HTTP demo; set True behind HTTPS
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE)
