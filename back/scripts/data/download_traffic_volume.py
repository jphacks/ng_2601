#!/usr/bin/env python3
"""Fetch one current MLIT/JARTIC traffic-volume snapshot into local GeoJSON.

The API is free but requires accepting the JARTIC/MLIT traffic API terms. It is
rate-limited, reference data rather than an official traffic survey, and must
be attributed in any public UI. This script requests one time slice and keeps
the result local so the backend never fans out requests to the upstream API.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

API_URL = "https://api.jartic-open-traffic.org/geoserver"
GUIDANCE_URL = "https://www.jartic-open-traffic.org/"
TERMS_URL = "https://www.jartic-open-traffic.org/xROAD%E4%BA%A4%E9%80%9A%E9%87%8FAPI%E6%A9%9F%E8%83%BD%E5%88%A9%E7%94%A8%E8%A6%8F%E7%B4%84v3.pdf"
USER_AGENT = "CyclerHub-back/0.1 (hobby project; MLIT/JARTIC attribution preserved)"
JST = ZoneInfo("Asia/Tokyo")


def parse_bbox(value: str) -> tuple[float, float, float, float]:
    values = tuple(float(part) for part in value.split(","))
    if len(values) != 4 or values[0] >= values[2] or values[1] >= values[3]:
        raise ValueError("bbox must be min_lon,min_lat,max_lon,max_lat")
    return values  # type: ignore[return-value]


def query_time(kind: str, minutes_ago: int | None) -> datetime:
    now = datetime.now(JST)
    if minutes_ago is not None:
        now -= timedelta(minutes=minutes_ago)
    else:
        now -= timedelta(minutes=30 if kind == "5m" else 120)
    if kind == "5m":
        now -= timedelta(minutes=now.minute % 5, seconds=now.second, microseconds=now.microsecond)
    else:
        now = now.replace(minute=0, second=0, microsecond=0)
    return now


def fetch(kind: str, observed_at: datetime, bbox: tuple[float, float, float, float]) -> dict[str, object]:
    layer = f"t_travospublic_measure_{kind}"
    min_lon, min_lat, max_lon, max_lat = bbox
    cql = (
        f"道路種別='3' AND 時間コード={observed_at.strftime('%Y%m%d%H%M')} "
        f"AND BBOX(ジオメトリ,{min_lon},{min_lat},{max_lon},{max_lat},'EPSG:4326')"
    )
    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": layer,
        "srsName": "EPSG:4326",
        "outputFormat": "application/json",
        "exceptions": "application/json",
        "cql_filter": cql,
    }
    url = API_URL + "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            payload = json.load(response)
    except (OSError, urllib.error.URLError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Traffic API request failed: {error}") from error
    if payload.get("exceptions"):
        raise RuntimeError(f"Traffic API returned an error: {payload['exceptions']}")
    return payload


def as_int(properties: dict[str, object], key: str) -> int:
    value = properties.get(key)
    try:
        return int(value) if value not in (None, "") else 0
    except (TypeError, ValueError):
        return 0


def normalize(payload: dict[str, object], kind: str, observed_at: datetime, bbox: tuple[float, float, float, float]) -> dict[str, object]:
    features: list[dict[str, object]] = []
    for feature in payload.get("features", []):
        if not isinstance(feature, dict):
            continue
        geometry = feature.get("geometry") or {}
        coordinates = geometry.get("coordinates", []) if isinstance(geometry, dict) else []
        if geometry.get("type") == "MultiPoint" and coordinates:
            coordinates = coordinates[0]
        if not isinstance(coordinates, list) or len(coordinates) < 2:
            continue
        raw = feature.get("properties") or {}
        if not isinstance(raw, dict):
            continue
        up = sum(as_int(raw, key) for key in ("上り・小型交通量", "上り・大型交通量", "上り・車種判別不能交通量"))
        down = sum(as_int(raw, key) for key in ("下り・小型交通量", "下り・大型交通量", "下り・車種判別不能交通量"))
        features.append(
            {
                "type": "Feature",
                "id": feature.get("id"),
                "geometry": {"type": "Point", "coordinates": coordinates},
                "properties": {
                    "station_id": raw.get("常時観測点コード"),
                    "vehicle_count": up + down,
                    "up_vehicle_count": up,
                    "down_vehicle_count": down,
                    "interval_kind": kind,
                    "observed_at": observed_at.isoformat(),
                    "quality": {
                        "up_missing": raw.get("上り・欠測"),
                        "down_missing": raw.get("下り・欠測"),
                        "up_loop_error": raw.get("上り・ループ異常"),
                        "down_loop_error": raw.get("下り・ループ異常"),
                    },
                },
            }
        )
    return {
        "type": "FeatureCollection",
        "metadata": {
            "source": "MLIT traffic-volume API via JARTIC",
            "source_url": GUIDANCE_URL,
            "terms_url": TERMS_URL,
            "authority": "MLIT",
            "source_kind": "measured_traffic_volume",
            "retrieved_at": datetime.now(timezone.utc).isoformat(),
            "observed_at": observed_at.isoformat(),
            "coverage": "selected national-road measurement locations",
            "license": "Free API use after terms acceptance; attribution and reference-value notice required",
            "processed_by": "CyclerHub-back",
            "bbox": bbox,
        },
        "features": features,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--kind", choices=("5m", "1h"), default="1h")
    parser.add_argument("--minutes-ago", type=int)
    parser.add_argument("--bbox", type=parse_bbox, default=(122.0, 24.0, 154.0, 46.0))
    parser.add_argument("--output", type=Path, default=Path("data/normalized/context/traffic_volume.geojson"))
    args = parser.parse_args()
    observed_at = query_time(args.kind, args.minutes_ago)
    normalized = normalize(fetch(args.kind, observed_at, args.bbox), args.kind, observed_at, args.bbox)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(normalized, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {len(normalized['features'])} traffic features to {args.output}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1) from error
