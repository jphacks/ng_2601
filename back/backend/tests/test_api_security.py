"""Regression checks for startup, sessions, TLS, and route selection."""
import importlib
import ssl
from pathlib import Path
from unittest.mock import MagicMock
from uuid import uuid4

import httpx
import jwt
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from app.auth import AuthService, MagicLinkRequest


@pytest.fixture
def backend(monkeypatch):
    monkeypatch.setenv('ROUTING_CATALOG_PATH', str(Path(__file__).parents[2] / 'config/routing_catalog.json'))
    m = importlib.import_module('app.main')
    monkeypatch.setattr(m.auth_service, 'session_secret', 'test-only-secret-' * 4)
    return m


def test_startup_rejects_short_secret(backend, monkeypatch):
    monkeypatch.setattr(backend.auth_service, 'session_secret', 'short')
    with pytest.raises(RuntimeError, match='SESSION_SECRET'):
        with TestClient(backend.app): pass


def test_access_tokens_require_expiry_and_uuid_subject():
    service = AuthService('', session_secret='test-only-secret-' * 4, frontend_origin='http://localhost')
    for payload in [{'sub': str(uuid4()), 'typ': 'access'}, {'sub': 'bad', 'typ': 'access', 'exp': 9999999999, 'iat': 1}]:
        token = jwt.encode(payload, service.session_secret, algorithm='HS256')
        with pytest.raises(HTTPException) as error: service.decode_access_token(token)
        assert error.value.status_code == 401
    assert service.decode_access_token(service._access_token(str(uuid4())))
    for email in ['a@example.com\nBcc: x@y.com', 'a b@example.com', 'a@@example.com']:
        with pytest.raises(ValueError): MagicLinkRequest(email=email)


def test_both_smtp_transports_verify_certificates(monkeypatch):
    service = AuthService('', session_secret='test-only-secret-' * 4, frontend_origin='http://localhost')
    monkeypatch.setattr(service, '_smtp_authenticate', lambda smtp: None)
    for mode in ['ssl', 'starttls']:
        smtp = MagicMock(); smtp.__enter__.return_value = smtp; smtp.ehlo.return_value = (250, b'ok')
        factory = MagicMock(return_value=smtp)
        monkeypatch.setattr('app.auth.smtplib.' + ('SMTP_SSL' if mode == 'ssl' else 'SMTP'), factory)
        service.smtp_security = mode; service._send_smtp(MagicMock())
        context = factory.call_args.kwargs['context'] if mode == 'ssl' else smtp.starttls.call_args.kwargs['context']
        assert context.check_hostname and context.verify_mode == ssl.CERT_REQUIRED


@pytest.mark.parametrize('mode,statuses,expected', [
    ('avoid', [('partial', 0), ('available', 10)], 1),
    ('avoid', [('available', 10), ('partial', 0)], 0),
    ('avoid', [('stale', 0), ('partial', 0)], 0),
    ('direct', [('partial', 0), ('available', 0)], 0),
])
def test_route_fallback_and_traffic_coverage(backend, monkeypatch, mode, statuses, expected):
    class RoutingClient:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def get(self, url, params):
            index = int(params['alternativeidx'])
            return httpx.Response(400 if index == 2 else 200, request=httpx.Request('GET', url), json={'index': index})
    restriction = MagicMock(); restriction.status.return_value = {'enabled': True}; restriction.active_hits.return_value = []
    traffic = MagicMock(); traffic.source_id = 'traffic'
    traffic.assess.side_effect = lambda candidate, *_: dict(status=statuses[candidate['index']][0], routing_penalty=statuses[candidate['index']][1])
    monkeypatch.setattr(backend, 'restriction_provider', restriction)
    monkeypatch.setattr(backend, 'traffic_provider', traffic)
    monkeypatch.setattr(backend, 'accident_provider', MagicMock(aggregate=lambda *_: {'status':'unavailable'}))
    monkeypatch.setattr(backend.httpx, 'AsyncClient', lambda **_: RoutingClient())
    with TestClient(backend.app) as client:
        result = client.post('/v1/routes', json={'start': {'lat':35,'lon':136}, 'end':{'lat':35.01,'lon':136.01}, 'preferences':{'traffic_mode':mode}})
    assert result.status_code == 200
    assert result.json()['route']['index'] == expected


def test_auth_database_outage_is_service_unavailable(backend, monkeypatch):
    import psycopg
    def unavailable():
        raise psycopg.OperationalError('simulated outage')
    monkeypatch.setattr(backend.auth_service, '_connect', unavailable)
    token = backend.auth_service._access_token(str(uuid4()))
    with TestClient(backend.app) as client:
        result = client.get('/v1/auth/me', headers={'Authorization':'Bearer '+token})
    assert result.status_code == 503
    assert result.json() == {'detail':'Application database is unavailable'}
