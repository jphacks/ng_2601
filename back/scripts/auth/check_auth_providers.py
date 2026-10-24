#!/usr/bin/env python3
"""Try the interactive Google OAuth flow, then test the SMTP relay fallback.

This is an operator test, not a production login client. It reads
``backend/.env`` without printing secrets. OAuth needs a real client ID,
client secret, and a callback reachable by the browser. If that cannot be
completed, the script sends one clearly labelled message to
``SMTP_TEST_RECEIVER`` using the configured relay credentials.
"""

from __future__ import annotations

import argparse
import http.cookiejar
import json
import os
import smtplib
import socket
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path


class OAuthTestFailure(RuntimeError):
    pass


def load_env(path: Path) -> None:
    """Load simple KEY=value entries without overriding shell variables."""
    if not path.is_file():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        os.environ.setdefault(key, value)


def request_json(opener: urllib.request.OpenerDirector, url: str) -> tuple[int, dict[str, object]]:
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with opener.open(request, timeout=20) as response:
            status = response.status
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise OAuthTestFailure(f"backend returned HTTP {error.code}: {body[:240]}") from error
    except (OSError, urllib.error.URLError) as error:
        raise OAuthTestFailure(f"backend is unreachable: {error}") from error
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as error:
        raise OAuthTestFailure("backend returned non-JSON OAuth data") from error
    if not isinstance(payload, dict):
        raise OAuthTestFailure("backend returned an unexpected OAuth response")
    return status, payload


def try_oauth(backend_url: str, callback_input: str | None, open_browser: bool) -> None:
    client_id = os.getenv("GOOGLE_CLIENT_ID", "")
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET", "")
    if not client_id or client_id.startswith("dummy") or not client_secret:
        raise OAuthTestFailure("Google OAuth credentials are missing or still dummy values")

    callback_url = os.getenv("GOOGLE_CALLBACK_URL", "")
    if not callback_url:
        raise OAuthTestFailure("GOOGLE_CALLBACK_URL is not configured")

    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    _, payload = request_json(opener, f"{backend_url.rstrip('/')}/v1/auth/google")
    authorization_url = payload.get("authorization_url")
    if not isinstance(authorization_url, str) or not authorization_url.startswith("https://accounts.google.com/"):
        raise OAuthTestFailure("backend did not return a Google authorization URL")

    print("OAuth authorization URL:")
    print(authorization_url)
    print("The browser callback may show HTTP 400 because this script owns the OAuth cookie.")
    print("Copy the final callback URL from the browser address bar and paste it here.")
    if open_browser:
        webbrowser.open(authorization_url)
    try:
        callback_value = callback_input or input("Callback URL (blank to skip OAuth): ").strip()
    except EOFError as error:
        raise OAuthTestFailure("OAuth callback was not supplied on a non-interactive terminal") from error
    if not callback_value:
        raise OAuthTestFailure("OAuth callback was not supplied")
    parsed = urllib.parse.urlsplit(callback_value)
    query = urllib.parse.parse_qs(parsed.query)
    code = query.get("code", [""])[0]
    state = query.get("state", [""])[0]
    if not code or not state:
        raise OAuthTestFailure("callback URL does not contain both code and state")

    callback_endpoint = urllib.parse.urljoin(f"{backend_url.rstrip('/')}/", "v1/auth/google/callback")
    callback_request = urllib.request.Request(
        callback_endpoint + "?" + urllib.parse.urlencode({"code": code, "state": state}),
        headers={"Accept": "application/json"},
    )
    try:
        with opener.open(callback_request, timeout=30) as response:
            body = response.read().decode("utf-8")
            status = response.status
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise OAuthTestFailure(f"OAuth callback returned HTTP {error.code}: {body[:240]}") from error
    except (OSError, urllib.error.URLError) as error:
        raise OAuthTestFailure(f"OAuth callback failed: {error}") from error
    if status != 200:
        raise OAuthTestFailure(f"OAuth callback returned HTTP {status}: {body[:240]}")
    result = json.loads(body)
    if not isinstance(result, dict) or not isinstance(result.get("session"), dict):
        raise OAuthTestFailure("OAuth callback did not return a session")
    print("Google OAuth succeeded; session tokens were received and not printed.")


