"""Authentication, session, and moderator access services.

Google OAuth and email magic links both end in the same database-backed
session format.  The moderator API intentionally uses a separate bearer
secret so moderation does not require a user account or a moderator table.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import smtplib
import socket
import ssl
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from typing import Any, Literal
from uuid import UUID
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx
import jwt
import psycopg
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, Field, field_validator

ACCESS_TOKEN_TTL = timedelta(minutes=15)
REFRESH_TOKEN_TTL = timedelta(days=30)
MAGIC_LINK_TTL = timedelta(minutes=15)

BikeType = Literal["city", "electric_assist", "road", "gravel", "mamachari"]
HillMode = Literal["avoid", "balanced", "accept"]
TrafficMode = Literal["avoid", "balanced", "direct"]
SurfaceMode = Literal["paved", "comfortable", "rough_ok"]
WalkingMode = Literal["never", "short", "long"]


def _now() -> datetime:
    return datetime.now(UTC)


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _bearer(value: str | None) -> str:
    if not value or not value.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Bearer access token required")
    token = value[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Bearer access token required")
    return token


class SessionResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int = int(ACCESS_TOKEN_TTL.total_seconds())


class MagicLinkRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        value = value.strip().lower()
        if value.count("@") != 1 or value.startswith("@") or value.endswith("@") or any(character.isspace() or ord(character) < 32 for character in value):
            raise ValueError("A valid email address is required")
        return value


class MagicLinkConsumeRequest(BaseModel):
    token: str = Field(min_length=16, max_length=512)


class PreferenceUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=120)
    bike_type: BikeType | None = None
    hill_mode: HillMode | None = None
    traffic_mode: TrafficMode | None = None
    surface_mode: SurfaceMode | None = None
    walking_mode: WalkingMode | None = None


class GoogleCallbackResponse(BaseModel):
    session: SessionResponse
    provider: str = "google"
    picture: str | None = None


class AuthService:
    def __init__(self, database_url: str, *, session_secret: str, frontend_origin: str) -> None:
        self.database_url = database_url
        self.session_secret = session_secret
        self.frontend_origin = frontend_origin.rstrip("/")
        self.google_client_id = os.getenv("GOOGLE_CLIENT_ID", "dummy-google-client-id")
        self.google_client_secret = os.getenv("GOOGLE_CLIENT_SECRET", "")
        self.google_callback_url = os.getenv(
            "GOOGLE_CALLBACK_URL", "http://localhost:8080/v1/auth/google/callback"
        )
        self.smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
        self.smtp_port = int(os.getenv("SMTP_PORT", "587"))
        self.smtp_security = os.getenv("SMTP_SECURITY", "auto").strip().lower()
        self.smtp_auth_mode = os.getenv("SMTP_AUTH_MODE", "required").strip().lower()
        self.smtp_helo_name = os.getenv("SMTP_HELO_NAME", "").strip() or socket.getfqdn()
        self.smtp_sender = os.getenv("SMTP_SENDER", "")
        self.smtp_username = os.getenv("SMTP_USERNAME", "")
        self.smtp_password = os.getenv("SMTP_PASSWORD", "")
        self._oauth_states: dict[str, datetime] = {}

    def _send_smtp(self, message: EmailMessage) -> None:
        if self.smtp_security not in {"auto", "starttls", "ssl"}:
            raise HTTPException(status_code=503, detail="SMTP_SECURITY must be auto, starttls, or ssl")
        if self.smtp_auth_mode not in {"required", "auto", "none"}:
            raise HTTPException(status_code=503, detail="SMTP_AUTH_MODE must be required, auto, or none")

        security = self.smtp_security
        if security == "auto" and self.smtp_port == 465:
            security = "ssl"
        tls_context = ssl.create_default_context()

        def send_once(mode: str, host: str, port: int) -> None:
            if mode == "ssl":
                with smtplib.SMTP_SSL(
                    host, port, timeout=20, local_hostname=self.smtp_helo_name, context=tls_context
                ) as smtp:
                    self._smtp_ehlo(smtp)
                    self._smtp_authenticate(smtp)
                    smtp.send_message(message)
                return
            with smtplib.SMTP(host, port, timeout=20, local_hostname=self.smtp_helo_name) as smtp:
                self._smtp_ehlo(smtp)
                smtp.starttls(context=tls_context)
                self._smtp_ehlo(smtp)
                self._smtp_authenticate(smtp)
                smtp.send_message(message)

        try:
            send_once(security, self.smtp_host, self.smtp_port)
        except (smtplib.SMTPNotSupportedError, smtplib.SMTPResponseException) as error:
            # Some relay configurations expose implicit TLS on 465 but do not
            # advertise STARTTLS on the configured 587 listener. Retrying on
            # 465 is encrypted and safe; silently falling back to plaintext is
            # never acceptable when SMTP AUTH credentials are present.
            retryable_response = not isinstance(error, smtplib.SMTPResponseException) or (
                400 <= error.smtp_code < 500 and error.smtp_code != 421
            )
            if security == "auto" and self.smtp_port == 587 and retryable_response:
                send_once("ssl", self.smtp_host, 465)
            else:
                raise

    @staticmethod
    def _smtp_ehlo(smtp: smtplib.SMTP) -> None:
        code, response = smtp.ehlo()
        if code != 250:
            raise smtplib.SMTPResponseException(code, response)

    def _smtp_authenticate(self, smtp: smtplib.SMTP) -> None:
        """Authenticate when required or when an auto relay advertises AUTH.

        Google Workspace SMTP relay can be restricted by source IP instead of
        SMTP AUTH. Such a listener intentionally omits the AUTH extension; the
        connection is still encrypted, but calling ``login`` can never work.
        ``auto`` accepts that documented relay mode while ``required`` keeps
        account authentication mandatory for ordinary SMTP servers.
        """
        if self.smtp_auth_mode == "none":
            return
        auth_advertised = "auth" in getattr(smtp, "esmtp_features", {})
        if self.smtp_auth_mode == "auto" and not auth_advertised:
            return
        if not auth_advertised:
            raise smtplib.SMTPNotSupportedError("SMTP AUTH is not advertised by the server")
        if not self.smtp_username or not self.smtp_password:
            raise smtplib.SMTPAuthenticationError(535, b"SMTP credentials are required")
        smtp.login(self.smtp_username, self.smtp_password)

    def _connect(self) -> psycopg.Connection[Any]:
        return psycopg.connect(self.database_url)

    def _access_token(self, user_id: str) -> str:
        issued = _now()
        return jwt.encode(
            {
                "sub": user_id,
                "typ": "access",
                "iat": issued,
                "exp": issued + ACCESS_TOKEN_TTL,
            },
            self.session_secret,
            algorithm="HS256",
        )

    def _session(self, user_id: str) -> SessionResponse:
        refresh = secrets.token_urlsafe(48)
        expires = _now() + REFRESH_TOKEN_TTL
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO auth_sessions (user_id, refresh_token_hash, expires_at) VALUES (%s, %s, %s)",
                (user_id, _hash(refresh), expires),
            )
        return SessionResponse(access_token=self._access_token(user_id), refresh_token=refresh)

    def decode_access_token(self, token: str) -> str:
        try:
            payload = jwt.decode(token, self.session_secret, algorithms=["HS256"], options={"require": ["sub", "exp", "iat", "typ"]})
            UUID(payload["sub"])
        except (jwt.PyJWTError, ValueError, TypeError, AttributeError) as error:
            raise HTTPException(status_code=401, detail="Invalid or expired access token") from error
        if payload.get("typ") != "access" or not payload.get("sub"):
            raise HTTPException(status_code=401, detail="Invalid access token")
        return str(payload["sub"])

    def user_id_from_header(self, authorization: str | None) -> str:
        return self.decode_access_token(_bearer(authorization))

    def request_magic_link(self, email: str) -> None:
        normalized = email.strip().lower()
        raw_token = secrets.token_urlsafe(32)
        if self.smtp_auth_mode not in {"required", "auto", "none"}:
            raise HTTPException(status_code=503, detail="SMTP_AUTH_MODE must be required, auto, or none")
        if not self.smtp_sender or (
            self.smtp_auth_mode == "required" and (not self.smtp_password or not self.smtp_username)
        ):
            raise HTTPException(status_code=503, detail="SMTP is not fully configured")

        link = f"{self.frontend_origin}/auth/magic-link?token={raw_token}"
        message = EmailMessage()
        message["Subject"] = "Your CyclerHub-back sign-in link"
        message["From"] = self.smtp_sender
        message["To"] = normalized
        message.set_content(
            "Sign in to CyclerHub-back using this link. It expires in 15 minutes.\n\n" + link
        )

        with self._connect() as connection:
            # Serialize requests for the same address so concurrent calls cannot
            # both pass the cooldown check and send two messages.
            connection.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (normalized,))
            recent = connection.execute(
                "SELECT 1 FROM email_login_tokens WHERE email = %s AND consumed_at IS NULL AND expires_at > %s",
                (normalized, _now() + MAGIC_LINK_TTL - timedelta(seconds=60)),
            ).fetchone()
            if recent:
                return
            connection.execute(
                "DELETE FROM email_login_tokens WHERE email = %s AND consumed_at IS NULL",
                (normalized,),
            )
            connection.execute(
                "INSERT INTO email_login_tokens (email, token_hash, expires_at) VALUES (%s, %s, %s)",
                (normalized, _hash(raw_token), _now() + MAGIC_LINK_TTL),
            )
            try:
                self._send_smtp(message)
            except (OSError, smtplib.SMTPException) as error:
                raise HTTPException(status_code=502, detail="Unable to send sign-in email") from error

    def consume_magic_link(self, raw_token: str) -> SessionResponse:
        now = _now()
        normalized_token = _hash(raw_token)
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT id, email FROM email_login_tokens
                WHERE token_hash = %s AND consumed_at IS NULL AND expires_at > %s
                FOR UPDATE
                """,
                (normalized_token, now),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=400, detail="Invalid or expired sign-in link")
            token_id, email = row
            connection.execute(
                "UPDATE email_login_tokens SET consumed_at = %s WHERE id = %s",
                (now, token_id),
            )
            identity = connection.execute(
                "SELECT user_id FROM auth_identities WHERE lower(email) = %s AND revoked_at IS NULL LIMIT 1",
                (email.lower(),),
            ).fetchone()
            if identity:
                user_id = identity[0]
            else:
                user_id = connection.execute(
                    "INSERT INTO users DEFAULT VALUES RETURNING id"
                ).fetchone()[0]
            connection.execute(
                """
                INSERT INTO auth_identities (user_id, provider, provider_subject, email, email_verified_at)
                VALUES (%s, 'email_magic_link', %s, %s, %s)
                ON CONFLICT (provider, provider_subject)
                DO UPDATE SET email_verified_at = EXCLUDED.email_verified_at, revoked_at = NULL
                """,
                (user_id, email.lower(), email.lower(), now),
            )
        return self._session(str(user_id))

    async def google_login(self, code: str) -> tuple[SessionResponse, str | None]:
        if not self.google_client_secret or self.google_client_id.startswith("dummy"):
            raise HTTPException(status_code=503, detail="Google OAuth is not configured")
        async with httpx.AsyncClient(timeout=15) as client:
            token_response = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "code": code,
                    "client_id": self.google_client_id,
                    "client_secret": self.google_client_secret,
                    "redirect_uri": self.google_callback_url,
                    "grant_type": "authorization_code",
                },
            )
            if token_response.is_error:
                raise HTTPException(status_code=400, detail="Google authorization code was rejected")
            token = token_response.json().get("access_token")
            if not token:
                raise HTTPException(status_code=400, detail="Google did not return an access token")
            profile_response = await client.get(
                "https://openidconnect.googleapis.com/v1/userinfo",
                headers={"Authorization": f"Bearer {token}"},
            )
            if profile_response.is_error:
                raise HTTPException(status_code=400, detail="Unable to read Google profile")
            profile = profile_response.json()
        subject = str(profile.get("sub", ""))
        email = str(profile.get("email", "")).strip().lower()
        if not subject or not email or not profile.get("email_verified", False):
            raise HTTPException(status_code=400, detail="Google account email is not verified")
        session = await run_in_threadpool(self._google_identity_session, subject, email, profile.get("name"))
        picture = profile.get("picture")
        return session, picture if isinstance(picture, str) else None

    def _google_identity_session(self, subject: str, email: str, display_name: Any) -> SessionResponse:
        now = _now()
        with self._connect() as connection:
            identity = connection.execute(
                "SELECT user_id FROM auth_identities WHERE provider = 'google' AND provider_subject = %s AND revoked_at IS NULL",
                (subject,),
            ).fetchone()
            if identity:
                user_id = identity[0]
            else:
                identity = connection.execute(
                    "SELECT user_id FROM auth_identities WHERE lower(email) = %s AND revoked_at IS NULL LIMIT 1",
                    (email,),
                ).fetchone()
                if identity:
                    user_id = identity[0]
                else:
                    user_id = connection.execute(
                        "INSERT INTO users (display_name) VALUES (%s) RETURNING id",
                        (display_name,),
                    ).fetchone()[0]
                connection.execute(
                    """
                    INSERT INTO auth_identities (user_id, provider, provider_subject, email, email_verified_at)
                    VALUES (%s, 'google', %s, %s, %s)
                    ON CONFLICT (provider, provider_subject)
                    DO UPDATE SET email = EXCLUDED.email, email_verified_at = EXCLUDED.email_verified_at, revoked_at = NULL
                    """,
                    (user_id, subject, email, now),
                )
        return self._session(str(user_id))

    def refresh(self, raw_refresh: str) -> SessionResponse:
        now = _now()
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT id, user_id FROM auth_sessions
                WHERE refresh_token_hash = %s AND revoked_at IS NULL AND expires_at > %s
                FOR UPDATE
                """,
                (_hash(raw_refresh), now),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=401, detail="Invalid or expired refresh token")
            connection.execute("UPDATE auth_sessions SET revoked_at = %s WHERE id = %s", (now, row[0]))
            user_id = str(row[1])
        return self._session(user_id)

    def revoke(self, raw_refresh: str) -> None:
        with self._connect() as connection:
            connection.execute(
                "UPDATE auth_sessions SET revoked_at = %s WHERE refresh_token_hash = %s AND revoked_at IS NULL",
                (_now(), _hash(raw_refresh)),
            )

    def begin_google(self) -> str:
        if (
            not self.google_client_id
            or self.google_client_id.startswith("dummy")
            or not self.google_client_secret
            or not self.google_callback_url
        ):
            raise HTTPException(status_code=503, detail="Google OAuth is not configured")
        now = _now()
        self._oauth_states = {key: expiry for key, expiry in self._oauth_states.items() if expiry > now}
        state = secrets.token_urlsafe(24)
        self._oauth_states[state] = now + timedelta(minutes=10)
        query = urlencode(
            {
                "client_id": self.google_client_id,
                "redirect_uri": self.google_callback_url,
                "response_type": "code",
                "scope": "openid email profile",
                "state": state,
                "access_type": "offline",
                "prompt": "select_account",
            }
        )
        return f"https://accounts.google.com/o/oauth2/v2/auth?{query}"

    def consume_oauth_state(self, state: str, browser_state: str | None) -> None:
        expiry = self._oauth_states.get(state)
        if expiry is None or expiry <= _now() or not browser_state or not hmac.compare_digest(state, browser_state):
            raise HTTPException(status_code=400, detail="Invalid or expired OAuth state")
        self._oauth_states.pop(state, None)


class ModeratorTokenVerifier:
    """Single env-backed token today; replace this class for token rotation later."""

    def __init__(self, token: str) -> None:
        self.token = token

    def require(self, authorization: str | None) -> None:
        presented = _bearer(authorization)
        if not self.token or not hmac.compare_digest(presented, self.token):
            raise HTTPException(status_code=403, detail="Moderator token rejected")


def build_auth_router(service: AuthService) -> APIRouter:
    router = APIRouter(prefix="/v1/auth", tags=["auth"])

    async def current_user_id(authorization: str | None = Header(default=None)) -> str:
        return service.user_id_from_header(authorization)

    magic_attempts: dict[str, list[datetime]] = {}

    @router.post("/magic-link/request")
    def request_magic_link(request: Request, body: MagicLinkRequest) -> dict[str, str]:
        key = request.client.host if request.client else "unknown"
        now = _now()
        recent = [timestamp for timestamp in magic_attempts.get(key, []) if timestamp > now - timedelta(minutes=15)]
        if len(recent) >= 5:
            raise HTTPException(status_code=429, detail="Too many sign-in requests")
        recent.append(now)
        magic_attempts[key] = recent
        service.request_magic_link(str(body.email))
        return {"status": "sent"}

    @router.post("/magic-link/consume", response_model=SessionResponse)
    def consume_magic_link(request: MagicLinkConsumeRequest) -> SessionResponse:
        return service.consume_magic_link(request.token)

    @router.get("/google")
    async def start_google(response: Response) -> dict[str, str]:
        url = service.begin_google()
        state_values = parse_qs(urlsplit(url).query).get("state", [])
        if len(state_values) != 1:
            raise HTTPException(status_code=503, detail="OAuth state could not be created")
        state = state_values[0]
        response.set_cookie("cyclerhub_oauth", state, httponly=True, secure=service.google_callback_url.startswith("https://"), samesite="lax", max_age=600)
        return {"authorization_url": url}

    @router.get("/google/callback", response_model=GoogleCallbackResponse)
    async def google_callback(request: Request, response: Response, code: str = Query(min_length=1), state: str = Query(min_length=1)) -> GoogleCallbackResponse:
        service.consume_oauth_state(state, request.cookies.get("cyclerhub_oauth"))
        response.delete_cookie("cyclerhub_oauth")
        session, picture = await service.google_login(code)
        return GoogleCallbackResponse(session=session, picture=picture)

    @router.post("/refresh", response_model=SessionResponse)
    def refresh(authorization: str | None = Header(default=None)) -> SessionResponse:
        return service.refresh(_bearer(authorization))

    @router.post("/logout")
    def logout(authorization: str | None = Header(default=None)) -> dict[str, str]:
        service.revoke(_bearer(authorization))
        return {"status": "signed_out"}

    @router.get("/me")
    def me(user_id: str = Depends(current_user_id)) -> dict[str, object]:
        with service._connect() as connection:
            row = connection.execute(
                "SELECT id, display_name, bike_type, hill_mode, traffic_mode, surface_mode, walking_mode FROM users WHERE id = %s AND deleted_at IS NULL",
                (user_id,),
            ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        return {
            "id": str(row[0]),
            "display_name": row[1],
            "bike_type": row[2],
            "preferences": {
                "hill_mode": row[3],
                "traffic_mode": row[4],
                "surface_mode": row[5],
                "walking_mode": row[6],
            },
        }

    @router.put("/me/preferences")
    def update_preferences(
        request: PreferenceUpdate,
        user_id: str = Depends(current_user_id),
    ) -> dict[str, str]:
        values = request.model_dump(exclude_unset=True, exclude_none=True)
        if not values:
            return {"status": "unchanged"}
        assignments = ", ".join(f"{key} = %s" for key in values)
        with service._connect() as connection:
            result = connection.execute(
                f"UPDATE users SET {assignments} WHERE id = %s AND deleted_at IS NULL",
                (*values.values(), user_id),
            )
        if result.rowcount != 1:
            raise HTTPException(status_code=404, detail="User not found")
        return {"status": "updated"}

    return router

