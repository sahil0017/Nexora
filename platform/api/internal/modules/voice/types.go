// Package voice implements the NEXORA Voice Intelligence Platform control plane
// covering all 10 workstreams and the canonical Conversation IR backbone.
package voice

import "time"

// WordTimestamp provides TagSpeech-style word-to-speaker temporal grounding.
type WordTimestamp struct {
	Word         string  `json:"word"`
	StartMS      int     `json:"start_ms"`
	EndMS        int     `json:"end_ms"`
	SpeakerLabel string  `json:"speaker_label"`
	Confidence   float64 `json:"confidence"`
}

// VadSegment marks an active speech interval detected in Layer 2.
type VadSegment struct {
	StartMS    int     `json:"start_ms"`
	EndMS      int     `json:"end_ms"`
	EnergyDBFS float64 `json:"energy_dbfs"`
	SpeechProb float64 `json:"speech_prob"`
}

// AudioQualityReport holds Workstream 2 signal assessment and CHiME-style routing.
type AudioQualityReport struct {
	QualityScore    float64      `json:"quality_score"`
	SNRDB           float64      `json:"snr_db"`
	ClippingRatio   float64      `json:"clipping_ratio"`
	SpeechRatio     float64      `json:"speech_ratio"`
	NoiseFloorDBFS  float64      `json:"noise_floor_dbfs"`
	RoutingStrategy string       `json:"routing_strategy"`
	VadSegments     []VadSegment `json:"vad_segments"`
	Warnings        []string     `json:"warnings"`
}

// IntegrityMetadata tracks Workstream 1 & 9 consent, encryption, hashes, and legal hold.
type IntegrityMetadata struct {
	SHA256Original       string `json:"sha256_original"`
	HMACSeal             string `json:"hmac_seal"`
	EncryptionKeyVersion int    `json:"encryption_key_version"`
	LegalHold            bool   `json:"legal_hold"`
	ConsentGranted       bool   `json:"consent_granted"`
	ConsentScope         string `json:"consent_scope"`
	RetentionUntil       string `json:"retention_until,omitempty"`
}

// RecordingIR represents the preserved Layer 1/2 audio object (separate from transcript).
type RecordingIR struct {
	RecordingID       string             `json:"recording_id"`
	SourceType        string             `json:"source_type"`
	MimeType          string             `json:"mime_type"`
	SampleRateHz      int                `json:"sample_rate_hz"`
	Channels          int                `json:"channels"`
	DurationMS        int                `json:"duration_ms"`
	ByteSize          int64              `json:"byte_size"`
	StorageURI        string             `json:"storage_uri"`
	S3Bucket          string             `json:"s3_bucket,omitempty"`
	S3ObjectKey       string             `json:"s3_object_key,omitempty"`
	S3PresignedStatus string             `json:"s3_presigned_status,omitempty"` // pending|presigned|uploaded|verified
	S3ETag            string             `json:"s3_etag,omitempty"`
	UploadedAt        string             `json:"uploaded_at,omitempty"`
	CallerName        string             `json:"caller_name,omitempty"`
	CallerPhoneMasked string             `json:"caller_phone_masked,omitempty"`
	CallerPhoneHash   string             `json:"caller_phone_hash,omitempty"`
	CallerSource      string             `json:"caller_source,omitempty"` // truecaller|contacts|call_directory|user_assigned|unknown
	CallerConfidence  float64            `json:"caller_confidence,omitempty"`
	CallDirection     string             `json:"call_direction,omitempty"` // inbound|outbound|meeting|unknown
	AudioMetadata     map[string]any     `json:"audio_metadata,omitempty"`
	QualityReport     AudioQualityReport `json:"quality_report"`
	Integrity         IntegrityMetadata  `json:"integrity"`
}

// ObservedIdentity records an identity assertion from a specific source for conflict detection.
type ObservedIdentity struct {
	Source     string  `json:"source"` // android_call_screening|ios_call_directory|device_contacts|user_confirmed|voice_self_intro
	Name       string  `json:"name"`
	Confidence float64 `json:"confidence"`
	SeenAt     string  `json:"seen_at"`
}