def try_smtp() -> None:
    receiver = os.getenv("SMTP_TEST_RECEIVER", "").strip()
    host = os.getenv("SMTP_HOST", "smtp.gmail.com").strip()
    security = os.getenv("SMTP_SECURITY", "auto").strip().lower()
    auth_mode = os.getenv("SMTP_AUTH_MODE", "required").strip().lower()
    helo_name = os.getenv("SMTP_HELO_NAME", "").strip() or socket.getfqdn()
    sender = os.getenv("SMTP_SENDER", "").strip()
    username = os.getenv("SMTP_USERNAME", "").strip()
    password = os.getenv("SMTP_PASSWORD", "")
    if not receiver:
        raise RuntimeError("SMTP_TEST_RECEIVER is empty; refusing to send a test message")
    if not sender or (auth_mode == "required" and (not username or not password)):
        raise RuntimeError("SMTP_SENDER is required; SMTP_USERNAME and SMTP_PASSWORD are required in SMTP AUTH mode")
    try:
        port = int(os.getenv("SMTP_PORT", "587"))
    except ValueError as error:
        raise RuntimeError("SMTP_PORT must be an integer") from error

    message = EmailMessage()
    message["Subject"] = "CyclerHub-back SMTP relay test"
    message["From"] = sender
    message["To"] = receiver
    message.set_content(
        "This is an operator test from CyclerHub-back.\n"
        f"Sent at {datetime.now(timezone.utc).isoformat()}.\n"
        "It is not a sign-in link."
    )
    if security not in {"auto", "starttls", "ssl"}:
        raise RuntimeError("SMTP_SECURITY must be auto, starttls, or ssl")
    if auth_mode not in {"required", "auto", "none"}:
        raise RuntimeError("SMTP_AUTH_MODE must be required, auto, or none")
    if security == "auto" and port == 465:
        security = "ssl"
    tls_context = ssl.create_default_context()

    def send_once(mode: str, target_port: int) -> None:
        if mode == "ssl":
            with smtplib.SMTP_SSL(
                host, target_port, timeout=20, local_hostname=helo_name, context=tls_context
            ) as smtp:
                smtp_ehlo(smtp)
                smtp_authenticate(smtp)
                smtp.send_message(message)
            return
        with smtplib.SMTP(host, target_port, timeout=20, local_hostname=helo_name) as smtp:
            smtp_ehlo(smtp)
            smtp.starttls(context=tls_context)
            smtp_ehlo(smtp)
            smtp_authenticate(smtp)
            smtp.send_message(message)

    def smtp_ehlo(smtp: smtplib.SMTP) -> None:
        code, response = smtp.ehlo()
        if code != 250:
            raise smtplib.SMTPResponseException(code, response)

    def smtp_authenticate(smtp: smtplib.SMTP) -> None:
        if auth_mode == "none":
            return
        auth_advertised = "auth" in getattr(smtp, "esmtp_features", {})
        if auth_mode == "auto" and not auth_advertised:
            print("SMTP AUTH was not advertised; using the relay's encrypted IP-authenticated mode.")
            return
        if not auth_advertised:
            raise smtplib.SMTPNotSupportedError("SMTP AUTH is not advertised by the server")
        smtp.login(username, password)

    try:
        send_once(security, port)
    except (smtplib.SMTPNotSupportedError, smtplib.SMTPResponseException) as error:
        retryable_response = not isinstance(error, smtplib.SMTPResponseException) or 400 <= error.smtp_code < 500
        if security == "auto" and port == 587 and retryable_response:
            if isinstance(error, smtplib.SMTPResponseException):
                print(f"SMTP port 587 rejected the session with {error.smtp_code}; retrying encrypted SMTP on port 465.")
            else:
                print("STARTTLS or SMTP AUTH was not available on port 587; retrying encrypted SMTP on port 465.")
            try:
                send_once("ssl", 465)
            except (OSError, smtplib.SMTPException) as error:
                raise RuntimeError(f"SMTP relay test failed on both STARTTLS and implicit TLS: {error}") from error
        else:
            raise RuntimeError(f"SMTP relay test failed: {error}") from error
    except (OSError, smtplib.SMTPException) as error:
        raise RuntimeError(f"SMTP relay test failed: {error}") from error
    print(f"SMTP relay accepted a test message for {receiver}.")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend-url", default=os.getenv("BACKEND_URL", "http://localhost:8080"))
    parser.add_argument("--callback-url", help="callback URL copied from the browser; skips the prompt")
    parser.add_argument("--open-browser", action="store_true", help="open the Google authorization URL")
    parser.add_argument("--smtp-only", action="store_true", help="skip OAuth and test the SMTP relay")
    args = parser.parse_args()

    script_dir = Path(__file__).resolve().parent
    load_env(script_dir.parent.parent / "backend" / ".env")

    if not args.smtp_only:
        try:
            try_oauth(args.backend_url, args.callback_url, args.open_browser)
            return 0
        except (OAuthTestFailure, OSError, ValueError, json.JSONDecodeError) as error:
            print(f"OAuth test did not complete: {error}", file=sys.stderr)
    try:
        try_smtp()
        return 0
    except RuntimeError as error:
        print(f"SMTP fallback test failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
