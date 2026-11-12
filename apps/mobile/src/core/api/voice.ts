// Typed wrappers over the NEXORA Voice Intelligence Platform endpoints (/api/v1/voice/*).
import { API_BASE_URL } from '../config';
import { api } from './client';

export type WordTimestamp = {
  word: string;
  start_ms: number;
  end_ms: number;
  speaker_label: string;
  confidence: number;
};

export type VadSegment = {
  start_ms: number;
  end_ms: number;
  energy_dbfs: number;
  speech_prob: number;
};

export type AudioQualityReport = {
  quality_score: number;
  snr_db: number;
  clipping_ratio: number;
  speech_ratio: number;
  noise_floor_dbfs: number;
  routing_strategy: string;
  vad_segments: VadSegment[];
  warnings?: string[];
};

export type IntegrityMetadata = {
  sha256_original: string;
  hmac_seal: string;
  encryption_key_version: number;
  legal_hold: boolean;
  consent_granted: boolean;
  consent_scope: string;
};

export type RecordingIR = {
  recording_id: string;
  source_type: string;
  mime_type: string;
  sample_rate_hz: number;
  channels: number;
  duration_ms: number;
  byte_size: number;
  storage_uri: string;
  s3_bucket?: string;
  s3_object_key?: string;
  s3_presigned_status?: string;
  s3_etag?: string;
  uploaded_at?: string;
  caller_name?: string;
  caller_phone_masked?: string;
  caller_phone_hash?: string;
  caller_source?: string;
  caller_confidence?: number;
  call_direction?: string;
  quality_report: AudioQualityReport;
  integrity: IntegrityMetadata;
};

export type ObservedIdentity = {
  source: string;
  name: string;
  confidence: number;
  seen_at: string;
};

export type CallerDirectoryEntry = {
  user_id: string;
  phone_hash: string;
  phone_masked: string;
  display_name: string;
  source: string;
  confidence: number;
  spam_risk?: string;
  spam_reports: number;
  spam_score: number;
  company?: string;
  business_category?: string;
  organization?: string;
  known_purpose?: string;
  relationship_label?: string;
  call_count: number;
  last_call_at?: string;
  observed_identities?: ObservedIdentity[];
  identity_conflict: boolean;
  needs_classification: boolean;
};

export type CallerTimelineItem = {
  conversation_id: string;
  recording_id: string;
  title: string;
  summary: string;
  call_direction: string;
  storage_uri: string;
  s3_presigned_status: string;
  duration_ms: number;
  created_at: string;
};

export type CallerContextResponse = {
  caller: CallerDirectoryEntry;
  timeline: CallerTimelineItem[];
};

export type PresignUploadResponse = {
  recording_id: string;
  conversation_id: string;
  upload_url: string;
  upload_method: string;
  upload_mode: string;
  required_headers: Record<string, string>;
  expires_in_sec: number;
  s3_bucket: string;
  s3_object_key: string;
  storage_uri: string;
  caller?: CallerDirectoryEntry;
};

export type ParticipantIR = {
  participant_id: string;
  speaker_label: string;
  display_name: string;
  role: string;
  voiceprint_ref?: string;
  is_verified: boolean;
  talk_time_ms: number;
  utterance_count: number;
};

export type UtteranceIR = {
  utterance_id: string;
  recording_id: string;
  speaker_label: string;
  seq_index: number;
  start_ms: number;
  end_ms: number;
  original_text: string;
  language: string;
  confidence: number;
  word_timestamps: WordTimestamp[];
  uncertainty_reason?: string;
  overlap_detected: boolean;
  audio_segment_ref?: string;
  to_speakers?: string[];
  addressing_mode?: string;
  addressed_utterance_id?: string;
  what_is_spoken?: string;
};

export type InteractionEdgeIR = {
  from_speaker: string;
  from_name: string;
  to_speaker: string;
  to_name: string;
  turn_count: number;
  last_topic: string;
  primary_acts: string[];
  strength: number;
  sample_summary: string;
};

export type CaptureSession = {
  session_id: string;
  conversation_id: string;
  user_id: string;
  title: string;
  capture_mode: string;
  source_type: string;
  state: string;
  chunk_count: number;
  os_capture_guidance?: string;
  created_at: string;
  updated_at: string;
};

