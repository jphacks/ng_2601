"""Manual integration check: requires a disposable database named cyclerhub_audit_*.

Run inside the backend image with the repository backend mounted at /audit.
SMTP delivery and Google's remote exchange are intercepted; DB and BRouter are real.
"""
import os
import secrets
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlsplit, urlunsplit
from uuid import uuid4
from unittest.mock import patch

import jwt
import psycopg
from fastapi.testclient import TestClient

if os.environ.get('AUDIT_DATABASE', '').startswith('cyclerhub_audit_'):
    parsed = urlsplit(os.environ['DATABASE_URL'])
    os.environ['DATABASE_URL'] = urlunsplit(parsed._replace(path='/'+os.environ['AUDIT_DATABASE']))

os.environ['SESSION_SECRET'] = secrets.token_urlsafe(48)
os.environ['MODERATOR_API_TOKEN'] = secrets.token_urlsafe(32)
os.environ['DEVICE_INGEST_TOKEN'] = secrets.token_urlsafe(32)
os.environ['SMTP_SENDER'] = 'audit@example.invalid'
os.environ['SMTP_USERNAME'] = 'audit@example.invalid'
os.environ['SMTP_PASSWORD'] = 'intercepted-no-delivery'
from app import main as m
from app.auth import _hash

with psycopg.connect(m.DATABASE_URL) as db:
    assert db.execute('SELECT current_database()').fetchone()[0].startswith('cyclerhub_audit_'), 'Requires disposable audit DB'

checks = 0

def check(client, method, path, expected=200, **kwargs):
    global checks
    response = client.request(method, path, **kwargs)
    assert response.status_code == expected, (method, path, response.status_code, response.text[:500])
    checks += 1
    return response.json() if response.content else None