// CallerDirectoryEntry represents a free native/local Caller Intelligence profile.
type CallerDirectoryEntry struct {
	UserID              string             `json:"user_id"`
	PhoneHash           string             `json:"phone_hash"`
	PhoneMasked         string             `json:"phone_masked"`
	DisplayName         string             `json:"display_name"`
	Source              string             `json:"source"`
	Confidence          float64            `json:"confidence"`
	SpamRisk            string             `json:"spam_risk,omitempty"` // low|medium|high
	SpamReports         int                `json:"spam_reports"`
	SpamScore           float64            `json:"spam_score"`
	Company             string             `json:"company,omitempty"`
	BusinessCategory    string             `json:"business_category,omitempty"`
	Organization        string             `json:"organization,omitempty"`
	KnownPurpose        string             `json:"known_purpose,omitempty"`
	RelationshipLabel   string             `json:"relationship_label,omitempty"` // client|vendor|colleague|family|support|unknown
	CallCount           int                `json:"call_count"`
	LastCallAt          string             `json:"last_call_at,omitempty"`
	ObservedIdentities  []ObservedIdentity `json:"observed_identities,omitempty"`
	IdentityConflict    bool               `json:"identity_conflict"`
	NeedsClassification bool               `json:"needs_classification"`
	VoiceprintRef       string             `json:"voiceprint_ref,omitempty"`
	UpdatedAt           time.Time          `json:"updated_at"`
}

// CallerTimelineItem links a past conversation/recording to a caller's phone_hash.
type CallerTimelineItem struct {
	ConversationID    string `json:"conversation_id"`
	RecordingID       string `json:"recording_id"`
	Title             string `json:"title"`
	Summary           string `json:"summary"`
	CallDirection     string `json:"call_direction"`
	StorageURI        string `json:"storage_uri"`
	S3PresignedStatus string `json:"s3_presigned_status"`
	DurationMS        int    `json:"duration_ms"`
	CreatedAt         string `json:"created_at"`
}

// CallerContextResponse returns full Caller Intelligence + previous interactions timeline.
type CallerContextResponse struct {
	Caller   CallerDirectoryEntry `json:"caller"`
	Timeline []CallerTimelineItem `json:"timeline"`
}

// ClassifyCallerRequest lets the user classify an unknown caller post-call.
type ClassifyCallerRequest struct {
	UserID            string `json:"user_id,omitempty"`
	PhoneNumber       string `json:"phone_number"`
	DisplayName       string `json:"display_name"`
	RelationshipLabel string `json:"relationship_label,omitempty"`
	BusinessCategory  string `json:"business_category,omitempty"`
	Organization      string `json:"organization,omitempty"`
	KnownPurpose      string `json:"known_purpose,omitempty"`
	IsSpam            bool   `json:"is_spam,omitempty"`
	ConversationID    string `json:"conversation_id,omitempty"`
}

// ReportSpamRequest submits a user spam report to detect repeated suspicious patterns.
type ReportSpamRequest struct {
	UserID      string `json:"user_id,omitempty"`
	PhoneNumber string `json:"phone_number"`
	Reason      string `json:"reason,omitempty"`
}

// ResolveCallerRequest looks up or caches caller identity even before/without a spoken greeting.
type ResolveCallerRequest struct {
	UserID       string `json:"user_id,omitempty"`
	PhoneNumber  string `json:"phone_number"`
	CallerName   string `json:"caller_name,omitempty"`
	CallerSource string `json:"caller_source,omitempty"` // truecaller|contacts|call_directory|user_assigned
}

// BindCallerRequest binds a resolved caller identity onto a conversation/recording without re-speaking names.
type BindCallerRequest struct {
	UserID        string  `json:"user_id,omitempty"`
	PhoneNumber   string  `json:"phone_number,omitempty"`
	CallerName    string  `json:"caller_name,omitempty"`
	CallerSource  string  `json:"caller_source,omitempty"`
	Confidence    float64 `json:"confidence,omitempty"`
	CallDirection string  `json:"call_direction,omitempty"` // inbound|outbound
	SpeakerLabel  string  `json:"speaker_label,omitempty"`
}

