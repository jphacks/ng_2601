from __future__ import annotations

import os
from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo

import httpx
import psycopg
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

from .auth import AuthService, ModeratorTokenVerifier, build_auth_router
from .catalog import CatalogError, RoutingCatalog
from .context import NoUserPreferenceStore, PostgresUserPreferenceStore
from .route_context import AccidentHistoryProvider, TrafficProvider
from .restrictions import CompositeRestrictionProvider

JAPAN_TIMEZONE = ZoneInfo("Asia/Tokyo")
catalog = RoutingCatalog.from_path(os.getenv("ROUTING_CATALOG_PATH", "/app/config/routing_catalog.json"))
BROUTER_URL = os.getenv("BROUTER_URL", "http://127.0.0.1:17777").rstrip("/")
DATABASE_URL = os.getenv("DATABASE_URL", "")
auth_service = AuthService(
    DATABASE_URL,
    session_secret=os.getenv("SESSION_SECRET", "local-only-change-me"),
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


class Coordinate(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class RouteRequest(BaseModel):
    start: Coordinate
    end: Coordinate
    bike_type: str | None = None
    user_id: str | None = Field(default=None, max_length=128)
    preferences: dict[str, str] = Field(default_factory=dict)

    @field_validator("bike_type")
    @classmethod
    def normalize_bike_type(cls, value: str | None) -> str | None:
        return value.strip().lower() if value else value


class ObservationModerationUpdate(BaseModel):
    status: Literal["active", "resolved", "withdrawn", "expired"] | None = None
    verification_state: Literal["unverified", "corroborated", "moderated"] | None = None



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


@app.post("/v1/routes")
async def route(
    request: RouteRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, object]:
    authenticated_user_id = request.user_id
    if authenticated_user_id is None and authorization:
        authenticated_user_id = auth_service.user_id_from_header(authorization)
    profile = (
        user_preference_store.profile_for(authenticated_user_id)
        if authenticated_user_id
        else {}
    )
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
                response.raise_for_status()
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
async def moderate_observation(
    observation_id: str,
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
