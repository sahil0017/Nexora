-- Rollback for 0002_mobility_feature1
DROP TABLE IF EXISTS mobility.transit_realtime_observations CASCADE;
DROP TABLE IF EXISTS mobility.route_predictions CASCADE;
DROP TABLE IF EXISTS mobility.route_segments CASCADE;

ALTER TABLE mobility.trip_feedback
    DROP COLUMN IF EXISTS feedback;

DROP INDEX IF EXISTS mobility.idx_routeoptions_journey;
ALTER TABLE mobility.route_options
    DROP COLUMN IF EXISTS model_version,
    DROP COLUMN IF EXISTS explanation,
    DROP COLUMN IF EXISTS estimated_cost_inr,
    DROP COLUMN IF EXISTS reliability_score,
    DROP COLUMN IF EXISTS eta_p80_s,
    DROP COLUMN IF EXISTS journey_id;

ALTER TABLE mobility.trips DROP COLUMN IF EXISTS city_id;
ALTER TABLE mobility.saved_places DROP COLUMN IF EXISTS city_id;

DROP TABLE IF EXISTS mobility.commute_patterns CASCADE;
DROP TABLE IF EXISTS mobility.route_preferences CASCADE;
DROP TABLE IF EXISTS mobility.profiles CASCADE;
DROP TABLE IF EXISTS mobility.cities CASCADE;

DROP TABLE IF EXISTS platform.processed_events CASCADE;
DROP TABLE IF EXISTS platform.event_outbox CASCADE;

DROP INDEX IF EXISTS identity.idx_users_provider_subject;
ALTER TABLE identity.users
    DROP COLUMN IF EXISTS external_subject,
    DROP COLUMN IF EXISTS auth_provider;