with TestClient(m.app) as client:
    check(client, 'GET', '/health')
    spec = check(client, 'GET', '/openapi.json')
    options = check(client, 'GET', '/v1/routing-options')
    check(client, 'GET', '/v1/routing-sources')
    bbox = dict(min_lon=136.87, min_lat=35.16, max_lon=136.91, max_lat=35.19, limit=1)
    check(client, 'GET', '/v1/observations', params=bbox)
    check(client, 'GET', '/v1/map-data', params=bbox)
    check(client, 'GET', '/v1/map-data', expected=422, params={**bbox, 'min_lon': 137})
    check(client, 'GET', '/v1/map-data', expected=422, params=dict(min_lon=-180,min_lat=-90,max_lon=180,max_lat=90))
    for path in ['/v1/auth/me', '/v1/saved-places', '/v1/saved-routes']:
        check(client, 'GET', path, expected=401)
    check(client, 'GET', '/v1/auth/me', expected=401, headers={'Authorization':'Bearer invalid'})
    bad = jwt.encode({'sub':'not-a-uuid', 'typ':'access'}, m.auth_service.session_secret, algorithm='HS256')
    check(client, 'GET', '/v1/auth/me', expected=401, headers={'Authorization':f'Bearer {bad}'})
    check(client, 'POST', '/v1/auth/magic-link/consume', expected=400, json={'token':'x'*32})
    check(client, 'GET', '/v1/auth/google/callback?code=x&state=x', expected=400)
    email = f'audit-{uuid4().hex}@example.invalid'
    captured=[]
    with patch.object(m.auth_service, '_send_smtp', side_effect=captured.append):
        check(client,'POST','/v1/auth/magic-link/request',json={'email':email})
        check(client,'POST','/v1/auth/magic-link/request',json={'email':email})
        assert len(captured)==1, 'Cooldown must preserve original link'
        token=parse_qs(urlsplit(captured[0].get_content().strip().splitlines()[-1]).query)['token'][0]
        session=check(client,'POST','/v1/auth/magic-link/consume',json={'token':token})
        check(client,'POST','/v1/auth/magic-link/consume',expected=400,json={'token':token})
        for _ in range(3): check(client,'POST','/v1/auth/magic-link/request',json={'email':email})
        check(client,'POST','/v1/auth/magic-link/request',expected=429,json={'email':email})
    headers={'Authorization':'Bearer '+session['access_token']}
    check(client,'GET','/v1/auth/me',headers=headers)
    check(client,'PUT','/v1/auth/me/preferences',headers=headers,json={'bike_type':'mamachari','hill_mode':'avoid'})
    assert check(client,'GET','/v1/auth/me',headers=headers)['bike_type']=='mamachari'
    place=check(client,'POST','/v1/saved-places',expected=201,headers=headers,json={'label':' audit ', 'location':{'lat':35.171,'lon':136.881}})
    assert place['label']=='audit'
    check(client,'GET','/v1/saved-places',headers=headers)
    check(client,'PATCH','/v1/saved-places/'+place['id'],headers=headers,json={'label':'edited'})
    check(client,'POST','/v1/saved-places',expected=422,headers=headers,json={'label':'  ','location':{'lat':35,'lon':136}})
    route_body={'start':{'lat':35.170,'lon':136.880},'end':{'lat':35.178,'lon':136.895}}
    saved=check(client,'POST','/v1/saved-routes',expected=201,headers=headers,json={**route_body,'label':'usual','bike_type':'road'})
    check(client,'GET','/v1/saved-routes',headers=headers)
    updated=check(client,'PATCH','/v1/saved-routes/'+saved['id'],headers=headers,json={'preferences':{'hill_mode':'avoid'}})
    assert updated['bike_type']=='road' and len(updated['preferences'])==4
    check(client,'PATCH','/v1/saved-routes/'+saved['id'],headers=headers,json={'bike_type':'gravel'})
    with psycopg.connect(m.DATABASE_URL) as db:
        other=str(db.execute('INSERT INTO users DEFAULT VALUES RETURNING id').fetchone()[0])
    outsider={'Authorization':'Bearer '+m.auth_service._access_token(other)}
    check(client,'PATCH','/v1/saved-routes/'+saved['id'],expected=404,headers=outsider,json={'label':'steal'})
    observation=check(client,'POST','/v1/observations',expected=201,headers=headers,json={'category':'obstruction','location':{'lat':35.171,'lon':136.881},'temporal_kind':'temporary','expires_at':(datetime.now(UTC)+timedelta(days=1)).isoformat()})
    oid=observation['id']
    check(client,'POST','/v1/observations/'+oid+'/confirmations',expected=201,headers=headers,json={'state':'still_present'})
    check(client,'POST','/v1/observations/not-uuid/confirmations',expected=422,headers=headers,json={'state':'cleared'})
    layer=check(client,'GET','/v1/observations',params=bbox)
    assert any(f['id']==oid for f in layer['features'])
    check(client,'PATCH','/v1/moderation/observations/'+oid,expected=403,headers=headers,json={'status':'resolved'})
    check(client,'PATCH','/v1/moderation/observations/'+oid,headers={'Authorization':'Bearer '+os.environ['MODERATOR_API_TOKEN']},json={'status':'resolved'})
    assert check(client,'GET','/v1/observations',params=bbox)['features']==[]
    event={'schema_version':1,'device_id':'audit','event_id':'one','kind':'bump','observed_at':datetime.now(UTC).isoformat(),'location':{'lat':35.171,'lon':136.881},'peak_delta_g':0.8,'rms_g':0.3,'gps_hdop':1.2,'speed_kmph':12}
    check(client,'POST','/v1/device-events',expected=401,json=event)
    device={'Authorization':'Bearer '+os.environ['DEVICE_INGEST_TOKEN']}
    assert not check(client,'POST','/v1/device-events',expected=201,headers=device,json=event)['duplicate']
    assert check(client,'POST','/v1/device-events',expected=201,headers=device,json=event)['duplicate']
    check(client,'POST','/v1/device-events',expected=409,headers=device,json={**event,'peak_delta_g':1})
    data=check(client,'GET','/v1/map-data',params=bbox)
    assert len(data['route_context']['surface']['features'])==1
    for bike in options['bike_types']:
        routed=check(client,'POST','/v1/routes',json={**route_body,'bike_type':bike})
        assert routed['route']['features'] and routed['resolved']['bike_type']==bike
    check(client,'POST','/v1/routes',expected=422,json={**route_body,'bike_type':'unsupported'})
    # OAuth state/cookie/single-use flow, with only the external Google exchange replaced.
    m.auth_service.google_client_id='audit-client';m.auth_service.google_client_secret='audit-secret'
    url=check(client,'GET','/v1/auth/google')['authorization_url']
    state=parse_qs(urlsplit(url).query)['state'][0]
    with TestClient(m.app) as foreign:
        check(foreign,'GET',f'/v1/auth/google/callback?code=audit&state={state}',expected=400)
    async def fake_google(code):
        return m.auth_service._session(other)
    with patch.object(m.auth_service,'google_login',side_effect=fake_google):
        check(client,'GET',f'/v1/auth/google/callback?code=audit&state={state}')
        check(client,'GET',f'/v1/auth/google/callback?code=audit&state={state}',expected=400)
    refresh={'Authorization':'Bearer '+session['refresh_token']}
    rotated=check(client,'POST','/v1/auth/refresh',headers=refresh)
    check(client,'POST','/v1/auth/refresh',expected=401,headers=refresh)
    refresh={'Authorization':'Bearer '+rotated['refresh_token']}
    check(client,'POST','/v1/auth/logout',headers=refresh)
    check(client,'POST','/v1/auth/refresh',expected=401,headers=refresh)
    check(client,'DELETE','/v1/saved-places/'+place['id'],headers=headers)
    check(client,'DELETE','/v1/saved-routes/'+saved['id'],headers=headers)
    cors=client.options('/v1/saved-places/'+place['id'],headers={'Origin':m.auth_service.frontend_origin,'Access-Control-Request-Method':'DELETE'})
    assert cors.status_code==200
print(f'PASS: {checks} API checks; real PostgreSQL/PostGIS, local source providers, five BRouter bike profiles. SMTP/Google exchange intercepted.')
