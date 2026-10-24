"""The hub between user data, routing policy, and external restrictions."""

from __future__ import annotations

import psycopg
from typing import Protocol


class UserPreferenceStore(Protocol):
    def preferences_for(self, user_id: str, bike_type: str) -> dict[str, str]: ...

    def profile_for(self, user_id: str) -> dict[str, str]: ...


class NoUserPreferenceStore:
    """Fallback used when the backend runs without a configured database."""

    def preferences_for(self, user_id: str, bike_type: str) -> dict[str, str]:
        return {}

    def profile_for(self, user_id: str) -> dict[str, str]:
        return {}


class PostgresUserPreferenceStore:
    """Reads the user's single saved bike and preference set from PostgreSQL."""

    def __init__(self, database_url: str) -> None:
        self.database_url = database_url

    def preferences_for(self, user_id: str, bike_type: str) -> dict[str, str]:
        profile = self.profile_for(user_id)
        if not profile:
            return {}
        return {key: value for key, value in profile.items() if key != "bike_type"}

    def profile_for(self, user_id: str) -> dict[str, str]:
        try:
            with psycopg.connect(self.database_url) as connection:
                row = connection.execute(
                    """
                    SELECT bike_type, hill_mode, traffic_mode, surface_mode, walking_mode
                    FROM users
                    WHERE id = %s AND deleted_at IS NULL
                    """,
                    (user_id,),
                ).fetchone()
        except psycopg.Error:
            # Routing remains usable while the local database is starting up.
            return {}
        if not row:
            return {}
        return {
            "bike_type": str(row[0]),
            "hill_mode": str(row[1]),
            "traffic_mode": str(row[2]),
            "surface_mode": str(row[3]),
            "walking_mode": str(row[4]),
        }