export type ConversationEventIR = {
  event_id: string;
  event_type: 'request' | 'proposal' | 'commitment' | 'decision' | 'question' | 'disagreement' | string;
  summary: string;
  actor_speaker: string;
  topic: string;
  dialogue_act: string;
  intent: string;
  confidence: number;
  source_utterance_ids: string[];
  due_at?: string;
  status: string;
};

export type KnowledgeEntityIR = {
  entity_id: string;
  canonical_name: string;
  entity_type: string;
  aliases: string[];
};

export type KnowledgeEdgeIR = {
  from_entity: string;
  to_entity: string;
  relation_type: string;
  confidence: number;
  valid_from: string;
  evidence_utterance_id?: string;
};

export type ReasoningResultIR = {
  finding_id: string;
  finding_type: 'contradiction' | 'negotiation_shift' | 'causal_link' | 'temporal_change' | 'uncertainty' | string;
  severity: 'low' | 'medium' | 'high' | 'critical' | string;
  title: string;
  explanation: string;
  confidence: number;
  evidence_utterance_ids: string[];
};

export type SourceEvidenceRef = {
  ref_id: string;
  target_kind: string;
  target_id: string;
  utterance_id: string;
  speaker_label: string;
  start_ms: number;
  end_ms: number;
  quote: string;
  confidence: number;
};

export type ActionSuggestionIR = {
  action_id: string;
  action_type: 'note' | 'reminder' | 'task' | 'calendar_event' | 'follow_up' | string;
  title: string;
  rationale: string;
  confidence: number;
  requires_approval: boolean;
  status: 'suggested' | 'approved' | 'rejected' | 'executed' | string;
  evidence_refs?: SourceEvidenceRef[];
  decided_at?: string;
};

export type HumanCorrectionIR = {
  correction_id: string;
  target_type: string;
  target_id: string;
  original_value: string;
  corrected_value: string;
  reason: string;
  corrected_by: string;
  created_at: string;
};

export type ModelTelemetryIR = {
  stage: string;
  adapter_name: string;
  routing_reason: string;
  fallback_used: boolean;
  latency_ms: number;
  confidence: number;
  cost_units: number;
};

export type CustodyEvent = {
  id: string;
  evidence_id: string;
  conversation_id: string;
  actor_id: string;
  event_action: string;
  prev_hash: string;
  event_hash: string;
  occurred_at: string;
};

export type EvidenceRecord = {
  evidence_id: string;
  conversation_id: string;
  recording_id: string;
  merkle_root: string;
  chain_head_hash: string;
  chain_valid: boolean;
  export_count: number;
  last_verified_at: string;
  custody_events: CustodyEvent[];
};

export type ConversationIR = {
  conversation_id: string;
  user_id: string;
  title: string;
  summary: string;
  status: string;
  primary_language: string;
  detected_languages: string[];
  topics: string[];
  overall_confidence: number;
  confidence_tier: string;
  created_at: string;
  updated_at: string;
  recording: RecordingIR;
  participants: ParticipantIR[];
  utterances: UtteranceIR[];
  conversation_events: ConversationEventIR[];
  extracted_knowledge: {
    entities: KnowledgeEntityIR[];
    edges: KnowledgeEdgeIR[];
  };
  reasoning_results: ReasoningResultIR[];
  action_suggestions: ActionSuggestionIR[];
  human_corrections: HumanCorrectionIR[];
  source_evidence_refs: SourceEvidenceRef[];
  interaction_edges?: InteractionEdgeIR[];
  model_telemetry: ModelTelemetryIR[];
  evidence?: EvidenceRecord;
};

export type VoiceOverviewResponse = {
  user_id: string;
  workstreams_active: number;
  conversation_count: number;
  utterance_count: number;
  commitments_decisions: number;
  reasoning_findings: number;
  pending_approvals: number;
  verified_chains: number;
  avg_audio_quality: number;
  conversations: ConversationIR[];
};

export type VoiceQAResponse = {
  answer: string;
  confidence: number;
  confidence_tier: string;
  citations: Array<{
    conversation_id: string;
    conversation_title: string;
    utterance_id: string;
    speaker_label: string;
    start_ms: number;
    end_ms: number;
    quote: string;
    score: number;
  }>;
};

