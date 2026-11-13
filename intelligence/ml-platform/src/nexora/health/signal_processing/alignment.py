"""Cross-modal clock-drift and monotonic timestamp alignment for asynchronous physiological streams."""

from __future__ import annotations

from typing import Any

import numpy as np


def align_multimodal_streams(streams: list[dict[str, Any]]) -> dict[str, Any]:
    """Align asynchronous phone, wearable, and EEG streams using monotonic clocks and sync uncertainty."""
    if not streams:
        return {
            "aligned_count": 0,
            "max_sync_uncertainty_ms": 0.0,
            "estimated_clock_skew_ms": 0.0,
            "alignment_quality": "unavailable",
        }

    offsets_ms: list[float] = []
    uncertainties: list[float] = []
    for s in streams:
        dev_ts = float(s.get("device_timestamp_ms", 0.0))
        mono_ts = float(s.get("monotonic_ms", 0.0))
        unc = float(s.get("sync_uncertainty_ms", 25.0))
        if dev_ts > 0 and mono_ts > 0:
            offsets_ms.append(dev_ts - mono_ts)
        uncertainties.append(max(0.0, unc))

    clock_skew_ms = float(np.std(offsets_ms)) if len(offsets_ms) >= 2 else 0.0
    max_unc = float(max(uncertainties)) if uncertainties else 0.0
    quality = "good" if max_unc <= 50.0 and clock_skew_ms <= 30.0 else "degraded"

    return {
        "aligned_count": len(streams),
        "max_sync_uncertainty_ms": round(max_unc, 2),
        "estimated_clock_skew_ms": round(clock_skew_ms, 2),
        "alignment_quality": quality,
    }
