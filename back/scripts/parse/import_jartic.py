#!/usr/bin/env python3
"""Convert JARTIC Type-D ZIP files into CyclerHub-back's restriction GeoJSON.

By default this writes JARTIC 'road closed' records (common restriction code 4).
Records whose vehicle exceptions or schedules have not been fully mapped stay
as warnings. Use --include-warnings only for the much larger all-record export.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import zipfile
from datetime import datetime, timezone
from pathlib import Path

COORDINATE = re.compile(r"(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)")
CODE_HEADERS = ("共通規制種別コード", "共通規制種別")
NAME_HEADERS = ("共通規制種別名称", "規制種別名称")


def find_header(headers: list[str], candidates: tuple[str, ...]) -> str | None:
    return next((header for header in headers if any(term in header for term in candidates)), None)


def geometry(value: str) -> dict[str, object] | None:
    lines = []
    for part in value.split("/"):
        points = [[float(lon), float(lat)] for lon, lat in COORDINATE.findall(part)]
        if len(points) >= 2:
            lines.append(points)
        elif len(points) == 1:
            return {"type": "Point", "coordinates": points[0]}
    if len(lines) == 1:
        return {"type": "LineString", "coordinates": lines[0]}
    if lines:
        return {"type": "MultiLineString", "coordinates": lines}
    return None


def schedule_fields(row: dict[str, str]) -> dict[str, str]:
    return {
        header: value
        for header, value in row.items()
        if value and header.startswith(("対象期間", "規制時間", "規制曜日", "除外期間", "除外時間", "除外曜日"))
    }


def is_unconditional(row: dict[str, str], schedule: dict[str, str]) -> bool:
    if any(header.startswith(("対象期間", "除外期間")) for header in schedule):
        return False
    for header, value in schedule.items():
        if "時間" in header and value not in {"0", "0000", "2400"}:
            return False
        if "曜日" in header and value not in {"", "9"}:
            return False
    # A vehicle code can express an exception that needs the official code table.
    return not any(value for header, value in row.items() if "車両コード" in header)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path, nargs="+", help="JARTIC Type-D ZIP files")
    parser.add_argument("--output", type=Path, default=Path("data/normalized/restrictions/jartic.geojson"))
    parser.add_argument(
        "--include-warnings",
        action="store_true",
        help="also export unmapped records as warnings; this can be very large",
    )
    args = parser.parse_args()

    features: list[dict[str, object]] = []
    for archive_path in args.input:
        with zipfile.ZipFile(archive_path) as archive:
            csv_names = [name for name in archive.namelist() if name.lower().endswith(".csv")]
            if len(csv_names) != 1:
                raise RuntimeError(f"Expected one CSV in {archive_path}, found {len(csv_names)}")
            with archive.open(csv_names[0]) as raw:
                rows = csv.DictReader((line.decode("cp932") for line in raw))
                headers = rows.fieldnames or []
                code_header = find_header(headers, CODE_HEADERS)
                geometry_header = find_header(headers, ("規制場所", "位置座標", "座標"))
                if code_header is None or geometry_header is None:
                    raise RuntimeError(f"Unsupported JARTIC CSV columns in {archive_path}: {headers}")
                name_header = find_header(headers, NAME_HEADERS)
                for row_number, row in enumerate(rows, start=2):
                    item_geometry = geometry(row.get(geometry_header, ""))
                    if item_geometry is None:
                        continue
                    code = row.get(code_header, "").strip()
                    raw_schedule = schedule_fields(row)
                    enforcement = "block" if code == "4" and is_unconditional(row, raw_schedule) else "warn"
                    if code != "4" and not args.include_warnings:
                        continue
                    features.append(
                        {
                            "type": "Feature",
                            "geometry": item_geometry,
                            "properties": {
                                "id": f"{archive_path.stem}:{row_number}",
                                "source": "JARTIC traffic regulation open data",
                                "source_file": archive_path.name,
                                "common_restriction_code": code,
                                "name": row.get(name_header, "") if name_header else "",
                                "enforcement": enforcement,
                                "vehicle_classes": ["ordinary_bicycle"],
                                "schedule_raw": raw_schedule,
                            },
                        }
                    )

    output = {
        "type": "FeatureCollection",
        "metadata": {
            "source": "JARTIC traffic regulation open data",
            "authority": "Japan Road Traffic Information Center (JARTIC)",
            "source_kind": "traffic_regulation",
            "confidence": "official_dataset",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "enforced_scope": "unconditional common restriction code 4 (road closed) only",
        },
        "features": features,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {len(features)} restrictions to {args.output}")


if __name__ == "__main__":
    main()
