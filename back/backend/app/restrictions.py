"""External routing restrictions, independent of any database schema."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable


@dataclass(frozen=True)
class RestrictionHit:
    restriction_id: str
    source: str
    enforcement: str
    name: str
    source_id: str = "unknown"
    authority: str = "unknown"
    source_kind: str = "official"
    observed_at: str | None = None
    retrieved_at: str | None = None
    confidence: str = "unknown"


class RestrictionProvider:
    def active_hits(
        self, route: dict[str, Any], vehicle_class: str, evaluated_at: datetime
    ) -> list[RestrictionHit]:
        return []

    def status(self) -> dict[str, Any]:
        return {"enabled": False, "feature_count": 0}

    def features_in_bbox(
        self,
        bbox: tuple[float, float, float, float],
        evaluated_at: datetime | None = None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        return []


class CompositeRestrictionProvider(RestrictionProvider):
    """Combines independent source files without erasing their provenance."""

    def __init__(self, providers: dict[str, RestrictionProvider]) -> None:
        self._providers = providers

    @classmethod
    def from_paths(cls, paths: dict[str, str | Path | None]) -> "CompositeRestrictionProvider":
        return cls({source_id: GeoJsonRestrictionProvider.from_path(path, source_id) for source_id, path in paths.items()})

    def active_hits(self, route: dict[str, Any], vehicle_class: str, evaluated_at: datetime) -> list[RestrictionHit]:
        hits: list[RestrictionHit] = []
        for provider in self._providers.values():
            hits.extend(provider.active_hits(route, vehicle_class, evaluated_at))
        return hits

    def status(self) -> dict[str, Any]:
        sources = {source_id: provider.status() for source_id, provider in self._providers.items()}
        return {
            "enabled": any(source["enabled"] for source in sources.values()),
            "feature_count": sum(source["feature_count"] for source in sources.values()),
            "sources": sources,
        }

    def features_in_bbox(
        self,
        bbox: tuple[float, float, float, float],
        evaluated_at: datetime | None = None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        features: list[dict[str, Any]] = []
        for provider in self._providers.values():
            remaining = None if limit is None else max(limit - len(features), 0)
            if remaining == 0:
                break
            features.extend(provider.features_in_bbox(bbox, evaluated_at, remaining))
        return features


class GeoJsonRestrictionProvider(RestrictionProvider):
    def __init__(self, collection: dict[str, Any], source_path: Path, source_id: str = "unknown") -> None:
        self._features = [
            (feature, _bbox_from_geometry(feature.get("geometry") or {}))
            for feature in collection.get("features", [])
        ]
        self._metadata = collection.get("metadata", {})
        self._source_path = source_path
        self._source_id = source_id
        self._source_metadata = collection.get("metadata", {})

    @classmethod
    def from_path(cls, path: str | Path | None, source_id: str = "unknown") -> RestrictionProvider:
        if not path:
            return RestrictionProvider()
        source_path = Path(path)
        if not source_path.is_file():
            return RestrictionProvider()
        with source_path.open(encoding="utf-8") as source_file:
            return cls(json.load(source_file), source_path, source_id)

    def active_hits(
        self, route: dict[str, Any], vehicle_class: str, evaluated_at: datetime
    ) -> list[RestrictionHit]:
        route_segments = list(_route_segments(route))
        route_bbox = _bbox_from_segments(route_segments)
        hits: list[RestrictionHit] = []
        for feature, feature_bbox in self._features:
            if route_bbox is None or feature_bbox is None or not _bboxes_overlap(route_bbox, feature_bbox):
                continue
            properties = feature.get("properties") or {}
            if vehicle_class not in properties.get("vehicle_classes", [vehicle_class]):
                continue
            if not _active_now(properties, evaluated_at):
                continue
            if _intersects_any(route_segments, feature.get("geometry") or {}):
                hits.append(
                    RestrictionHit(
                        restriction_id=str(properties.get("id", "unknown")),
                        source=str(properties.get("source", self._source_metadata.get("source", "unknown"))),
                        enforcement=str(properties.get("enforcement", "warn")),
                        name=str(properties.get("name", "")),
                        source_id=self._source_id,
                        authority=str(properties.get("authority", self._source_metadata.get("authority", "unknown"))),
                        source_kind=str(properties.get("source_kind", self._source_metadata.get("source_kind", "official"))),
                        observed_at=properties.get("observed_at", self._source_metadata.get("observed_at")),
                        retrieved_at=properties.get("retrieved_at", self._source_metadata.get("retrieved_at", self._source_metadata.get("generated_at"))),
                        confidence=str(properties.get("confidence", self._source_metadata.get("confidence", "unknown"))),
                    )
                )
        return hits

    def status(self) -> dict[str, Any]:
        return {
            "enabled": True,
            "feature_count": len(self._features),
            "path": str(self._source_path),
            "metadata": self._metadata,
            "source_id": self._source_id,
        }

    def features_in_bbox(
        self,
        bbox: tuple[float, float, float, float],
        evaluated_at: datetime | None = None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        features: list[dict[str, Any]] = []
        for feature, feature_bbox in self._features:
            geometry = feature.get("geometry") or {}
            if feature_bbox is None or not _geometry_intersects_bbox(geometry, bbox):
                continue
            properties = dict(feature.get("properties") or {})
            if evaluated_at is not None and not _active_now(properties, evaluated_at):
                continue
            properties.update(
                {
                    "source_id": self._source_id,
                    "authority": self._source_metadata.get("authority", properties.get("authority")),
                    "source": self._source_metadata.get("source", properties.get("source")),
                    "source_kind": self._source_metadata.get("source_kind", properties.get("source_kind")),
                    "confidence": self._source_metadata.get("confidence", properties.get("confidence")),
                    "dataset_version": self._source_metadata.get("dataset_version", properties.get("dataset_version")),
                    "retrieved_at": self._source_metadata.get("retrieved_at", properties.get("retrieved_at")),
                }
            )
            features.append({"type": "Feature", "geometry": feature.get("geometry"), "properties": properties})
            if limit is not None and len(features) >= limit:
                break
        return features


def _active_now(properties: dict[str, Any], evaluated_at: datetime) -> bool:
    """Apply only normalized schedules; raw provider fields remain warnings."""
    days = properties.get("days")
    if days is not None and evaluated_at.weekday() not in days:
        return False
    start, end = properties.get("start_time"), properties.get("end_time")
    if not start or not end:
        return True
    now = evaluated_at.strftime("%H:%M")
    return start <= now <= end if start <= end else now >= start or now <= end


def _route_segments(route: dict[str, Any]) -> Iterable[tuple[list[float], list[float]]]:
    for feature in route.get("features", []):
        geometry = feature.get("geometry") or {}
        yield from _segments_from_geometry(geometry)


def _segments_from_geometry(geometry: dict[str, Any]) -> Iterable[tuple[list[float], list[float]]]:
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates", [])
    lines: Iterable[list[list[float]]]
    if geometry_type == "LineString":
        lines = [coordinates]
    elif geometry_type == "MultiLineString":
        lines = coordinates
    elif geometry_type == "Polygon":
        lines = coordinates
    elif geometry_type == "MultiPolygon":
        lines = [ring for polygon in coordinates for ring in polygon]
    else:
        return
    for line in lines:
        for start, end in zip(line, line[1:]):
            yield start, end


def _intersects_any(route_segments: list[tuple[list[float], list[float]]], geometry: dict[str, Any]) -> bool:
    if geometry.get("type") == "Point":
        point = geometry.get("coordinates", [])
        return any(_point_near_segment(point, start, end) for start, end in route_segments)
    restriction_segments = list(_segments_from_geometry(geometry))
    return any(
        _segments_intersect(route_start, route_end, restriction_start, restriction_end)
        for route_start, route_end in route_segments
        for restriction_start, restriction_end in restriction_segments
    )


def _bbox_from_segments(
    segments: list[tuple[list[float], list[float]]],
) -> tuple[float, float, float, float] | None:
    points = [point for segment in segments for point in segment]
    if not points:
        return None
    return min(point[0] for point in points), min(point[1] for point in points), max(point[0] for point in points), max(point[1] for point in points)


def _bbox_from_geometry(geometry: dict[str, Any]) -> tuple[float, float, float, float] | None:
    points: list[list[float]] = []

    def visit(value: Any) -> None:
        if not isinstance(value, list) or not value:
            return
        if isinstance(value[0], (int, float)) and len(value) >= 2:
            points.append(value)
            return
        for child in value:
            visit(child)

    visit(geometry.get("coordinates", []))
    if not points:
        return None
    return min(point[0] for point in points), min(point[1] for point in points), max(point[0] for point in points), max(point[1] for point in points)


def _bboxes_overlap(
    left: tuple[float, float, float, float], right: tuple[float, float, float, float]
) -> bool:
    return left[0] <= right[2] and left[2] >= right[0] and left[1] <= right[3] and left[3] >= right[1]


def _point_in_bbox(point: list[float], bbox: tuple[float, float, float, float]) -> bool:
    return len(point) >= 2 and bbox[0] <= point[0] <= bbox[2] and bbox[1] <= point[1] <= bbox[3]


def _segment_intersects_bbox(
    start: list[float], end: list[float], bbox: tuple[float, float, float, float]
) -> bool:
    """Return whether a segment intersects an axis-aligned WGS84 bbox."""
    if len(start) < 2 or len(end) < 2:
        return False
    if _point_in_bbox(start, bbox) or _point_in_bbox(end, bbox):
        return True
    # Liang-Barsky clipping avoids treating a segment's coordinate envelope as
    # the segment itself.
    dx, dy = end[0] - start[0], end[1] - start[1]
    constraints = (
        (-dx, start[0] - bbox[0]),
        (dx, bbox[2] - start[0]),
        (-dy, start[1] - bbox[1]),
        (dy, bbox[3] - start[1]),
    )
    lower, upper = 0.0, 1.0
    for coefficient, value in constraints:
        if coefficient == 0:
            if value < 0:
                return False
            continue
        ratio = value / coefficient
        if coefficient < 0:
            lower = max(lower, ratio)
        else:
            upper = min(upper, ratio)
        if lower > upper:
            return False
    return True


def _point_in_ring(point: list[float], ring: list[list[float]]) -> bool:
    """Return whether a point is inside or on the boundary of a ring."""
    if len(point) < 2 or len(ring) < 3:
        return False
    inside = False
    for start, end in zip(ring, ring[1:] + ring[:1]):
        if _segment_intersects_bbox(start, end, (point[0], point[1], point[0], point[1])):
            return True
        if (start[1] > point[1]) != (end[1] > point[1]):
            crossing_lon = (end[0] - start[0]) * (point[1] - start[1]) / (end[1] - start[1]) + start[0]
            if point[0] < crossing_lon:
                inside = not inside
    return inside


def _point_in_polygon(point: list[float], rings: list[list[list[float]]]) -> bool:
    if not rings or not _point_in_ring(point, rings[0]):
        return False
    return not any(_point_in_ring(point, hole) for hole in rings[1:])


def _bbox_corners(bbox: tuple[float, float, float, float]) -> tuple[list[float], ...]:
    return (
        [bbox[0], bbox[1]],
        [bbox[0], bbox[3]],
        [bbox[2], bbox[1]],
        [bbox[2], bbox[3]],
    )


def _geometry_intersects_bbox(
    geometry: dict[str, Any], bbox: tuple[float, float, float, float]
) -> bool:
    """Return true only when the actual GeoJSON geometry touches the bbox."""
    geometry_type = geometry.get("type")
    if geometry_type == "GeometryCollection":
        return any(_geometry_intersects_bbox(item, bbox) for item in geometry.get("geometries", []))
    feature_bbox = _bbox_from_geometry(geometry)
    if feature_bbox is None or not _bboxes_overlap(feature_bbox, bbox):
        return False
    coordinates = geometry.get("coordinates", [])
    if geometry_type == "Point":
        return _point_in_bbox(coordinates, bbox)
    if geometry_type == "MultiPoint":
        return any(_point_in_bbox(point, bbox) for point in coordinates)
    if geometry_type in {"LineString", "MultiLineString", "Polygon", "MultiPolygon"}:
        if any(_segment_intersects_bbox(start, end, bbox) for start, end in _segments_from_geometry(geometry)):
            return True
    if geometry_type == "Polygon":
        return any(_point_in_polygon(corner, coordinates) for corner in _bbox_corners(bbox))
    if geometry_type == "MultiPolygon":
        return any(
            _point_in_polygon(corner, polygon)
            for polygon in coordinates
            for corner in _bbox_corners(bbox)
        )
    return False


def _orientation(a: list[float], b: list[float], c: list[float]) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _segments_intersect(a: list[float], b: list[float], c: list[float], d: list[float]) -> bool:
    left = _orientation(a, b, c) * _orientation(a, b, d)
    right = _orientation(c, d, a) * _orientation(c, d, b)
    return left <= 0 and right <= 0


def _point_near_segment(point: list[float], a: list[float], b: list[float]) -> bool:
    if len(point) < 2:
        return False
    scale_x = 111_000 * math.cos(math.radians((a[1] + b[1]) / 2))
    scale_y = 111_000
    px, py = point[0] * scale_x, point[1] * scale_y
    ax, ay = a[0] * scale_x, a[1] * scale_y
    bx, by = b[0] * scale_x, b[1] * scale_y
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy or 1)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy)) <= 20.0
