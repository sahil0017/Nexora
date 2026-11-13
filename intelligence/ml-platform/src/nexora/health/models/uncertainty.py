"""Epistemic (modality/ensemble) and heteroscedastic aleatoric uncertainty estimation."""

from __future__ import annotations

import numpy as np


def estimate_uncertainty(
    ensemble_predictions: list[float],
    available_modalities: list[str],
    signal_quality_score: float,
    missing_count: int,
) -> dict[str, float]:
    """Compute epistemic std from ensemble spread + missing-modality penalty, and aleatoric std from quality."""
    spread = float(np.std(ensemble_predictions)) if len(ensemble_predictions) >= 2 else 0.02
    modality_penalty = 0.025 * missing_count
    if "eeg" not in available_modalities:
        modality_penalty += 0.03
    if "mri" not in available_modalities:
        modality_penalty += 0.02

    epistemic = float(np.clip(spread + modality_penalty, 0.025, 0.28))
    # Heteroscedastic aleatoric uncertainty grows as signal quality drops
    aleatoric = float(np.clip(0.03 + 0.14 * (1.0 - float(np.clip(signal_quality_score, 0.0, 1.0))), 0.025, 0.24))
    total_std = float(np.sqrt(epistemic**2 + aleatoric**2))
    return {
        "epistemic": round(epistemic, 4),
        "aleatoric": round(aleatoric, 4),
        "total_std": round(total_std, 4),
    }
