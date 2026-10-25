"""Experimental CoreS3 road-surface measurements, kept separate from reports."""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import UTC, datetime, timedelta
from typing import Literal

import psycopg
from fastapi import APIRouter, Header, HTTPException
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field


class DeviceLocation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lat: float = Field(ge=-90, le=90, allow_inf_nan=False)
    lon: float = Field(ge=-180, le=180, allow_inf_nan=False)


class SurfaceEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal[1]
    device_id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,48}$")
    event_id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,64}$")
    kind: Literal["bump", "roughness"]
    observed_at: AwareDatetime
    location: DeviceLocation
    peak_delta_g: float = Field(ge=0, le=16, allow_inf_nan=False)
    rms_g: float = Field(ge=0, le=16, allow_inf_nan=False)
    gps_hdop: float = Field(gt=0, le=5, allow_inf_nan=False)
    speed_kmph: float = Field(ge=0, le=80, allow_inf_nan=False)


def _fingerprint(event: SurfaceEvent) -> str:
    payload = json.dumps(event.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def build_device_router(database_url: str, ingest_token: str) -> APIRouter:
    router = APIRouter()

    @router.post("/v1/device-events", status_code=201)
    def ingest_device_event(event: SurfaceEvent, authorization: str | None = Header(default=None)) -> dict[str, object]:
        if not ingest_token or not database_url:
            raise HTTPException(status_code=503, detail="Device ingestion is not configured")
        supplied = authorization[7:].strip() if authorization and authorization.lower().startswith("bearer ") else ""
        if not hmac.compare_digest(supplied, ingest_token):
            raise HTTPException(status_code=401, detail="Invalid device credential")

        observed_at = event.observed_at.astimezone(UTC)
        now = datetime.now(UTC)
        if observed_at < now - timedelta(days=30) or observed_at > now + timedelta(minutes=5):
            raise HTTPException(status_code=422, detail="Event time is outside the accepted window")

        fingerprint = _fingerprint(event)
        try:
            with psycopg.connect(database_url) as connection:
                row = connection.execute(
                    """
                    INSERT INTO device_surface_events
                        (device_id, event_id, kind, observed_at, location,
                         peak_delta_g, rms_g, gps_hdop, speed_kmph, payload_fingerprint)
                    VALUES (%s, %s, %s, %s,
                            ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography,
                            %s, %s, %s, %s, %s)
                    ON CONFLICT (device_id, event_id) DO NOTHING
                    RETURNING event_id
                    """,
                    (
                        event.device_id, event.event_id, event.kind, observed_at,
                        event.location.lon, event.location.lat, event.peak_delta_g,
                        event.rms_g, event.gps_hdop, event.speed_kmph, fingerprint,
                    ),
                ).fetchone()
                if row is None:
                    old = connection.execute(
                        "SELECT payload_fingerprint FROM device_surface_events WHERE device_id = %s AND event_id = %s",
                        (event.device_id, event.event_id),
                    ).fetchone()
                    if old is None or old[0] != fingerprint:
                        raise HTTPException(status_code=409, detail="Event ID already used with different data")
        except psycopg.Error as error:
            raise HTTPException(status_code=503, detail="Device event database is unavailable") from error
        return {"event_id": event.event_id, "accepted": True, "duplicate": row is None}

    return router


def surface_features_in_bbox(
    database_url: str, bbox: tuple[float, float, float, float], limit: int,
) -> tuple[list[dict[str, object]], bool]:
    if not database_url:
        return [], False
    min_lon, min_lat, max_lon, max_lat = bbox
    try:
        with psycopg.connect(database_url) as connection:
            rows = connection.execute(
                """
                SELECT id, kind, observed_at, ST_Y(location::geometry), ST_X(location::geometry),
                       peak_delta_g, rms_g, gps_hdop
                FROM device_surface_events
                WHERE observed_at >= now() - interval '30 days'
                  AND ST_Intersects(location, ST_MakeEnvelope(%s, %s, %s, %s, 4326)::geography)
                ORDER BY observed_at DESC
                LIMIT %s
                """,
                (min_lon, min_lat, max_lon, max_lat, limit + 1),
            ).fetchall()
    except psycopg.Error as error:
        raise HTTPException(status_code=503, detail="Device event database is unavailable") from error

    features = [
        {
            "type": "Feature",
            "id": str(row[0]),
            "geometry": {"type": "Point", "coordinates": [row[4], row[3]]},
            "properties": {
                "id": str(row[0]),
                "kind": row[1],
                "observed_at": row[2].isoformat(),
                "peak_delta_g": row[5],
                "rms_g": row[6],
                "gps_hdop": row[7],
                "source_id": "cores3_surface_v1",
                "authority": "device_measurement",
                "verification_state": "unverified",
                "routing_effect": "none",
            },
        }
        for row in rows[:limit]
    ]
    return features, len(rows) > limit
