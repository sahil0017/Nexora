"""Unit tests for the NEXORA Voice Intelligence Platform (10 Workstreams + Conversation IR)."""

from __future__ import annotations

import base64
import io
import math
import struct
import unittest
import wave

from nexora.inference.api import (
    events_status,
    ingest_event,
    voice_audio_analyze,
    voice_conversation_process,
    voice_memory_search,
    voice_models_benchmarks,
    voice_qa,
    voice_session_chunk,
    voice_session_finalize,
    voice_session_start,
)


def _make_test_wav_b64(duration_sec: float = 0.6, sample_rate: int = 16000) -> str:
    buf = io.BytesIO()
    n_samples = int(duration_sec * sample_rate)
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        frames = bytearray()
        for i in range(n_samples):
            # Alternate active speech-like tone burst and quiet noise floor for VAD detection
            if 0.1 * sample_rate <= i <= 0.45 * sample_rate:
                val = int(12000 * math.sin(2.0 * math.pi * 440.0 * (i / sample_rate)))
            else:
                val = int(40 * math.sin(2.0 * math.pi * 60.0 * (i / sample_rate)))
            frames.extend(struct.pack("<h", val))
        wf.writeframes(bytes(frames))
    return base64.b64encode(buf.getvalue()).decode("ascii")


