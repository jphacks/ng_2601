from __future__ import annotations

import os
from datetime import UTC, datetime
from typing import Annotated, Any, Literal
from uuid import UUID
from zoneinfo import ZoneInfo

import httpx
import psycopg
from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, StringConstraints, field_validator
from psycopg.types.json import Jsonb
from starlette.concurrency import run_in_threadpool

from .auth import AuthService, ModeratorTokenVerifier, build_auth_router
from .catalog import CatalogError, RoutingCatalog
from .context import NoUserPreferenceStore, PostgresUserPreferenceStore
from .route_context import AccidentHistoryProvider, TrafficProvider
from .restrictions import CompositeRestrictionProvider

JAPAN_TIMEZONE = ZoneInfo("Asia/Tokyo")
try:
    MAX_MAP_BBOX_AREA_DEG2 = float(os.getenv("MAX_MAP_BBOX_AREA_DEG2", "25"))
except ValueError as error:
    raise RuntimeError("MAX_MAP_BBOX_AREA_DEG2 must be a positive number") from error
if MAX_MAP_BBOX_AREA_DEG2 <= 0:
    raise RuntimeError("MAX_MAP_BBOX_AREA_DEG2 must be a positive number")
catalog = RoutingCatalog.from_path(os.getenv("ROUTING_CATALOG_PATH", "/app/config/routing_catalog.json"))
BROUTER_URL = os.getenv("BROUTER_URL", "http://127.0.0.1:17777").rstrip("/")
DATABASE_URL = os.getenv("DATABASE_URL", "")
auth_service = AuthService(
    DATABASE_URL,
    session_secret=os.getenv("SESSION_SECRET", ""),
    frontend_origin=os.getenv("FRONTEND_ORIGIN", "http://localhost:5173"),
)
user_preference_store = PostgresUserPreferenceStore(DATABASE_URL) if DATABASE_URL else NoUserPreferenceStore()
moderator_tokens = ModeratorTokenVerifier(os.getenv("MODERATOR_API_TOKEN", ""))
restriction_provider = CompositeRestrictionProvider.from_paths(
    {
        "jartic": os.getenv("JARTIC_RESTRICTIONS_PATH", os.getenv("RESTRICTIONS_PATH")),
        "mlit": os.getenv("MLIT_RESTRICTIONS_PATH"),
    }
)
accident_provider = AccidentHistoryProvider(os.getenv("NPA_ACCIDENTS_PATH"), "npa_accident_history")
traffic_provider = TrafficProvider(os.getenv("TRAFFIC_VOLUME_PATH"), "mlit_jartic_traffic_volume")

app = FastAPI(title="CyclerHub-back routing backend", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ALLOW_ORIGINS", os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")).split(","),
    allow_methods=["GET", "POST", "PUT", "PATCH", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)
app.include_router(build_auth_router(auth_service))


@app.on_event("startup")
async def validate_security_configuration() -> None:
    if len(auth_service.session_secret) < 32:
        raise RuntimeError("SESSION_SECRET must be configured with at least 32 characters")