// PresignUploadRequest reserves a recording + PostgreSQL link and returns an S3 PUT URL.
type PresignUploadRequest struct {
	UserID         string `json:"user_id,omitempty"`
	Title          string `json:"title"`
	SourceType     string `json:"source_type,omitempty"`
	MimeType       string `json:"mime_type,omitempty"`
	FileExt        string `json:"file_ext,omitempty"`
	ByteSize       int64  `json:"byte_size,omitempty"`
	Language       string `json:"language,omitempty"`
	PhoneNumber    string `json:"phone_number,omitempty"`
	CallerName     string `json:"caller_name,omitempty"`
	CallerSource   string `json:"caller_source,omitempty"`
	CallDirection  string `json:"call_direction,omitempty"`
	ConsentGranted *bool  `json:"consent_granted,omitempty"`
}

// PresignUploadResponse contains the S3 presigned URL plus PostgreSQL-linked IDs.
type PresignUploadResponse struct {
	RecordingID     string                `json:"recording_id"`
	ConversationID  string                `json:"conversation_id"`
	UploadURL       string                `json:"upload_url"`
	UploadMethod    string                `json:"upload_method"`
	UploadMode      string                `json:"upload_mode"` // s3_sigv4|local_signed_fallback
	RequiredHeaders map[string]string     `json:"required_headers"`
	ExpiresInSec    int                   `json:"expires_in_sec"`
	S3Bucket        string                `json:"s3_bucket"`
	S3ObjectKey     string                `json:"s3_object_key"`
	StorageURI      string                `json:"storage_uri"`
	Caller          *CallerDirectoryEntry `json:"caller,omitempty"`
}

// CompleteUploadRequest confirms the S3 object upload, links PostgreSQL, and runs the 10 workstreams.
type CompleteUploadRequest struct {
	UserID           string           `json:"user_id,omitempty"`
	S3ETag           string           `json:"s3_etag,omitempty"`
	SHA256Original   string           `json:"sha256_original,omitempty"`
	ByteSize         int64            `json:"byte_size,omitempty"`
	DurationMS       int              `json:"duration_ms,omitempty"`
	AudioBase64      string           `json:"audio_base64,omitempty"`
	TranscriptText   string           `json:"transcript_text,omitempty"`
	Turns            []map[string]any `json:"turns,omitempty"`
	PhoneNumber      string           `json:"phone_number,omitempty"`
	CallerName       string           `json:"caller_name,omitempty"`
	CallerSource     string           `json:"caller_source,omitempty"`
	CallDirection    string           `json:"call_direction,omitempty"`
	SNRDB            float64          `json:"snr_db,omitempty"`
	OverlapSuspected bool             `json:"overlap_suspected,omitempty"`
}

// ParticipantIR holds speaker attribution and JEDIS-style talk-time state.
type ParticipantIR struct {
	ParticipantID  string `json:"participant_id"`
	SpeakerLabel   string `json:"speaker_label"`
	DisplayName    string `json:"display_name"`
	Role           string `json:"role"`
	VoiceprintRef  string `json:"voiceprint_ref,omitempty"`
	IsVerified     bool   `json:"is_verified"`
	TalkTimeMS     int    `json:"talk_time_ms"`
	UtteranceCount int    `json:"utterance_count"`
}

// UtteranceIR holds Layer 3 raw speaker-attributed transcript data.
type UtteranceIR struct {
	UtteranceID          string          `json:"utterance_id"`
	RecordingID          string          `json:"recording_id"`
	SpeakerLabel         string          `json:"speaker_label"`
	SeqIndex             int             `json:"seq_index"`
	StartMS              int             `json:"start_ms"`
	EndMS                int             `json:"end_ms"`
	OriginalText         string          `json:"original_text"`
	Language             string          `json:"language"`
	Confidence           float64         `json:"confidence"`
	WordTimestamps       []WordTimestamp `json:"word_timestamps"`
	UncertaintyReason    string          `json:"uncertainty_reason,omitempty"`
	OverlapDetected      bool            `json:"overlap_detected"`
	AudioSegmentRef      string          `json:"audio_segment_ref,omitempty"`
	ToSpeakers           []string        `json:"to_speakers,omitempty"`
	AddressingMode       string          `json:"addressing_mode,omitempty"`
	AddressedUtteranceID string          `json:"addressed_utterance_id,omitempty"`
	WhatIsSpoken         string          `json:"what_is_spoken,omitempty"`
}

