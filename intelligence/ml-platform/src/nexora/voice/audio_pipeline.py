"""Workstream 2 — Audio Intelligence Pipeline.

Performs audio validation, WAV/PCM decoding, Voice Activity Detection (VAD),
SNR estimation, clipping detection, quality scoring, and CHiME-7/8-informed
quality-aware routing (avoiding destructive enhancement on already-clean audio
or forcing heavy fallback when SNR / overlap degrades).
"""

from __future__ import annotations

import base64
import hashlib
import io
import math
import struct
import time
import wave
from typing import Any

from nexora.voice.ir import AudioQualityReport, ModelTelemetryIR, VadSegment


def _decode_wav_pcm16(raw_bytes: bytes) -> tuple[list[float], int, int]:
    """Decode WAV bytes into normalized [-1.0, 1.0] mono float samples."""
    with wave.open(io.BytesIO(raw_bytes), "rb") as wf:
        sample_rate = wf.getframerate() or 16000
        channels = wf.getnchannels() or 1
        sampwidth = wf.getsampwidth()
        n_frames = wf.getnframes()
        frames = wf.readframes(n_frames)
    if sampwidth != 2 or not frames:
        return [], sample_rate, channels
    count = len(frames) // 2
    ints = struct.unpack(f"<{count}h", frames[: count * 2])
    if channels > 1:
        mono = [
            sum(ints[i : i + channels]) / (channels * 32768.0)
            for i in range(0, len(ints) - channels + 1, channels)
        ]
    else:
        mono = [x / 32768.0 for x in ints]
    return mono, sample_rate, channels


def _analyze_pcm_samples(samples: list[float], sample_rate_hz: int) -> dict[str, Any]:
    """Compute energy frames, VAD segments, SNR, clipping, and noise floor."""
    if not samples:
        return {
            "duration_ms": 0,
            "snr_db": 18.0,
            "clipping_ratio": 0.0,
            "speech_ratio": 0.0,
            "noise_floor_dbfs": -55.0,
            "vad_segments": [],
        }

    frame_len = max(1, int(sample_rate_hz * 0.02))  # 20 ms frames
    frame_rms: list[float] = []
    clipped = 0
    for s in samples:
        if abs(s) >= 0.99:
            clipped += 1
    clipping_ratio = round(clipped / max(1, len(samples)), 5)

    for i in range(0, len(samples), frame_len):
        chunk = samples[i : i + frame_len]
        rms = math.sqrt(sum(x * x for x in chunk) / max(1, len(chunk)))
        frame_rms.append(rms)

    sorted_rms = sorted(frame_rms)
    noise_rms = max(1e-6, sorted_rms[max(0, int(0.15 * len(sorted_rms)))])
    peak_rms = max(1e-6, sorted_rms[max(0, int(0.95 * len(sorted_rms)))])
    snr_db = round(max(-5.0, min(45.0, 20.0 * math.log10(peak_rms / noise_rms))), 2)
    noise_floor_dbfs = round(max(-90.0, 20.0 * math.log10(noise_rms)), 2)

    vad_threshold = max(noise_rms * 2.2, 0.015)
    vad_segments: list[VadSegment] = []
    in_speech = False
    seg_start_idx = 0
    seg_energies: list[float] = []
    speech_frames = 0

    for idx, rms in enumerate(frame_rms):
        is_speech = rms >= vad_threshold
        if is_speech:
            speech_frames += 1
            if not in_speech:
                in_speech = True
                seg_start_idx = idx
                seg_energies = [rms]
            else:
                seg_energies.append(rms)
        elif in_speech:
            end_ms = idx * 20
            start_ms = seg_start_idx * 20
            if end_ms - start_ms >= 80:
                mean_e = sum(seg_energies) / max(1, len(seg_energies))
                dbfs = round(20.0 * math.log10(max(1e-6, mean_e)), 2)
                prob = round(min(0.99, 0.55 + (mean_e / max(vad_threshold, 1e-5)) * 0.15), 3)
                vad_segments.append(
                    VadSegment(start_ms=start_ms, end_ms=end_ms, energy_dbfs=dbfs, speech_prob=prob)
                )
            in_speech = False
            seg_energies = []

    if in_speech:
        end_ms = len(frame_rms) * 20
        start_ms = seg_start_idx * 20
        if end_ms - start_ms >= 80:
            mean_e = sum(seg_energies) / max(1, len(seg_energies))
            dbfs = round(20.0 * math.log10(max(1e-6, mean_e)), 2)
            prob = round(min(0.99, 0.55 + (mean_e / max(vad_threshold, 1e-5)) * 0.15), 3)
            vad_segments.append(
                VadSegment(start_ms=start_ms, end_ms=end_ms, energy_dbfs=dbfs, speech_prob=prob)
            )

    duration_ms = int(round((len(samples) / max(1, sample_rate_hz)) * 1000))
    speech_ratio = round(speech_frames / max(1, len(frame_rms)), 3)

    # Extract lightweight acoustic pitch/ZCR fingerprints per VAD segment for dynamic diarization
    segment_fingerprints: list[dict[str, float]] = []
    for seg in vad_segments:
        s_idx = max(0, int((seg.start_ms / 1000.0) * sample_rate_hz))
        e_idx = min(len(samples), int((seg.end_ms / 1000.0) * sample_rate_hz))
        seg_samples = samples[s_idx:e_idx]
        if len(seg_samples) >= 2:
            zc = sum(
                1 for i in range(1, len(seg_samples))
                if (seg_samples[i - 1] >= 0) != (seg_samples[i] >= 0)
            )
            zcr_hz = round((zc / 2.0) / max(0.01, len(seg_samples) / sample_rate_hz), 1)
        else:
            zcr_hz = 160.0
        segment_fingerprints.append({"zcr_hz": zcr_hz, "energy_dbfs": seg.energy_dbfs})

    return {
        "duration_ms": duration_ms,
        "snr_db": snr_db,
        "clipping_ratio": clipping_ratio,
        "speech_ratio": speech_ratio,
        "noise_floor_dbfs": noise_floor_dbfs,
        "vad_segments": vad_segments,
        "segment_fingerprints": segment_fingerprints,
    }


