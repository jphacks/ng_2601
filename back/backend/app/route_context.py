"""Non-restriction route context with explicit provenance."""

from __future__ import annotations

import json
import math
from datetime import datetime
from pathlib import Path
from typing import Any

from .restrictions import _geometry_intersects_bbox, _route_segments


def _distance_m(point: list[float], a: list[float], b: list[float]) -> float:
    """Approximate point-to-segment distance in metres for Japan-scale routes."""
    scale_x = 111_000 * math.cos(math.radians((a[1] + b[1]) / 2))
    scale_y = 111_000
    px, py = point[0] * scale_x, point[1] * scale_y
    ax, ay = a[0] * scale_x, a[1] * scale_y
    bx, by = b[0] * scale_x, b[1] * scale_y
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy or 1)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _route_length_m(segments: list[tuple[list[float], list[float]]]) -> float:
    return sum(
        math.hypot((b[0] - a[0]) * 111_000 * math.cos(math.radians((a[1] + b[1]) / 2)), (b[1] - a[1]) * 111_000)
        for a, b in segments
    )


def _point_near_route(point: list[float], segments: list[tuple[list[float], list[float]]], radius_m: float) -> bool:
    return any(_distance_m(point, start, end) <= radius_m for start, end in segments)


class GeoJsonRouteContext:
    def __init__(self, path: str | Path | None, source_id: str, radius_m: float = 100) -> None:
        self.source_id = source_id
        self.radius_m = radius_m
        self.path = Path(path) if path else None
        self.collection: dict[str, Any] = {}
        if self.path and self.path.is_file():
            with self.path.open(encoding="utf-8") as source_file:
                self.collection = json.load(source_file)

    @property
    def enabled(self) -> bool:
        return bool(self.collection)

    @property
    def metadata(self) -> dict[str, Any]:
        return self.collection.get("metadata", {})

    def status(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "source_id": self.source_id,
            "feature_count": len(self.collection.get("features", [])),
            "path": str(self.path) if self.path else None,
            "metadata": self.metadata,
        }

    def nearby_properties(self, segments: list[tuple[list[float], list[float]]]) -> list[dict[str, Any]]:
        # Reject distant points before the more expensive per-segment metric
        # check. Annual nationwide NPA snapshots contain hundreds of thousands
        # of points; comparing each one to every route segment stalls requests.
        points = [point for segment in segments for point in segment]
        if not points:
            return []
        latitude_padding = self.radius_m / 111_000
        longitude_padding = latitude_padding / max(0.01, math.cos(math.radians(max(abs(p[1]) for p in points))))
        west = min(p[0] for p in points) - longitude_padding
        east = max(p[0] for p in points) + longitude_padding
        south = min(p[1] for p in points) - latitude_padding
        north = max(p[1] for p in points) + latitude_padding
        results = []
        for feature in self.collection.get("features", []):
            geometry = feature.get("geometry") or {}
            point = geometry.get("coordinates") if geometry.get("type") == "Point" else None
            if point and west <= point[0] <= east and south <= point[1] <= north and _point_near_route(point, segments, self.radius_m):
                results.append(feature.get("properties") or {})
        return results

    def features_in_bbox(
        self, bbox: tuple[float, float, float, float], limit: int | None = None
    ) -> list[dict[str, Any]]:
        """Return map features with source metadata attached and no local paths."""
        results: list[dict[str, Any]] = []
        for feature in self.collection.get("features", []):
            geometry = feature.get("geometry") or {}
            if not _geometry_intersects_bbox(geometry, bbox):
                continue
            properties = dict(feature.get("properties") or {})
            properties.update(
                {
                    "source_id": self.source_id,
                    "authority": self.metadata.get("authority", properties.get("authority")),
                    "source": self.metadata.get("source", properties.get("source")),
                    "source_kind": self.metadata.get("source_kind", properties.get("source_kind")),
                    "confidence": self.metadata.get("confidence", properties.get("confidence")),
                    "dataset_version": self.metadata.get("dataset_version", properties.get("dataset_version")),
                    "retrieved_at": self.metadata.get("retrieved_at", properties.get("retrieved_at")),
                }
            )
            results.append({"type": "Feature", "geometry": geometry, "properties": properties})
            if limit is not None and len(results) >= limit:
                break
        return results


class AccidentHistoryProvider(GeoJsonRouteContext):
    def aggregate(self, route: dict[str, Any], evaluated_at: datetime) -> dict[str, Any]:
        segments = list(_route_segments(route))
        if not self.enabled or not segments:
            return {"status": "unavailable", "source_id": self.source_id}
        hits = self.nearby_properties(segments)
        window = self.metadata.get("window")
        return {
            # A loaded dataset with zero nearby records is a complete query
            # result.  ``coverage`` describes the dataset's completeness;
            # zero hits must not make an otherwise available source look
            # degraded.
            "status": "available",
            "source_id": self.source_id,
            "authority": self.metadata.get("authority", "National Police Agency"),
            "source": self.metadata.get("source", "NPA traffic-accident open data"),
            "dataset_version": self.metadata.get("dataset_version"),
            "retrieved_at": self.metadata.get("retrieved_at"),
            "evaluated_at": evaluated_at.isoformat(),
            "window": window,
            "radius_m": self.radius_m,
            "total_accidents": len(hits),
            "bicycle_involved_accidents": sum(bool(item.get("bicycle_involved")) for item in hits),
            "fatal_or_serious_accidents": sum(bool(item.get("fatal_or_serious")) for item in hits),
            "coverage": self.metadata.get("coverage", "partial"),
        }


class TrafficProvider(GeoJsonRouteContext):
    def assess(self, route: dict[str, Any], mode: str, evaluated_at: datetime) -> dict[str, Any]:
        segments = list(_route_segments(route))
        route_length = _route_length_m(segments)
        if not self.enabled or not segments:
            return {"status": "unavailable", "source_id": self.source_id, "routing_penalty": 0}
        observations = self.nearby_properties(segments)
        values = [float(item.get("vehicle_count", 0)) for item in observations]
        # A local file can outlive the traffic it describes. Never rank a
        # present-day trip using an old or undated measurement snapshot.
        observed_at = self.metadata.get("observed_at")
        try:
            timestamp = datetime.fromisoformat(str(observed_at).replace("Z", "+00:00"))
            age = (evaluated_at - timestamp).total_seconds() if timestamp.tzinfo else None
        except (ValueError, TypeError):
            age = None
        fresh = age is not None and 0 <= age <= 4 * 60 * 60
        matched_length = min(route_length, len(observations) * 250.0)
        coverage = matched_length / route_length if route_length else 0
        weight = {"avoid": 1.0, "balanced": 0.35, "direct": 0.0}.get(mode, 0.35)
        return {
            "status": "unavailable" if age is None else "stale" if not fresh else "available" if coverage >= 0.5 else "partial",
            "source_id": self.source_id,
            "authority": self.metadata.get("authority", "MLIT"),
            "source": self.metadata.get("source", "MLIT/JARTIC traffic volume API"),
            "retrieved_at": self.metadata.get("retrieved_at"),
            "evaluated_at": evaluated_at.isoformat(),
            "observed_at": observed_at,
            "observation_age_seconds": round(age) if age is not None else None,
            "matched_length_m": round(matched_length, 1),
            "route_length_m": round(route_length, 1),
            "coverage_ratio": round(coverage, 3),
            "observation_count": len(observations),
            "routing_penalty": round(sum(values) * weight, 2) if fresh and coverage >= 0.5 else 0,
        }
