# NEXORA Voice Intelligence Platform — Technical Architecture & 10-Workstream Programme

> **10 Engineering Workstreams · 4 Architectural Layers · 1 Canonical Conversation IR**

This document specifies the **NEXORA Voice Intelligence** module implemented across PostgreSQL (`0007_voice_intelligence`), Go Control Plane (`platform/api/internal/modules/voice`), Python Intelligence Service (`intelligence/ml-platform/src/nexora/voice`), Event Contracts (`contracts/`), and React Native / Web UX (`apps/mobile/src/features/voice`).

---

## 1. Core Architectural Invariant

Original audio, raw transcripts, structured interpretations, and verified human-corrected records are **strictly separate data objects**:

1. **Original Audio (`voice.recordings` / `RecordingIR`)** — Preserves capture source, sample rate, VAD/SNR quality report, encryption key version, consent state, SHA-256 original digest, HMAC seal, and legal hold flag.
2. **Raw Transcript (`voice.utterances` / `UtteranceIR`)** — Immutable speaker-attributed turns with TagSpeech-style word timestamps, language tags, acoustic confidence, overlap flags, and uncertainty reasons.
3. **Structured Interpretation (`voice.conversation_events`, `voice.reasoning_findings`, `voice.knowledge_*`)** — Topics, dialogue acts, decisions, commitments, contradictions, negotiation shifts, causal rationales, and temporal knowledge graph triples.
4. **Verified Facts & Human Corrections (`voice.human_corrections`, `voice.evidence_records`, `voice.custody_events`)** — Immutable correction log and tamper-evident hash-chained custody log; human edits never silently overwrite raw audio or ASR outputs.

---

## 2. Ten Workstreams Mapped to Implementation

| Workstream | Engineering Scope | Implemented Components |
|---|---|---|
| **1. Capture Intelligence** | Audio capture, imports, consent gating, metadata | `POST /api/v1/voice/conversations/{capture,import}`, `voiceMicCapture` privacy permission |
| **2. Audio Intelligence** | WAV/PCM validation, VAD, SNR, clipping, quality-aware routing | [`audio_pipeline.py`](../../intelligence/ml-platform/src/nexora/voice/audio_pipeline.py) (`direct_asr`, `denoise_then_asr`, `overlap_aware_diarize`, `low_snr_fallback`) |
| **3. Speech Intelligence** | Word-level alignment, speaker cache, overlap & multilingual EN/HI/TE | [`speech_engine.py`](../../intelligence/ml-platform/src/nexora/voice/speech_engine.py) (`JEDISSpeakerPromptCache`, `TagSpeechBaselineAdapter`, `DiarizationGuidedMultilingualAdapter`) |
| **4. Conversation Intelligence** | Topics, dialogue acts, intents, requests/decisions/commitments | [`understanding_engine.py`](../../intelligence/ml-platform/src/nexora/voice/understanding_engine.py) (`ConversationEventIR`) |
| **5. Reasoning Intelligence** | Contradictions, negotiation shifts, causality, timeline shifts, uncertainty | `ReasoningResultIR` extractor in `understanding_engine.py` |
| **6. Memory Intelligence** | Entity resolution, temporal KG triples, hybrid lexical + dense vector search | `voice.knowledge_entities`, `voice.knowledge_edges`, `GET /api/v1/voice/memory/search` |
| **7. Action Intelligence** | Notes, reminders, tasks, follow-ups with Human-in-the-Loop approval | `voice.action_suggestions`, `POST /api/v1/voice/actions/{id}/decide` |
| **8. Verification Intelligence** | Source grounding (`SourceEvidenceRef`), confidence calibration, human corrections | `POST /api/v1/voice/qa`, `POST /api/v1/voice/conversations/{id}/corrections` |
| **9. Evidence Intelligence** | SHA-256 + HMAC seal, utterance Merkle root, hash-chained custody, legal hold, export | [`crypto.go`](../../platform/api/internal/modules/voice/crypto.go), `GET /api/v1/voice/evidence/{id}/export`, `POST /api/v1/voice/evidence/{id}/legal-hold` |
| **10. Model Intelligence** | Replaceable adapters, quality-aware routing, latency/cost telemetry | `VoiceModelRouter`, `voice.model_telemetry`, `GET /api/v1/voice/models/status` |

---

## 3. Research-Driven Design Translation

