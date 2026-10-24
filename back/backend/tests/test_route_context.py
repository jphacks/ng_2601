from datetime import datetime, timezone

from app.route_context import AccidentHistoryProvider, TrafficProvider


ROUTE = {"features": [{"geometry": {"type": "LineString", "coordinates": [[136.0, 35.0], [136.001, 35.0]]}}]}


def test_accident_context_aggregates_with_provenance(tmp_path):
    path = tmp_path / "accidents.geojson"
    path.write_text(
        '{"type":"FeatureCollection","metadata":{"source":"NPA","dataset_version":"2024","window":{"from":"2022-01-01","to":"2024-12-31"}},"features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[136.0005,35.0]},"properties":{"bicycle_involved":true,"fatal_or_serious":false}}]}'
    )
    context = AccidentHistoryProvider(path, "npa_accident_history").aggregate(ROUTE, datetime(2026, 10, 24, tzinfo=timezone.utc))

    assert context["source_id"] == "npa_accident_history"
    assert context["status"] == "available"
    assert context["total_accidents"] == 1
    assert context["bicycle_involved_accidents"] == 1


def test_accident_context_with_no_nearby_records_is_available(tmp_path):
    path = tmp_path / "accidents.geojson"
    path.write_text(
        '{"type":"FeatureCollection","metadata":{"coverage":"nationwide"},"features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[137.0,35.0]},"properties":{}}]}'
    )
    context = AccidentHistoryProvider(path, "npa_accident_history").aggregate(
        ROUTE, datetime(2026, 10, 24, tzinfo=timezone.utc)
    )

    assert context["status"] == "available"
    assert context["total_accidents"] == 0


def test_traffic_context_reports_partial_coverage_and_source(tmp_path):
    path = tmp_path / "traffic.geojson"
    path.write_text(
        '{"type":"FeatureCollection","metadata":{"authority":"MLIT","source":"traffic API","retrieved_at":"2026-10-24T00:00:00+00:00"},"features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[136.0005,35.0]},"properties":{"vehicle_count":120}}]}'
    )
    context = TrafficProvider(path, "mlit_jartic_traffic_volume").assess(ROUTE, "avoid", datetime(2026, 10, 24, tzinfo=timezone.utc))

    assert context["source_id"] == "mlit_jartic_traffic_volume"
    assert context["observation_count"] == 1
    assert context["routing_penalty"] > 0


def test_map_context_bbox_uses_geometry_intersection(tmp_path):
    path = tmp_path / "context.geojson"
    path.write_text(
        '{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"LineString","coordinates":[[0,0],[1,1]]},"properties":{"id":"diagonal"}}]}'
    )
    context = AccidentHistoryProvider(path, "test_context")

    assert context.features_in_bbox((0.2, 0.7, 0.3, 0.8)) == []
    assert context.features_in_bbox((0.2, 0.2, 0.3, 0.3))[0]["properties"]["id"] == "diagonal"
