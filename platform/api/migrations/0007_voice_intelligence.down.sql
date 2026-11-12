-- Rollback NEXORA Migration 0007 — Voice Intelligence Platform
DROP TABLE IF EXISTS voice.call_logs;
DROP TABLE IF EXISTS voice.caller_directory;
DROP TABLE IF EXISTS voice.capture_sessions;
DROP TABLE IF EXISTS voice.model_telemetry;
DROP TABLE IF EXISTS voice.custody_events;
DROP TABLE IF EXISTS voice.evidence_records;
DROP TABLE IF EXISTS voice.human_corrections;
DROP TABLE IF EXISTS voice.action_suggestions;
DROP TABLE IF EXISTS voice.knowledge_edges;
DROP TABLE IF EXISTS voice.knowledge_entities;
DROP TABLE IF EXISTS voice.reasoning_findings;
DROP TABLE IF EXISTS voice.conversation_events;
DROP TABLE IF EXISTS voice.utterances;
DROP TABLE IF EXISTS voice.participants;
DROP TABLE IF EXISTS voice.recordings;
DROP TABLE IF EXISTS voice.conversations;
DROP SCHEMA IF EXISTS voice;

DELETE FROM platform.module_preferences WHERE module_key = 'voice';

ALTER TABLE platform.module_preferences
    DROP CONSTRAINT IF EXISTS chk_platform_module_preferences_key;
ALTER TABLE platform.module_preferences
    ADD CONSTRAINT chk_platform_module_preferences_key
    CHECK (module_key IN ('move','health','finance','work','assistant'));
