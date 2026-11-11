-- NEXORA Migration 0005 — 12-Pillar City Movement Digital Twin & Privacy-Preserving Intelligence

-- ============================================================
-- 1. CITY MOVEMENT DIGITAL TWIN GRAPH (Nodes & Directed Edges)
-- ============================================================
CREATE TABLE IF NOT EXISTS mobility.digital_twin_nodes (
    node_id           TEXT PRIMARY KEY,
    h3_index          TEXT NOT NULL,
    city_id           TEXT REFERENCES mobility.cities(id) ON DELETE SET NULL,
    node_type         TEXT NOT NULL CHECK (node_type IN ('road_junction','transit_hub','pedestrian_zone','wildlife_corridor')),
    location          geography(POINT, 4326) NOT NULL,
    vehicle_flow      REAL NOT NULL DEFAULT 0,
    crowd_density     REAL NOT NULL DEFAULT 0 CHECK (crowd_density BETWEEN 0 AND 1),
    safety_index      REAL NOT NULL DEFAULT 0.85 CHECK (safety_index BETWEEN 0 AND 1),
    state_metadata    JSONB NOT NULL DEFAULT '{}',
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dt_nodes_loc ON mobility.digital_twin_nodes USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_dt_nodes_h3 ON mobility.digital_twin_nodes(h3_index);
CREATE TRIGGER trg_dt_nodes_touch BEFORE UPDATE ON mobility.digital_twin_nodes FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE IF NOT EXISTS mobility.digital_twin_edges (
    edge_id           TEXT PRIMARY KEY,
    from_node_id      TEXT NOT NULL REFERENCES mobility.digital_twin_nodes(node_id) ON DELETE CASCADE,
    to_node_id        TEXT NOT NULL REFERENCES mobility.digital_twin_nodes(node_id) ON DELETE CASCADE,
    mode              TEXT NOT NULL,
    capacity_per_hr   INT NOT NULL DEFAULT 1200,
    current_load_pct  REAL NOT NULL DEFAULT 0.35 CHECK (current_load_pct BETWEEN 0 AND 2.5),
    avg_speed_kph     REAL NOT NULL DEFAULT 32.0,
    anomaly_active    BOOLEAN NOT NULL DEFAULT false,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dt_edges_nodes ON mobility.digital_twin_edges(from_node_id, to_node_id);

-- ============================================================
-- 2. CROSS-DOMAIN MOVEMENT & 3. PREDICTIVE CROWD INTELLIGENCE
-- ============================================================
CREATE TABLE IF NOT EXISTS mobility.crowd_forecasts (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    h3_index                TEXT NOT NULL,
    city_id                 TEXT REFERENCES mobility.cities(id) ON DELETE SET NULL,
    horizon_min             SMALLINT NOT NULL CHECK (horizon_min IN (15, 30, 60, 120)),
    predicted_crowd_density REAL NOT NULL CHECK (predicted_crowd_density BETWEEN 0 AND 1),
    vehicle_pressure        REAL NOT NULL DEFAULT 0.4 CHECK (vehicle_pressure BETWEEN 0 AND 1),
    animal_presence_score   REAL NOT NULL DEFAULT 0.0 CHECK (animal_presence_score BETWEEN 0 AND 1),
    bottleneck_risk         TEXT NOT NULL DEFAULT 'low' CHECK (bottleneck_risk IN ('low','moderate','high','critical')),
    drivers                 JSONB NOT NULL DEFAULT '[]',
    model_version           TEXT NOT NULL,
    predicted_for           TIMESTAMPTZ NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (h3_index, predicted_for, horizon_min, model_version)
);
CREATE INDEX IF NOT EXISTS idx_crowd_forecasts_h3 ON mobility.crowd_forecasts(h3_index, predicted_for DESC);

-- ============================================================
-- 4. ANIMAL-VEHICLE CONFLICT PREDICTION
-- ============================================================
CREATE TABLE IF NOT EXISTS mobility.animal_conflict_zones (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    h3_index          TEXT NOT NULL,
    city_id           TEXT REFERENCES mobility.cities(id) ON DELETE SET NULL,
    species_group     TEXT NOT NULL CHECK (species_group IN ('stray_cattle','stray_dog','wildlife_deer','primate','bird_flock','other')),
    corridor_type     TEXT NOT NULL DEFAULT 'urban_arterial' CHECK (corridor_type IN ('urban_arterial','peri_urban','forest_edge','highway_crossing')),
    location          geography(POINT, 4326) NOT NULL,
    risk_score        REAL NOT NULL CHECK (risk_score BETWEEN 0 AND 1),
    sighting_count    INT NOT NULL DEFAULT 1,
    active_hours_utc  INT[] NOT NULL DEFAULT '{0,1,12,13,14,15,16,17}',
    advisory          TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','monitoring','resolved')),
    last_observed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_animal_conflict_loc ON mobility.animal_conflict_zones USING GIST(location) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_animal_conflict_h3 ON mobility.animal_conflict_zones(h3_index) WHERE status = 'active';

-- ============================================================
-- 5. PEDESTRIAN SAFETY INTELLIGENCE
-- ============================================================
CREATE TABLE IF NOT EXISTS mobility.pedestrian_safety_cells (
    h3_index            TEXT PRIMARY KEY,
    city_id             TEXT REFERENCES mobility.cities(id) ON DELETE SET NULL,
    walk_safety_score   REAL NOT NULL CHECK (walk_safety_score BETWEEN 0 AND 100),
    lighting_index      REAL NOT NULL DEFAULT 0.75 CHECK (lighting_index BETWEEN 0 AND 1),
    sidewalk_continuity REAL NOT NULL DEFAULT 0.70 CHECK (sidewalk_continuity BETWEEN 0 AND 1),
    crossing_exposure   REAL NOT NULL DEFAULT 0.30 CHECK (crossing_exposure BETWEEN 0 AND 1),
    speed_exposure_kph  REAL NOT NULL DEFAULT 35.0,
    incident_count_30d  INT NOT NULL DEFAULT 0,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_ped_safety_touch BEFORE UPDATE ON mobility.pedestrian_safety_cells FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================
-- 10. URBAN WHAT-IF SIMULATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS mobility.urban_simulations (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID REFERENCES identity.users(id) ON DELETE SET NULL,
    city_id            TEXT REFERENCES mobility.cities(id) ON DELETE SET NULL,
    scenario_name      TEXT NOT NULL,
    intervention_type  TEXT NOT NULL CHECK (intervention_type IN ('car_free_zone','signal_retime','transit_boost','speed_calming','bus_lane')),
    target_h3_indices  TEXT[] NOT NULL DEFAULT '{}',
    parameters         JSONB NOT NULL DEFAULT '{}',
    baseline_metrics   JSONB NOT NULL DEFAULT '{}',
    projected_metrics  JSONB NOT NULL DEFAULT '{}',
    net_impact_summary TEXT NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_urban_sim_created ON mobility.urban_simulations(created_at DESC);

-- ============================================================
-- 11. ROAD MEMORY NETWORK (Persistent Quorum-Verified Road Conditions)
-- ============================================================
CREATE TABLE IF NOT EXISTS mobility.road_memory_nodes (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    h3_index             TEXT NOT NULL,
    segment_id           TEXT REFERENCES mobility.road_segments(id) ON DELETE SET NULL,
    location             geography(POINT, 4326) NOT NULL,
    condition_type       TEXT NOT NULL CHECK (condition_type IN ('surface_damage','chronic_waterlogging','signal_bottleneck','animal_crossing','unlit_walkway','construction_zone','smooth_corridor')),
    severity             TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
    confidence           REAL NOT NULL DEFAULT 0.65 CHECK (confidence BETWEEN 0 AND 1),
    observation_count    INT NOT NULL DEFAULT 1,
    verified_by_count    INT NOT NULL DEFAULT 1,
    decay_half_life_hrs  REAL NOT NULL DEFAULT 72.0,
    last_observed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at           TIMESTAMPTZ,
    metadata             JSONB NOT NULL DEFAULT '{}',
    status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','verified','decayed','resolved')),
    UNIQUE (h3_index, condition_type)
);
CREATE INDEX IF NOT EXISTS idx_road_memory_loc ON mobility.road_memory_nodes USING GIST(location) WHERE status IN ('active','verified');
CREATE INDEX IF NOT EXISTS idx_road_memory_h3 ON mobility.road_memory_nodes(h3_index, confidence DESC);

-- ============================================================
-- 12. PRIVACY-PRESERVING CROWD INTELLIGENCE (K-Anonymous + Epsilon DP)
-- ============================================================
CREATE TABLE IF NOT EXISTS mobility.privacy_aggregated_flows (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    h3_index              TEXT NOT NULL,
    bucket_start          TIMESTAMPTZ NOT NULL,
    k_anonymity_count     INT NOT NULL CHECK (k_anonymity_count >= 0),
    k_threshold           INT NOT NULL DEFAULT 5,
    epsilon_budget        REAL NOT NULL DEFAULT 0.5 CHECK (epsilon_budget > 0),
    suppressed_below_k    BOOLEAN NOT NULL DEFAULT false,
    noised_flow_density   REAL,
    noised_avg_speed_kph  REAL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (h3_index, bucket_start)
);
CREATE INDEX IF NOT EXISTS idx_privacy_flows_h3 ON mobility.privacy_aggregated_flows(h3_index, bucket_start DESC);
