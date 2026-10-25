CREATE TABLE IF NOT EXISTS device_surface_events (
    id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    device_id text NOT NULL,
    event_id text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('bump', 'roughness')),
    observed_at timestamptz NOT NULL,
    location geography(Point, 4326) NOT NULL,
    peak_delta_g real NOT NULL,
    rms_g real NOT NULL,
    gps_hdop real NOT NULL,
    speed_kmph real NOT NULL,
    payload_fingerprint text NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (device_id, event_id)
);

CREATE INDEX IF NOT EXISTS device_surface_events_location_gix
    ON device_surface_events USING gist (location);
CREATE INDEX IF NOT EXISTS device_surface_events_observed_at_idx
    ON device_surface_events (observed_at DESC);
