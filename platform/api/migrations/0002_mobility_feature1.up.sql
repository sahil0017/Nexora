-- NEXORA Feature 1 (MoveSmart) data model completion.
-- Adds missing mobility personalization, route segments/predictions,
-- partitioned GTFS-RT observations, multi-city config, outbox/idempotency,
-- and OIDC auth_provider support.

-- ============================================================
-- 1. IDENTITY (OIDC / provider support)
-- ============================================================
ALTER TABLE identity.users
    ALTER COLUMN password_hash DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'local',
    ADD COLUMN IF NOT EXISTS external_subject TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider_subject
    ON identity.users(auth_provider, external_subject)
    WHERE external_subject IS NOT NULL;

-- ============================================================
-- 2. PLATFORM (Transactional outbox + idempotent consumers)
-- ============================================================
CREATE TABLE IF NOT EXISTS platform.event_outbox (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type     TEXT NOT NULL,
    schema_version INT NOT NULL DEFAULT 1,
    aggregate_type TEXT NOT NULL,
    aggregate_id   TEXT NOT NULL,
    partition_key  TEXT NOT NULL,
    payload        JSONB NOT NULL,
    occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at   TIMESTAMPTZ,
    attempts       INT NOT NULL DEFAULT 0,
    last_error     TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_unpublished
    ON platform.event_outbox(occurred_at)
    WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS platform.processed_events (
    event_id       UUID NOT NULL,
    consumer_group TEXT NOT NULL,
    processed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (event_id, consumer_group)
);

-- ============================================================
-- 3. MOBILITY — MULTI-CITY & PERSONALIZATION
-- ============================================================
-- City operational config (Section 10). Spatial center/bounds allow
-- resolving city_id automatically from GPS coordinates; unconfigured
-- cities can be populated dynamically via GPS reverse-geocoding.
CREATE TABLE IF NOT EXISTS mobility.cities (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    country    CHAR(2),
    timezone   TEXT,
    currency   CHAR(3),
    center     geography(POINT, 4326),
    bounds     geography(POLYGON, 4326),
    config     JSONB NOT NULL DEFAULT '{}',
    enabled    BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cities_bounds ON mobility.cities USING GIST(bounds);

CREATE TABLE IF NOT EXISTS mobility.profiles (
    user_id      UUID PRIMARY KEY REFERENCES identity.users(id) ON DELETE CASCADE,
    city_id      TEXT REFERENCES mobility.cities(id) ON DELETE SET NULL,
    default_mode TEXT NOT NULL DEFAULT 'two_wheeler'
                 CHECK (default_mode IN ('walk','bicycle','two_wheeler','car','bus','metro','multimodal')),
    preferences  JSONB NOT NULL DEFAULT '{}',
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_mobility_profiles_touch
    BEFORE UPDATE ON mobility.profiles
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE IF NOT EXISTS mobility.route_preferences (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL UNIQUE REFERENCES identity.users(id) ON DELETE CASCADE,
    weights             JSONB NOT NULL DEFAULT '{"time":0.4,"reliability":0.3,"cost":0.2,"walk":0.1}',
    optimize_for        TEXT NOT NULL DEFAULT 'RELIABILITY'
                        CHECK (optimize_for IN ('FASTEST','RELIABILITY','CHEAPEST','LEAST_WALKING')),
    avoid_tolls         BOOLEAN NOT NULL DEFAULT false,
    max_walking_minutes SMALLINT NOT NULL DEFAULT 15 CHECK (max_walking_minutes >= 0),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_route_prefs_touch
    BEFORE UPDATE ON mobility.route_preferences
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE IF NOT EXISTS mobility.commute_patterns (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    origin_place_id      UUID REFERENCES mobility.saved_places(id) ON DELETE SET NULL,
    destination_place_id UUID REFERENCES mobility.saved_places(id) ON DELETE SET NULL,
    weekday              SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    departure_time       TIME NOT NULL,
    pattern              JSONB NOT NULL DEFAULT '{}',
    confidence           REAL CHECK (confidence BETWEEN 0 AND 1),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_commute_patterns_user
    ON mobility.commute_patterns(user_id, weekday);
CREATE TRIGGER trg_commute_patterns_touch
    BEFORE UPDATE ON mobility.commute_patterns
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================
-- 4. MOBILITY — CITY SCOPING, ROUTE SEGMENTS & PREDICTIONS
-- ============================================================
-- Resolved from GPS coordinates / reverse-geocoding (nullable if outside a configured city).
ALTER TABLE mobility.saved_places
    ADD COLUMN IF NOT EXISTS city_id TEXT REFERENCES mobility.cities(id) ON DELETE SET NULL;

ALTER TABLE mobility.trips
    ADD COLUMN IF NOT EXISTS city_id TEXT REFERENCES mobility.cities(id) ON DELETE SET NULL;

-- Route options may be generated during /journeys/plan before a trip starts.
ALTER TABLE mobility.route_options
    ALTER COLUMN trip_id DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS journey_id UUID,
    ADD COLUMN IF NOT EXISTS eta_p80_s INT,
    ADD COLUMN IF NOT EXISTS reliability_score REAL CHECK (reliability_score BETWEEN 0 AND 1),
    ADD COLUMN IF NOT EXISTS estimated_cost_inr NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS explanation JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS model_version TEXT;

CREATE INDEX IF NOT EXISTS idx_routeoptions_journey
    ON mobility.route_options(journey_id)
    WHERE journey_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS mobility.route_segments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_option_id UUID NOT NULL REFERENCES mobility.route_options(id) ON DELETE CASCADE,
    road_segment_id TEXT NOT NULL REFERENCES mobility.road_segments(id),
    sequence        INT NOT NULL,
    UNIQUE (route_option_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_routesegments_segment
    ON mobility.route_segments(road_segment_id);

-- Per-model route predictions (supports shadow mode & calibration evaluation).
CREATE TABLE IF NOT EXISTS mobility.route_predictions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_option_id UUID NOT NULL REFERENCES mobility.route_options(id) ON DELETE CASCADE,
    model_version   TEXT NOT NULL,
    is_shadow       BOOLEAN NOT NULL DEFAULT false,
    eta_p50_s       INT NOT NULL,
    eta_p80_s       INT,
    eta_p90_s       INT,
    uncertainty     JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_routepredictions_option
    ON mobility.route_predictions(route_option_id, created_at DESC);

ALTER TABLE mobility.trip_feedback
    ADD COLUMN IF NOT EXISTS feedback JSONB NOT NULL DEFAULT '{}';

-- ============================================================
-- 5. MOBILITY — PARTITIONED GTFS-RT OBSERVATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS mobility.transit_realtime_observations (
    id               BIGINT GENERATED ALWAYS AS IDENTITY,
    city_id          TEXT,
    trip_id          TEXT,
    stop_id          TEXT,
    route_id         TEXT,
    delay_seconds    INT,
    vehicle_location geography(POINT, 4326),
    source           TEXT NOT NULL DEFAULT 'gtfs_rt',
    observed_at      TIMESTAMPTZ NOT NULL,
    ingested_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (observed_at, id)
) PARTITION BY RANGE (observed_at);

CREATE TABLE IF NOT EXISTS mobility.transit_realtime_observations_default
    PARTITION OF mobility.transit_realtime_observations DEFAULT;

CREATE INDEX IF NOT EXISTS idx_transit_rt_stop
    ON mobility.transit_realtime_observations(stop_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_transit_rt_trip
    ON mobility.transit_realtime_observations(trip_id, observed_at DESC);
