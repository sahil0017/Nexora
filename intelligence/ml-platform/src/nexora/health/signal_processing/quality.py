"""Shared spectral utilities and signal-quality assessment."""

from __future__ import annotations

import numpy as np


def bandpower_fft(signal: np.ndarray, sample_rate_hz: float, low_hz: float, high_hz: float) -> float:
    n = len(signal)
    if n < 8 or sample_rate_hz <= 0:
        return 0.0
    centered = signal - np.mean(signal)
    window = np.hanning(n)
    fft_vals = np.fft.rfft(centered * window)
    freqs = np.fft.rfftfreq(n, d=1.0 / sample_rate_hz)
    psd = (np.abs(fft_vals) ** 2) / max(float(np.sum(window**2)), 1e-9)
    mask = (freqs >= low_hz) & (freqs <= high_hz)
    if not np.any(mask):
        return 0.0
    return float(np.trapezoid(psd[mask], freqs[mask])) if hasattr(np, "trapezoid") else float(np.trapz(psd[mask], freqs[mask]))


def dominant_freq_hz(signal: np.ndarray, sample_rate_hz: float, low_hz: float, high_hz: float) -> float | None:
    n = len(signal)
    if n < 16 or sample_rate_hz <= 0:
        return None
    centered = signal - np.mean(signal)
    window = np.hanning(n)
    fft_vals = np.fft.rfft(centered * window)
    freqs = np.fft.rfftfreq(n, d=1.0 / sample_rate_hz)
    mask = (freqs >= low_hz) & (freqs <= high_hz)
    if not np.any(mask):
        return None
    sub_freqs = freqs[mask]
    sub_mag = np.abs(fft_vals[mask])
    if float(np.max(sub_mag)) < 1e-9:
        return None
    return float(sub_freqs[int(np.argmax(sub_mag))])


def compute_imu_quality(sample_count: int, actigraphy_rms: float) -> float:
    length_score = float(np.clip(sample_count / 100.0, 0.2, 1.0))
    motion_penalty = float(np.clip(actigraphy_rms / 1.5, 0.0, 0.75))
    return round(float(np.clip(length_score * (1.0 - motion_penalty), 0.05, 0.98)), 4)