class TestVoiceIntelligence(unittest.TestCase):
    def test_audio_pipeline_wav_vad_and_quality_routing(self) -> None:
        wav_b64 = _make_test_wav_b64()
        clean = voice_audio_analyze({"audio_base64": wav_b64})
        self.assertGreater(clean["quality_report"]["quality_score"], 75.0)
        self.assertEqual(clean["quality_report"]["routing_strategy"], "direct_asr")
        self.assertGreaterEqual(len(clean["quality_report"]["vad_segments"]), 1)
        self.assertEqual(len(clean["audio_metadata"]["sha256_original"]), 64)

        noisy = voice_audio_analyze({"snr_db": 5.5, "transcript_text": "Hello team"})
        self.assertEqual(noisy["quality_report"]["routing_strategy"], "low_snr_fallback")

    def test_full_conversation_ir_ten_workstreams(self) -> None:
        ir = voice_conversation_process(
            {
                "title": "Vendor Pricing & Timeline Review",
                "source_type": "meeting",
                "snr_db": 18.0,
                "overlap_suspected": True,
                "transcript_text": "\n".join(
                    [
                        "Sahil: Can we finalize the deployment timeline today?",
                        "Ananya: The quote is Rs. 5,00,000, but we propose Rs. 4,20,000 because the SDK is ready.",
                        "Vikram: I disagree with launching on Monday due to pending QA.",
                        "Sahil: Agreed. I will share the signed scope by Friday.",
                        "Riya: Kal 5 baje sync kar sakte hain?",
                    ]
                ),
            }
        )

        # Layer 1 & 2: Recording separated from utterances
        self.assertEqual(ir["recording"]["quality_report"]["routing_strategy"], "overlap_aware_diarize")
        self.assertTrue(ir["recording"]["integrity"]["sha256_original"])

        # Layer 3: Speaker-attributed utterances with word timestamps + multilingual code-switch
        self.assertEqual(len(ir["participants"]), 4)
        self.assertEqual(len(ir["utterances"]), 5)
        self.assertIn("en-hi", ir["detected_languages"])
        self.assertGreater(len(ir["utterances"][0]["word_timestamps"]), 0)

        # Workstream 4: Conversation events (question, proposal, disagreement, decision/commitment)
        ev_types = {e["event_type"] for e in ir["conversation_events"]}
        self.assertIn("question", ev_types)
        self.assertIn("proposal", ev_types)
        self.assertIn("disagreement", ev_types)

        # Workstream 5: Reasoning findings (negotiation shift + contradiction + causal + date shift)
        finding_types = {f["finding_type"] for f in ir["reasoning_results"]}
        self.assertIn("negotiation_shift", finding_types)
        self.assertIn("contradiction", finding_types)
        self.assertIn("causal_link", finding_types)

        # Workstream 6 & 7: Knowledge graph + human-in-the-loop actions
        self.assertGreaterEqual(len(ir["extracted_knowledge"]["entities"]), 4)
        self.assertGreaterEqual(len(ir["action_suggestions"]), 2)
        self.assertTrue(all(a["requires_approval"] for a in ir["action_suggestions"]))

        # Workstream 6 & 8: Hybrid memory search & grounded Q&A
        search_res = voice_memory_search({"query": "signed scope", "conversations": [ir]})
        self.assertGreaterEqual(search_res["count"], 1)

        qa_hit = voice_qa({"question": "What quote did Ananya propose?", "conversations": [ir]})
        self.assertNotEqual(qa_hit["confidence_tier"], "INSUFFICIENT_DATA")
        self.assertGreaterEqual(len(qa_hit["citations"]), 1)

        qa_miss = voice_qa({"question": "What is the weather on Mars?", "conversations": [ir]})
        self.assertEqual(qa_miss["confidence_tier"], "INSUFFICIENT_DATA")
        self.assertEqual(len(qa_miss["citations"]), 0)

        # Workstream 10: Model intelligence benchmarks
        bench = voice_models_benchmarks()
        self.assertGreaterEqual(bench["total_runs"], 1)
        self.assertEqual(len(bench["registered_adapters"]), 2)

    def test_voice_outbox_event_ingestion(self) -> None:
        res = ingest_event(
            {
                "event_id": "evt-voice-001",
                "event_type": "voice.conversation.understood.v1",
                "schema_version": 1,
                "occurred_at": "2026-11-12T11:00:00Z",
                "producer": "nexora-api",
                "payload": {"conversation_id": "22222222-2222-2222-2222-222222222201"},
            }
        )
        self.assertEqual(res["accepted"], 1)
        status = events_status()
        self.assertGreaterEqual(status["voice_events_count"], 1)

    def test_acoustic_speaker_clustering_self_intro_and_who_to_whom(self) -> None:
        # Two distinct frequency bursts (300 Hz low voice vs 1600 Hz high voice) in WAV PCM without speaker labels
        buf = io.BytesIO()
        sample_rate = 16000
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            frames = bytearray()
            total = int(0.8 * sample_rate)
            for i in range(total):
                if 0.05 * sample_rate <= i <= 0.30 * sample_rate:
                    val = int(11000 * math.sin(2.0 * math.pi * 300.0 * (i / sample_rate)))
                elif 0.45 * sample_rate <= i <= 0.72 * sample_rate:
                    val = int(12000 * math.sin(2.0 * math.pi * 1600.0 * (i / sample_rate)))
                else:
                    val = 15
                frames.extend(struct.pack("<h", val))
            wf.writeframes(bytes(frames))
        audio_b64 = base64.b64encode(buf.getvalue()).decode("ascii")

        # Unlabeled text where voices introduce themselves dynamically and address each other
        ir = voice_conversation_process(
            {
                "conversation_id": "22222222-2222-2222-2222-222222222202",
                "title": "Dynamic Speaker Clustering Test",
                "audio_base64": audio_b64,
                "transcript_text": (
                    "Hi, I'm Sahil. Ananya, can you approve the revised architecture today?\n"
                    "Hi, I'm Ananya. Actually let's counter-propose Friday instead because QA needs buffer."
                ),
            }
        )
        utts = ir["utterances"]
        self.assertEqual(len(utts), 2)
        self.assertNotEqual(utts[0]["speaker_label"], utts[1]["speaker_label"])
        names = {p["display_name"] for p in ir["participants"]}
        self.assertIn("Sahil", names)
        self.assertIn("Ananya", names)
        self.assertEqual(utts[0]["addressing_mode"], "direct_vocative")
        self.assertIn("SPK_02", utts[0]["to_speakers"])
        self.assertEqual(utts[1]["addressing_mode"], "counter_offer")
        self.assertTrue(bool(utts[1]["what_is_spoken"]))
        self.assertGreaterEqual(len(ir["interaction_edges"]), 2)

    def test_streaming_background_call_session_and_deduplication(self) -> None:
        started = voice_session_start(
            {
                "title": "Background Client Call",
                "capture_mode": "background_service_mic",
                "source_type": "call",
                "consent_granted": True,
            }
        )
        sess_id = started["session_id"]
        self.assertEqual(started["capture_mode"], "background_service_mic")
        self.assertIn("Foreground", started["os_capture_notes"])

        c1 = voice_session_chunk(
            sess_id,
            {
                "chunk_seq": 1,
                "channel_hint": "local_mic",
                "in_background": True,
                "duration_ms": 3500,
                "transcript_text": "Hi, I'm Sahil. Priya, we need the signed MSA today.",
            },
        )
        self.assertFalse(c1["deduplicated"])
        self.assertEqual(c1["state"], "background")
        self.assertEqual(c1["chunk_count"], 1)

        # Re-sending same chunk_seq is idempotent
        dup = voice_session_chunk(
            sess_id,
            {
                "chunk_seq": 1,
                "channel_hint": "local_mic",
                "in_background": True,
                "duration_ms": 3500,
                "transcript_text": "duplicate",
            },
        )
        self.assertTrue(dup["deduplicated"])

        c2 = voice_session_chunk(
            sess_id,
            {
                "chunk_seq": 2,
                "channel_hint": "remote_track",
                "in_background": True,
                "duration_ms": 4000,
                "transcript_text": "Hi, I'm Priya. Sahil, I agree to deliver the MSA tomorrow.",
            },
        )
        ir = c2["ir"]
        self.assertEqual(len(ir["utterances"]), 2)
        self.assertGreaterEqual(ir["utterances"][1]["start_ms"], 3500)
        self.assertGreaterEqual(len(ir["interaction_edges"]), 1)

        fin = voice_session_finalize(sess_id)
        self.assertEqual(fin["state"], "finalized")
        self.assertEqual(fin["ir"]["status"], "understood")

    def test_no_greeting_truecaller_caller_identification(self) -> None:
        ir = voice_conversation_process(
            {
                "conversation_id": "22222222-2222-2222-2222-222222222203",
                "title": "Inbound Truecaller Call (No Greeting)",
                "source_type": "call",
                "caller_identity": {
                    "caller_name": "Vikram Patel",
                    "caller_source": "truecaller",
                    "caller_confidence": 0.92,
                    "phone_masked": "+91******4210",
                    "call_direction": "inbound",
                },
                "turns": [
                    {"channel_hint": "remote_track", "text": "Send the revised invoice by 5 PM today."},
                    {"channel_hint": "local_mic", "text": "Confirmed, I will email it right after this call."},
                ],
            }
        )
        names = {p["display_name"] for p in ir["participants"]}
        self.assertIn("Vikram Patel", names)
        self.assertTrue(any(e["from_name"] == "Vikram Patel" for e in ir["interaction_edges"]))


if __name__ == "__main__":
    unittest.main()
