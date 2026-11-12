import { api } from './client';

export type DeepArchitectureStatus = {
  status: string;
  brain_reachable: boolean;
  architecture_count?: number;
  architectures?: Record<string, string>;
  details?: Record<string, Record<string, any>>;
  timestamp?: string;
};

export type VisionInspectResponse = {
  frame_id: string;
  hazards_detected: Array<{
    hazard_type: string;
    confidence: number;
    bbox: [number, number, number, number];
    depth_estimate_m: number;
    severity_grade: string;
  }>;
  overall_hazard_severity: number;
  advisory: string;
  model: string;
};

export type CashflowForecastResponse = {
  user_id: string;
  current_balance_inr: number;
  projections: Array<{
    day: number;
    predicted_balance_inr: number;
    lower_bound_inr: number;
    upper_bound_inr: number;
    confidence: number;
  }>;
  minimum_projected_balance_inr: number;
  runway_days: number;
  risk_status: string;
  model: string;
};

export type AnomalyScoreResponse = {
  user_id: string;
  distance: number;
  anomaly_score: number;
  is_anomaly: boolean;
  severity: string;
  model: string;
};

export type VoiceUrgencyResponse = {
  urgency_score: number;
  sentiment: string;
  escalation_required: boolean;
  caller_affect: string;
  priority_tier: string;
  model: string;
};

export type VoiceDiarizationResponse = {
  audio_id: string;
  speaker_count: number;
  turns: Array<{
    speaker: string;
    start_time_s: number;
    end_time_s: number;
    transcript_snippet: string;
  }>;
  model: string;
};

export type UserTwinResponse = {
  user_id: string;
  fusion_vector_dim: number;
  cross_domain_correlations: Array<{
    pair: string;
    strength: number;
    insight: string;
  }>;
  dominant_mode: string;
  top_spending_category: string;
  commute_stress_index: number;
  model: string;
};

export type DriftResponse = {
  feature_name: string;
  ks_statistic: number;
  p_value: number;
  drift_detected: boolean;
  drift_severity: string;
  recommended_action: string;
  model: string;
};

export type BenchmarkResponse = {
  timestamp: string;
  total_pillars_tested: number;
  all_passed: boolean;
  benchmarks: Array<{
    pillar: string;
    architecture: string;
    latency_ms: number;
    passed: boolean;
    metric_summary: string;
  }>;
  total_duration_ms: number;
};

export const deepMlApi = {
  status: () => api.get<DeepArchitectureStatus>('/deep/status'),

  mobility: {
    stGnn: (body: { segment_ids: string[]; horizon_minutes?: number }) =>
      api.post<{ predictions: Record<string, number>; model: string }>('/deep/mobility/st-gnn/predict', body),
    conformalEta: (body: { base_duration_s: number; hour_of_day?: number; incident_present?: boolean }) =>
      api.post<{ p50_seconds: number; p80_seconds: number; p90_seconds: number; model: string }>('/deep/mobility/eta/conformal', body),
    trajectoryPredict: (body: { breadcrumbs: Array<{ latitude: number; longitude: number; speed_kph?: number }> }) =>
      api.post<{ predicted_destination: { latitude: number; longitude: number }; is_outlier: boolean; outlier_score: number; model: string }>('/deep/mobility/trajectory/predict', body),
    visionInspect: (body: { frame_b64?: string; simulated_scenario?: 'pothole' | 'waterlogging' | 'damaged_road' | 'clear' }) =>
      api.post<VisionInspectResponse>('/deep/mobility/vision/inspect', body),
    demandForecast: (body: { h3_index: string; hour_of_day?: number; day_of_week?: number }) =>
      api.post<{ surge_multiplier: number; predicted_demand_idx: number; model: string }>('/deep/mobility/demand/forecast', body),
    policyEvaluate: (body: { route_coordinates: Array<[number, number]>; policy_type?: string }) =>
      api.post<{ policy_score: number; safety_compliance_pct: number; recommended_action: string; model: string }>('/deep/mobility/policy/evaluate', body),
  },

  finance: {
    classifyAlert: (body: { text: string; sender?: string }) =>
      api.post<{ merchant: string; category: string; amount_inr: number; is_recurring: boolean; confidence: number; model: string }>('/deep/finance/classify-alert', body),
    anomaly: (body: { user_id?: string; amount_inr: number; category?: string; hour?: number }) =>
      api.post<AnomalyScoreResponse>('/deep/finance/anomaly', body),
    cashflowForecast: (body: { user_id?: string; starting_balance?: number; horizon_days?: number }) =>
      api.post<CashflowForecastResponse>('/deep/finance/cashflow-forecast', body),
    regimeRisk: (body: { portfolio?: Record<string, number> }) =>
      api.post<{ active_regime: string; volatility_regime: string; factor_exposures: Record<string, number>; risk_level: string; model: string }>('/deep/finance/regime-risk', body),
    graphPropagate: (body: { shock_nodes?: Record<string, number>; steps?: number }) =>
      api.post<{ propagated_nodes: Array<{ node: string; shock_intensity: number }>; total_nodes: number; model: string }>('/deep/finance/graph/propagate', body),
    docExtract: (body: { raw_text: string }) =>
      api.post<{ document_type: string; extracted_fields: Record<string, any>; confidence: number; model: string }>('/deep/finance/doc/extract', body),
    merchantsRegister: (merchants: Record<string, [string, string, boolean]>) =>
      api.post<{ registered: number }>('/deep/finance/merchants/register', { merchants }),
    merchantsList: () =>
      api.get<{ count: number; merchants: Record<string, [string, string, boolean]> }>('/deep/finance/merchants'),
  },

  voice: {
    asrAdapt: (body: { audio_b64?: string; sample_text?: string; language?: string }) =>
      api.post<{ transcript: string; detected_language: string; confidence: number; model: string }>('/deep/voice/asr/adapt', body),
    diarize: (body: { conversation_id?: string; audio_duration_s?: number }) =>
      api.post<VoiceDiarizationResponse>('/deep/voice/diarize', body),
    denseSearch: (body: { query: string; documents: string[]; top_k?: number }) =>
      api.post<{ top_results: Array<{ index: number; document: string; score: number }>; model: string }>('/deep/voice/dense-search', body),
    rerank: (body: { query: string; candidates: string[] }) =>
      api.post<{ ranked_results: Array<{ candidate: string; score: number }>; model: string }>('/deep/voice/rerank', body),
    urgency: (body: { transcript?: string; audio_features?: Record<string, number> }) =>
      api.post<VoiceUrgencyResponse>('/deep/voice/urgency', body),
    codeSwitchRegister: (tokens: Record<string, string>) =>
      api.post<{ registered: number }>('/deep/voice/code-switch/register', { tokens }),
    codeSwitchLexicon: () =>
      api.get<{ count: number; dialects: Record<string, string> }>('/deep/voice/code-switch/lexicon'),
  },

  multimodal: {
    userTwin: (body: { user_id?: string; mobility_trips?: number; finance_spend_inr?: number; voice_calls?: number }) =>
      api.post<UserTwinResponse>('/deep/multimodal/user-twin', body),
  },

  evaluation: {
    drift: (body: { feature_name: string; baseline_values?: number[]; current_values?: number[] }) =>
      api.post<DriftResponse>('/deep/evaluation/drift', body),
    benchmark: () =>
      api.post<BenchmarkResponse>('/deep/evaluation/benchmark', {}),
  },
};
