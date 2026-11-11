-- Rollback Migration 0005 — 12-Pillar City Movement Digital Twin & Privacy Intelligence

DROP TABLE IF EXISTS mobility.privacy_aggregated_flows;
DROP TABLE IF EXISTS mobility.road_memory_nodes;
DROP TABLE IF EXISTS mobility.urban_simulations;
DROP TABLE IF EXISTS mobility.pedestrian_safety_cells;
DROP TABLE IF EXISTS mobility.animal_conflict_zones;
DROP TABLE IF EXISTS mobility.crowd_forecasts;
DROP TABLE IF EXISTS mobility.digital_twin_edges;
DROP TABLE IF EXISTS mobility.digital_twin_nodes;
