"""Configuration and filesystem layout for Dhvani."""
from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
DEMO_DIR = DATA_DIR / "demo"
STATIC_DIR = BASE_DIR / "static"
DB_PATH = DATA_DIR / "orbitwin.db"
SECRET_PATH = DATA_DIR / "secret.key"
FRONTEND = BASE_DIR / "Orbitwin_Emergency_Response_Intelligence.html"
LANDING = BASE_DIR / "Vecna_Verse.html"


def _load_dotenv(path: Path) -> None:
    """Tiny .env loader so the app has no extra runtime dependency."""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_dotenv(BASE_DIR / ".env")

for directory in (DATA_DIR, UPLOAD_DIR, DEMO_DIR, STATIC_DIR):
    directory.mkdir(parents=True, exist_ok=True)


def env_bool(name: str, default: bool = True) -> bool:
    return os.getenv(name, "1" if default else "0").strip().lower() not in {"0", "false", "no", "off"}


AUTH_ENABLED = env_bool("DHVANI_AUTH", env_bool("ORBITWIN_AUTH", True))
DEMO_USER = os.getenv("DHVANI_DEMO_USER", os.getenv("ORBITWIN_DEMO_USER", "mehta"))
DEMO_PASSWORD = os.getenv("DHVANI_DEMO_PASSWORD", os.getenv("ORBITWIN_DEMO_PASSWORD", "dhvani-demo"))
DEMO_NAME = os.getenv("DHVANI_DEMO_NAME", os.getenv("ORBITWIN_DEMO_NAME", "Inspector Mehta"))
DEMO_ROLE = os.getenv("DHVANI_DEMO_ROLE", os.getenv("ORBITWIN_DEMO_ROLE", "Investigator"))

WHISPER_MODEL = os.getenv("WHISPER_MODEL", "base")
WHISPER_HINDI_MODEL = os.getenv("WHISPER_HINDI_MODEL", "small")
AUDIO_EVENT_MODEL = os.getenv("AUDIO_EVENT_MODEL", "MIT/ast-finetuned-audioset-10-10-0.4593")
EMOTION_MODEL = os.getenv("EMOTION_MODEL", "superb/wav2vec2-base-superb-er")

MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "50"))
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024
MAX_DURATION_SECONDS = int(os.getenv("MAX_DURATION_SECONDS", "300"))

# Optional server-side Gemini live transcription. The browser never sees this
# key; all calls are made by the FastAPI process.
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip()
GEMINI_API_BASE = os.getenv("GEMINI_API_BASE", "https://generativelanguage.googleapis.com").rstrip("/")
GEMINI_TIMEOUT_SECONDS = float(os.getenv("GEMINI_TIMEOUT_SECONDS", "45"))
LIVE_CHUNK_SECONDS = max(2, min(15, int(os.getenv("LIVE_CHUNK_SECONDS", "5"))))
# The full live recording is uploaded through the normal recording endpoint, so
# keep the live cap within the normal upload duration cap.
LIVE_MAX_SECONDS = max(30, min(MAX_DURATION_SECONDS, int(os.getenv("LIVE_MAX_SECONDS", "300"))))
LIVE_MAX_CHUNK_MB = max(1, min(20, int(os.getenv("LIVE_MAX_CHUNK_MB", "8"))))
LIVE_MAX_CHUNK_BYTES = LIVE_MAX_CHUNK_MB * 1024 * 1024
LIVE_RATE_LIMIT_PER_MINUTE = max(1, min(60, int(os.getenv("LIVE_RATE_LIMIT_PER_MINUTE", "12"))))

MAP_TILE_URL = os.getenv("MAP_TILE_URL", "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}")
MAP_ATTRIBUTION = os.getenv("MAP_ATTRIBUTION", "Tiles &copy; Esri")
NOMINATIM_URL = os.getenv("NOMINATIM_URL", "https://nominatim.openstreetmap.org")
NOMINATIM_USER_AGENT = os.getenv("NOMINATIM_USER_AGENT", "Dhvani-Emergency-Intelligence/1.0")

TELEPHONY_PROVIDER = os.getenv("TELEPHONY_PROVIDER", "none").strip().lower()
TELEPHONY_CONFIGURED = bool(
    TELEPHONY_PROVIDER not in {"", "none", "disabled"}
    and os.getenv("TELEPHONY_ACCOUNT_SID")
    and os.getenv("TELEPHONY_AUTH_TOKEN")
    and os.getenv("TELEPHONY_FROM_NUMBER")
)

ALLOWED_EXTENSIONS = {".wav", ".mp3", ".m4a", ".aac", ".ogg", ".opus", ".flac", ".webm", ".mp4"}
ALLOWED_MIME_PREFIXES = ("audio/", "video/mp4", "video/webm", "application/octet-stream")