export type CallLogEntry = {
  id: string;
  user_id: string;
  device_call_id?: string;
  phone_hash: string;
  phone_masked: string;
  contact_name: string;
  direction: 'inbound' | 'outbound' | 'missed' | 'rejected' | 'voicemail' | 'unknown';
  duration_sec: number;
  started_at: string;
  sim_slot?: string;
  source: string;
  conversation_id?: string;
  spam_risk: string;
};

export type CallLogContactSummary = {
  phone_hash: string;
  phone_masked: string;
  display_name: string;
  call_count: number;
  missed_count: number;
  total_duration_sec: number;
  last_call_at: string;
  spam_risk: string;
};

export type CallLogAlert = {
  alert_type: string;
  title: string;
  phone_masked: string;
  phone_hash: string;
  count: number;
  recommendation: string;
};

export type CallLogInsights = {
  total_calls: number;
  inbound_count: number;
  outbound_count: number;
  missed_count: number;
  rejected_count: number;
  total_talk_duration_sec: number;
  avg_call_duration_sec: number;
  unique_contacts: number;
  unknown_numbers: number;
  high_risk_spam_count: number;
  peak_call_hour_utc: number;
  top_contacts: CallLogContactSummary[];
  follow_up_alerts: CallLogAlert[];
  recent_logs: CallLogEntry[];
};

