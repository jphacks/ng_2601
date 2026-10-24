CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name text,
    bike_type text NOT NULL DEFAULT 'city'
        CHECK (bike_type IN ('city', 'electric_assist', 'road', 'gravel', 'mamachari')),
    hill_mode text NOT NULL DEFAULT 'balanced'
        CHECK (hill_mode IN ('avoid', 'balanced', 'accept')),
    traffic_mode text NOT NULL DEFAULT 'balanced'
        CHECK (traffic_mode IN ('avoid', 'balanced', 'direct')),
    surface_mode text NOT NULL DEFAULT 'comfortable'
        CHECK (surface_mode IN ('paved', 'comfortable', 'rough_ok')),
    walking_mode text NOT NULL DEFAULT 'short'
        CHECK (walking_mode IN ('never', 'short', 'long')),
    created_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE TABLE auth_identities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider text NOT NULL CHECK (provider IN ('google', 'email_magic_link')),
    provider_subject text NOT NULL,
    email text,
    email_verified_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    UNIQUE (provider, provider_subject)
);

CREATE INDEX auth_identities_email_idx
    ON auth_identities (lower(email))
    WHERE email IS NOT NULL AND revoked_at IS NULL;

CREATE TABLE auth_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz
);

CREATE TABLE email_login_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX email_login_tokens_expiry_idx ON email_login_tokens (expires_at);

CREATE TABLE observations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    author_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    category text NOT NULL,
    location geography(Point, 4326) NOT NULL,
    temporal_kind text NOT NULL
        CHECK (temporal_kind IN ('permanent', 'time_of_day', 'date_range', 'temporary', 'trend')),
    observed_at timestamptz NOT NULL,
    starts_at timestamptz,
    ends_at timestamptz,
    expires_at timestamptz,
    status text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'resolved', 'withdrawn', 'expired')),
    verification_state text NOT NULL DEFAULT 'unverified'
        CHECK (verification_state IN ('unverified', 'corroborated', 'moderated')),
    description text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (temporal_kind = 'date_range' AND starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at > starts_at)
        OR (temporal_kind <> 'date_range' AND starts_at IS NULL AND ends_at IS NULL)
    ),
    CHECK (temporal_kind <> 'temporary' OR expires_at IS NOT NULL),
    CHECK (expires_at IS NULL OR expires_at > observed_at)
);

CREATE INDEX observations_location_gix ON observations USING gist (location);
CREATE INDEX observations_active_expiry_idx ON observations (status, expires_at);
CREATE INDEX observations_category_idx ON observations (category);

CREATE TABLE observation_confirmations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    observation_id uuid NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    state text NOT NULL CHECK (state IN ('still_present', 'cleared', 'inaccurate', 'duplicate')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (observation_id, user_id)
);

CREATE TABLE saved_places (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label text NOT NULL,
    location geography(Point, 4326) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX saved_places_user_idx ON saved_places (user_id);

CREATE TABLE saved_routes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label text NOT NULL,
    bike_type text NOT NULL CHECK (bike_type IN ('city', 'electric_assist', 'road', 'gravel', 'mamachari')),
    start_location geography(Point, 4326) NOT NULL,
    end_location geography(Point, 4326) NOT NULL,
    preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
    last_route_geojson jsonb,
    last_routed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX saved_routes_user_idx ON saved_routes (user_id);