- **TagSpeech (ACL 2026)**: Every word carries explicit `(start_ms, end_ms, speaker_label, confidence)` temporal grounding in `WordTimestamp`.
- **JEDIS-LLM (2025)**: `JEDISSpeakerPromptCache` preserves speaker attribution, display names, roles, and talk-time state across conversation chunks.
- **CHiME-7/8 Review (2026)**: `analyze_audio_payload` routes clean audio through `direct_asr` (avoiding enhancement artifacts) and noisy/overlapping audio through `denoise_then_asr`, `overlap_aware_diarize`, or `low_snr_fallback`.
- **Multilingual & Diarization-Guided ASR (2026)**: Language-aware detection handles `en`, `hi`, `te`, and code-switched `en-hi` / `en-te` turns with replaceable adapters.

---

## 4. Background Call Capture & OS Constraints

- **Android (`background_service_mic`)**: Supports continuous background capture via an explicit Android Foreground Service (`FOREGROUND_SERVICE_MICROPHONE`) with a persistent OS notification. Third-party silent `VOICE_CALL` cellular PSTN tapping is blocked by Android OS security policies; supported calls use dual-track VoIP/meeting streams or user-consented speaker/mic capture.
- **iOS (`foreground_mic` / `call_dual_track`)**: Supports background audio continuation with `UIBackgroundModes: audio` and an active `AVAudioSession` (the OS always shows an orange microphone indicator), or CallKit/VoIP dual-track streams and user-initiated imported recordings.
- **Web (`meeting_stream` / `foreground_mic`)**: Uses browser `MediaRecorder` while the tab has permission and remains active.
- **Streaming Session Protocol**: `POST /api/v1/voice/sessions/start` → idempotent `POST /api/v1/voice/sessions/{id}/chunk` (`chunk_seq`, `in_background`, `channel_hint`: `local_mic` | `remote_track` | `mixed_room`) → `POST /api/v1/voice/sessions/{id}/state` → `POST /api/v1/voice/sessions/{id}/finalize`.

---

## 5. Dynamic "Who Is Speaking to Whom & What" Resolution

1. **Acoustic & Channel Diarization**: When speaker labels are absent, [`JEDISSpeakerPromptCache`](../../intelligence/ml-platform/src/nexora/voice/speech_engine.py) combines `channel_hint` (`local_mic` / `remote_track`) with per-VAD-segment ZCR pitch + energy dBFS fingerprints from [`audio_pipeline.py`](../../intelligence/ml-platform/src/nexora/voice/audio_pipeline.py) to assign consistent speaker IDs across chunks.
2. **Dynamic Self-Intro Name Binding**: Phrases such as `"Hi, I'm Ananya"` bind the speaker's `display_name` dynamically in the JEDIS speaker cache so subsequent turns retain identity.
3. **Addressee & Intent Extraction**: `resolve_interaction_dynamics` (Python) and `ResolveGoInteractionDynamics` (Go fallback) populate `to_speakers`, `addressing_mode` (`direct_vocative`, `counter_offer`, `reply_to_previous`, `group_broadcast`), `addressed_utterance_id`, `what_is_spoken`, and aggregated `interaction_edges` on `ConversationIR`.

---

## 6. ₹0 Native Caller Intelligence & Presigned S3 Storage

- **Free Native OS Caller ID**:
  - **Android**: [`NexoraCallScreeningService.kt`](../../apps/mobile/native/android/NexoraCallScreeningService.kt) + [`NexoraCallerIdModule.kt`](../../apps/mobile/native/android/NexoraCallerIdModule.kt) screen incoming numbers via `CallScreeningService`, hash numbers locally (`SHA-256`), and check `voice.caller_directory` without paid third-party SDKs.
  - **iOS**: [`NexoraCallDirectoryHandler.swift`](../../apps/mobile/native/ios/NexoraCallDirectoryHandler.swift) + [`NexoraCallerIdBridge.swift`](../../apps/mobile/native/ios/NexoraCallerIdBridge.swift) preload synced caller & spam lists into `CXCallDirectoryProvider` via App Groups.
- **8 Caller Intelligence Signals**: Caller Context (prior interactions), Business Intelligence (category/org/purpose), Spam Pattern Intelligence (frequency + user reports), Relationship Context, Unknown Caller post-call classification, Conversation Linking, Call Timeline (`GET /api/v1/voice/caller/timeline`), and Identity Conflict Detection (`observed_identities`, `identity_conflict`).
- **Presigned S3 Recording Flow**: [`s3_presign.go`](../../platform/api/internal/modules/voice/s3_presign.go) issues AWS SigV4 PUT/GET URLs (with signed local dev fallback when S3 env vars are unset), reserving and linking `s3_bucket`, `s3_object_key`, `s3_presigned_status`, `s3_etag`, and `sha256_original` inside `voice.recordings`.