export const voiceApi = {
  overview: () => api.get<VoiceOverviewResponse>('/voice/overview'),
  conversations: () => api.get<{ conversations: ConversationIR[]; count: number }>('/voice/conversations'),
  getConversation: (id: string) => api.get<ConversationIR>(`/voice/conversations/${id}`),
  capture: (body: {
    title: string;
    source_type?: string;
    language?: string;
    consent_granted: boolean;
    transcript_text?: string;
    snr_db?: number;
    overlap_suspected?: boolean;
  }) => api.post<ConversationIR>('/voice/conversations/capture', body),
  importRecording: (body: {
    title: string;
    source_type?: string;
    language?: string;
    consent_granted: boolean;
    transcript_text: string;
    snr_db?: number;
  }) => api.post<ConversationIR>('/voice/conversations/import', body),
  reprocess: (id: string) => api.post<ConversationIR>(`/voice/conversations/${id}/process`, {}),
  addCorrection: (
    conversationId: string,
    body: { target_type: string; target_id: string; corrected_value: string; reason?: string },
  ) => api.post<HumanCorrectionIR>(`/voice/conversations/${conversationId}/corrections`, body),
  decideAction: (actionId: string, decision: 'approved' | 'rejected') =>
    api.post<ActionSuggestionIR>(`/voice/actions/${actionId}/decide`, { decision }),
  searchMemory: (q: string) =>
    api.get<{ query: string; count: number; results: Array<Record<string, any>> }>(
      `/voice/memory/search?q=${encodeURIComponent(q)}`,
    ),
  askQA: (question: string, conversationId?: string) =>
    api.post<VoiceQAResponse>('/voice/qa', { question, conversation_id: conversationId }),
  exportEvidence: (conversationId: string) =>
    api.get<Record<string, any>>(`/voice/evidence/${conversationId}/export`),
  toggleLegalHold: (conversationId: string, legalHold: boolean, reason?: string) =>
    api.post<EvidenceRecord>(`/voice/evidence/${conversationId}/legal-hold`, {
      legal_hold: legalHold,
      reason,
    }),
  modelStatus: () => api.get<Record<string, any>>('/voice/models/status'),
  startSession: (body: {
    title: string;
    capture_mode: 'foreground_mic' | 'background_service_mic' | 'call_dual_track' | 'meeting_stream';
    source_type?: string;
    language?: string;
    consent_granted: boolean;
  }) => api.post<CaptureSession>('/voice/sessions/start', body),
  getSession: (id: string) => api.get<CaptureSession>(`/voice/sessions/${id}`),
  streamChunk: (
    id: string,
    body: {
      chunk_seq: number;
      channel_hint?: 'local_mic' | 'remote_track' | 'mixed_room';
      in_background?: boolean;
      audio_base64?: string;
      transcript_text?: string;
      turns?: { speaker_label?: string; text: string; start_ms?: number; end_ms?: number; channel_hint?: string }[];
      snr_db?: number;
      duration_ms?: number;
      overlap_suspected?: boolean;
    },
  ) =>
    api.post<{ deduplicated: boolean; session: CaptureSession; ir: ConversationIR }>(
      `/voice/sessions/${id}/chunk`,
      body,
    ),
  updateSessionState: (id: string, state: 'active' | 'paused' | 'background') =>
    api.post<CaptureSession>(`/voice/sessions/${id}/state`, { state }),
  finalizeSession: (id: string) =>
    api.post<{ session: CaptureSession; ir: ConversationIR }>(`/voice/sessions/${id}/finalize`, {}),
  resolveCaller: (body: { phone_number: string; caller_name?: string; caller_source?: string }) =>
    api.post<CallerContextResponse>('/voice/caller/resolve', body),
  classifyCaller: (body: {
    phone_number: string;
    display_name: string;
    relationship_label?: string;
    business_category?: string;
    organization?: string;
    known_purpose?: string;
    is_spam?: boolean;
    conversation_id?: string;
  }) => api.post<CallerDirectoryEntry>('/voice/caller/classify', body),
  reportCallerSpam: (body: { phone_number: string; reason?: string }) =>
    api.post<CallerDirectoryEntry>('/voice/caller/report-spam', body),
  syncCallerDirectory: () =>
    api.get<{ entries: CallerDirectoryEntry[]; count: number; mode: string }>('/voice/caller/directory-sync'),
  syncDeviceContacts: (body: {
    contacts: Array<{ phone_number: string; display_name: string; organization?: string }>;
    source?: string;
  }) => api.post<{ synced_count: number; entries: CallerDirectoryEntry[] }>('/voice/caller/sync-contacts', body),
  callerTimeline: (phoneNumber: string) =>
    api.get<CallerContextResponse>(`/voice/caller/timeline?phone_number=${encodeURIComponent(phoneNumber)}`),
  importCallLogs: (body: {
    source?: string;
    raw_csv?: string;
    logs?: Array<{
      device_call_id?: string;
      phone_number: string;
      contact_name?: string;
      direction: string;
      duration_sec: number;
      started_at: string;
      sim_slot?: string;
      source?: string;
      transcript_text?: string;
    }>;
  }) =>
    api.post<{ imported_count: number; linked_conversations: number; insights: CallLogInsights }>(
      '/voice/caller/import-logs',
      body,
    ),
  callLogs: (limit = 200) =>
    api.get<{ logs: CallLogEntry[]; count: number; insights: CallLogInsights }>(
      `/voice/caller/logs?limit=${limit}`,
    ),
  callLogInsights: () => api.get<CallLogInsights>('/voice/caller/insights'),
  bindCaller: (
    conversationId: string,
    body: { phone_number?: string; caller_name?: string; caller_source?: string; call_direction?: string },
  ) => api.post<ConversationIR>(`/voice/conversations/${conversationId}/caller`, body),
  presignUpload: (body: {
    title: string;
    source_type?: string;
    mime_type?: string;
    byte_size?: number;
    phone_number?: string;
    caller_name?: string;
    caller_source?: string;
    call_direction?: string;
    consent_granted: boolean;
  }) => api.post<PresignUploadResponse>('/voice/recordings/presign-upload', body),
  completeUpload: (
    recordingId: string,
    body: {
      s3_etag?: string;
      sha256_original?: string;
      byte_size?: number;
      duration_ms?: number;
      transcript_text?: string;
      turns?: { speaker_label?: string; channel_hint?: string; text: string }[];
      phone_number?: string;
      caller_name?: string;
      caller_source?: string;
      call_direction?: string;
    },
  ) =>
    api.post<{ ir: ConversationIR; download_url: string; storage_mode: string }>(
      `/voice/recordings/${recordingId}/complete-upload`,
      body,
    ),
  presignDownload: (recordingId: string) =>
    api.get<{ download_url: string; storage_uri: string; s3_object_key: string; s3_presigned_status: string }>(
      `/voice/recordings/${recordingId}/presign-download`,
    ),
  streamUrl: () => `${API_BASE_URL}/voice/stream`,
};
