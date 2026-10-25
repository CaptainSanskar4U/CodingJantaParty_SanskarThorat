"""Warm and verify the map data used by the live demo.

This script does not create fake coordinates. It checks the local geocode cache
for every gazetteer landmark, optionally asks Nominatim for the missing ones
(one request per second), and can verify that the public OpenStreetMap tile
server returns an image for the two demo locations.

Usage:
    python scripts/prewarm_map.py
    python scripts/prewarm_map.py --check-tiles
"""
from __future__ import annotations

import argparse
import math
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app import config, db, geo  # noqa: E402


def cached(label: str) -> bool:
    query = geo._cache_query(label)
    return bool(db.query_one(
        "SELECT query FROM geocache WHERE query IN (?, ?) LIMIT 1",
        (label, query),
    ))


def check_tile(lat: float, lon: float, zoom: int = 13) -> tuple[int, int, int, int]:
    n = 2 ** zoom
    x = int((lon + 180.0) / 360.0 * n)
    lat_rad = math.radians(lat)
    y = int((1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi) / 2.0 * n)
    url = f"https://tile.openstreetmap.org/{zoom}/{x}/{y}.png"
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": config.NOMINATIM_USER_AGENT,
            "Accept": "image/png,image/*;q=0.8",
        },
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        body = response.read()
        return response.status, len(body), x, y


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check-tiles", action="store_true", help="Fetch one OSM tile for each demo landmark.")
    parser.add_argument("--no-network", action="store_true", help="Only inspect the local cache; do not geocode missing landmarks.")
    args = parser.parse_args()

    missing = []
    for item in geo.GAZETTEER:
        if cached(item["label"]):
            continue
        if args.no_network:
            missing.append(item["label"])
            continue
        print(f"geocoding {item['label']} ...", flush=True)
        result = geo.nominatim_lookup(item["label"])
        if result:
            print(f"  cached {result['lat']:.6f}, {result['lon']:.6f} via {result['provider']}", flush=True)
        else:
            missing.append(item["label"])
        time.sleep(1.1)

    summary = geo.cache_summary()
    print(f"cache: {summary['cached_landmarks']}/{summary['total_landmarks']} landmarks")
    if missing:
        print("missing: " + ", ".join(missing))

    tile_ok = True
    if args.check_tiles:
        demo = [
            ("Dadar Station, Mumbai", 19.0192269, 72.8428479),
            ("Marine Drive, Mumbai", 18.9557281, 72.8127131),
        ]
        for label, lat, lon in demo:
            try:
                status, size, x, y = check_tile(lat, lon)
                print(f"tile {label}: HTTP {status}, {size} bytes, z/x/y=13/{x}/{y}")
                if status != 200 or size < 100:
                    tile_ok = False
            except Exception as exc:
                print(f"tile {label}: FAILED ({type(exc).__name__}: {exc})")
                tile_ok = False
            time.sleep(1.1)

    return 0 if not missing and tile_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
