-- Rollback for 0003_mobility_intelligence
DROP TABLE IF EXISTS mobility.road_hazards CASCADE;
DROP TABLE IF EXISTS mobility.demand_forecasts CASCADE;
DROP TABLE IF EXISTS mobility.spatial_cells CASCADE;
