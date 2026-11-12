"""NEXORA Voice Intelligence Engine — Orchestrates all 10 Workstreams on Conversation IR."""

from __future__ import annotations

from collections import deque
from datetime import datetime, timezone
from typing import Any
import uuid

from nexora.voice.audio_pipeline import analyze_audio_payload
from nexora.voice.ir import (
    ConversationIR,
    IntegrityMetadata,
    RecordingIR,
)
from nexora.voice.speech_engine import (
    JEDISSpeakerPromptCache,
    VoiceModelRouter,
    detect_utterance_language,
)
from nexora.voice.understanding_engine import (
    analyze_conversation,
    answer_grounded_question,
    cosine_similarity,
    deterministic_embedding,
)


class StreamingCallSession:
    """Maintains live background call / meeting state across rolling chunks."""

    def __init__(
        self,
        session_id: str,
        user_id: str,
        title: str,
        capture_mode: str,
        source_type: str,
        language: str,
        consent_granted: bool,
    ) -> None:
        self.session_id = session_id
        self.conversation_id = session_id
        self.recording_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"rec:{session_id}"))
        self.user_id = user_id
        self.title = title
        self.capture_mode = capture_mode  # foreground_mic | background_service_mic | call_dual_track | meeting_stream
        self.source_type = source_type
        self.language = language
        self.consent_granted = consent_granted
        self.state = "active"  # active | paused | background | finalized
        self.created_at = datetime.now(timezone.utc).isoformat()
        self.updated_at = self.created_at
        self.speaker_cache = JEDISSpeakerPromptCache()
        self.processed_chunk_seqs: set[int] = set()
        self.utterances: list[Any] = []
        self.last_ir: dict[str, Any] | None = None


