package health

import "time"

// ClaimGuardrail is enforced across all health research responses.
const ClaimGuardrail = "Research surrogate only. NEXORA never claims to measure or improve brain waste clearance from ordinary smartwatch sleep scores or standalone smartphone sensors."

// SubmoduleDescriptor describes an available submodule inside NEXORA Health.
type SubmoduleDescriptor struct {
	Key         string `json:"key"`
	Title       string `json:"title"`
	Subtitle    string `json:"subtitle"`
	Status      string `json:"status"`
	SensorReady bool   `json:"sensor_ready"`
}

// FeatureProvenance tracks source hardware, quality, calibration, and missingness.
type FeatureProvenance struct {
	SourceDevice        string  `json:"source_device"`
	SignalSource        string  `json:"signal_source"`
	SamplingRateHz      float64 `json:"sampling_rate_hz"`
	TimestampAccuracyMs float64 `json:"timestamp_accuracy_ms"`
	PlacementProtocol   string  `json:"placement_protocol"`
	CalibrationStatus   string  `json:"calibration_status"`
	SignalQualityScore  float64 `json:"signal_quality_score"`
	MeasurementStatus   string  `json:"measurement_status"`
	AlgorithmVersion    string  `json:"algorithm_version"`
	MissingReason       *string `json:"missing_reason,omitempty"`
}

// ProvenancedFeature represents a single extracted physiological feature with explicit metadata.
type ProvenancedFeature struct {
	Name        string            `json:"name"`
	Value       any               `json:"value"`
	Unit        string            `json:"unit"`
	Provenance  FeatureProvenance `json:"provenance"`
	Limitations []string          `json:"limitations,omitempty"`
}

// SensorFrame represents a timestamped sample (used for optional consented research upload or local extraction).
type SensorFrame struct {
	TimestampMs int64    `json:"timestamp_ms"`
	Ax          float64  `json:"ax"`
	Ay          float64  `json:"ay"`
	Az          float64  `json:"az"`
	Gx          float64  `json:"gx,omitempty"`
	Gy          float64  `json:"gy,omitempty"`
	Gz          float64  `json:"gz,omitempty"`
	PPG         *float64 `json:"ppg,omitempty"`
	Resp        *float64 `json:"resp,omitempty"`
}

// SensorIngestRequest accepts either pre-extracted local features (local-first default) or consented raw frames.
type SensorIngestRequest struct {
	UserID            string                        `json:"user_id"`
	SessionID         string                        `json:"session_id,omitempty"`
	IdempotencyKey    string                        `json:"idempotency_key,omitempty"`
	SourceDevice      string                        `json:"source_device,omitempty"`
	HardwareTier      string                        `json:"hardware_tier"`
	SampleRateHz      float64                       `json:"sample_rate_hz"`
	IsSimulated       bool                          `json:"is_simulated"`
	DeviceTimestampMs int64                         `json:"device_timestamp_ms,omitempty"`
	MonotonicMs       int64                         `json:"monotonic_ms,omitempty"`
	SyncUncertaintyMs float64                       `json:"sync_uncertainty_ms,omitempty"`
	ExtractedFeatures map[string]ProvenancedFeature `json:"extracted_features,omitempty"`
	Frames            []SensorFrame                 `json:"frames,omitempty"`
	EEGSamples        []float64                     `json:"eeg_samples,omitempty"`
	EEGSampleRateHz   float64                       `json:"eeg_sample_rate_hz,omitempty"`
}

// SensorStreamRecord is a persisted, provenanced physiological feature batch.
type SensorStreamRecord struct {
	StreamID            string                        `json:"stream_id"`
	UserID              string                        `json:"user_id"`
	SessionID           string                        `json:"session_id,omitempty"`
	HardwareTier        string                        `json:"hardware_tier"`
	IsSimulated         bool                          `json:"is_simulated"`
	Features            map[string]ProvenancedFeature `json:"features"`
	AvailableModalities []string                      `json:"available_modalities"`
	MissingModalities   []string                      `json:"missing_modalities"`
	Limitations         []string                      `json:"limitations"`
	IsFallback          bool                          `json:"is_fallback"`
	ClaimGuardrail      string                        `json:"claim_guardrail"`
	DeviceTimestampMs   int64                         `json:"device_timestamp_ms"`
	RecordedAt          time.Time                     `json:"recorded_at"`
}