def analyze_audio_payload(payload: dict[str, Any]) -> tuple[dict[str, Any], AudioQualityReport, ModelTelemetryIR]:
    """Validate and score an audio capture or metadata payload.

    Supports raw base64 WAV/PCM audio as well as metadata-only / transcript imports
    while preserving cryptographic SHA-256 hashes of original input bytes.
    """
    t0 = time.perf_counter()
    audio_b64 = str(payload.get("audio_base64") or "").strip()
    mime_type = str(payload.get("mime_type") or "audio/wav")
    sample_rate_hz = int(payload.get("sample_rate_hz") or 16000)
    channels = int(payload.get("channels") or 1)
    overlap_hint = bool(payload.get("overlap_suspected", False))
    warnings: list[str] = []
    raw_bytes = b""

    if audio_b64:
        try:
            raw_bytes = base64.b64decode(audio_b64, validate=True)
        except Exception:
            warnings.append("invalid_base64_audio_fallback_to_metadata")
            raw_bytes = audio_b64.encode("utf-8")

    if raw_bytes:
        sha256_hex = hashlib.sha256(raw_bytes).hexdigest()
        byte_size = len(raw_bytes)
    else:
        seed_text = str(payload.get("transcript_text") or payload.get("title") or "nexora-voice")
        sha256_hex = hashlib.sha256(seed_text.encode("utf-8")).hexdigest()
        byte_size = int(payload.get("byte_size") or len(seed_text.encode("utf-8")))

    vad_segments: list[VadSegment] = []
    segment_fingerprints: list[dict[str, float]] = []
    duration_ms = int(payload.get("duration_ms") or 0)
    snr_db = float(payload.get("snr_db") or 22.0)
    clipping_ratio = float(payload.get("clipping_ratio") or 0.0)
    speech_ratio = float(payload.get("speech_ratio") or 0.72)
    noise_floor_dbfs = float(payload.get("noise_floor_dbfs") or -48.0)

    if raw_bytes[:4] == b"RIFF":
        try:
            samples, wav_sr, wav_ch = _decode_wav_pcm16(raw_bytes)
            if samples:
                sample_rate_hz = wav_sr
                channels = wav_ch
                stats = _analyze_pcm_samples(samples, sample_rate_hz)
                duration_ms = stats["duration_ms"]
                snr_db = stats["snr_db"]
                clipping_ratio = stats["clipping_ratio"]
                speech_ratio = stats["speech_ratio"]
                noise_floor_dbfs = stats["noise_floor_dbfs"]
                vad_segments = stats["vad_segments"]
                segment_fingerprints = stats.get("segment_fingerprints", [])
        except Exception:
            warnings.append("wav_parse_fallback_to_signal_metadata")

    if duration_ms <= 0:
        # Estimate realistic duration from utterance count or transcript word length (~140 wpm)
        words = len(str(payload.get("transcript_text") or "").split())
        duration_ms = max(1500, int((max(words, 8) / 2.3) * 1000))

    if not vad_segments and duration_ms > 0:
        vad_segments = [VadSegment(start_ms=0, end_ms=duration_ms, energy_dbfs=-22.0, speech_prob=0.88)]

    # CHiME-7/8-informed quality scoring & quality-aware fallback routing
    score = 88.0
    if snr_db < 10.0:
        score -= (10.0 - snr_db) * 3.0
        warnings.append("low_snr_detected")
    elif snr_db > 25.0:
        score += 5.0
    if clipping_ratio > 0.01:
        score -= min(25.0, clipping_ratio * 500.0)
        warnings.append("audio_clipping_detected")
    if speech_ratio < 0.2:
        score -= 18.0
        warnings.append("sparse_speech_activity")
    if sample_rate_hz < 16000:
        score -= 8.0
        warnings.append("narrowband_sample_rate")

    quality_score = round(max(5.0, min(100.0, score)), 1)

    if snr_db < 8.0 or quality_score < 45.0:
        routing_strategy = "low_snr_fallback"
        routing_reason = f"Low SNR ({snr_db:.1f} dB) / quality ({quality_score}) triggers conservative multi-pass fallback"
    elif overlap_hint:
        routing_strategy = "overlap_aware_diarize"
        routing_reason = "Overlapping speakers detected; routing through overlap-aware speaker separation branch"
    elif snr_db < 16.0:
        routing_strategy = "denoise_then_asr"
        routing_reason = f"Moderate noise ({snr_db:.1f} dB SNR); applying spectral enhancement before ASR"
    else:
        routing_strategy = "direct_asr"
        routing_reason = f"Clean signal ({snr_db:.1f} dB SNR, score {quality_score}); bypassing denoiser to avoid artifacts"

    report = AudioQualityReport(
        quality_score=quality_score,
        snr_db=round(snr_db, 2),
        clipping_ratio=round(clipping_ratio, 5),
        speech_ratio=round(speech_ratio, 3),
        noise_floor_dbfs=round(noise_floor_dbfs, 2),
        routing_strategy=routing_strategy,
        vad_segments=vad_segments,
        warnings=warnings,
    )
    latency_ms = round((time.perf_counter() - t0) * 1000.0, 3)
    telemetry = ModelTelemetryIR(
        stage="audio_qc",
        adapter_name="ffmpeg-vad-qc-v1",
        routing_reason=routing_reason,
        fallback_used=bool(warnings),
        latency_ms=latency_ms,
        confidence=round(quality_score / 100.0, 3),
        cost_units=0.05,
    )
    meta = {
        "sha256_original": sha256_hex,
        "byte_size": byte_size,
        "mime_type": mime_type,
        "sample_rate_hz": sample_rate_hz,
        "channels": channels,
        "duration_ms": duration_ms,
        "segment_fingerprints": segment_fingerprints,
    }
    return meta, report, telemetry