class VoiceIntelligenceNetwork:
    """Unified 10-workstream Voice Intelligence pipeline producing Conversation IR."""

    def __init__(self) -> None:
        self.model_router = VoiceModelRouter()
        self.memory_store: deque[dict[str, Any]] = deque(maxlen=200)
        self.sessions: dict[str, StreamingCallSession] = {}

    def analyze_audio(self, payload: dict[str, Any]) -> dict[str, Any]:
        meta, quality, telemetry = analyze_audio_payload(payload)
        return {
            "audio_metadata": meta,
            "quality_report": {
                "quality_score": quality.quality_score,
                "snr_db": quality.snr_db,
                "clipping_ratio": quality.clipping_ratio,
                "speech_ratio": quality.speech_ratio,
                "noise_floor_dbfs": quality.noise_floor_dbfs,
                "routing_strategy": quality.routing_strategy,
                "warnings": quality.warnings,
                "vad_segments": [
                    {
                        "start_ms": s.start_ms,
                        "end_ms": s.end_ms,
                        "energy_dbfs": s.energy_dbfs,
                        "speech_prob": s.speech_prob,
                    }
                    for s in quality.vad_segments
                ],
            },
            "telemetry": {
                "stage": telemetry.stage,
                "adapter_name": telemetry.adapter_name,
                "routing_reason": telemetry.routing_reason,
                "fallback_used": telemetry.fallback_used,
                "latency_ms": telemetry.latency_ms,
                "confidence": telemetry.confidence,
                "cost_units": telemetry.cost_units,
            },
        }

    def process_conversation(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Execute Layer 1 -> Layer 4 pipeline and return canonical Conversation IR."""
        user_id = str(payload.get("user_id") or "00000000-0000-0000-0000-000000000000")
        conv_id = str(payload.get("conversation_id") or uuid.uuid4())
        rec_id = str(payload.get("recording_id") or uuid.uuid4())
        title = str(payload.get("title") or "Voice Conversation").strip()
        source_type = str(payload.get("source_type") or "mobile_mic")
        consent_granted = bool(payload.get("consent_granted", True))

        # Workstream 2: Audio Intelligence
        meta, quality, audio_tel = analyze_audio_payload(payload)

        # Workstream 3 & 10: Speech & Model Routing Intelligence
        speaker_cache = JEDISSpeakerPromptCache()
        speech_payload = dict(payload)
        if meta.get("segment_fingerprints") and "segment_fingerprints" not in speech_payload:
            speech_payload["segment_fingerprints"] = meta["segment_fingerprints"]
        utterances, participants, speech_tel = self.model_router.run_speech_stage(
            payload=speech_payload,
            recording_id=rec_id,
            duration_ms=meta["duration_ms"],
            quality=quality,
            speaker_cache=speaker_cache,
        )

        # Language summary
        langs: list[str] = []
        for u in utterances:
            if u.language not in langs:
                langs.append(u.language)
        if not langs:
            langs = [detect_utterance_language(title, hint=str(payload.get("language") or "en"))]

        # Workstreams 4, 5, 6, 7, 8: Understanding, Reasoning, Memory, Actions, Verification
        analyzed = analyze_conversation(
            conversation_id=conv_id,
            utterances=utterances,
            participants_names=[p.display_name for p in participants],
            participants=participants,
        )

        recording = RecordingIR(
            recording_id=rec_id,
            source_type=source_type,
            mime_type=meta["mime_type"],
            sample_rate_hz=meta["sample_rate_hz"],
            channels=meta["channels"],
            duration_ms=meta["duration_ms"],
            byte_size=meta["byte_size"],
            storage_uri=str(payload.get("storage_uri") or f"s3://nexora-voice-vault/{user_id}/{rec_id}.enc"),
            quality_report=quality,
            integrity=IntegrityMetadata(
                sha256_original=meta["sha256_original"],
                hmac_seal=str(payload.get("hmac_seal") or ""),
                encryption_key_version=1,
                legal_hold=bool(payload.get("legal_hold", False)),
                consent_granted=consent_granted,
                consent_scope=str(payload.get("consent_scope") or "voice.capture"),
            ),
            audio_metadata=meta,
        )

        ir = ConversationIR(
            conversation_id=conv_id,
            user_id=user_id,
            title=title,
            summary=analyzed["summary"],
            status="understood",
            primary_language=langs[0],
            detected_languages=langs,
            topics=analyzed["topics"],
            overall_confidence=analyzed["overall_confidence"],
            confidence_tier=analyzed["confidence_tier"],
            recording=recording,
            participants=participants,
            utterances=utterances,
            conversation_events=analyzed["events"],
            extracted_knowledge=analyzed["knowledge"],
            reasoning_results=analyzed["findings"],
            action_suggestions=analyzed["actions"],
            human_corrections=[],
            source_evidence_refs=analyzed["evidence_refs"],
            model_telemetry=[audio_tel, speech_tel, analyzed["telemetry"]],
            interaction_edges=analyzed["interaction_edges"],
        )
        ir_dict = ir.to_dict()

        # Index in-memory for subsequent hybrid search & Q&A
        self._upsert_memory(ir_dict)
        return ir_dict

    def _upsert_memory(self, ir_dict: dict[str, Any]) -> None:
        cid = ir_dict.get("conversation_id")
        filtered = [item for item in self.memory_store if item.get("conversation_id") != cid]
        self.memory_store.clear()
        self.memory_store.extend(filtered)
        self.memory_store.append(ir_dict)

    def search_memory(self, query: str, conversations: list[dict[str, Any]] | None = None, limit: int = 8) -> dict[str, Any]:
        pool = conversations if conversations is not None else list(self.memory_store)
        q_clean = query.strip().lower()
        q_vec = deterministic_embedding(q_clean)
        matches: list[dict[str, Any]] = []
        for conv in pool:
            cid = conv.get("conversation_id", "")
            title = conv.get("title", "")
            for utt in conv.get("utterances") or []:
                txt = str(utt.get("original_text") or "")
                lex = 1.0 if q_clean and q_clean in txt.lower() else 0.0
                sem = max(0.0, cosine_similarity(q_vec, deterministic_embedding(txt)))
                score = round(0.55 * lex + 0.45 * sem, 4)
                if score > 0.12 or not q_clean:
                    matches.append(
                        {
                            "conversation_id": cid,
                            "conversation_title": title,
                            "utterance_id": utt.get("utterance_id"),
                            "speaker_label": utt.get("speaker_label"),
                            "start_ms": utt.get("start_ms", 0),
                            "end_ms": utt.get("end_ms", 0),
                            "text": txt,
                            "score": score,
                        }
                    )
        matches.sort(key=lambda m: m["score"], reverse=True)
        return {"query": query, "count": len(matches[:limit]), "results": matches[:limit]}

    def answer_qa(self, question: str, conversations: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        pool = conversations if conversations is not None else list(self.memory_store)
        return answer_grounded_question(question, pool)

    def model_benchmarks(self) -> dict[str, Any]:
        return self.model_router.benchmark_summary()

    # =========================================================================
    # STREAMING BACKGROUND / CALL SESSION LIFECYCLE
    # =========================================================================
    def start_session(self, payload: dict[str, Any]) -> dict[str, Any]:
        sid = str(payload.get("session_id") or uuid.uuid4())
        sess = StreamingCallSession(
            session_id=sid,
            user_id=str(payload.get("user_id") or "00000000-0000-0000-0000-000000000000"),
            title=str(payload.get("title") or "Live Call / Voice Session"),
            capture_mode=str(payload.get("capture_mode") or "call_dual_track"),
            source_type=str(payload.get("source_type") or "call"),
            language=str(payload.get("language") or "en"),
            consent_granted=bool(payload.get("consent_granted", True)),
        )
        self.sessions[sid] = sess
        return {
            "session_id": sess.session_id,
            "conversation_id": sess.conversation_id,
            "state": sess.state,
            "capture_mode": sess.capture_mode,
            "chunk_count": 0,
            "os_capture_notes": self._os_capture_guidance(sess.capture_mode),
        }

    def ingest_session_chunk(self, session_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        sess = self.sessions.get(session_id)
        if sess is None:
            self.start_session({"session_id": session_id, **payload})
            sess = self.sessions[session_id]

        seq = int(payload.get("chunk_seq", len(sess.processed_chunk_seqs)))
        if seq in sess.processed_chunk_seqs and sess.last_ir is not None:
            return {"deduplicated": True, "session_id": session_id, "state": sess.state, "ir": sess.last_ir}

        sess.processed_chunk_seqs.add(seq)
        if payload.get("in_background"):
            sess.state = "background"

        meta, quality, audio_tel = analyze_audio_payload(payload)
        speech_payload = dict(payload)
        if meta.get("segment_fingerprints") and "segment_fingerprints" not in speech_payload:
            speech_payload["segment_fingerprints"] = meta["segment_fingerprints"]

        chunk_utts, _, speech_tel = self.model_router.run_speech_stage(
            payload=speech_payload,
            recording_id=sess.recording_id,
            duration_ms=meta["duration_ms"],
            quality=quality,
            speaker_cache=sess.speaker_cache,
        )
        offset_ms = sess.utterances[-1].end_ms if sess.utterances else 0
        for u in chunk_utts:
            u.seq_index = len(sess.utterances)
            if u.start_ms < offset_ms:
                shift = offset_ms
                u.start_ms += shift
                u.end_ms += shift
                for wt in u.word_timestamps:
                    wt.start_ms += shift
                    wt.end_ms += shift
            sess.utterances.append(u)

        participants = sess.speaker_cache.export_participants()
        analyzed = analyze_conversation(
            conversation_id=sess.conversation_id,
            utterances=sess.utterances,
            participants_names=[p.display_name for p in participants],
            participants=participants,
        )
        langs = []
        for u in sess.utterances:
            if u.language not in langs:
                langs.append(u.language)

        total_dur = sess.utterances[-1].end_ms if sess.utterances else meta["duration_ms"]
        ir = ConversationIR(
            conversation_id=sess.conversation_id,
            user_id=sess.user_id,
            title=sess.title,
            summary=analyzed["summary"],
            status="analyzing" if sess.state != "finalized" else "understood",
            primary_language=langs[0] if langs else sess.language,
            detected_languages=langs or [sess.language],
            topics=analyzed["topics"],
            overall_confidence=analyzed["overall_confidence"],
            confidence_tier=analyzed["confidence_tier"],
            recording=RecordingIR(
                recording_id=sess.recording_id,
                source_type=sess.source_type,
                mime_type=meta["mime_type"],
                sample_rate_hz=meta["sample_rate_hz"],
                channels=meta["channels"],
                duration_ms=total_dur,
                byte_size=meta["byte_size"],
                storage_uri=f"s3://nexora-voice-vault/{sess.user_id}/{sess.recording_id}.enc",
                quality_report=quality,
                integrity=IntegrityMetadata(
                    sha256_original=meta["sha256_original"],
                    consent_granted=sess.consent_granted,
                ),
                audio_metadata=meta,
            ),
            participants=participants,
            utterances=sess.utterances,
            conversation_events=analyzed["events"],
            extracted_knowledge=analyzed["knowledge"],
            reasoning_results=analyzed["findings"],
            action_suggestions=analyzed["actions"],
            human_corrections=[],
            source_evidence_refs=analyzed["evidence_refs"],
            model_telemetry=[audio_tel, speech_tel, analyzed["telemetry"]],
            interaction_edges=analyzed["interaction_edges"],
        )
        sess.last_ir = ir.to_dict()
        sess.updated_at = datetime.now(timezone.utc).isoformat()
        self._upsert_memory(sess.last_ir)
        return {
            "deduplicated": False,
            "session_id": session_id,
            "state": sess.state,
            "chunk_count": len(sess.processed_chunk_seqs),
            "ir": sess.last_ir,
        }

    def finalize_session(self, session_id: str) -> dict[str, Any] | None:
        sess = self.sessions.get(session_id)
        if sess is None:
            return None
        sess.state = "finalized"
        if sess.last_ir is not None:
            sess.last_ir["status"] = "understood"
            self._upsert_memory(sess.last_ir)
        return {
            "session_id": session_id,
            "state": sess.state,
            "chunk_count": len(sess.processed_chunk_seqs),
            "ir": sess.last_ir,
        }

    @staticmethod
    def _os_capture_guidance(mode: str) -> str:
        if mode == "background_service_mic":
            return "Android Foreground Microphone Service / iOS active AVAudioSession with visible indicator."
        if mode == "call_dual_track":
            return "VoIP/CallKit dual-track or speaker-separated stream; cellular PSTN downlink cannot be tapped stealthily by OS rules."
        return "Foreground microphone or uploaded recording stream."