// InteractionEdgeIR captures directed "who is speaking to whom and about what" turn flow.
type InteractionEdgeIR struct {
	FromSpeaker   string   `json:"from_speaker"`
	FromName      string   `json:"from_name"`
	ToSpeaker     string   `json:"to_speaker"`
	ToName        string   `json:"to_name"`
	TurnCount     int      `json:"turn_count"`
	LastTopic     string   `json:"last_topic"`
	PrimaryActs   []string `json:"primary_acts"`
	Strength      float64  `json:"strength"`
	SampleSummary string   `json:"sample_summary"`
}

// ConversationEventIR holds Workstream 4 structured dialogue events.
type ConversationEventIR struct {
	EventID            string   `json:"event_id"`
	EventType          string   `json:"event_type"` // request|proposal|commitment|decision|question|disagreement
	Summary            string   `json:"summary"`
	ActorSpeaker       string   `json:"actor_speaker"`
	Topic              string   `json:"topic"`
	DialogueAct        string   `json:"dialogue_act"`
	Intent             string   `json:"intent"`
	Confidence         float64  `json:"confidence"`
	SourceUtteranceIDs []string `json:"source_utterance_ids"`
	DueAt              string   `json:"due_at,omitempty"`
	Status             string   `json:"status"`
}

// KnowledgeEntityIR holds a resolved entity in the Workstream 6 temporal knowledge graph.
type KnowledgeEntityIR struct {
	EntityID      string         `json:"entity_id"`
	CanonicalName string         `json:"canonical_name"`
	EntityType    string         `json:"entity_type"`
	Aliases       []string       `json:"aliases"`
	Attributes    map[string]any `json:"attributes,omitempty"`
	Embedding     []float32      `json:"embedding,omitempty"`
}

// KnowledgeEdgeIR holds a temporal relation triple.
type KnowledgeEdgeIR struct {
	FromEntity          string  `json:"from_entity"`
	ToEntity            string  `json:"to_entity"`
	RelationType        string  `json:"relation_type"`
	Confidence          float64 `json:"confidence"`
	ValidFrom           string  `json:"valid_from"`
	EvidenceUtteranceID string  `json:"evidence_utterance_id,omitempty"`
}

// ExtractedKnowledgeIR groups Workstream 6 entities and graph edges.
type ExtractedKnowledgeIR struct {
	Entities []KnowledgeEntityIR `json:"entities"`
	Edges    []KnowledgeEdgeIR   `json:"edges"`
}

// ReasoningResultIR holds Workstream 5 contradictions, negotiation shifts, causality, and uncertainty.
type ReasoningResultIR struct {
	FindingID            string   `json:"finding_id"`
	FindingType          string   `json:"finding_type"` // contradiction|negotiation_shift|causal_link|temporal_change|uncertainty
	Severity             string   `json:"severity"`
	Title                string   `json:"title"`
	Explanation          string   `json:"explanation"`
	Confidence           float64  `json:"confidence"`
	EvidenceUtteranceIDs []string `json:"evidence_utterance_ids"`
}

// SourceEvidenceRef links an output claim directly to an utterance timestamp span.
type SourceEvidenceRef struct {
	RefID        string  `json:"ref_id"`
	TargetKind   string  `json:"target_kind"`
	TargetID     string  `json:"target_id"`
	UtteranceID  string  `json:"utterance_id"`
	SpeakerLabel string  `json:"speaker_label"`
	StartMS      int     `json:"start_ms"`
	EndMS        int     `json:"end_ms"`
	Quote        string  `json:"quote"`
	Confidence   float64 `json:"confidence"`
}

// ActionSuggestionIR holds Workstream 7 Human-in-the-Loop suggested notes, reminders, and tasks.
type ActionSuggestionIR struct {
	ActionID         string              `json:"action_id"`
	ActionType       string              `json:"action_type"` // note|reminder|task|calendar_event|follow_up
	Title            string              `json:"title"`
	Rationale        string              `json:"rationale"`
	Confidence       float64             `json:"confidence"`
	RequiresApproval bool                `json:"requires_approval"`
	Status           string              `json:"status"` // suggested|approved|rejected|executed
	Payload          map[string]any      `json:"payload,omitempty"`
	EvidenceRefs     []SourceEvidenceRef `json:"evidence_refs"`
	DecidedAt        string              `json:"decided_at,omitempty"`
}

