# External data and routing policy

This page is the backend's reference for external data: where it comes from, how it is refreshed, and what effect it has on routes. The [API contract](api.md) defines response fields; [environment setup](environment.md) gives the local startup steps.

Downloaded routing data is kept out of Git and mounted read-only into local Docker services. Keep upstream snapshots under `data/raw/<source>/`; keep normalized files consumed by the backend under `data/normalized/restrictions/` or `data/normalized/context/`. A raw file is never mounted as if it were a normalized routing input.

| Data | Source | Command | Storage | Update policy |
| --- | --- | --- | --- | --- |
| BRouter RD5 routing segments | [BRouter's official weekly segment directory](https://brouter.de/brouter/segments4/) | `./scripts/data/download_rd5.sh` | `brouter_extension/segments/` | Runtime data mounted into BRouter as `/segments4`; it is separate from our profiles and the unmodified upstream checkout. Run manually before a demo and when routing data needs refreshing. `--refresh` replaces each downloaded tile. |
| JARTIC Type-D traffic regulations, Aichi | [JARTIC official catalog](https://www.jartic.or.jp/d/opendata/opendata.json) | `python3 scripts/data/download_jartic.py` | `data/raw/jartic/` | Run manually each month. JARTIC replaces old monthly files. |
| JARTIC Type-D traffic regulations, nationwide | Same as above | `python3 scripts/data/download_jartic.py --all` | `data/raw/jartic/` | Run manually each month after validating the import on Aichi. |
| CyclerHub-back restriction overlay | Generated from JARTIC ZIPs | `python3 scripts/parse/import_jartic.py data/raw/jartic/*.zip` | `data/normalized/restrictions/jartic.geojson` | Regenerate after every JARTIC download. The default output contains JARTIC road-closure records and stays small enough for the routing backend. |
| MLIT/JARTIC directional traffic volume | [JARTIC traffic volume API](https://www.jartic-open-traffic.org/) | `python3 scripts/data/download_traffic_volume.py` | `data/normalized/context/traffic_volume.geojson` | Refresh one current 5-minute or hourly snapshot within API limits; preserve observation and retrieval times and coverage gaps. |
| NPA accident history | [NPA traffic-accident open data](https://www.npa.go.jp/publications/statistics/koutsuu/opendata/index_opendata.html) | `python3 scripts/data/download_npa_accidents.py` | `data/normalized/context/npa_accidents.geojson` plus `data/raw/npa/` | Download annual releases and normalize selected non-identifying fields. Historical context only. |

## What affects route selection

| Source | Current role | Route selection |
| --- | --- | --- |
| OpenStreetMap in BRouter RD5 | Road geometry, bicycle access, one-way rules, surfaces and paths | Base graph and bicycle profile costs |
| JARTIC regulations | Official traffic regulations; current importer supports Aichi by default and can download all prefectures | Only unambiguous unconditional road-closure records can block a candidate; other records are warnings |
| MLIT/JARTIC traffic volume | Observed counts at selected national-road measurement locations | Can rank BRouter candidates when coverage and freshness are adequate; cannot create a legal closure |
| NPA accident history | Historical incidents near the chosen route | Context only; does not choose or block a route |
| Community reports | Local user observations | Map context only, pending a separate validation policy |
| CoreS3 surface events | Experimental measurements | Map context only; see the [experimental API](api.md#experimental-cores3-road-surface-measurements) |

Sources retain their authority, observation/retrieval time, confidence, and attribution independently. A route response keeps legal restrictions in `restriction_assessment` and traffic and accident history in `route_context`. Map layers likewise distinguish official sources, reports, and experimental measurements.

`download_rd5.sh` queries BRouter's official directory index before it downloads. It ignores ocean-only cells that are absent from that directory, writes each download through a `.part` file, and replaces `manifest.tsv` only after the whole run succeeds. `--dry-run` prints the exact URLs selected today.

The current JARTIC adapter applies a narrow, reviewable rule: an unconditional JARTIC common restriction type `4` (road closed), with no vehicle code, becomes a hard block for an ordinary bicycle. Type `4` records carrying vehicle codes, time or day conditions, and every other restriction type are returned as route warnings until their vehicle exceptions, directionality, and schedule format have a dedicated mapper. This prevents an ambiguous record from being treated as a legal prohibition.

JARTIC records include point, line and area geometry, vehicle classes, directions, and time/day conditions. The next mapper should handle type `11` one-way rules with directed geometry and bicycle exceptions. Types `5` (vehicle closed) and `13` (no entry) require verified target and exemption codes; time and weekday conditions need structured evaluation in Asia/Tokyo. Signs and markings take precedence over a delayed dataset.

The restriction provider retains source metadata in its hits. The frontend should use that metadata for source labels, freshness, and attribution instead of inferring a source from alert text.

`--include-warnings` exports every unmapped JARTIC record for offline analysis or a map layer. Do not mount that large output into the routing backend.

JARTIC's terms require source attribution when the data is displayed or used in the product. Show: `Traffic regulation information, Japan Road Traffic Information Center (JARTIC), processed by CyclerHub-back`, with the JARTIC data URL and the data retrieval date. The data updates monthly and may lag the regulation in the field; road signs and markings remain authoritative.

## Traffic volume API

`download_traffic_volume.py` uses the official WFS endpoint at `api.jartic-open-traffic.org/geoserver`. It requests one time slice, the national-road layer, and a bounding box, then converts the API's `MultiPoint` response and Japanese property names into the normalized fields consumed by `TrafficProvider`.

Examples:

```sh
python3 scripts/data/download_traffic_volume.py --kind 1h
python3 scripts/data/download_traffic_volume.py --kind 5m --bbox 136.7,35.0,137.1,35.3
```

The API is free for users who accept the traffic API terms. The terms permit use in applications but require an end-user-visible notice that the service uses the MLIT traffic API and that the content is not guaranteed by MLIT. The data is a reference value, can be unavailable or inaccurate, and access may be limited for high load. Do not present it as an official traffic survey. Our normalized metadata preserves the guidance URL, terms URL, observation time, retrieval time, source authority, and processing notice. Traffic volume influences only the traffic preference signal and map context.

The backend requests up to three BRouter candidates when a restriction or traffic provider is enabled. The traffic provider uses nearby measurement points and a 50% coverage threshold to rank candidates marked `available`; otherwise it returns the first legal candidate with `partial`, `stale`, or `unavailable` context. Snapshots older than four hours do not rank routes. `avoid` prefers lower measured exposure where covered, `balanced` applies a modest traffic adjustment, and `direct` keeps the first legal candidate. The BRouter profile already supplies a static road-class traffic cost; dynamic measurements are applied once at candidate selection. Current scoring approximates exposure using nearby stations, without directional road-link matching. The UI should show coverage and observation time, not imply that an unmeasured road is quiet.

## National Police Agency accident data

`download_npa_accidents.py` downloads the official annual `honhyo_<year>.csv` files, keeps the source CSV locally, and writes a GeoJSON layer with coordinates, time, fatalities, injuries, bicycle involvement, and selected road attributes. The source coordinates are packed degrees/minutes/seconds values and are converted to decimal degrees during normalization. Bicycle involvement uses the NPA party codes for bicycles (`51`) and electric-assist bicycles (`52`). It intentionally omits party ages and other party-level fields from the map layer.

Examples:

```sh
python3 scripts/data/download_npa_accidents.py --year 2025
python3 scripts/data/download_npa_accidents.py --year 2023 --year 2024 --year 2025 --refresh
```

The NPA publishes these datasets with the Public Data License 1.0. Public use, editing, and hobby use are allowed with source attribution and a clear statement that CyclerHub-back processed the data. The source page also warns that later corrections may not be reflected in the published file. The accident layer is historical context only: it does not indicate a current incident, closure, legal restriction, or guaranteed safety level.

The current provider matches points within 100 m of the selected route and aggregates the loaded local snapshot. It reports the snapshot's evidence window; it does not yet apply a separate rolling three-year filter or direction-aware link matching. Future analysis may add explicit unmatched states, a selected year window, and stronger coverage measures. A lack of matched incidents must not be presented as proof of safety.

## Local and public-use rules

All downloaded data stays local and is mounted read-only into the backend. Source metadata is returned by `/v1/routing-sources` and `/v1/map-data`. Do not remove attribution, imply government endorsement, or describe traffic observations or accident history as guarantees. User reports are first-party community content and are labelled separately from all official sources.

Refreshes are manual and require a backend restart to reload normalized sources.
