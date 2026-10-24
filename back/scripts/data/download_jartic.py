#!/usr/bin/env python3
"""Download the current JARTIC Type-D traffic-regulation ZIPs.

The monthly catalog determines the file URLs. Do not hard-code a month-specific
link: JARTIC replaces old files when the next monthly release is published.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

CATALOG_URL = "https://www.jartic.or.jp/d/opendata/opendata.json"
BASE_URL = "https://www.jartic.or.jp/d/opendata"
USER_AGENT = "cyclerhub-back-routing-backend/0.1"


def fetch(url: str) -> bytes:
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=120) as response:  # noqa: S310
                return response.read()
        except (urllib.error.URLError, TimeoutError) as error:
            last_error = error
            if attempt < 2:
                time.sleep(2**attempt)
    raise RuntimeError(f"Could not download {url}: {last_error}")


def main() -> None:
    parser = argparse.ArgumentParser()
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument("--all", action="store_true", help="download all 47 prefectures")
    selection.add_argument(
        "--prefecture",
        action="append",
        default=[],
        metavar="RXX",
        help="JARTIC prefecture ID, repeatable; R23 is Aichi",
    )
    parser.add_argument("--output", type=Path, default=Path("data/jartic/raw"))
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()

    catalog = json.loads(fetch(CATALOG_URL).decode("utf-8"))
    type_d = next((entry for entry in catalog if entry.get("type") == "typeD"), None)
    if type_d is None:
        raise RuntimeError("JARTIC catalog does not contain typeD traffic regulations")

    selected = type_d.get("targetList", [])
    if args.prefecture:
        wanted = set(args.prefecture)
        selected = [entry for entry in selected if entry.get("id") in wanted]
        missing = wanted - {entry.get("id") for entry in selected}
        if missing:
            raise RuntimeError(f"Unknown JARTIC prefecture IDs: {', '.join(sorted(missing))}")
    elif not args.all:
        selected = [entry for entry in selected if entry.get("id") == "R23"]

    args.output.mkdir(parents=True, exist_ok=True)
    snapshot = {
        "source": CATALOG_URL,
        "target_month": type_d.get("targetMonth"),
        "release_day": type_d.get("releaseDay"),
        "targets": selected,
    }
    (args.output / "catalog.json").write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    for entry in selected:
        url = BASE_URL + entry["link"]
        target = args.output / entry["link"].rsplit("/", 1)[-1]
        if target.exists() and not args.refresh:
            print(f"cached  {target.name}")
            continue
        payload = fetch(url)
        temporary = target.with_suffix(target.suffix + ".part")
        temporary.write_bytes(payload)
        if not zipfile.is_zipfile(temporary):
            temporary.unlink(missing_ok=True)
            raise RuntimeError(f"JARTIC download is not a ZIP archive: {url}")
        temporary.replace(target)
        print(f"downloaded  {target.name} ({len(payload) / 1_000_000:.1f} MB)")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1) from error