// HumanCorrectionIR records immutable Workstream 8 human edits without mutating original audio/ASR.
type HumanCorrectionIR struct {
	CorrectionID   string `json:"correction_id"`
	TargetType     string `json:"target_type"`
	TargetID       string `json:"target_id"`
	OriginalValue  string `json:"original_value"`
	CorrectedValue string `json:"corrected_value"`
	Reason         string `json:"reason"`
	CorrectedBy    string `json:"corrected_by"`
	CreatedAt      string `json:"created_at"`
}

// ModelTelemetryIR tracks Workstream 10 routing & performance per stage.
type ModelTelemetryIR struct {
	Stage         string  `json:"stage"`
	AdapterName   string  `json:"adapter_name"`
	RoutingReason string  `json:"routing_reason"`
	FallbackUsed  bool    `json:"fallback_used"`
	LatencyMS     float64 `json:"latency_ms"`
	Confidence    float64 `json:"confidence"`
	CostUnits     float64 `json:"cost_units"`
}

// CustodyEvent represents one tamper-evident step in the Workstream 9 chain of custody.
type CustodyEvent struct {
	ID             string         `json:"id"`
	EvidenceID     string         `json:"evidence_id"`
	ConversationID string         `json:"conversation_id"`
	ActorID        string         `json:"actor_id"`
	EventAction    string         `json:"event_action"`
	PrevHash       string         `json:"prev_hash"`
	EventHash      string         `json:"event_hash"`
	Details        map[string]any `json:"details,omitempty"`
	OccurredAt     string         `json:"occurred_at"`
}

// EvidenceRecord bundles Workstream 9 provenance and cryptographic verification metadata.
type EvidenceRecord struct {
	EvidenceID     string         `json:"evidence_id"`
	ConversationID string         `json:"conversation_id"`
	RecordingID    string         `json:"recording_id"`
	MerkleRoot     string         `json:"merkle_root"`
	ChainHeadHash  string         `json:"chain_head_hash"`
	ChainValid     bool           `json:"chain_valid"`
	ExportCount    int            `json:"export_count"`
	LastVerifiedAt string         `json:"last_verified_at"`
	CustodyEvents  []CustodyEvent `json:"custody_events"`
}

// ConversationIR is the single shared intermediate representation across all 10 workstreams.
type ConversationIR struct {
	ConversationID     string                `json:"conversation_id"`
	UserID             string                `json:"user_id"`
	Title              string                `json:"title"`
	Summary            string                `json:"summary"`
	Status             string                `json:"status"`
	PrimaryLanguage    string                `json:"primary_language"`
	DetectedLanguages  []string              `json:"detected_languages"`
	Topics             []string              `json:"topics"`
	OverallConfidence  float64               `json:"overall_confidence"`
	ConfidenceTier     string                `json:"confidence_tier"`
	CreatedAt          time.Time             `json:"created_at"`
	UpdatedAt          time.Time             `json:"updated_at"`
	Recording          RecordingIR           `json:"recording"`
	Participants       []ParticipantIR       `json:"participants"`
	Utterances         []UtteranceIR         `json:"utterances"`
	ConversationEvents []ConversationEventIR `json:"conversation_events"`
	ExtractedKnowledge ExtractedKnowledgeIR  `json:"extracted_knowledge"`
	ReasoningResults   []ReasoningResultIR   `json:"reasoning_results"`
	ActionSuggestions  []ActionSuggestionIR  `json:"action_suggestions"`
	HumanCorrections   []HumanCorrectionIR   `json:"human_corrections"`
	SourceEvidenceRefs []SourceEvidenceRef   `json:"source_evidence_refs"`
	ModelTelemetry     []ModelTelemetryIR    `json:"model_telemetry"`
	InteractionEdges   []InteractionEdgeIR   `json:"interaction_edges,omitempty"`
	Evidence           *EvidenceRecord       `json:"evidence,omitempty"`
}