// SleepClearanceRequest runs staged research inference over available modalities.
type SleepClearanceRequest struct {
	UserID                  string        `json:"user_id"`
	CohortID                string        `json:"cohort_id,omitempty"`
	ModelStage              string        `json:"model_stage,omitempty"`
	HardwareTier            string        `json:"hardware_tier"`
	IsSimulated             bool          `json:"is_simulated,omitempty"`
	EegDeltaRatio           *float64      `json:"eeg_delta_ratio,omitempty"`
	N3Fraction              *float64      `json:"n3_fraction,omitempty"`
	SleepFragmentationIndex *float64      `json:"sleep_fragmentation_index,omitempty"`
	RespiratoryRateBpm      *float64      `json:"respiratory_rate_bpm,omitempty"`
	PpgPulsatilityIndex     *float64      `json:"ppg_pulsatility_index,omitempty"`
	HrvRmssdMs              *float64      `json:"hrv_rmssd_ms,omitempty"`
	DeviceOrientation       string        `json:"device_orientation,omitempty"`
	SignalQualityScore      float64       `json:"signal_quality_score"`
	SampleRateHz            float64       `json:"sample_rate_hz,omitempty"`
	Frames                  []SensorFrame `json:"frames,omitempty"`
}

type UncertaintyBreakdown struct {
	Epistemic float64 `json:"epistemic"`
	Aleatoric float64 `json:"aleatoric"`
}

type ResearchEstimate struct {
	Target             string               `json:"target"`
	Value              float64              `json:"value"`
	Unit               string               `json:"unit"`
	ConfidenceInterval [2]float64           `json:"confidence_interval"`
	Uncertainty        UncertaintyBreakdown `json:"uncertainty"`
}

type EvidenceSummary struct {
	AvailableModalities []string `json:"available_modalities"`
	MissingModalities   []string `json:"missing_modalities"`
	SignalQuality       string   `json:"signal_quality"`
	SignalQualityScore  float64  `json:"signal_quality_score"`
}

// SleepClearanceSession is a persisted staged research-inference output with explicit limitations.
type SleepClearanceSession struct {
	SessionID                      string           `json:"session_id"`
	UserID                         string           `json:"user_id"`
	CohortID                       string           `json:"cohort_id,omitempty"`
	HardwareTier                   string           `json:"hardware_tier"`
	ResearchEstimate               ResearchEstimate `json:"research_estimate"`
	Evidence                       EvidenceSummary  `json:"evidence"`
	PhysiologicalHypotheses        map[string]any   `json:"physiological_hypotheses"`
	N3AssociatedFeatureSensitivity float64          `json:"n3_associated_feature_sensitivity"`
	Limitations                    []string         `json:"limitations"`
	ModelStage                     string           `json:"model_stage"`
	ModelVersion                   string           `json:"model_version"`
	ValidationStatus               string           `json:"validation_status"`
	IsFallback                     bool             `json:"is_fallback"`
	ClaimGuardrail                 string           `json:"claim_guardrail"`
	CreatedAt                      time.Time        `json:"created_at"`
}

// MriReferenceRecord represents an independently acquired clinical MRI partner measurement.
type MriReferenceRecord struct {
	ReferenceID             string    `json:"reference_id"`
	UserID                  string    `json:"user_id"`
	CohortID                string    `json:"cohort_id"`
	SiteID                  string    `json:"site_id"`
	ScannerFieldT           float64   `json:"scanner_field_t"`
	SurrogateType           string    `json:"surrogate_type"`
	DtiAlpsIndex            *float64  `json:"dti_alps_index,omitempty"`
	CsfPulsatileVelocityCmS *float64  `json:"csf_pulsatile_velocity_cm_s,omitempty"`
	BoldCsfCouplingR        *float64  `json:"bold_csf_coupling_r,omitempty"`
	PvsBurdenScore          *float64  `json:"pvs_burden_score,omitempty"`
	QualityScore            float64   `json:"quality_score"`
	PairedSessionID         string    `json:"paired_session_id,omitempty"`
	AcquiredAt              time.Time `json:"acquired_at"`
}

// CohortValidationRequest evaluates agreement between predicted surrogates and MRI references.
type CohortValidationRequest struct {
	SurrogateTarget string           `json:"surrogate_target"`
	Predicted       []float64        `json:"predicted"`
	MriReference    []float64        `json:"mri_reference"`
	NightGroups     [][]float64      `json:"night_groups,omitempty"`
	CiLow           []float64        `json:"ci_low,omitempty"`
	CiHigh          []float64        `json:"ci_high,omitempty"`
	Subgroups       []map[string]any `json:"subgroups,omitempty"`
}

