"""Versioned routing policy catalogue."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class CatalogError(ValueError):
    pass


@dataclass(frozen=True)
class ResolvedRoutePolicy:
    bike_type: str
    brouter_profile: str
    ruleset: str
    preferences: dict[str, str]
    brouter_parameters: dict[str, str]
    vehicle_class: str


class RoutingCatalog:
    def __init__(self, raw: dict[str, Any]) -> None:
        self._raw = raw
        self._preferences = raw["preferences"]
        self._bike_types = raw["bike_types"]
        self._rulesets = raw["rulesets"]

    @classmethod
    def from_path(cls, path: str | Path) -> "RoutingCatalog":
        with Path(path).open(encoding="utf-8") as catalog_file:
            raw = json.load(catalog_file)
        if raw.get("schema_version") != 1:
            raise RuntimeError("Unsupported routing catalogue schema")
        return cls(raw)

    def resolve(self, bike_type: str, supplied: dict[str, str]) -> ResolvedRoutePolicy:
        bike = self._bike_types.get(bike_type)
        if bike is None:
            raise CatalogError(f"Unsupported bike_type: {bike_type}")
        unknown = set(supplied) - set(self._preferences)
        if unknown:
            raise CatalogError(f"Unsupported preference: {sorted(unknown)[0]}")

        preferences: dict[str, str] = {}
        brouter_parameters: dict[str, str] = {}
        for name, definition in self._preferences.items():
            value = supplied.get(name, bike["defaults"][name])
            if value not in definition["values"]:
                raise CatalogError(f"Unsupported value for {name}: {value}")
            preferences[name] = value
            brouter_parameters[name] = definition["brouter_values"][value]

        brouter_parameters.update(bike.get("brouter_parameters", {}))

        ruleset = bike["ruleset"]
        if ruleset not in self._rulesets:
            raise RuntimeError(f"Unknown ruleset configured for {bike_type}: {ruleset}")
        return ResolvedRoutePolicy(
            bike_type,
            bike["brouter_profile"],
            ruleset,
            preferences,
            brouter_parameters,
            self._rulesets[ruleset]["vehicle_class"],
        )

    def public_catalog(self) -> dict[str, Any]:
        return {
            "bike_types": {
                name: {"defaults": bike["defaults"], "capabilities": bike["capabilities"]}
                for name, bike in sorted(self._bike_types.items())
            },
            "preferences": {name: definition["values"] for name, definition in self._preferences.items()},
        }