class Coordinate(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class RouteRequest(BaseModel):
    start: Coordinate
    end: Coordinate
    bike_type: str | None = None
    preferences: dict[str, str] = Field(default_factory=dict)

    @field_validator("bike_type", mode="before")
    @classmethod
    def normalize_bike_type(cls, value: object) -> object:
        return value.strip().lower() if isinstance(value, str) else value


class ObservationModerationUpdate(BaseModel):
    status: Literal["active", "resolved", "withdrawn", "expired"] | None = None
    verification_state: Literal["unverified", "corroborated", "moderated"] | None = None


class ObservationCreate(BaseModel):
    category: str = Field(min_length=1, max_length=64)
    location: Coordinate
    temporal_kind: Literal["permanent", "time_of_day", "date_range", "temporary", "trend"] = "temporary"
    observed_at: datetime | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    expires_at: datetime | None = None
    description: str | None = Field(default=None, max_length=2000)

    @field_validator("category", mode="before")
    @classmethod
    def normalize_category(cls, value: object) -> object:
        return value.strip().lower() if isinstance(value, str) else value


class ObservationConfirmationCreate(BaseModel):
    state: Literal["still_present", "cleared", "inaccurate", "duplicate"]


Label = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


class SavedPlaceCreate(BaseModel):
    label: Label
    location: Coordinate


class SavedPlaceUpdate(BaseModel):
    label: Label | None = None
    location: Coordinate | None = None


class SavedRouteCreate(BaseModel):
    label: Label
    start: Coordinate
    end: Coordinate
    bike_type: str = Field(default="city", min_length=1, max_length=64)
    preferences: dict[str, str] = Field(default_factory=dict)

    @field_validator("bike_type", mode="before")
    @classmethod
    def normalize_bike_type(cls, value: object) -> object:
        return value.strip().lower() if isinstance(value, str) else value


class SavedRouteUpdate(BaseModel):
    label: Label | None = None
    start: Coordinate | None = None
    end: Coordinate | None = None
    bike_type: str | None = Field(default=None, min_length=1, max_length=64)
    preferences: dict[str, str] | None = None

    @field_validator("bike_type", mode="before")
    @classmethod
    def normalize_optional_bike_type(cls, value: object) -> object:
        return value.strip().lower() if isinstance(value, str) else value


def _bbox(
    min_lon: float,
    min_lat: float,
    max_lon: float,
    max_lat: float,
) -> tuple[float, float, float, float]:
    if min_lon > max_lon or min_lat > max_lat:
        raise HTTPException(status_code=422, detail="Minimum map coordinates must not exceed maximum coordinates")
    if (max_lon - min_lon) * (max_lat - min_lat) > MAX_MAP_BBOX_AREA_DEG2:
        raise HTTPException(
            status_code=422,
            detail=f"Map bounding box is too large; maximum area is {MAX_MAP_BBOX_AREA_DEG2:g} square degrees",
        )
    return min_lon, min_lat, max_lon, max_lat


def _utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _require_database() -> None:
    if not DATABASE_URL:
        raise HTTPException(status_code=503, detail="Application database is not configured")


def _authenticated_user_id(authorization: str | None) -> str:
    return auth_service.user_id_from_header(authorization)


def _observation_features(
    bbox: tuple[float, float, float, float],
    category: str | None,
    limit: int,
) -> tuple[list[dict[str, object]], bool]:
    if not DATABASE_URL:
        raise HTTPException(status_code=503, detail="Observation database is not configured")
    min_lon, min_lat, max_lon, max_lat = bbox
    filters = [
        "o.status = 'active'",
        "(o.expires_at IS NULL OR o.expires_at > now())",
        "(o.starts_at IS NULL OR o.starts_at <= now())",
        "(o.ends_at IS NULL OR o.ends_at > now())",
        "ST_Intersects(o.location, ST_MakeEnvelope(%s, %s, %s, %s, 4326)::geography)",
    ]
    parameters: list[object] = [min_lon, min_lat, max_lon, max_lat]
    if category:
        filters.append("o.category = %s")
        parameters.append(category.strip().lower())
    parameters.append(limit + 1)
    query = f"""
        SELECT o.id, o.category, ST_Y(o.location::geometry), ST_X(o.location::geometry),
               o.temporal_kind, o.observed_at, o.starts_at, o.ends_at, o.expires_at,
               o.status, o.verification_state, o.description, o.created_at, o.updated_at
        FROM observations o
        WHERE {' AND '.join(filters)}
        ORDER BY o.observed_at DESC
        LIMIT %s
    """
    try:
        with psycopg.connect(DATABASE_URL) as connection:
            rows = connection.execute(query, parameters).fetchall()
    except psycopg.Error as error:
        raise HTTPException(status_code=503, detail="Observation database is unavailable") from error
    features: list[dict[str, object]] = []
    for row in rows:
        features.append(
            {
                "type": "Feature",
                "id": str(row[0]),
                "geometry": {"type": "Point", "coordinates": [row[3], row[2]]},
                "properties": {
                    "source_id": "user_report",
                    "authority": "community",
                    "category": row[1],
                    "temporal_kind": row[4],
                    "observed_at": row[5].isoformat() if row[5] else None,
                    "starts_at": row[6].isoformat() if row[6] else None,
                    "ends_at": row[7].isoformat() if row[7] else None,
                    "expires_at": row[8].isoformat() if row[8] else None,
                    "status": row[9],
                    "verification_state": row[10],
                    "description": row[11],
                    "created_at": row[12].isoformat() if row[12] else None,
                    "updated_at": row[13].isoformat() if row[13] else None,
                },
            }
        )
    return features[:limit], len(features) > limit



@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/v1/routing-options")
async def routing_options() -> dict[str, object]:
    return catalog.public_catalog()


@app.get("/v1/routing-sources")
async def routing_sources() -> dict[str, object]:
    """Expose currently loaded external sources for clients and operations."""
    return {
        "restrictions": restriction_provider.status(),
        "route_context": {
            "accident_history": accident_provider.status(),
            "traffic": traffic_provider.status(),
        },
        "user_preferences": "postgresql" if DATABASE_URL else "not_configured",
    }


@app.get("/v1/observations")
def observations(
    min_lon: float = Query(ge=-180, le=180),
    min_lat: float = Query(ge=-90, le=90),
    max_lon: float = Query(ge=-180, le=180),
    max_lat: float = Query(ge=-90, le=90),
    category: str | None = Query(default=None, max_length=64),
    limit: int = Query(default=200, ge=1, le=500),
) -> dict[str, object]:
    """Return active community reports as a provenance-bearing map layer."""
    bbox = _bbox(min_lon, min_lat, max_lon, max_lat)
    features, truncated = _observation_features(bbox, category, limit)
    return {
        "type": "FeatureCollection",
        "features": features,
        "truncated": truncated,
        "source": {
            "source_id": "user_report",
            "authority": "community",
            "routing_effect": "none_until_validated",
        },
    }


@app.post("/v1/observations", status_code=201)
def create_observation(
    request: ObservationCreate,
    authorization: str | None = Header(default=None),
) -> dict[str, object]:
    """Create a structured, location-specific community report."""
    user_id = auth_service.user_id_from_header(authorization)
    observed_at = _utc(request.observed_at) or datetime.now(UTC)
    starts_at = _utc(request.starts_at)
    ends_at = _utc(request.ends_at)
    expires_at = _utc(request.expires_at)
    if request.temporal_kind == "date_range" and (
        starts_at is None or ends_at is None or ends_at <= starts_at
    ):
        raise HTTPException(status_code=422, detail="Date-range reports require a valid starts_at and ends_at")
    if request.temporal_kind != "date_range" and (starts_at is not None or ends_at is not None):
        raise HTTPException(status_code=422, detail="starts_at and ends_at are only valid for date-range reports")
    if request.temporal_kind == "temporary" and expires_at is None:
        raise HTTPException(status_code=422, detail="Temporary reports require expires_at")
    if expires_at is not None and expires_at <= observed_at:
        raise HTTPException(status_code=422, detail="expires_at must be later than observed_at")
    if not DATABASE_URL:
        raise HTTPException(status_code=503, detail="Observation database is not configured")
    try:
        with psycopg.connect(DATABASE_URL) as connection:
            row = connection.execute(
                """
                INSERT INTO observations
                    (author_user_id, category, location, temporal_kind, observed_at,
                     starts_at, ends_at, expires_at, description)
                VALUES (%s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography,
                        %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    user_id,
                    request.category,
                    request.location.lon,
                    request.location.lat,
                    request.temporal_kind,
                    observed_at,
                    starts_at,
                    ends_at,
                    expires_at,
                    request.description,
                ),
            ).fetchone()
    except psycopg.Error as error:
        raise HTTPException(status_code=503, detail="Observation database is unavailable") from error
    return {
        "id": str(row[0]),
        "source_id": "user_report",
        "authority": "community",
        "verification_state": "unverified",
        "routing_effect": "none_until_validated",
    }


@app.post("/v1/observations/{observation_id}/confirmations", status_code=201)
def confirm_observation(
    observation_id: UUID,
    request: ObservationConfirmationCreate,
    authorization: str | None = Header(default=None),
) -> dict[str, object]:
    """Record one authenticated user's current assessment of a report."""
    user_id = _authenticated_user_id(authorization)
    _require_database()
    try:
        with psycopg.connect(DATABASE_URL) as connection:
            if not connection.execute("SELECT 1 FROM observations WHERE id = %s", (observation_id,)).fetchone():
                raise HTTPException(status_code=404, detail="Observation not found")
            row = connection.execute(
                """
                INSERT INTO observation_confirmations (observation_id, user_id, state)
                VALUES (%s, %s, %s)
                ON CONFLICT (observation_id, user_id)
                DO UPDATE SET state = EXCLUDED.state, created_at = now()
                RETURNING observation_id, state, created_at
                """,
                (observation_id, user_id, request.state),
            ).fetchone()
    except HTTPException:
        raise
    except psycopg.DataError as error:
        raise HTTPException(status_code=422, detail="Invalid observation ID") from error
    except psycopg.Error as error:
        raise HTTPException(status_code=503, detail="Observation database is unavailable") from error
    return {
        "observation_id": str(row[0]),
        "state": row[1],
        "created_at": row[2].isoformat(),
        "source_id": "user_report_confirmation",
        "authority": "community",
        "routing_effect": "none_until_validated",
    }


def _place_payload(row: tuple[Any, ...]) -> dict[str, object]:
    return {
        "id": str(row[0]),
        "label": row[1],
        "location": {"lat": row[2], "lon": row[3]},
        "created_at": row[4].isoformat(),
        "updated_at": row[5].isoformat(),
    }


@app.get("/v1/saved-places")
def list_saved_places(authorization: str | None = Header(default=None)) -> dict[str, object]:
    user_id = _authenticated_user_id(authorization)
    _require_database()
    try:
        with psycopg.connect(DATABASE_URL) as connection:
            rows = connection.execute(
                """
                SELECT id, label, ST_Y(location::geometry), ST_X(location::geometry), created_at, updated_at
                FROM saved_places WHERE user_id = %s ORDER BY updated_at DESC
                """,
                (user_id,),
            ).fetchall()
    except psycopg.Error as error:
        raise HTTPException(status_code=503, detail="Saved-place database is unavailable") from error
    return {"places": [_place_payload(row) for row in rows]}


@app.post("/v1/saved-places", status_code=201)
def create_saved_place(
    request: SavedPlaceCreate,
    authorization: str | None = Header(default=None),
) -> dict[str, object]:
    user_id = _authenticated_user_id(authorization)
    _require_database()
    try:
        with psycopg.connect(DATABASE_URL) as connection:
            row = connection.execute(
                """
                INSERT INTO saved_places (user_id, label, location)
                VALUES (%s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography)
                RETURNING id, label, ST_Y(location::geometry), ST_X(location::geometry), created_at, updated_at
                """,
                (user_id, request.label.strip(), request.location.lon, request.location.lat),
            ).fetchone()
    except psycopg.Error as error:
        raise HTTPException(status_code=503, detail="Saved-place database is unavailable") from error
    return _place_payload(row)


@app.patch("/v1/saved-places/{place_id}")
def update_saved_place(
    place_id: UUID,
    request: SavedPlaceUpdate,
    authorization: str | None = Header(default=None),
) -> dict[str, object]:
    user_id = _authenticated_user_id(authorization)
    _require_database()
    values = request.model_dump(exclude_unset=True, exclude_none=True)
    if not values:
        raise HTTPException(status_code=422, detail="At least one place field is required")
    assignments: list[str] = []
    parameters: list[object] = []
    if "label" in values:
        assignments.append("label = %s")
        parameters.append(str(values["label"]).strip())
    if "location" in values:
        location = values["location"]
        assignments.append("location = ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography")
        parameters.extend([location["lon"], location["lat"]])
    assignments.append("updated_at = now()")
    parameters.extend([place_id, user_id])
    try:
        with psycopg.connect(DATABASE_URL) as connection:
            row = connection.execute(
                f"""
                UPDATE saved_places SET {', '.join(assignments)}
                WHERE id = %s AND user_id = %s
                RETURNING id, label, ST_Y(location::geometry), ST_X(location::geometry), created_at, updated_at
                """,
                parameters,
            ).fetchone()
    except psycopg.DataError as error:
        raise HTTPException(status_code=422, detail="Invalid saved-place ID") from error
    except psycopg.Error as error:
        raise HTTPException(status_code=503, detail="Saved-place database is unavailable") from error
    if not row:
        raise HTTPException(status_code=404, detail="Saved place not found")
    return _place_payload(row)


@app.delete("/v1/saved-places/{place_id}")
def delete_saved_place(place_id: UUID, authorization: str | None = Header(default=None)) -> dict[str, str]:
    user_id = _authenticated_user_id(authorization)
    _require_database()
    try:
        with psycopg.connect(DATABASE_URL) as connection:
            result = connection.execute(
                "DELETE FROM saved_places WHERE id = %s AND user_id = %s", (place_id, user_id)
            )
    except psycopg.DataError as error:
        raise HTTPException(status_code=422, detail="Invalid saved-place ID") from error
    except psycopg.Error as error:
        raise HTTPException(status_code=503, detail="Saved-place database is unavailable") from error
    if result.rowcount != 1:
        raise HTTPException(status_code=404, detail="Saved place not found")
    return {"status": "deleted"}


def _route_payload(row: tuple[Any, ...]) -> dict[str, object]:
    return {
        "id": str(row[0]),
        "label": row[1],
        "bike_type": row[2],
        "start": {"lat": row[3], "lon": row[4]},
        "end": {"lat": row[5], "lon": row[6]},
        "preferences": row[7],
        "last_route": row[8],
        "last_routed_at": row[9].isoformat() if row[9] else None,
        "created_at": row[10].isoformat(),
        "updated_at": row[11].isoformat(),
    }


@app.get("/v1/saved-routes")
def list_saved_routes(authorization: str | None = Header(default=None)) -> dict[str, object]:
    user_id = _authenticated_user_id(authorization)
    _require_database()
    try:
        with psycopg.connect(DATABASE_URL) as connection:
            rows = connection.execute(
                """
                SELECT id, label, bike_type, ST_Y(start_location::geometry), ST_X(start_location::geometry),
                       ST_Y(end_location::geometry), ST_X(end_location::geometry), preferences,
                       last_route_geojson, last_routed_at, created_at, updated_at
                FROM saved_routes WHERE user_id = %s ORDER BY updated_at DESC
                """,
                (user_id,),
            ).fetchall()
    except psycopg.Error as error:
        raise HTTPException(status_code=503, detail="Saved-route database is unavailable") from error
    return {"routes": [_route_payload(row) for row in rows]}


@app.post("/v1/saved-routes", status_code=201)
def create_saved_route(
    request: SavedRouteCreate,
    authorization: str | None = Header(default=None),
) -> dict[str, object]:
    user_id = _authenticated_user_id(authorization)
    try:
        policy = catalog.resolve(request.bike_type, request.preferences)
    except CatalogError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    _require_database()
    try:
        with psycopg.connect(DATABASE_URL) as connection:
            row = connection.execute(
                """
                INSERT INTO saved_routes (user_id, label, bike_type, start_location, end_location, preferences)
                VALUES (%s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography,
                        ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, %s)
                RETURNING id, label, bike_type, ST_Y(start_location::geometry), ST_X(start_location::geometry),
                          ST_Y(end_location::geometry), ST_X(end_location::geometry), preferences,
                          last_route_geojson, last_routed_at, created_at, updated_at
                """,
                (
                    user_id,
                    request.label.strip(),
                    policy.bike_type,
                    request.start.lon,
                    request.start.lat,
                    request.end.lon,
                    request.end.lat,
                    Jsonb(policy.preferences),
                ),
            ).fetchone()
    except psycopg.Error as error:
        raise HTTPException(status_code=503, detail="Saved-route database is unavailable") from error
    return _route_payload(row)


@app.patch("/v1/saved-routes/{route_id}")
def update_saved_route(
    route_id: UUID,
    request: SavedRouteUpdate,
    authorization: str | None = Header(default=None),
) -> dict[str, object]:
    user_id = _authenticated_user_id(authorization)
    values = request.model_dump(exclude_unset=True, exclude_none=True)
    if not values:
        raise HTTPException(status_code=422, detail="At least one route field is required")
    _require_database()
    try:
        with psycopg.connect(DATABASE_URL) as connection:
            stored = connection.execute(
                "SELECT bike_type, preferences FROM saved_routes WHERE id = %s AND user_id = %s FOR UPDATE",
                (route_id, user_id),
            ).fetchone()
            if not stored:
                raise HTTPException(status_code=404, detail="Saved route not found")

            merged_bike_type = values.get("bike_type", stored[0])
            merged_preferences = dict(stored[1] or {})
            if "preferences" in values:
                merged_preferences.update(values["preferences"])
            try:
                policy = catalog.resolve(merged_bike_type, merged_preferences)
            except CatalogError as error:
                raise HTTPException(status_code=422, detail=str(error)) from error

            assignments: list[str] = ["bike_type = %s", "preferences = %s"]
            parameters: list[object] = [policy.bike_type, Jsonb(policy.preferences)]
            if "label" in values:
                assignments.append("label = %s")
                parameters.append(values["label"])
            for field, column in (("start", "start_location"), ("end", "end_location")):
                if field in values:
                    coordinate = values[field]
                    assignments.append(f"{column} = ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography")
                    parameters.extend([coordinate["lon"], coordinate["lat"]])
            assignments.append("updated_at = now()")
            parameters.extend([route_id, user_id])
            row = connection.execute(
                f"""
                UPDATE saved_routes SET {', '.join(assignments)}
                WHERE id = %s AND user_id = %s
                RETURNING id, label, bike_type, ST_Y(start_location::geometry), ST_X(start_location::geometry),
                          ST_Y(end_location::geometry), ST_X(end_location::geometry), preferences,
                          last_route_geojson, last_routed_at, created_at, updated_at
                """,
                parameters,
            ).fetchone()
    except HTTPException:
        raise
    except psycopg.DataError as error:
        raise HTTPException(status_code=422, detail="Invalid saved-route ID") from error
    except psycopg.Error as error:
        raise HTTPException(status_code=503, detail="Saved-route database is unavailable") from error
    if not row:
        raise HTTPException(status_code=404, detail="Saved route not found")
    return _route_payload(row)


@app.delete("/v1/saved-routes/{route_id}")
def delete_saved_route(route_id: UUID, authorization: str | None = Header(default=None)) -> dict[str, str]:
    user_id = _authenticated_user_id(authorization)
    _require_database()
    try:
        with psycopg.connect(DATABASE_URL) as connection:
            result = connection.execute(
                "DELETE FROM saved_routes WHERE id = %s AND user_id = %s", (route_id, user_id)
            )
    except psycopg.DataError as error:
        raise HTTPException(status_code=422, detail="Invalid saved-route ID") from error
    except psycopg.Error as error:
        raise HTTPException(status_code=503, detail="Saved-route database is unavailable") from error
    if result.rowcount != 1:
        raise HTTPException(status_code=404, detail="Saved route not found")
    return {"status": "deleted"}


@app.get("/v1/map-data")
def map_data(
    min_lon: float = Query(ge=-180, le=180),
    min_lat: float = Query(ge=-90, le=90),
    max_lon: float = Query(ge=-180, le=180),
    max_lat: float = Query(ge=-90, le=90),
    limit: int = Query(default=200, ge=1, le=500),
) -> dict[str, object]:
    """Return map layers while keeping restrictions, contexts, and reports separate."""
    bbox = _bbox(min_lon, min_lat, max_lon, max_lat)
    evaluated_at = datetime.now(JAPAN_TIMEZONE)
    layer_limit = limit + 1
    restriction_features = restriction_provider.features_in_bbox(bbox, evaluated_at, layer_limit)
    accident_features = accident_provider.features_in_bbox(bbox, layer_limit)
    traffic_features = traffic_provider.features_in_bbox(bbox, layer_limit)
    observation_features, observations_truncated = _observation_features(bbox, None, limit)
    return {
        "restrictions": {
            "type": "FeatureCollection",
            "features": restriction_features[:limit],
            "truncated": len(restriction_features) > limit,
            "source_status": restriction_provider.status(),
        },
        "route_context": {
            "accidents": {
                "type": "FeatureCollection",
                "features": accident_features[:limit],
                "truncated": len(accident_features) > limit,
                "source_status": accident_provider.status(),
            },
            "traffic": {
                "type": "FeatureCollection",
                "features": traffic_features[:limit],
                "truncated": len(traffic_features) > limit,
                "source_status": traffic_provider.status(),
            },
        },
        "observations": {
            "type": "FeatureCollection",
            "features": observation_features,
            "truncated": observations_truncated,
            "source": {
                "source_id": "user_report",
                "authority": "community",
                "routing_effect": "none_until_validated",
            },
        },
    }


@app.post("/v1/routes")
async def route(
    request: RouteRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, object]:
    authenticated_user_id = None
    if authorization:
        authenticated_user_id = auth_service.user_id_from_header(authorization)
    profile = await run_in_threadpool(user_preference_store.profile_for, authenticated_user_id) if authenticated_user_id else {}
    bike_type = request.bike_type or profile.get("bike_type", "city")
    saved_preferences = {
        key: value
        for key, value in profile.items()
        if key != "bike_type"
    }
    supplied_preferences = {**saved_preferences, **request.preferences}
    try:
        policy = catalog.resolve(bike_type, supplied_preferences)
    except CatalogError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    base_parameters = {
        "lonlats": f"{request.start.lon},{request.start.lat}|{request.end.lon},{request.end.lat}",
        "profile": policy.brouter_profile,
        "format": "geojson",
        "timode": "1",
        **{f"profile:{name}": value for name, value in policy.brouter_parameters.items()},
    }
    route_geojson: dict[str, object] | None = None
    hits = []
    selected_traffic_context: dict[str, object] = {"status": "unavailable", "source_id": traffic_provider.source_id}
    selected_traffic_penalty: float | None = None
    evaluated_at = datetime.now(JAPAN_TIMEZONE)
    try:
        # When government restrictions are loaded, ask BRouter for up to three
        # alternatives and return the first one that has no active hard block.
        alternatives = range(3) if restriction_provider.status()["enabled"] or traffic_provider.enabled else range(1)
        async with httpx.AsyncClient(timeout=30.0) as client:
            for alternative_index in alternatives:
                response = await client.get(
                    f"{BROUTER_URL}/brouter",
                    params={**base_parameters, "alternativeidx": str(alternative_index)},
                )
                if response.is_error:
                    if alternative_index == 0:
                        response.raise_for_status()
                    break
                candidate = response.json()
                candidate_hits = restriction_provider.active_hits(
                    candidate, policy.vehicle_class, evaluated_at
                )
                if not any(hit.enforcement == "block" for hit in candidate_hits):
                    traffic_context = traffic_provider.assess(candidate, policy.preferences["traffic_mode"], evaluated_at)
                    candidate_penalty = float(traffic_context.get("routing_penalty", 0))
                    if selected_traffic_penalty is None or candidate_penalty < selected_traffic_penalty:
                        route_geojson = candidate
                        hits = candidate_hits
                        selected_traffic_context = traffic_context
                        selected_traffic_penalty = candidate_penalty
    except httpx.HTTPError as error:
        raise HTTPException(status_code=503, detail="Routing engine is unavailable") from error
    except ValueError as error:
        raise HTTPException(status_code=502, detail="Routing engine returned invalid JSON") from error

    if route_geojson is None:
        raise HTTPException(status_code=409, detail="No route passed active legal restrictions")

    return {
        "route": route_geojson,
        "resolved": {
            "bike_type": policy.bike_type,
            "preferences": policy.preferences,
            "ruleset": policy.ruleset,
            "evaluated_at": evaluated_at.isoformat(),
        },
        "restriction_assessment": {
            "source_enabled": restriction_provider.status()["enabled"],
            "alerts": [hit.__dict__ for hit in hits],
        },
        "route_context": {
            "accident_history": accident_provider.aggregate(route_geojson, evaluated_at),
            "traffic": selected_traffic_context,
        },
    }


@app.patch("/v1/moderation/observations/{observation_id}")
def moderate_observation(
    observation_id: UUID,
    request: ObservationModerationUpdate,
    authorization: str | None = Header(default=None),
) -> dict[str, object]:
    """Moderate observations through a separate env-token protected API."""
    moderator_tokens.require(authorization)
    changes = request.model_dump(exclude_unset=True, exclude_none=True)
    if not changes:
        raise HTTPException(status_code=422, detail="At least one moderation field is required")
    assignments = ", ".join(f"{key} = %s" for key in changes)
    try:
        with psycopg.connect(DATABASE_URL) as connection:
            row = connection.execute(
                f"UPDATE observations SET {assignments}, updated_at = now() WHERE id = %s RETURNING id, status, verification_state, updated_at",
                (*changes.values(), observation_id),
            ).fetchone()
    except psycopg.DataError as error:
        raise HTTPException(status_code=422, detail="Invalid observation ID") from error
    except psycopg.Error as error:
        raise HTTPException(status_code=503, detail="Database is unavailable") from error
    if not row:
        raise HTTPException(status_code=404, detail="Observation not found")
    return {
        "id": str(row[0]),
        "status": row[1],
        "verification_state": row[2],
        "updated_at": row[3].isoformat(),
    }
