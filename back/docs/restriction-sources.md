# Restriction-source policy

CyclerHub-back uses a source only when it has a clear role in routing. The source must be versioned locally, attributed, and able to state the time it was evaluated.

| Source | What it provides | Freshness | Routing role | Decision |
| --- | --- | --- | --- | --- |
| OSM in BRouter RD5 | Road geometry, bicycle access, one-way tagging, surfaces, paths | Weekly BRouter build | Base graph and profile rules | In use |
| [JARTIC traffic-regulation open data](https://www.jartic.or.jp/service/opendata/) | Police-held point, line, and area regulations; vehicle classes; directions; time and day conditions | Monthly, generally based on the end of two months earlier | Legal restriction overlay | In use for Aichi; designed for all prefectures |
| [MLIT road-disaster information](https://www.mlit.go.jp/road/bosai/bosai.html) | Active road closures and disaster-related restrictions, including published GIS snapshots | Event-driven and snapshot-specific | Temporary disruption overlay | Supported as the `mlit` provider when `data/normalized/restrictions/mlit.geojson` is loaded |
| [MLIT/JARTIC traffic-volume API](https://www.jartic-open-traffic.org/) | Directional observed traffic counts at selected national-road measurement locations | 5-minute values are available about 20 minutes after observation; history is limited | Dynamic traffic context and a bounded route preference signal, never legal access | Supported through the local normalized GeoJSON cache; coverage and API terms remain visible |
| [National Police Agency traffic-accident open data](https://www.npa.go.jp/publications/statistics/koutsuu/opendata/index_opendata.html) | Published injury/fatal traffic-accident records with location, time, accident type, parties, road, weather, and surface attributes | Annual datasets, with later corrections possible | Historical safety context and route-quality analysis | Supported through the local normalized GeoJSON cache; never a current closure or automatic legal block |
| User reports | Local hazards, construction, missing information | Community-provided | Map warning; no routing effect until a separate validation policy promotes it | Database-backed `/v1/observations` API |

MLIT also publishes or links to useful non-restriction sources through [xROAD](https://www.xroad.mlit.go.jp/): road attributes, facility inspection data, road traffic census/OD data, and National Land Numerical Information. These can explain a route's stable infrastructure or maintenance context, but they need separate versioned importers and licensing checks. They should remain route context or geographic data until a source explicitly defines a bicycle-relevant legal rule. The live [Road Information Provision System](https://www.road-info-prvs.mlit.go.jp/roadinfo/sp/spTop_00_0.html) is useful for operator verification, but it is not treated as a backend API or scraped dependency in this release.

## Treatments

- `jartic`: official traffic regulation; may produce a legal route block when the mapper is explicit.
- `mlit`: official temporary road disruption or disaster information; may block only when the imported record explicitly says the road is closed.
- `npa_accident_history`: historical police accident statistics; advisory context only. \
e.g. “3 reported bicycle-involved injury crashes within 100 m during 2022–2024,”
- `user_report`: timestamped community observation or experience; advisory until validated.

All four may be displayed near one route, but their authority, freshness, and routing effect must remain visible independently.


## JARTIC & MLIT
### JARTIC
- Updated monthly
- Nationwide
- Based on prefectural police traffic-regulation databases
- Contains bicycle-specific regulations: one-way, entry, turn, time, day, vehicle, and geometry fields. 

NOTE: the current release may not match signs or markings at a location. Signs and road markings should prevail.

The first mapper accepts one unambiguous legal form: common restriction code `4` (road closed). A code-4 record becomes a hard route block only when its vehicle and temporal conditions are absent. Every other imported record is a warning. This is intentional: JARTIC's target and exemption vehicle codes include bicycles and light vehicles, and a wrong mapper could send a cyclist into a prohibited road or prohibit a permitted route.

The next mapper should handle code `11` one-way with its directed coordinate sequence and bicycle exceptions. After that, map code `5` vehicle closed and code `13` no entry only after the target and exemption codes are tested against the official code table. Time and weekday rules should be normalized into structured fields per condition set, then evaluated in Asia/Tokyo using the route request time.

The backend boundary is `RestrictionProvider`. `CompositeRestrictionProvider` evaluates the JARTIC and MLIT files independently, then combines their hits while retaining `source_id`, authority, source kind, observation/retrieval times, confidence, and attribution metadata. The frontend should group alerts by `source_id` and render the source-specific label, freshness, and attribution from that metadata; it should not infer source from filenames or alert text.

The expected files are `data/normalized/restrictions/jartic.geojson` and `data/normalized/restrictions/mlit.geojson`. Both are normalized GeoJSON, but they have different meanings: JARTIC records traffic regulations, while MLIT records temporary road disruption or disaster information. An MLIT record may be a hard route block only when the imported record explicitly has `enforcement: "block"`; otherwise it is a warning. Signs, markings, and current road conditions remain authoritative.



## Route contexts

Accident history and traffic volume are route context. They describe conditions or historical evidence around a route; they do not assert that a road is closed or that a cyclist is legally prohibited from using it. Keep them out of `restriction_assessment` and return them in a separate `route_context` object.

### National Police Agency accident records
- Annual traffic-accident open-data packages (published years are historical)
- Include: a point location, occurrence time, accident severity, involved-party types, accident classification, road form, traffic controls, weather, and road-surface fields.
- They do not determine a bicycle's direction or exact position on the roadway

The current provider aggregates every record in the loaded local snapshot and
matches point records within 100 m of the returned route. The snapshot's
metadata supplies its release/window; the provider does not yet apply a
separate rolling three-year filter or perform direction-aware link matching.
Those are validation and data-quality improvements for a later release.

The target aggregation should:

1. Match NPA accident points to the route using a declared radius and retain an `unmatched` state when the match is uncertain.
2. Apply an explicit time window, such as the most recent three complete calendar years, and a route distance buffer, such as 100 m around the route geometry.
3. Count distinct accident records, then optionally split by bicycle involvement, severity, accident type, intersection/road segment, and year.
4. Return the evidence window, radius, dataset release, sample size, and attribution with the aggregate. Do not return identifying detail or imply that an absence of records means a road is safe.

The response shape should be conceptually:

```json
{
  "route_context": {
    "accident_history": {
      "status": "available",
      "window": {"from": "2022-01-01", "to": "2024-12-31"},
      "radius_m": 100,
      "total_accidents": 3,
      "bicycle_involved_accidents": 2,
      "fatal_or_serious_accidents": 0,
      "coverage": "partial",
      "source_id": "npa_accident_history",
      "dataset_version": "2024"
    },
    "traffic": {"status": "unavailable"}
  }
}
```

`status` must distinguish `available`, `partial`, `unavailable`, and `stale`. A context aggregate can be shown on a map and route summary even when it has no routing effect.

## Using traffic volume for the traffic preference

The MLIT/JARTIC API provides direction-specific machine-observed traffic at selected national-road measurement points, including five-minute and one-hour values. Five-minute data is typically available about 20 minutes after observation, but the service is not a complete live traffic map: coverage is limited to participating measurement locations and the API warns that observations can be inaccurate or unavailable. The data is a reference value, not a formal MLIT traffic survey. [MLIT API release](https://www.mlit.go.jp/report/press/road01_hh_001930.html), [JARTIC traffic API guidance](https://www.jartic-open-traffic.org/)

Use it as a dynamic signal for `traffic_mode`, with these boundaries:

- `avoid`: prefer candidates with lower measured traffic exposure where the route is covered; do not penalize uncovered roads as if they were quiet.
- `balanced`: combine the existing OSM/BRouter road-class signal with a modest measured-traffic adjustment where coverage is current.
- `direct`: keep the route close to the normal cost function and show traffic context without a meaningful dynamic penalty.

Implement this in a separate `TrafficProvider`, not inside the legal restriction provider. It should cache API responses, honor the API terms and rate limits, normalize station geometry, direction, interval, vehicle count, observation time, retrieval time, and quality flags, and expose coverage for every route assessment.

The current route pipeline requests up to three BRouter candidates when a
restriction or traffic provider is enabled. It uses the traffic provider's
near-route point approximation and its 50% coverage threshold to rank only
`available` candidates. If no candidate has adequate coverage, it returns the
first legal candidate and marks the traffic signal `partial` or `unavailable`.
Direction-aware link matching, length-weighted station exposure, and more detailed
quality filtering remain planned improvements. Snapshots older than four hours
are returned as `stale` and never rank candidates. Never manufacture a low-traffic score
from missing measurements. Keep the existing BRouter `traffic_mode` as the
static baseline and apply the dynamic signal once, so the same preference is
not counted twice.

The UI should present “measured traffic coverage” and the observation time alongside the preference result. A route chosen using partial coverage should say so. Traffic volume can influence comfort ranking; it cannot create a closure, override a JARTIC or MLIT legal/official block, or establish that a bicycle route is unsafe by itself.
