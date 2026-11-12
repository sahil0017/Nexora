-- NEXORA Migration 0007 — Complete Voice Intelligence Platform (10 Workstreams + Conversation IR)
-- Key Architectural Invariant:
--   Original audio (voice.recordings), raw transcript (voice.utterances),
--   interpretation (voice.conversation_events / voice.reasoning_findings / voice.knowledge_*),
--   and verified/human-corrected evidence (voice.human_corrections / voice.evidence_records)
--   are strictly separate data objects linked by immutable references.

CREATE SCHEMA IF NOT EXISTS voice;

-- Extend platform.module_preferences to allow 'voice' module
DO $$
DECLARE
    c_name TEXT;
BEGIN
    SELECT conname INTO c_name
    FROM pg_constraint
    WHERE conrelid = 'platform.module_preferences'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%module_key%';
    IF c_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE platform.module_preferences DROP CONSTRAINT %I', c_name);
    END IF;
END $$;

ALTER TABLE platform.module_preferences
    ADD CONSTRAINT chk_platform_module_preferences_key
    CHECK (module_key IN ('move','health','finance','work','assistant','voice'));

INSERT INTO platform.module_preferences (user_id, module_key, enabled)
VALUES ('00000000-0000-0000-0000-000000000000', 'voice', true)
ON CONFLICT (user_id, module_key) DO UPDATE SET enabled = EXCLUDED.enabled;

