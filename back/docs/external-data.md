# External routing data

This repository contains code and configuration. Downloaded routing data is kept out of Git and mounted read-only into the local Docker services. Keep upstream snapshots under `data/raw/<source>/`; keep normalized files consumed by the backend under `data/normalized/restrictions/` or `data/normalized/context/`. A raw file is never mounted as if it were a normalized routing input.

| Data | Source | Command | Storage | Update policy |
| --- | --- | --- | --- | --- |
| BRouter RD5 routing segments | [BRouter's official weekly segment directory](https://brouter.de/brouter/segments4/) | `./scripts/data/download_rd5.sh` | `brouter_extension/segments/` | Runtime data mounted into BRouter as `/segments4`; it is separate from our profiles and the unmodified upstream checkout. Run manually before a demo and when routing data needs refreshing. `--refresh` replaces each downloaded tile. |
| JARTIC Type-D traffic regulations, Aichi | [JARTIC official catalog](https://www.jartic.or.jp/d/opendata/opendata.json) | `python3 scripts/data/download_jartic.py` | `data/raw/jartic/` | Run manually each month. JARTIC replaces old monthly files. |
| JARTIC Type-D traffic regulations, nationwide | Same as above | `python3 scripts/data/download_jartic.py --all` | `data/raw/jartic/` | Run manually each month after validating the import on Aichi. |
| CyclerHub-back restriction overlay | Generated from JARTIC ZIPs | `python3 scripts/parse/import_jartic.py data/raw/jartic/*.zip` | `data/normalized/restrictions/jartic.geojson` | Regenerate after every JARTIC download. The default output contains JARTIC road-closure records and stays small enough for the routing backend. |
| MLIT temporary road-disruption overlay | [MLIT road-disaster information](https://www.mlit.go.jp/road/bosai/bosai.html) | Provider-specific normalized GeoJSON import | `data/normalized/restrictions/mlit.geojson` | Keep any downloaded source snapshot under `data/raw/mlit/`; replace the normalized file only after preserving its snapshot date and terms. |
| MLIT/JARTIC directional traffic volume | [JARTIC traffic volume API](https://www.jartic-open-traffic.org/) | `python3 scripts/data/download_traffic_volume.py` | `data/normalized/context/traffic_volume.geojson` | Refresh one current 5-minute or hourly snapshot within API limits; preserve observation and retrieval times and coverage gaps. |
| NPA accident history | [NPA traffic-accident open data](https://www.npa.go.jp/publications/statistics/koutsuu/opendata/index_opendata.html) | `python3 scripts/data/download_npa_accidents.py` | `data/normalized/context/npa_accidents.geojson` plus `data/raw/npa/` | Download annual releases and normalize selected non-identifying fields. Historical context only. |

`download_rd5.sh` queries BRouter's official directory index before it downloads. It ignores ocean-only cells that are absent from that directory, writes each download through a `.part` file, and replaces `manifest.tsv` only after the whole run succeeds. `--dry-run` prints the exact URLs selected today.

The current JARTIC adapter applies a narrow, reviewable rule: an unconditional JARTIC common restriction type `4` (road closed), with no vehicle code, becomes a hard block for an ordinary bicycle. Type `4` records carrying vehicle codes, time or day conditions, and every other restriction type are returned as route warnings until their vehicle exceptions, directionality, and schedule format have a dedicated mapper. This prevents an ambiguous record from being treated as a legal prohibition.

`--include-warnings` exports every unmapped JARTIC record for offline analysis or a map layer. Do not mount that large output into the routing backend.

## Other useful MLIT sources

MLIT's xROAD catalogue exposes several sources that can improve everyday bicycle decisions, but they do not all belong in the same routing layer:

| Source | Useful signal | Initial treatment |
| --- | --- | --- |
| [Road attributes and road network data](https://www.xroad.mlit.go.jp/) | Road class, managed-road attributes, designated heavy-vehicle routes, and other stable infrastructure metadata | Candidate routing enrichment after licensing and link matching are confirmed. Do not treat a vehicle designation as a bicycle prohibition without an explicit legal rule. |
| [National road facility inspection database](https://www.xroad.mlit.go.jp/database/221/) | Pavement, bridge, tunnel, and other facility inspection and repair status | Map context and maintenance-risk signal. Do not infer that an inspected facility is currently unsafe; retain the inspection date and management authority. |
| [Road Information Provision System](https://www.road-info-prvs.mlit.go.jp/roadinfo/sp/spTop_00_0.html) | Frequently refreshed road restrictions, weather, and surface information | Keep as a manual/provider-specific adapter until an official downloadable/API interface and reuse terms are confirmed. Do not scrape the live pages as a hidden backend dependency. |
| [National Land Numerical Information](https://nlftp.mlit.go.jp/ksj/) | Road lines, elevation, land use, public facilities, and disaster-risk layers | Stable geographic context and preprocessing input. Each dataset has its own version and usage conditions; record the dataset page and license in the snapshot metadata. |
| [Road traffic census / OD data](https://view.xroad.mlit.go.jp/) | Historical area-level flows and trip purposes | Planning and explanation context, not live traffic and not a direct legal or comfort penalty. |

The next technically useful addition is a versioned road-attribute import. It requires a link-matching layer between the source road identifiers and BRouter geometry. The xROAD viewer's terms require source attribution and defer to third-party terms for linked databases, so a hobby project may use a downloaded snapshot only after recording the applicable terms; the viewer itself is not a blanket licence for every linked dataset. The current release has working local providers for traffic volume, NPA accidents, and JARTIC restrictions. The MLIT disruption provider boundary is implemented, but no official MLIT normalized snapshot/importer is included yet; additional MLIT sources remain planned adapters rather than guessed scrapers.

JARTIC's terms require source attribution when the data is displayed or used in the product. Show: `Traffic regulation information, Japan Road Traffic Information Center (JARTIC), processed by CyclerHub-back`, with the JARTIC data URL and the data retrieval date. The data updates monthly and may lag the regulation in the field; road signs and markings remain authoritative.

## Traffic volume API

`download_traffic_volume.py` uses the official WFS endpoint at `api.jartic-open-traffic.org/geoserver`. It requests one time slice, the national-road layer, and a bounding box, then converts the API's `MultiPoint` response and Japanese property names into the normalized fields consumed by `TrafficProvider`.

Examples:

```sh
python3 scripts/data/download_traffic_volume.py --kind 1h
python3 scripts/data/download_traffic_volume.py --kind 5m --bbox 136.7,35.0,137.1,35.3
```

The API is free for users who accept the traffic API terms. The terms permit use in applications but require an end-user-visible notice that the service uses the MLIT traffic API and that the content is not guaranteed by MLIT. The data is a reference value, can be unavailable or inaccurate, and access may be limited for high load. Do not present it as an official traffic survey. Our normalized metadata preserves the guidance URL, terms URL, observation time, retrieval time, source authority, and processing notice. Traffic volume influences only the traffic preference signal and map context.

## National Police Agency accident data

`download_npa_accidents.py` downloads the official annual `honhyo_<year>.csv` files, keeps the source CSV locally, and writes a GeoJSON layer with coordinates, time, fatalities, injuries, bicycle involvement, and selected road attributes. The source coordinates are packed degrees/minutes/seconds values and are converted to decimal degrees during normalization. Bicycle involvement uses the NPA party codes for bicycles (`51`) and electric-assist bicycles (`52`). It intentionally omits party ages and other party-level fields from the map layer.

Examples:

```sh
python3 scripts/data/download_npa_accidents.py --year 2025
python3 scripts/data/download_npa_accidents.py --year 2023 --year 2024 --year 2025 --refresh
```

The NPA publishes these datasets with the Public Data License 1.0. Public use, editing, and hobby use are allowed with source attribution and a clear statement that CyclerHub-back processed the data. The source page also warns that later corrections may not be reflected in the published file. The accident layer is historical context only: it does not indicate a current incident, closure, legal restriction, or guaranteed safety level.

## MLIT restriction snapshots

`data/normalized/restrictions/mlit.geojson` remains an importer boundary rather than a guessed scraper. The MLIT road-information site is public, but its live display is reference information and the site warns that restrictions can change before travel. We will only add an MLIT file after identifying an official downloadable GIS/JSON source and documenting its terms and update method. Until then, the `mlit` provider is disabled when the file is absent; no data is fabricated.

## Local and public-use rules

All downloaded data stays local and is mounted read-only into the backend. Source metadata is returned by `/v1/routing-sources` and `/v1/map-data`. Do not remove attribution, imply government endorsement, or describe traffic observations or accident history as guarantees. User reports are first-party community content and are labelled separately from all official sources.

## Local processing audit (2026-10-25)

JARTIC's catalog request and the cached Aichi ZIP importer passed (4,885
features). NPA's cached 2025 CSV normalized successfully (287,023 points);
occurrence times use Asia/Tokyo, with the annual evidence window in metadata.
The MLIT/JARTIC live traffic API returned a current nationwide snapshot (994
measurement points). BRouter's official segment index and all 35 installed
Japan RD5 filenames were checked; real routing is checked separately.
MLIT disruption snapshots remain absent/disabled; no guessed MLIT file is
created. All installed normalized sources loaded successfully, so none were
removed. Refreshes are manual and require a backend restart to reload.

Traffic snapshots older than four hours cannot rank routes. Quality flags and
directional counts remain visible as source data, but current scoring is a
near-route station-count approximation, not directional road-link matching.
