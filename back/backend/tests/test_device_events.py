from datetime import UTC, datetime
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import device_events


class FakeConnection:
    def __init__(self):
        self.rows = {}
        self.query = ""
        self.parameters = ()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def execute(self, query, parameters):
        self.query = query
        self.parameters = parameters
        return self

    def fetchone(self):
        if "INSERT INTO" in self.query:
            key = self.parameters[:2]
            if key in self.rows:
                return None
            self.rows[key] = self.parameters[-1]
            return (key[1],)
        if "payload_fingerprint" in self.query:
            value = self.rows.get(self.parameters)
            return (value,) if value else None
        raise AssertionError(self.query)

    def fetchall(self):
        return [
            (uuid4(), "bump", datetime.now(UTC), 35.0, 136.0, 0.8, 0.3, 1.2)
        ]


def event_payload():
    return {
        "schema_version": 1,
        "device_id": "cores3-demo",
        "event_id": "boot_1",
        "kind": "bump",
        "observed_at": datetime.now(UTC).isoformat(),
        "location": {"lat": 35.0, "lon": 136.0},
        "peak_delta_g": 0.8,
        "rms_g": 0.3,
        "gps_hdop": 1.2,
        "speed_kmph": 12.0,
    }


def test_ingest_rejects_missing_token_and_deduplicates(monkeypatch):
    database = FakeConnection()
    monkeypatch.setattr(device_events.psycopg, "connect", lambda _: database)
    app = FastAPI()
    app.include_router(device_events.build_device_router("postgres://test", "secret"))
    client = TestClient(app)
    payload = event_payload()

    assert client.post("/v1/device-events", json=payload).status_code == 401
    first = client.post("/v1/device-events", json=payload, headers={"Authorization": "Bearer secret"})
    repeated = client.post("/v1/device-events", json=payload, headers={"Authorization": "Bearer secret"})
    assert first.status_code == 201 and first.json()["duplicate"] is False
    assert repeated.status_code == 201 and repeated.json()["duplicate"] is True
    assert len(database.rows) == 1

    altered = {**payload, "peak_delta_g": 2.0}
    assert client.post("/v1/device-events", json=altered, headers={"Authorization": "Bearer secret"}).status_code == 409


def test_ingest_requires_valid_location_and_time(monkeypatch):
    monkeypatch.setattr(device_events.psycopg, "connect", lambda _: FakeConnection())
    app = FastAPI()
    app.include_router(device_events.build_device_router("postgres://test", "secret"))
    client = TestClient(app)
    payload = event_payload()
    headers = {"Authorization": "Bearer secret"}
    assert client.post("/v1/device-events", json={**payload, "location": {"lat": 95, "lon": 0}}, headers=headers).status_code == 422
    assert client.post("/v1/device-events", json={**payload, "observed_at": "2020-01-01T00:00:00Z"}, headers=headers).status_code == 422


def test_surface_map_features_are_distinct_from_community_reports(monkeypatch):
    database = FakeConnection()
    monkeypatch.setattr(device_events.psycopg, "connect", lambda _: database)
    features, truncated = device_events.surface_features_in_bbox("postgres://test", (135.9, 34.9, 136.1, 35.1), 20)
    assert not truncated
    assert features[0]["geometry"]["coordinates"] == [136.0, 35.0]
    assert features[0]["properties"]["authority"] == "device_measurement"
    assert features[0]["properties"]["routing_effect"] == "none"