-- ============================================================
-- 1. CONVERSATIONS & LAYER 1/2 RECORDINGS (Capture + Audio + Integrity)
-- ============================================================
CREATE TABLE IF NOT EXISTS voice.conversations (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    title              TEXT NOT NULL,
    summary            TEXT NOT NULL DEFAULT '',
    status             TEXT NOT NULL DEFAULT 'captured'
        CHECK (status IN ('captured','analyzing','transcribed','understood','verified','archived')),
    primary_language   TEXT NOT NULL DEFAULT 'en',
    detected_languages TEXT[] NOT NULL DEFAULT '{}',
    topics             TEXT[] NOT NULL DEFAULT '{}',
    overall_confidence REAL NOT NULL DEFAULT 0.0 CHECK (overall_confidence BETWEEN 0 AND 1),
    confidence_tier    TEXT NOT NULL DEFAULT 'MEDIUM'
        CHECK (confidence_tier IN ('HIGH','MEDIUM','LOW','INSUFFICIENT_DATA')),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_voice_conv_user ON voice.conversations(user_id, created_at DESC) WHERE deleted_at IS NULL;
DROP TRIGGER IF EXISTS trg_voice_conv_touch ON voice.conversations;
CREATE TRIGGER trg_voice_conv_touch BEFORE UPDATE ON voice.conversations
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE IF NOT EXISTS voice.recordings (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id        UUID NOT NULL REFERENCES voice.conversations(id) ON DELETE CASCADE,
    user_id                UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    source_type            TEXT NOT NULL DEFAULT 'mobile_mic'
        CHECK (source_type IN ('mobile_mic','imported_file','call','meeting','transcript_import')),
    mime_type              TEXT NOT NULL DEFAULT 'audio/wav',
    sample_rate_hz         INT NOT NULL DEFAULT 16000,
    channels               SMALLINT NOT NULL DEFAULT 1,
    duration_ms            INT NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
    byte_size              BIGINT NOT NULL DEFAULT 0,
    storage_uri            TEXT NOT NULL DEFAULT '',
    s3_bucket              TEXT NOT NULL DEFAULT '',
    s3_object_key          TEXT NOT NULL DEFAULT '',
    s3_presigned_status    TEXT NOT NULL DEFAULT 'pending'
        CHECK (s3_presigned_status IN ('pending','presigned','uploaded','verified')),
    s3_etag                TEXT NOT NULL DEFAULT '',
    uploaded_at            TIMESTAMPTZ,
    caller_name            TEXT NOT NULL DEFAULT '',
    caller_phone_masked    TEXT NOT NULL DEFAULT '',
    caller_phone_hash      TEXT NOT NULL DEFAULT '',
    caller_source          TEXT NOT NULL DEFAULT 'unknown',
    caller_confidence      REAL NOT NULL DEFAULT 0.0,
    call_direction         TEXT NOT NULL DEFAULT 'unknown',
    encryption_key_version INT NOT NULL DEFAULT 1,
    audio_metadata         JSONB NOT NULL DEFAULT '{}',
    -- Workstream 2: Audio Intelligence quality report
    quality_score          REAL NOT NULL DEFAULT 0.0 CHECK (quality_score BETWEEN 0 AND 100),
    snr_db                 REAL NOT NULL DEFAULT 0.0,
    clipping_ratio         REAL NOT NULL DEFAULT 0.0,
    speech_ratio           REAL NOT NULL DEFAULT 0.0,
    noise_floor_dbfs       REAL NOT NULL DEFAULT -60.0,
    routing_strategy       TEXT NOT NULL DEFAULT 'direct_asr'
        CHECK (routing_strategy IN ('direct_asr','denoise_then_asr','overlap_aware_diarize','low_snr_fallback')),
    quality_report         JSONB NOT NULL DEFAULT '{}',
    vad_segments           JSONB NOT NULL DEFAULT '[]',
    -- Workstream 1 & 9: Consent & Cryptographic Preservation
    consent_granted        BOOLEAN NOT NULL DEFAULT false,
    consent_scope          TEXT NOT NULL DEFAULT 'voice.capture',
    sha256_original        TEXT NOT NULL,
    hmac_seal              TEXT NOT NULL,
    legal_hold             BOOLEAN NOT NULL DEFAULT false,
    retention_until        TIMESTAMPTZ,
    captured_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voice_rec_conv ON voice.recordings(conversation_id);
CREATE INDEX IF NOT EXISTS idx_voice_rec_s3_key ON voice.recordings(s3_object_key) WHERE s3_object_key <> '';

-- Free Native Caller Intelligence DB (Android CallScreeningService + iOS CallDirectory + Local Contacts + Spam/Context)
CREATE TABLE IF NOT EXISTS voice.caller_directory (
    user_id               UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    phone_hash            TEXT NOT NULL,
    phone_masked          TEXT NOT NULL DEFAULT '',
    display_name          TEXT NOT NULL DEFAULT '',
    source                TEXT NOT NULL DEFAULT 'unknown',
    confidence            REAL NOT NULL DEFAULT 0.0,
    spam_risk             TEXT NOT NULL DEFAULT 'low',
    spam_reports          INT NOT NULL DEFAULT 0,
    spam_score            REAL NOT NULL DEFAULT 0.0,
    company               TEXT NOT NULL DEFAULT '',
    business_category     TEXT NOT NULL DEFAULT '',
    organization          TEXT NOT NULL DEFAULT '',
    known_purpose         TEXT NOT NULL DEFAULT '',
    relationship_label    TEXT NOT NULL DEFAULT 'unknown',
    call_count            INT NOT NULL DEFAULT 1,
    last_call_at          TIMESTAMPTZ,
    observed_identities   JSONB NOT NULL DEFAULT '[]',
    identity_conflict     BOOLEAN NOT NULL DEFAULT false,
    needs_classification  BOOLEAN NOT NULL DEFAULT false,
    voiceprint_ref        TEXT NOT NULL DEFAULT '',
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, phone_hash)
);

-- ============================================================
-- 2. PARTICIPANTS & LAYER 3 UTTERANCES (Speech + Speaker Branch)
-- ============================================================
CREATE TABLE IF NOT EXISTS voice.participants (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id  UUID NOT NULL REFERENCES voice.conversations(id) ON DELETE CASCADE,
    user_id          UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    speaker_label    TEXT NOT NULL,
    display_name     TEXT NOT NULL,
    role             TEXT NOT NULL DEFAULT 'participant',
    voiceprint_ref   TEXT,
    is_verified      BOOLEAN NOT NULL DEFAULT false,
    talk_time_ms     INT NOT NULL DEFAULT 0,
    utterance_count  INT NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (conversation_id, speaker_label)
);

CREATE TABLE IF NOT EXISTS voice.utterances (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id    UUID NOT NULL REFERENCES voice.conversations(id) ON DELETE CASCADE,
    recording_id       UUID NOT NULL REFERENCES voice.recordings(id) ON DELETE CASCADE,
    participant_id     UUID REFERENCES voice.participants(id) ON DELETE SET NULL,
    speaker_label      TEXT NOT NULL,
    seq_index          INT NOT NULL,
    start_ms           INT NOT NULL DEFAULT 0,
    end_ms             INT NOT NULL DEFAULT 0,
    original_text      TEXT NOT NULL,
    word_timestamps    JSONB NOT NULL DEFAULT '[]',
    language           TEXT NOT NULL DEFAULT 'en',
    confidence         REAL NOT NULL DEFAULT 0.0 CHECK (confidence BETWEEN 0 AND 1),
    uncertainty_reason TEXT,
    overlap_detected   BOOLEAN NOT NULL DEFAULT false,
    audio_segment_ref  TEXT,
    to_speakers        TEXT[] NOT NULL DEFAULT '{}',
    addressing_mode    TEXT NOT NULL DEFAULT 'group_broadcast',
    addressed_utterance_id UUID,
    what_is_spoken     TEXT NOT NULL DEFAULT '',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voice_utt_conv_seq ON voice.utterances(conversation_id, seq_index);

CREATE TABLE IF NOT EXISTS voice.capture_sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    conversation_id     UUID NOT NULL REFERENCES voice.conversations(id) ON DELETE CASCADE,
    title               TEXT NOT NULL DEFAULT 'Live Call Session',
    capture_mode        TEXT NOT NULL DEFAULT 'call_dual_track'
        CHECK (capture_mode IN ('foreground_mic','background_service_mic','call_dual_track','meeting_stream')),
    source_type         TEXT NOT NULL DEFAULT 'call',
    state               TEXT NOT NULL DEFAULT 'active'
        CHECK (state IN ('active','paused','background','finalized')),
    chunk_count         INT NOT NULL DEFAULT 0,
    last_chunk_seq      INT NOT NULL DEFAULT -1,
    processed_seqs      INT[] NOT NULL DEFAULT '{}',
    os_capture_guidance TEXT NOT NULL DEFAULT '',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 3. WORKSTREAM 4 & 5: CONVERSATION EVENTS & REASONING FINDINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS voice.conversation_events (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id      UUID NOT NULL REFERENCES voice.conversations(id) ON DELETE CASCADE,
    event_type           TEXT NOT NULL
        CHECK (event_type IN ('request','proposal','commitment','decision','question','disagreement')),
    summary              TEXT NOT NULL,
    actor_speaker        TEXT NOT NULL DEFAULT '',
    topic                TEXT NOT NULL DEFAULT 'general',
    dialogue_act         TEXT NOT NULL DEFAULT 'statement',
    intent               TEXT NOT NULL DEFAULT 'inform',
    due_at               TIMESTAMPTZ,
    confidence           REAL NOT NULL DEFAULT 0.0 CHECK (confidence BETWEEN 0 AND 1),
    source_utterance_ids UUID[] NOT NULL DEFAULT '{}',
    status               TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open','confirmed','completed','disputed','superseded')),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voice_events_conv ON voice.conversation_events(conversation_id, event_type);

CREATE TABLE IF NOT EXISTS voice.reasoning_findings (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id       UUID NOT NULL REFERENCES voice.conversations(id) ON DELETE CASCADE,
    finding_type          TEXT NOT NULL
        CHECK (finding_type IN ('contradiction','negotiation_shift','causal_link','temporal_change','uncertainty')),
    severity              TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
    title                 TEXT NOT NULL,
    explanation           TEXT NOT NULL,
    evidence_utterance_ids UUID[] NOT NULL DEFAULT '{}',
    confidence            REAL NOT NULL DEFAULT 0.0 CHECK (confidence BETWEEN 0 AND 1),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voice_reasoning_conv ON voice.reasoning_findings(conversation_id);

-- ============================================================
-- 4. WORKSTREAM 6: TEMPORAL KNOWLEDGE GRAPH & SEMANTIC MEMORY
-- ============================================================
CREATE TABLE IF NOT EXISTS voice.knowledge_entities (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES voice.conversations(id) ON DELETE SET NULL,
    canonical_name  TEXT NOT NULL,
    entity_type     TEXT NOT NULL
        CHECK (entity_type IN ('person','organization','project','topic','date','amount','location','deliverable')),
    aliases         TEXT[] NOT NULL DEFAULT '{}',
    attributes      JSONB NOT NULL DEFAULT '{}',
    embedding       REAL[], -- portable across PostgreSQL 16 & RDS (pgvector-compatible layout)
    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, entity_type, canonical_name)
);
CREATE INDEX IF NOT EXISTS idx_voice_kg_ent_user ON voice.knowledge_entities(user_id, entity_type);

CREATE TABLE IF NOT EXISTS voice.knowledge_edges (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES voice.conversations(id) ON DELETE CASCADE,
    from_entity_id  UUID NOT NULL REFERENCES voice.knowledge_entities(id) ON DELETE CASCADE,
    to_entity_id    UUID NOT NULL REFERENCES voice.knowledge_entities(id) ON DELETE CASCADE,
    relation_type   TEXT NOT NULL,
    valid_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_to        TIMESTAMPTZ,
    confidence      REAL NOT NULL DEFAULT 0.8 CHECK (confidence BETWEEN 0 AND 1),
    evidence_ref    JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voice_kg_edges_conv ON voice.knowledge_edges(conversation_id);

-- ============================================================
-- 5. WORKSTREAM 7 & 8: ACTION SUGGESTIONS & HUMAN CORRECTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS voice.action_suggestions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES voice.conversations(id) ON DELETE CASCADE,
    action_type     TEXT NOT NULL
        CHECK (action_type IN ('note','reminder','task','calendar_event','follow_up')),
    title           TEXT NOT NULL,
    rationale       TEXT NOT NULL DEFAULT '',
    payload         JSONB NOT NULL DEFAULT '{}',
    approval_id     UUID REFERENCES intelligence.action_approvals(id) ON DELETE SET NULL,
    confidence      REAL NOT NULL DEFAULT 0.0 CHECK (confidence BETWEEN 0 AND 1),
    evidence_refs   JSONB NOT NULL DEFAULT '[]',
    status          TEXT NOT NULL DEFAULT 'suggested'
        CHECK (status IN ('suggested','approved','rejected','executed')),
    decided_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voice_actions_user ON voice.action_suggestions(user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS voice.human_corrections (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES voice.conversations(id) ON DELETE CASCADE,
    target_type     TEXT NOT NULL CHECK (target_type IN ('utterance_text','speaker_attribution','conversation_event','entity')),
    target_id       UUID NOT NULL,
    original_value  TEXT NOT NULL,
    corrected_value TEXT NOT NULL,
    reason          TEXT NOT NULL DEFAULT '',
    corrected_by    UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voice_corrections_conv ON voice.human_corrections(conversation_id, created_at DESC);

-- ============================================================
-- 6. WORKSTREAM 9 & 10: EVIDENCE, CHAIN OF CUSTODY & MODEL TELEMETRY
-- ============================================================
CREATE TABLE IF NOT EXISTS voice.evidence_records (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES voice.conversations(id) ON DELETE CASCADE,
    recording_id    UUID NOT NULL REFERENCES voice.recordings(id) ON DELETE CASCADE,
    merkle_root     TEXT NOT NULL,
    chain_head_hash TEXT NOT NULL,
    source_refs     JSONB NOT NULL DEFAULT '[]',
    export_count    INT NOT NULL DEFAULT 0,
    last_verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (conversation_id)
);

CREATE TABLE IF NOT EXISTS voice.custody_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    evidence_id     UUID NOT NULL REFERENCES voice.evidence_records(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES voice.conversations(id) ON DELETE CASCADE,
    actor_id        UUID NOT NULL,
    event_action    TEXT NOT NULL
        CHECK (event_action IN ('captured','imported','uploaded','caller_identified','analyzed','transcribed','corrected','approved','exported','legal_hold_enabled','legal_hold_released','verified')),
    prev_hash       TEXT NOT NULL,
    event_hash      TEXT NOT NULL,
    details         JSONB NOT NULL DEFAULT '{}',
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voice_custody_ev ON voice.custody_events(conversation_id, occurred_at ASC);

CREATE TABLE IF NOT EXISTS voice.model_telemetry (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES voice.conversations(id) ON DELETE SET NULL,
    stage           TEXT NOT NULL
        CHECK (stage IN ('audio_qc','asr','diarization','understanding','reasoning','memory','qa')),
    adapter_name    TEXT NOT NULL,
    routing_reason  TEXT NOT NULL,
    fallback_used   BOOLEAN NOT NULL DEFAULT false,
    latency_ms      REAL NOT NULL DEFAULT 0.0,
    confidence      REAL NOT NULL DEFAULT 0.0,
    cost_units      REAL NOT NULL DEFAULT 0.0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voice_model_telemetry_stage ON voice.model_telemetry(stage, created_at DESC);

CREATE TABLE IF NOT EXISTS voice.call_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    device_call_id  TEXT NOT NULL DEFAULT '',
    phone_hash      TEXT NOT NULL,
    phone_masked    TEXT NOT NULL,
    contact_name    TEXT NOT NULL DEFAULT '',
    direction       TEXT NOT NULL
        CHECK (direction IN ('inbound','outbound','missed','rejected','voicemail','unknown')),
    duration_sec    INT NOT NULL DEFAULT 0,
    started_at      TIMESTAMPTZ NOT NULL,
    sim_slot        TEXT NOT NULL DEFAULT '',
    source          TEXT NOT NULL DEFAULT 'device_call_log',
    conversation_id UUID REFERENCES voice.conversations(id) ON DELETE SET NULL,
    spam_risk       TEXT NOT NULL DEFAULT 'low',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, phone_hash, started_at, direction)
);
CREATE INDEX IF NOT EXISTS idx_voice_call_logs_user_time ON voice.call_logs(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_call_logs_phone ON voice.call_logs(user_id, phone_hash, started_at DESC);