// SubgroupAgreement summarizes stratified agreement for a clinical/device subgroup.
type SubgroupAgreement struct {
	GroupKey    string  `json:"group_key"`
	GroupValue  string  `json:"group_value"`
	SampleCount int     `json:"sample_count"`
	MAE         float64 `json:"mae"`
	RMSE        float64 `json:"rmse"`
	LinCCC      float64 `json:"lin_ccc"`
	Bias        float64 `json:"bland_altman_bias"`
}

// CohortValidationResult reports statistical agreement, documented ICC(2,1), coverage, and sensitivity.
type CohortValidationResult struct {
	SampleCount                    int                 `json:"sample_count"`
	SurrogateTarget                string              `json:"surrogate_target"`
	PearsonR                       float64             `json:"pearson_r"`
	SpearmanRho                    float64             `json:"spearman_rho"`
	LinCCC                         float64             `json:"lin_ccc"`
	MAE                            float64             `json:"mae"`
	RMSE                           float64             `json:"rmse"`
	BlandAltmanBias                float64             `json:"bland_altman_bias"`
	BlandAltmanLoaLow              float64             `json:"bland_altman_loa_low"`
	BlandAltmanLoaHigh             float64             `json:"bland_altman_loa_high"`
	WithinPersonVariance           *float64            `json:"within_person_variance,omitempty"`
	BetweenPersonVariance          *float64            `json:"between_person_variance,omitempty"`
	IccFormulation                 string              `json:"icc_formulation"`
	MultiNightICC                  *float64            `json:"multi_night_icc,omitempty"`
	IntervalCoverage95             *float64            `json:"interval_coverage_95,omitempty"`
	CalibrationError               *float64            `json:"calibration_error,omitempty"`
	N3AssociatedFeatureSensitivity float64             `json:"n3_associated_feature_sensitivity"`
	StratifiedMetrics              []SubgroupAgreement `json:"stratified_metrics,omitempty"`
	ValidationPassed               bool                `json:"validation_passed"`
	RunID                          string              `json:"run_id,omitempty"`
	Notes                          []string            `json:"notes"`
	IsFallback                     bool                `json:"is_fallback"`
	ClaimGuardrail                 string              `json:"claim_guardrail"`
}

// RawObservationPresignRequest requests an encrypted S3 upload URL for consented raw waveforms.
type RawObservationPresignRequest struct {
	UserID       string `json:"user_id"`
	SessionID    string `json:"session_id,omitempty"`
	ConsentScope string `json:"consent_scope"`
	ContentType  string `json:"content_type,omitempty"`
}

// RawObservationPresignResponse returns the presigned upload URL or local descriptor.
type RawObservationPresignResponse struct {
	ObservationID  string `json:"observation_id"`
	S3Bucket       string `json:"s3_bucket,omitempty"`
	S3ObjectKey    string `json:"s3_object_key"`
	PresignedURL   string `json:"presigned_url,omitempty"`
	UploadMode     string `json:"upload_mode"` // s3_presigned | local_unconfigured
	ClaimGuardrail string `json:"claim_guardrail"`
}

// RawObservationRecord records metadata for an encrypted raw waveform chunk stored in object storage.
type RawObservationRecord struct {
	ObservationID     string    `json:"observation_id"`
	UserID            string    `json:"user_id"`
	SessionID         string    `json:"session_id,omitempty"`
	S3ObjectKey       string    `json:"s3_object_key"`
	Sha256Ciphertext  string    `json:"sha256_ciphertext"`
	SampleCount       int       `json:"sample_count"`
	SampleRateHz      float64   `json:"sample_rate_hz"`
	DeviceTimestampMs int64     `json:"device_timestamp_ms"`
	MonotonicMs       int64     `json:"monotonic_ms"`
	SyncUncertaintyMs float64   `json:"sync_uncertainty_ms"`
	ConsentScope      string    `json:"consent_scope"`
	Revoked           bool      `json:"revoked"`
	RecordedAt        time.Time `json:"recorded_at"`
}

// ConsentRevokeRequest propagates consent revocation to observations and future model runs.
type ConsentRevokeRequest struct {
	UserID       string `json:"user_id"`
	ConsentScope string `json:"consent_scope"`
}

// ConsentGrantRequest records explicit purpose-specific sensor or telemetry consent.
type ConsentGrantRequest struct {
	UserID       string `json:"user_id"`
	ConsentScope string `json:"consent_scope"`
}

