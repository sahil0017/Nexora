"""Canonical Conversation IR (Intermediate Representation) for NEXORA Voice Intelligence.

Architectural Invariant:
  Original audio (RecordingIR), raw transcript (UtteranceIR), structured interpretation
  (ConversationEventIR, ReasoningResultIR, ExtractedKnowledgeIR), and verified/corrected
  facts (HumanCorrectionIR, SourceEvidenceRef) are strictly separate data objects linked
  by immutable IDs.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(slots=True)
class WordTimestamp:
    word: str
    start_ms: int
    end_ms: int
    speaker_label: str
    confidence: float


@dataclass(slots=True)
class VadSegment:
    start_ms: int
    end_ms: int
    energy_dbfs: float
    speech_prob: float


@dataclass(slots=True)
class AudioQualityReport:
    quality_score: float
    snr_db: float
    clipping_ratio: float
    speech_ratio: float
    noise_floor_dbfs: float
    routing_strategy: str  # direct_asr | denoise_then_asr | overlap_aware_diarize | low_snr_fallback
    vad_segments: list[VadSegment] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass(slots=True)
class IntegrityMetadata:
    sha256_original: str
    hmac_seal: str = ""
    encryption_key_version: int = 1
    legal_hold: bool = False
    consent_granted: bool = True
    consent_scope: str = "voice.capture"


@dataclass(slots=True)
class RecordingIR:
    recording_id: str
    source_type: str
    mime_type: str
    sample_rate_hz: int
    channels: int
    duration_ms: int
    byte_size: int
    storage_uri: str
    quality_report: AudioQualityReport
    integrity: IntegrityMetadata
    audio_metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class ParticipantIR:
    participant_id: str
    speaker_label: str
    display_name: str
    role: str = "participant"
    voiceprint_ref: str = ""
    is_verified: bool = False
    talk_time_ms: int = 0
    utterance_count: int = 0


@dataclass(slots=True)
class UtteranceIR:
    utterance_id: str
    recording_id: str
    speaker_label: str
    seq_index: int
    start_ms: int
    end_ms: int
    original_text: str
    language: str
    confidence: float
    word_timestamps: list[WordTimestamp] = field(default_factory=list)
    uncertainty_reason: str | None = None
    overlap_detected: bool = False
    audio_segment_ref: str = ""
    to_speakers: list[str] = field(default_factory=list)
    addressing_mode: str = "group_broadcast"  # direct_vocative | reply_to_previous | counter_offer | group_broadcast
    addressed_utterance_id: str | None = None
    what_is_spoken: str = ""


@dataclass(slots=True)
class InteractionEdgeIR:
    from_speaker: str
    from_name: str
    to_speaker: str
    to_name: str
    turn_count: int
    last_topic: str
    primary_acts: list[str] = field(default_factory=list)
    strength: float = 0.0
    sample_summary: str = ""


@dataclass(slots=True)
class ConversationEventIR:
    event_id: str
    event_type: str  # request | proposal | commitment | decision | question | disagreement
    summary: str
    actor_speaker: str
    topic: str
    dialogue_act: str
    intent: str
    confidence: float
    source_utterance_ids: list[str] = field(default_factory=list)
    due_at: str | None = None
    status: str = "open"


@dataclass(slots=True)
class KnowledgeEntityIR:
    entity_id: str
    canonical_name: str
    entity_type: str  # person | organization | project | topic | date | amount | location | deliverable
    aliases: list[str] = field(default_factory=list)
    attributes: dict[str, Any] = field(default_factory=dict)
    embedding: list[float] = field(default_factory=list)


@dataclass(slots=True)
class KnowledgeEdgeIR:
    from_entity: str
    to_entity: str
    relation_type: str
    confidence: float
    valid_from: str
    evidence_utterance_id: str = ""


@dataclass(slots=True)
class ExtractedKnowledgeIR:
    entities: list[KnowledgeEntityIR] = field(default_factory=list)
    edges: list[KnowledgeEdgeIR] = field(default_factory=list)


@dataclass(slots=True)
class ReasoningResultIR:
    finding_id: str
    finding_type: str  # contradiction | negotiation_shift | causal_link | temporal_change | uncertainty
    severity: str  # low | medium | high | critical
    title: str
    explanation: str
    confidence: float
    evidence_utterance_ids: list[str] = field(default_factory=list)


@dataclass(slots=True)
class SourceEvidenceRef:
    ref_id: str
    target_kind: str
    target_id: str
    utterance_id: str
    speaker_label: str
    start_ms: int
    end_ms: int
    quote: str
    confidence: float


@dataclass(slots=True)
class ActionSuggestionIR:
    action_id: str
    action_type: str  # note | reminder | task | calendar_event | follow_up
    title: str
    rationale: str
    confidence: float
    requires_approval: bool = True
    status: str = "suggested"
    payload: dict[str, Any] = field(default_factory=dict)
    evidence_refs: list[SourceEvidenceRef] = field(default_factory=list)


@dataclass(slots=True)
class HumanCorrectionIR:
    correction_id: str
    target_type: str
    target_id: str
    original_value: str
    corrected_value: str
    reason: str
    created_at: str


@dataclass(slots=True)
class ModelTelemetryIR:
    stage: str
    adapter_name: str
    routing_reason: str
    fallback_used: bool
    latency_ms: float
    confidence: float
    cost_units: float


@dataclass(slots=True)
class ConversationIR:
    conversation_id: str
    user_id: str
    title: str
    summary: str
    status: str
    primary_language: str
    detected_languages: list[str]
    topics: list[str]
    overall_confidence: float
    confidence_tier: str
    recording: RecordingIR
    participants: list[ParticipantIR] = field(default_factory=list)
    utterances: list[UtteranceIR] = field(default_factory=list)
    conversation_events: list[ConversationEventIR] = field(default_factory=list)
    extracted_knowledge: ExtractedKnowledgeIR = field(default_factory=ExtractedKnowledgeIR)
    reasoning_results: list[ReasoningResultIR] = field(default_factory=list)
    action_suggestions: list[ActionSuggestionIR] = field(default_factory=list)
    human_corrections: list[HumanCorrectionIR] = field(default_factory=list)
    source_evidence_refs: list[SourceEvidenceRef] = field(default_factory=list)
    model_telemetry: list[ModelTelemetryIR] = field(default_factory=list)
    interaction_edges: list[InteractionEdgeIR] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
