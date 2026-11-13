// Typed API wrappers for the NEXORA Health 3-Pipeline Architecture (/api/v1/health/*).
import { api } from './client';

export type HealthSubmodule = {
  key: string;
  title: string;
  subtitle: string;
  status: 'active' | 'research_preview' | 'planned';
  sensor_ready: boolean;
};

export type HardwareTier =
  | 'consumer_phone_sensors'
  | 'wearable_ppg_imu'
  | 'clinical_eeg_ppg_resp'
  | 'paired_mri_cohort';

export type SurrogateTarget =
  | 'dti_alps_index'
  | 'csf_pulsatile_velocity_cm_s'
  | 'bold_csf_coupling_r';

export type MeasurementStatus =
  | 'measured'
  | 'estimated'
  | 'unavailable'
  | 'invalid_quality'
  | 'simulated';

export type FeatureProvenance = {
  source_device: string;
  signal_source: string;
  sampling_rate_hz: number;
  timestamp_accuracy_ms: number;
  placement_protocol: string;
  calibration_status: string;
  signal_quality_score: number;
  measurement_status: MeasurementStatus;
  algorithm_version: string;
  missing_reason?: string;
};

export type ProvenancedFeature = {
  name: string;
  value: number | string | null;
  unit: string;
  provenance: FeatureProvenance;
  limitations?: string[];
};

export type SensorFrame = {
  timestamp_ms: number;
  ax: number;
  ay: number;
  az: number;
  gx?: number;
  gy?: number;
  gz?: number;
  ppg?: number;
  resp?: number;
};

export type SensorStreamRecord = {
  stream_id: string;
  user_id: string;
  session_id?: string;
  hardware_tier: HardwareTier;
  is_simulated: boolean;
  features: Record<string, ProvenancedFeature>;
  available_modalities: string[];
  missing_modalities: string[];
  limitations: string[];
  is_fallback: boolean;
  claim_guardrail: string;
  recorded_at: string;
};

export type SleepClearanceSession = {
  session_id: string;
  user_id: string;
  cohort_id?: string;
  hardware_tier: HardwareTier;
  research_estimate: {
    target: string;
    value: number;
    unit: string;
    confidence_interval: [number, number];
    uncertainty: {
      epistemic: number;
      aleatoric: number;
    };
  };
  evidence: {
    available_modalities: string[];
    missing_modalities: string[];
    signal_quality: string;
    signal_quality_score: number;
  };
  physiological_hypotheses: {
    sleep_physiology_state: number;
    available_components: string[];
    missing_components: string[];
    hypotheses: Record<string, number | null>;
  };
  n3_associated_feature_sensitivity: number;
  limitations: string[];
  model_stage: string;
  model_version: string;
  validation_status: string;
  is_fallback: boolean;
  claim_guardrail: string;
  created_at: string;
};

export type MriReferenceRecord = {
  reference_id: string;
  user_id: string;
  cohort_id: string;
  site_id: string;
  scanner_field_t: number;
  surrogate_type: string;
  dti_alps_index?: number;
  csf_pulsatile_velocity_cm_s?: number;
  bold_csf_coupling_r?: number;
  quality_score: number;
  acquired_at: string;
};

export type SubgroupAgreement = {
  group_key: string;
  group_value: string;
  sample_count: number;
  mae: number;
  rmse: number;
  lin_ccc: number;
  bland_altman_bias: number;
};

export type SensorIngestPayload = {
  user_id?: string;
  session_id?: string;
  idempotency_key?: string;
  source_device?: string;
  hardware_tier: HardwareTier;
  sample_rate_hz: number;
  is_simulated: boolean;
  device_timestamp_ms: number;
  monotonic_ms: number;
  sync_uncertainty_ms: number;
  extracted_features: Record<string, ProvenancedFeature>;
  frames?: SensorFrame[];
};

export type HealthTelemetrySummary = {
  queue: {
    queue_depth: number;
    capacity: number;
    enqueued: number;
    processed: number;
    deduplicated: number;
    dropped: number;
  };
  outbox_pending: number;
  outbox_dispatched: number;
  outbox_dlq: number;
  erasure_pending: number;
  erasure_completed: number;
  devices_count: number;
  sessions_count: number;
  validations_count: number;
  fallback_rate: number;
  claim_guardrail: string;
};

export type CohortValidationResult = {
  run_id?: string;
  sample_count: number;
  surrogate_target: string;
  pearson_r: number;
  spearman_rho: number;
  lin_ccc: number;
  mae: number;
  rmse: number;
  bland_altman_bias: number;
  bland_altman_loa_low: number;
  bland_altman_loa_high: number;
  within_person_variance?: number | null;
  between_person_variance?: number | null;
  icc_formulation: string;
  multi_night_icc?: number | null;
  interval_coverage_95?: number | null;
  calibration_error?: number | null;
  n3_associated_feature_sensitivity: number;
  stratified_metrics?: SubgroupAgreement[];
  validation_passed: boolean;
  notes: string[];
  is_fallback: boolean;
  claim_guardrail: string;
};

