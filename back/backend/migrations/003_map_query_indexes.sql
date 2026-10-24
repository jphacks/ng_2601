-- Indexes used by the public observation/map read APIs.
-- The original GiST index remains the canonical spatial index; this partial
-- index keeps active-map queries smaller as resolved reports accumulate.
CREATE INDEX CONCURRENTLY IF NOT EXISTS observations_active_location_gix
    ON observations USING gist (location)
    WHERE status = 'active';

CREATE INDEX CONCURRENTLY IF NOT EXISTS observations_active_observed_idx
    ON observations (observed_at DESC)
    WHERE status = 'active';
