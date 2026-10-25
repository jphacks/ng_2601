#!/usr/bin/env python3
"""Download and normalize National Police Agency accident open data.

The NPA publishes annual CSV files under a stable public URL. This script keeps
the source CSV locally and emits a deliberately small GeoJSON context layer:
coordinates, time, severity, bicycle involvement, and non-identifying road
attributes only. It does not copy ages or party-level details into the map
layer.

NPA data is historical context. It is never a restriction and never creates a
route block. The NPA page and PDL 1.0 require attribution and disclosure that
the data was edited/processed when it is transformed.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

BASE_URL = "https://www.npa.go.jp/publications/statistics/koutsuu/opendata/{year}/honhyo_{year}.csv"
SOURCE_PAGE = "https://www.npa.go.jp/publications/statistics/koutsuu/opendata/index_opendata.html"
USER_AGENT = "CyclerHub-back/0.1 (hobby project; NPA open-data attribution preserved)"


def download(url: str, target: Path, refresh: bool) -> None:
    if target.exists() and not refresh:
        print(f"cached  {target}")
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + ".part")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=180) as response, temporary.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
    except (OSError, urllib.error.URLError) as error:
        temporary.unlink(missing_ok=True)
        raise RuntimeError(f"Could not download {url}: {error}") from error
    temporary.replace(target)
    print(f"downloaded {target}")


def number(value: str) -> int:
    return int(value.strip() or "0")


def coordinate_dms(value: str) -> float:
    """Convert the NPA packed DMS coordinate to decimal degrees.

    The main table stores coordinates as degrees, minutes, and seconds with
    three decimal places of seconds packed into an integer.  For example,
    ``430607590`` means 43°06'07.590".
    """
    digits = value.strip()
    if not digits or not digits.isdigit() or len(digits) < 7:
        raise ValueError("invalid packed DMS coordinate")
    degrees = int(digits[:-7] or "0")
    minutes = int(digits[-7:-5])
    seconds = int(digits[-5:-3]) + int(digits[-3:]) / 1000
    if minutes >= 60 or seconds >= 60:
        raise ValueError("invalid packed DMS coordinate")
    return degrees + minutes / 60 + seconds / 3600


BICYCLE_PARTY_CODES = {"51", "52"}


def normalize(raw_files: list[tuple[int, Path]], output: Path) -> None:
    features: list[dict[str, object]] = []
    retrieved_at = datetime.now(timezone.utc).isoformat()
    for year, path in raw_files:
        with path.open(encoding="cp932", newline="") as source:
            reader = csv.DictReader(source)
            for row_number, row in enumerate(reader, start=2):
                try:
                    latitude = coordinate_dms(row.get("地点　緯度（北緯）", ""))
                    longitude = coordinate_dms(row.get("地点　経度（東経）", ""))
                    year_value = number(row.get("発生日時　　年", str(year)))
                    month = number(row.get("発生日時　　月", "1"))
                    day = number(row.get("発生日時　　日", "1"))
                    hour = number(row.get("発生日時　　時", "0"))
                    minute = number(row.get("発生日時　　分", "0"))
                    observed_at = datetime(year_value, month, day, hour, minute, tzinfo=ZoneInfo("Asia/Tokyo")).isoformat()
                except (ValueError, TypeError):
                    continue
                if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
                    continue
                fatalities = number(row.get("死者数", "0"))
                injuries = number(row.get("負傷者数", "0"))
                party_a = row.get("当事者種別（当事者A）", "")
                party_b = row.get("当事者種別（当事者B）", "")
                features.append(
                    {
                        "type": "Feature",
                        "geometry": {"type": "Point", "coordinates": [longitude, latitude]},
                        "properties": {
                            "id": f"npa-{year}-{row_number}",
                            "dataset_year": year,
                            "observed_at": observed_at,
                            "fatalities": fatalities,
                            "injuries": injuries,
                            # The public main table does not expose a reliable
                            # severity grade for every injury; do not call all
                            # injury crashes "serious".
                            "fatal_or_serious": fatalities > 0,
                            "injury_accident": injuries > 0,
                            "bicycle_involved": party_a.strip() in BICYCLE_PARTY_CODES
                            or party_b.strip() in BICYCLE_PARTY_CODES,
                            "accident_type": row.get("事故類型"),
                            "road_form": row.get("道路形状"),
                            "surface": row.get("路面状態"),
                            "prefecture_code": row.get("都道府県コード"),
                        },
                    }
                )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "metadata": {
                    "source": "National Police Agency traffic-accident open data",
                    "source_url": SOURCE_PAGE,
                    "authority": "National Police Agency of Japan",
                    "source_kind": "historical_accident_context",
                    "dataset_version": ",".join(str(year) for year, _ in raw_files),
                    "window": {"from": f"{min(year for year, _ in raw_files)}-01-01", "to": f"{max(year for year, _ in raw_files)}-12-31"},
                    "retrieved_at": retrieved_at,
                    "coverage": "nationwide",
                    "license": "Japan PDL 1.0; attribution and processed-data notice required",
                    "processed_by": "CyclerHub-back",
                },
                "features": features,
            },
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"wrote {len(features)} normalized accident features to {output}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", type=int, action="append", dest="years", help="year to download; repeatable")
    parser.add_argument("--raw-dir", type=Path, default=Path("data/raw/npa"))
    parser.add_argument("--output", type=Path, default=Path("data/normalized/context/npa_accidents.geojson"))
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    years = args.years or [datetime.now(timezone.utc).year - 1]
    if any(year < 2019 or year > datetime.now(timezone.utc).year for year in years):
        raise SystemExit("NPA open data is currently published for years 2019 through the latest release")
    raw_files = []
    for year in sorted(set(years)):
        target = args.raw_dir / f"honhyo_{year}.csv"
        download(BASE_URL.format(year=year), target, args.refresh)
        raw_files.append((year, target))
    normalize(raw_files, args.output)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1) from error
