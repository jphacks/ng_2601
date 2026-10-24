from datetime import datetime

from app.restrictions import CompositeRestrictionProvider, GeoJsonRestrictionProvider


def test_restriction_hit_when_route_crosses_block(tmp_path):
    source = tmp_path / "restrictions.geojson"
    source.write_text(
        """{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"LineString","coordinates":[[136.0,35.0],[136.0,35.1]]},"properties":{"id":"closure-1","source":"JARTIC","enforcement":"block","vehicle_classes":["ordinary_bicycle"]}}]}"""
    )
    provider = GeoJsonRestrictionProvider.from_path(source)
    route = {
        "features": [
            {"geometry": {"type": "LineString", "coordinates": [[135.9, 35.05], [136.1, 35.05]]}}
        ]
    }

    hits = provider.active_hits(route, "ordinary_bicycle", datetime(2026, 10, 24, 9, 0))

    assert [hit.restriction_id for hit in hits] == ["closure-1"]


def test_restriction_ignores_other_vehicle_classes(tmp_path):
    source = tmp_path / "restrictions.geojson"
    source.write_text(
        """{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[136.0,35.0]},"properties":{"id":"car-only","source":"JARTIC","enforcement":"block","vehicle_classes":["car"]}}]}"""
    )
    provider = GeoJsonRestrictionProvider.from_path(source)
    route = {"features": [{"geometry": {"type": "LineString", "coordinates": [[135.9, 35.0], [136.1, 35.0]]}}]}

    assert provider.active_hits(route, "ordinary_bicycle", datetime(2026, 10, 24, 9, 0)) == []


def test_composite_status_and_hits_preserve_source_identity(tmp_path):
    source = tmp_path / "mlit.geojson"
    source.write_text(
        """{"type":"FeatureCollection","metadata":{"authority":"MLIT","source_kind":"temporary_disruption","retrieved_at":"2026-10-24T00:00:00+00:00"},"features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[136.0,35.0]},"properties":{"id":"mlit-1","source":"MLIT road disaster information","enforcement":"block","vehicle_classes":["ordinary_bicycle"]}}]}"""
    )
    provider = CompositeRestrictionProvider.from_paths({"mlit": source, "jartic": None})
    route = {"features": [{"geometry": {"type": "LineString", "coordinates": [[135.9, 35.0], [136.1, 35.0]]}}]}

    hits = provider.active_hits(route, "ordinary_bicycle", datetime(2026, 10, 24, 9, 0))

    assert hits[0].source_id == "mlit"
    assert hits[0].authority == "MLIT"
    assert provider.status()["sources"]["mlit"]["feature_count"] == 1


def test_features_in_bbox_checks_geometry_not_only_feature_envelope(tmp_path):
    source = tmp_path / "restrictions.geojson"
    source.write_text(
        """{"type":"FeatureCollection","features":[
        {"type":"Feature","geometry":{"type":"LineString","coordinates":[[0.0,0.0],[1.0,1.0]]},"properties":{"id":"miss"}},
        {"type":"Feature","geometry":{"type":"LineString","coordinates":[[0.0,0.0],[1.0,1.0]]},"properties":{"id":"hit"}}
        ]}"""
    )
    provider = GeoJsonRestrictionProvider.from_path(source)

    # The first query's rectangle overlaps the line's coordinate envelope but
    # the diagonal itself never enters it. The second rectangle is crossed.
    assert [feature["properties"]["id"] for feature in provider.features_in_bbox((0.2, 0.7, 0.3, 0.8))] == []
    assert [feature["properties"]["id"] for feature in provider.features_in_bbox((0.2, 0.2, 0.3, 0.3))] == ["miss", "hit"]
    assert len(provider.features_in_bbox((0.2, 0.2, 0.3, 0.3), limit=1)) == 1