// SensorDeviceRecord maps to health_sensor_devices.
type SensorDeviceRecord struct {
	DeviceID          string    `json:"device_id"`
	UserID            string    `json:"user_id"`
	SignalSource      string    `json:"signal_source"`
	Capabilities      []string  `json:"capabilities"`
	CalibrationStatus string    `json:"calibration_status"`
	ConnectedAt       time.Time `json:"connected_at"`
}

// SensorSessionRecord maps to health_sensor_sessions.
type SensorSessionRecord struct {
	SessionID    string     `json:"session_id"`
	UserID       string     `json:"user_id"`
	DeviceID     string     `json:"device_id"`
	Protocol     string     `json:"protocol"`
	IsSimulated  bool       `json:"is_simulated"`
	ConsentScope string     `json:"consent_scope"`
	StartedAt    time.Time  `json:"started_at"`
	CompletedAt  *time.Time `json:"completed_at,omitempty"`
}

// SensorPermissionRecord maps to health_sensor_permissions.
type SensorPermissionRecord struct {
	PermissionID string     `json:"permission_id"`
	UserID       string     `json:"user_id"`
	ConsentScope string     `json:"consent_scope"`
	Granted      bool       `json:"granted"`
	RevokedAt    *time.Time `json:"revoked_at,omitempty"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

// ValidationRunRecord maps to health_validation_runs.
type ValidationRunRecord struct {
	RunID            string    `json:"run_id"`
	SurrogateTarget  string    `json:"surrogate_target"`
	SampleCount      int       `json:"sample_count"`
	LinCCC           float64   `json:"lin_ccc"`
	PearsonR         float64   `json:"pearson_r"`
	MAE              float64   `json:"mae"`
	RMSE             float64   `json:"rmse"`
	MultiNightICC    *float64  `json:"multi_night_icc,omitempty"`
	IccFormulation   string    `json:"icc_formulation"`
	ValidationPassed bool      `json:"validation_passed"`
	CreatedAt        time.Time `json:"created_at"`
}

// OutboxEventRecord maps to health_ingest_outbox.
type OutboxEventRecord struct {
	OutboxID       string     `json:"outbox_id"`
	EventID        string     `json:"event_id"`
	EventType      string     `json:"event_type"`
	UserID         string     `json:"user_id"`
	IdempotencyKey string     `json:"idempotency_key,omitempty"`
	PayloadJSON    []byte     `json:"payload_json"`
	Status         string     `json:"status"` // pending | dispatched | dlq
	Attempts       int        `json:"attempts"`
	NextRetryAt    time.Time  `json:"next_retry_at"`
	LastError      string     `json:"last_error,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	DispatchedAt   *time.Time `json:"dispatched_at,omitempty"`
}

// ErasureJobRecord maps to health_erasure_jobs.
type ErasureJobRecord struct {
	JobID          string     `json:"job_id"`
	UserID         string     `json:"user_id"`
	ConsentScope   string     `json:"consent_scope"`
	ObservationIDs []string   `json:"observation_ids"`
	S3ObjectKeys   []string   `json:"s3_object_keys,omitempty"`
	Status         string     `json:"status"` // pending | completed
	CreatedAt      time.Time  `json:"created_at"`
	CompletedAt    *time.Time `json:"completed_at,omitempty"`
}

// AuditLogRecord maps to health_audit_log.
type AuditLogRecord struct {
	AuditID      string         `json:"audit_id"`
	UserID       string         `json:"user_id"`
	Action       string         `json:"action"`
	ResourceType string         `json:"resource_type"`
	ResourceID   string         `json:"resource_id"`
	Details      map[string]any `json:"details,omitempty"`
	CreatedAt    time.Time      `json:"created_at"`
}

// TelemetrySummary exposes platform health, queue/outbox depth, DLQ, and model fallback stats.
type TelemetrySummary struct {
	Queue            QueueStats `json:"queue"`
	OutboxPending    int        `json:"outbox_pending"`
	OutboxDispatched int        `json:"outbox_dispatched"`
	OutboxDLQ        int        `json:"outbox_dlq"`
	ErasurePending   int        `json:"erasure_pending"`
	ErasureCompleted int        `json:"erasure_completed"`
	DevicesCount     int        `json:"devices_count"`
	SessionsCount    int        `json:"sessions_count"`
	ValidationsCount int        `json:"validations_count"`
	FallbackRate     float64    `json:"fallback_rate"`
	ClaimGuardrail   string     `json:"claim_guardrail"`
}