export const healthApi = {
  listSubmodules: () =>
    api.get<{ submodules: HealthSubmodule[]; claim_guardrail: string }>('/api/v1/health/submodules'),

  getDeviceCapabilities: () =>
    api.get<{ capabilities: Record<string, string[]>; claim_guardrail: string }>(
      '/api/v1/health/devices/capabilities',
    ),

  registerDevice: (payload: {
    device_id?: string;
    user_id?: string;
    signal_source: string;
    capabilities: string[];
    calibration_status?: string;
  }) => api.post<{ device_id: string; signal_source: string }>('/api/v1/health/devices/register', payload),

  listDevices: (userId = 'default-user') =>
    api.get<{
      devices: Array<{ device_id: string; signal_source: string; capabilities: string[]; calibration_status: string }>;
      claim_guardrail: string;
    }>(`/api/v1/health/devices?user_id=${encodeURIComponent(userId)}`),

  ingestFeatures: (payload: SensorIngestPayload) =>
    api.post<SensorStreamRecord>('/api/v1/health/features/ingest', payload),

  listLatestFeatures: (userId = 'default-user', limit = 10) =>
    api.get<{ streams: SensorStreamRecord[]; claim_guardrail: string }>(
      `/api/v1/health/features/latest?user_id=${encodeURIComponent(userId)}&limit=${limit}`,
    ),

  createSleepSession: (payload: {
    user_id?: string;
    cohort_id?: string;
    model_stage?: 'M0' | 'M1';
    hardware_tier: HardwareTier;
    is_simulated?: boolean;
    eeg_delta_ratio?: number;
    n3_fraction?: number;
    sleep_fragmentation_index?: number;
    respiratory_rate_bpm?: number;
    ppg_pulsatility_index?: number;
    hrv_rmssd_ms?: number;
    device_orientation?: string;
    signal_quality_score: number;
    sample_rate_hz?: number;
    frames?: SensorFrame[];
  }) => api.post<SleepClearanceSession>('/api/v1/health/research/sleep-sessions', payload),

  listSleepSessions: (userId = 'default-user', limit = 15) =>
    api.get<{ sessions: SleepClearanceSession[]; claim_guardrail: string }>(
      `/api/v1/health/research/sleep-sessions?user_id=${encodeURIComponent(userId)}&limit=${limit}`,
    ),

  createMriReference: (payload: {
    cohort_id: string;
    site_id: string;
    scanner_field_t: number;
    surrogate_type: SurrogateTarget;
    dti_alps_index?: number;
    csf_pulsatile_velocity_cm_s?: number;
    bold_csf_coupling_r?: number;
    quality_score?: number;
  }) => api.post<MriReferenceRecord>('/api/v1/health/references/measurements', payload),

  listMriReferences: (cohortId = '', limit = 25) =>
    api.get<{ references: MriReferenceRecord[]; claim_guardrail: string }>(
      `/api/v1/health/references/measurements?cohort_id=${encodeURIComponent(cohortId)}&limit=${limit}`,
    ),

  validateCohort: (payload: {
    surrogate_target: SurrogateTarget;
    predicted: number[];
    mri_reference: number[];
    night_groups?: number[][];
    ci_low?: number[];
    ci_high?: number[];
    subgroups?: Record<string, string>[];
  }) => api.post<CohortValidationResult>('/api/v1/health/research/validate', payload),

  listValidationRuns: (limit = 20) =>
    api.get<{ validations: Array<{ run_id: string; surrogate_target: string; sample_count: number; lin_ccc: number; validation_passed: boolean; created_at: string }>; claim_guardrail: string }>(
      `/api/v1/health/research/validations?limit=${limit}`,
    ),

  presignRawObservation: (payload: {
    user_id?: string;
    session_id?: string;
    consent_scope: 'health_research_telemetry';
    content_type?: string;
  }) =>
    api.post<{
      observation_id: string;
      s3_bucket?: string;
      s3_object_key: string;
      presigned_url?: string;
      upload_mode: 's3_presigned' | 'local_unconfigured';
      claim_guardrail: string;
    }>('/api/v1/health/observations/presign', payload),

  completeRawObservation: (payload: {
    observation_id: string;
    user_id?: string;
    session_id?: string;
    s3_object_key: string;
    sha256_ciphertext: string;
    sample_count: number;
    sample_rate_hz: number;
    device_timestamp_ms: number;
    monotonic_ms: number;
    sync_uncertainty_ms: number;
    consent_scope: 'health_research_telemetry';
  }) => api.post<{ observation_id: string; revoked: boolean }>('/api/v1/health/observations/complete', payload),

  grantConsent: (payload: { user_id?: string; consent_scope: string }) =>
    api.post<{ granted: boolean; consent_scope: string }>('/api/v1/health/consent/grant', payload),

  revokeConsent: (payload: { user_id?: string; consent_scope: string }) =>
    api.post<{ revoked_observations: number; erasure_job_id?: string; erasure_status?: string; status: string }>(
      '/api/v1/health/consent/revoke',
      payload,
    ),

  getQueueStats: () =>
    api.get<HealthTelemetrySummary['queue']>('/api/v1/health/queue/stats'),

  getTelemetry: () => api.get<HealthTelemetrySummary>('/api/v1/health/telemetry'),
};
