"""Location extraction with an auditable gazetteer and cached geocoding."""
from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from . import config, db

# Real coordinates for well-known landmarks. The gazetteer is a fallback when
# Nominatim is unavailable; it is never presented as device GPS.
GAZETTEER = [
    {"label": "Dadar Station, Mumbai", "aliases": ["dadar station", "dadar", "दादर स्टेशन", "दादर"], "lat": 19.0186, "lon": 72.8442, "accuracy_m": 900},
    {"label": "Andheri Station, Mumbai", "aliases": ["andheri station", "andheri", "अंधेरी स्टेशन", "अंधेरी"], "lat": 19.1197, "lon": 72.8464, "accuracy_m": 900},
    {"label": "CSMT Station, Mumbai", "aliases": ["cst station", "cst", "csmt", "chhatrapati shivaji terminus", "सीएसटी", "छत्रपति शिवाजी"], "lat": 18.9398, "lon": 72.8355, "accuracy_m": 700},
    {"label": "Gateway of India, Mumbai", "aliases": ["gateway of india", "गेटवे ऑफ इंडिया"], "lat": 18.9220, "lon": 72.8347, "accuracy_m": 500},
    {"label": "Marine Drive, Mumbai", "aliases": ["marine drive", "मरीन ड्राइव"], "lat": 18.9440, "lon": 72.8230, "accuracy_m": 800},
    {"label": "Bandra Station, Mumbai", "aliases": ["bandra station", "bandra", "बांद्रा स्टेशन", "बांद्रा"], "lat": 19.0596, "lon": 72.8295, "accuracy_m": 900},
    {"label": "Kurla Station, Mumbai", "aliases": ["kurla station", "kurla", "कुर्ला स्टेशन", "कुर्ला"], "lat": 19.0726, "lon": 72.8845, "accuracy_m": 900},
    {"label": "Thane Station, Mumbai", "aliases": ["thane station", "thane", "ठाणे स्टेशन", "ठाणे"], "lat": 19.2183, "lon": 72.9781, "accuracy_m": 1000},
    {"label": "Powai, Mumbai", "aliases": ["powai", "पवई"], "lat": 19.1176, "lon": 72.9060, "accuracy_m": 1200},
    {"label": "Juhu Beach, Mumbai", "aliases": ["juhu beach", "juhu", "जुहू बीच", "जुहू"], "lat": 19.1075, "lon": 72.8263, "accuracy_m": 700},
    {"label": "Colaba, Mumbai", "aliases": ["colaba", "कोलाबा"], "lat": 18.9067, "lon": 72.8147, "accuracy_m": 1000},
    {"label": "Worli, Mumbai", "aliases": ["worli", "वर्ली"], "lat": 19.0176, "lon": 72.8174, "accuracy_m": 1000},
    {"label": "Lower Parel, Mumbai", "aliases": ["lower parel", "लोअर परेल"], "lat": 18.9986, "lon": 72.8258, "accuracy_m": 900},
    {"label": "Sion, Mumbai", "aliases": ["sion", "सायन"], "lat": 19.0430, "lon": 72.8620, "accuracy_m": 1000},
    {"label": "Ghatkopar, Mumbai", "aliases": ["ghatkopar", "घाटकोपर"], "lat": 19.0860, "lon": 72.9081, "accuracy_m": 1000},
    {"label": "Malad, Mumbai", "aliases": ["malad", "मालाड"], "lat": 19.1860, "lon": 72.8480, "accuracy_m": 1000},
    {"label": "Borivali, Mumbai", "aliases": ["borivali", "बोरीवली"], "lat": 19.2307, "lon": 72.8567, "accuracy_m": 1000},
    {"label": "Green Park Metro Station, Delhi", "aliases": ["green park metro", "green park", "ग्रीन पार्क"], "lat": 28.5580, "lon": 77.2060, "accuracy_m": 700},
    {"label": "Hauz Khas, Delhi", "aliases": ["hauz khas", "haus khas", "हौज़ खास"], "lat": 28.5494, "lon": 77.2001, "accuracy_m": 1000},
]


def _normalise(text: str) -> str:
    return " ".join((text or "").lower().replace(",", " ").replace(".", " ").split())


def _cached(query: str) -> dict | None:
    return db.query_one("SELECT * FROM geocache WHERE query=?", (query,))


def _save_cache(query: str, lat: float, lon: float, display_name: str, provider: str, accuracy_m: float) -> None:
    db.insert("geocache", {
        "query": query,
        "lat": lat,
        "lon": lon,
        "display_name": display_name,
        "provider": provider,
        "accuracy_m": accuracy_m,
        "created_at": db.now(),
    })


def _cache_query(label: str) -> str:
    return label if "india" in label.lower() else f"{label}, India"


def cache_summary() -> dict:
    """Report which gazetteer landmarks already have a geocode cache row."""
    cached = 0
    for item in GAZETTEER:
        query = _cache_query(item["label"])
        if db.query_one("SELECT query FROM geocache WHERE query IN (?, ?) LIMIT 1", (item["label"], query)):
            cached += 1
    return {"cached_landmarks": cached, "total_landmarks": len(GAZETTEER)}


def nominatim_lookup(label: str) -> dict | None:
    query = _cache_query(label)
    cached = _cached(query)
    if cached:
        return {
            "lat": cached["lat"], "lon": cached["lon"],
            "display_name": cached["display_name"] or label,
            "provider": cached["provider"] or "nominatim",
            "accuracy_m": cached["accuracy_m"] or 1000,
        }
    params = urllib.parse.urlencode({"q": query, "format": "jsonv2", "limit": 1, "countrycodes": "in"})
    request = urllib.request.Request(
        f"{config.NOMINATIM_URL}/search?{params}",
        headers={"User-Agent": config.NOMINATIM_USER_AGENT, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            data = json.loads(response.read().decode("utf-8"))
        if not data:
            return None
        item = data[0]
        lat, lon = float(item["lat"]), float(item["lon"])
        _save_cache(query, lat, lon, item.get("display_name", label), "nominatim", 1000)
        return {"lat": lat, "lon": lon, "display_name": item.get("display_name", label),
                "provider": "nominatim", "accuracy_m": 1000}
    except Exception:
        return None


def extract_locations(segments: list[dict]) -> list[dict]:
    found: dict[str, dict] = {}
    for segment in segments:
        text = _normalise(segment.get("text") or "")
        if not text:
            continue
        for item in GAZETTEER:
            for alias in sorted(item["aliases"], key=len, reverse=True):
                alias_norm = _normalise(alias)
                if alias_norm and alias_norm in text:
                    if item["label"] in found:
                        break
                    geo = nominatim_lookup(item["label"])
                    if geo:
                        lat, lon, provider, accuracy = geo["lat"], geo["lon"], geo["provider"], geo["accuracy_m"]
                        detail = f"Caller-spoken landmark; geocoded by {provider}. Landmark coordinates are approximate and do not establish the caller's exact position."
                    else:
                        lat, lon, provider, accuracy = item["lat"], item["lon"], "local_gazetteer", item["accuracy_m"]
                        detail = "Caller-spoken landmark matched to a local gazetteer. Coordinates are approximate; the landmark is not the caller's confirmed position."
                    found[item["label"]] = {
                        "label": item["label"],
                        "lat": lat,
                        "lon": lon,
                        "accuracy_m": accuracy,
                        "source_type": "spoken_landmark",
                        "source_detail": detail,
                        "geocode_provider": provider,
                        "verification_status": "unverified",
                        "start_s": segment.get("start_s"),
                        "end_s": segment.get("end_s"),
                    }
                    break
    return list(found.values())
