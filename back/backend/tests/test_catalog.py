import json
from pathlib import Path

import pytest

from app.catalog import CatalogError, RoutingCatalog


@pytest.fixture
def catalog() -> RoutingCatalog:
    path = Path(__file__).parents[2] / "config" / "routing_catalog.json"
    return RoutingCatalog(json.loads(path.read_text(encoding="utf-8")))


def test_city_defaults_resolve_to_brouter_parameters(catalog: RoutingCatalog) -> None:
    policy = catalog.resolve("city", {})
    assert policy.brouter_profile == "japan_bicycle"
    assert policy.preferences["walking_mode"] == "short"
    assert policy.brouter_parameters == {
        "hill_mode": "1", "traffic_mode": "1", "surface_mode": "1", "walking_mode": "1",
        "vehicle_mass": "90", "biker_power": "100", "rolling_resistance": "0.010",
        "rough_surface_tolerance": "1.0",
    }


def test_each_supported_bike_type_has_distinct_route_parameters(catalog: RoutingCatalog) -> None:
    road = catalog.resolve("road", {})
    mamachari = catalog.resolve("mamachari", {})

    assert road.brouter_profile == mamachari.brouter_profile == "japan_bicycle"
    assert road.brouter_parameters["biker_power"] == "150"
    assert mamachari.brouter_parameters["vehicle_mass"] == "120"
    assert road.preferences["walking_mode"] == "never"


def test_invalid_preference_is_rejected(catalog: RoutingCatalog) -> None:
    with pytest.raises(CatalogError, match="Unsupported value"):
        catalog.resolve("city", {"walking_mode": "maybe"})