// CaptureSession tracks an active foreground/background call or meeting audio stream.
type CaptureSession struct {
	SessionID         string    `json:"session_id"`
	ConversationID    string    `json:"conversation_id"`
	UserID            string    `json:"user_id"`
	Title             string    `json:"title"`
	CaptureMode       string    `json:"capture_mode"` // foreground_mic|background_service_mic|call_dual_track|meeting_stream
	SourceType        string    `json:"source_type"`
	State             string    `json:"state"` // active|paused|background|finalized
	ChunkCount        int       `json:"chunk_count"`
	LastChunkSeq      int       `json:"last_chunk_seq"`
	ProcessedSeqs     []int     `json:"-"`
	OSCaptureGuidance string    `json:"os_capture_guidance"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

// StartSessionRequest initializes a live or background call capture stream.
type StartSessionRequest struct {
	UserID         string `json:"user_id,omitempty"`
	Title          string `json:"title"`
	CaptureMode    string `json:"capture_mode,omitempty"`
	SourceType     string `json:"source_type,omitempty"`
	Language       string `json:"language,omitempty"`
	ConsentGranted *bool  `json:"consent_granted,omitempty"`
	PhoneNumber    string `json:"phone_number,omitempty"`
	CallerName     string `json:"caller_name,omitempty"`
	CallerSource   string `json:"caller_source,omitempty"`
	CallDirection  string `json:"call_direction,omitempty"`
}

// SessionChunkRequest streams an incremental audio/speech chunk while foregrounded or backgrounded.
type SessionChunkRequest struct {
	UserID           string           `json:"user_id,omitempty"`
	ChunkSeq         int              `json:"chunk_seq"`
	ChannelHint      string           `json:"channel_hint,omitempty"` // local_mic|remote_track|mixed_room
	InBackground     bool             `json:"in_background,omitempty"`
	AudioBase64      string           `json:"audio_base64,omitempty"`
	TranscriptText   string           `json:"transcript_text,omitempty"`
	Turns            []map[string]any `json:"turns,omitempty"`
	SNRDB            float64          `json:"snr_db,omitempty"`
	DurationMS       int              `json:"duration_ms,omitempty"`
	OverlapSuspected bool             `json:"overlap_suspected,omitempty"`
	PhoneNumber      string           `json:"phone_number,omitempty"`
	CallerName       string           `json:"caller_name,omitempty"`
	CallerSource     string           `json:"caller_source,omitempty"`
	CallDirection    string           `json:"call_direction,omitempty"`
}

// SessionStateRequest pauses, resumes, or transitions a session into background state.
type SessionStateRequest struct {
	UserID string `json:"user_id,omitempty"`
	State  string `json:"state"` // active|paused|background
}

// CaptureRequest represents Workstream 1 capture or import input.
type CaptureRequest struct {
	UserID           string           `json:"user_id,omitempty"`
	Title            string           `json:"title"`
	SourceType       string           `json:"source_type,omitempty"`
	MimeType         string           `json:"mime_type,omitempty"`
	Language         string           `json:"language,omitempty"`
	ConsentGranted   *bool            `json:"consent_granted,omitempty"`
	ConsentScope     string           `json:"consent_scope,omitempty"`
	AudioBase64      string           `json:"audio_base64,omitempty"`
	TranscriptText   string           `json:"transcript_text,omitempty"`
	Turns            []map[string]any `json:"turns,omitempty"`
	SNRDB            float64          `json:"snr_db,omitempty"`
	DurationMS       int              `json:"duration_ms,omitempty"`
	OverlapSuspected bool             `json:"overlap_suspected,omitempty"`
	PhoneNumber      string           `json:"phone_number,omitempty"`
	CallerName       string           `json:"caller_name,omitempty"`
	CallerSource     string           `json:"caller_source,omitempty"`
	CallDirection    string           `json:"call_direction,omitempty"`
}

// CorrectionRequest adds a Workstream 8 human correction without overwriting raw originals.
type CorrectionRequest struct {
	UserID         string `json:"user_id,omitempty"`
	TargetType     string `json:"target_type"`
	TargetID       string `json:"target_id"`
	CorrectedValue string `json:"corrected_value"`
	Reason         string `json:"reason,omitempty"`
}

// ActionDecisionRequest approves or rejects a Workstream 7 suggested action.
type ActionDecisionRequest struct {
	UserID   string `json:"user_id,omitempty"`
	Decision string `json:"decision"` // approved | rejected
}

// QARequest asks a source-grounded question across conversational memory.
type QARequest struct {
	UserID         string `json:"user_id,omitempty"`
	Question       string `json:"question"`
	ConversationID string `json:"conversation_id,omitempty"`
}

// LegalHoldRequest toggles Workstream 9 legal hold status.
type LegalHoldRequest struct {
	UserID    string `json:"user_id,omitempty"`
	LegalHold bool   `json:"legal_hold"`
	Reason    string `json:"reason,omitempty"`
}

// CallLogEntry represents one historic call log row persisted in voice.call_logs.
type CallLogEntry struct {
	ID             string    `json:"id"`
	UserID         string    `json:"user_id"`
	DeviceCallID   string    `json:"device_call_id,omitempty"`
	PhoneHash      string    `json:"phone_hash"`
	PhoneMasked    string    `json:"phone_masked"`
	ContactName    string    `json:"contact_name"`
	Direction      string    `json:"direction"` // inbound|outbound|missed|rejected|voicemail|unknown
	DurationSec    int       `json:"duration_sec"`
	StartedAt      time.Time `json:"started_at"`
	SimSlot        string    `json:"sim_slot,omitempty"`
	Source         string    `json:"source"`
	ConversationID string    `json:"conversation_id,omitempty"`
	SpamRisk       string    `json:"spam_risk"`
	CreatedAt      time.Time `json:"created_at"`
}

// ImportCallLogItem represents a single incoming device/CSV/JSON historic call log record.
type ImportCallLogItem struct {
	DeviceCallID   string `json:"device_call_id,omitempty"`
	PhoneNumber    string `json:"phone_number"`
	ContactName    string `json:"contact_name,omitempty"`
	Direction      string `json:"direction"`
	DurationSec    int    `json:"duration_sec"`
	StartedAt      string `json:"started_at"`
	SimSlot        string `json:"sim_slot,omitempty"`
	Source         string `json:"source,omitempty"`
	TranscriptText string `json:"transcript_text,omitempty"`
}

// ImportCallLogsRequest imports a batch of historic call logs or raw CSV/JSON text dynamically.
type ImportCallLogsRequest struct {
	UserID string              `json:"user_id,omitempty"`
	Source string              `json:"source,omitempty"`
	Logs   []ImportCallLogItem `json:"logs,omitempty"`
	RawCSV string              `json:"raw_csv,omitempty"`
}

// CallLogContactSummary aggregates call history per contact/number.
type CallLogContactSummary struct {
	PhoneHash        string `json:"phone_hash"`
	PhoneMasked      string `json:"phone_masked"`
	DisplayName      string `json:"display_name"`
	CallCount        int    `json:"call_count"`
	MissedCount      int    `json:"missed_count"`
	TotalDurationSec int    `json:"total_duration_sec"`
	LastCallAt       string `json:"last_call_at"`
	SpamRisk         string `json:"spam_risk"`
}

// CallLogAlert highlights actionable patterns computed dynamically from historic call logs.
type CallLogAlert struct {
	AlertType      string `json:"alert_type"` // missed_repeat|unknown_frequent|spam_burst|untranscribed_long_call
	Title          string `json:"title"`
	PhoneMasked    string `json:"phone_masked"`
	PhoneHash      string `json:"phone_hash"`
	Count          int    `json:"count"`
	Recommendation string `json:"recommendation"`
}

// CallLogInsights holds dynamically computed analytics and loaded call logs.
type CallLogInsights struct {
	TotalCalls           int                     `json:"total_calls"`
	InboundCount         int                     `json:"inbound_count"`
	OutboundCount        int                     `json:"outbound_count"`
	MissedCount          int                     `json:"missed_count"`
	RejectedCount        int                     `json:"rejected_count"`
	TotalTalkDurationSec int                     `json:"total_talk_duration_sec"`
	AvgCallDurationSec   float64                 `json:"avg_call_duration_sec"`
	UniqueContacts       int                     `json:"unique_contacts"`
	UnknownNumbers       int                     `json:"unknown_numbers"`
	HighRiskSpamCount    int                     `json:"high_risk_spam_count"`
	PeakCallHourUTC      int                     `json:"peak_call_hour_utc"`
	TopContacts          []CallLogContactSummary `json:"top_contacts"`
	FollowUpAlerts       []CallLogAlert          `json:"follow_up_alerts"`
	RecentLogs           []CallLogEntry          `json:"recent_logs"`
}
