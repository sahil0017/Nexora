-- NEXORA Feature 1 — Intelligence & Event-Driven Mobility Schema (v3)
-- Covers:
--   1. H3 spatial grid & HDBSCAN hotspot clusters (mobility.spatial_cells)
--   2. Mobility demand & surge forecasting (mobility.demand_forecasts)
--   3. Road intelligence / computer vision hazards (mobility.road_hazards)

-- ============================================================
-- 1. H3 SPATIAL CELLS & HOTSPOTS
-- ============================================================
CREATE TABLE IF NOT EXISTS mobility.spatial_cells (
    h3_index         TEXT PRIMARY KEY,
    city_id          TEXT REFERENCES mobility.cities(id) ON DELETE SET NULL,
    resolution       SMALLINT NOT NULL DEFAULT 8 CHECK (resolution BETWEEN 0 AND 15),
    center           geography(POINT, 4326) NOT NULL,
    hotspot_cluster  INT,
    congestion_score REAL NOT NULL DEFAULT 0 CHECK (congestion_score BETWEEN 0 AND 1),
    sample_count     INT NOT NULL DEFAULT 0,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_spatial_cells_center
    ON mobility.spatial_cells USING GIST(center);
CREATE TRIGGER trg_spatial_cells_touch
    BEFORE UPDATE ON mobility.spatial_cells
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================
-- 2. MOBILITY DEMAND PREDICTIONS (TFT / Prophet / XGBoost)
-- ============================================================
CREATE TABLE IF NOT EXISTS mobility.demand_forecasts (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    h3_index               TEXT NOT NULL,
    city_id                TEXT REFERENCES mobility.cities(id) ON DELETE SET NULL,
    horizon_min            SMALLINT NOT NULL CHECK (horizon_min IN (15, 30, 60, 120)),
    predicted_demand       REAL NOT NULL CHECK (predicted_demand >= 0),
    surge_pressure         REAL NOT NULL DEFAULT 1.0 CHECK (surge_pressure >= 0.5),
    peak_hour_probability  REAL CHECK (peak_hour_probability BETWEEN 0 AND 1),
    transport_availability REAL CHECK (transport_availability BETWEEN 0 AND 1),
    weather_condition      TEXT NOT NULL DEFAULT 'clear',
    model_version          TEXT NOT NULL,
    predicted_for          TIMESTAMPTZ NOT NULL,
    generated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (h3_index, predicted_for, horizon_min, model_version)
);
CREATE INDEX IF NOT EXISTS idx_demand_forecasts_cell_time
    ON mobility.demand_forecasts(h3_index, predicted_for DESC);

-- ============================================================
-- 3. ROAD INTELLIGENCE / COMPUTER VISION HAZARDS
-- ============================================================
CREATE TABLE IF NOT EXISTS mobility.road_hazards (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID REFERENCES identity.users(id) ON DELETE SET NULL,
    trip_id            UUID REFERENCES mobility.trips(id) ON DELETE SET NULL,
    segment_id         TEXT REFERENCES mobility.road_segments(id) ON DELETE SET NULL,
    h3_index           TEXT,
    location           geography(POINT, 4326) NOT NULL,
    hazard_type        TEXT NOT NULL
                       CHECK (hazard_type IN ('pothole','damaged_road','blocked_lane','waterlogging','accident','construction','other')),
    severity           TEXT NOT NULL DEFAULT 'medium'
                       CHECK (severity IN ('low','medium','high','critical')),
    confidence         REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    lane_impact_factor REAL NOT NULL DEFAULT 0.15 CHECK (lane_impact_factor BETWEEN 0 AND 1),
    bounding_boxes     JSONB NOT NULL DEFAULT '[]',
    image_ref          TEXT,
    model_version      TEXT NOT NULL,
    verified           BOOLEAN NOT NULL DEFAULT false,
    status             TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','resolved','false_positive')),
    reported_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_road_hazards_loc
    ON mobility.road_hazards USING GIST(location)
    WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_road_hazards_segment
    ON mobility.road_hazards(segment_id, reported_at DESC)
    WHERE status = 'active';
