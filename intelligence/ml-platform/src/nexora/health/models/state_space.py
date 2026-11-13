"""M1: Bayesian linear-Gaussian state-space filter for longitudinal physiological states."""

from __future__ import annotations


def filter_m1_state_space(
    observations: list[float],
    obs_variances: list[float] | None = None,
    process_variance: float = 0.008,
    prior_mean: float = 0.50,
    prior_var: float = 0.04,
) -> dict[str, float]:
    """Run a 1D Kalman update over sequential night/window observations."""
    mean = prior_mean
    var = prior_var
    if not observations:
        return {"filtered_mean": round(mean, 4), "filtered_std": round(var**0.5, 4)}

    for idx, z in enumerate(observations):
        r = obs_variances[idx] if obs_variances and idx < len(obs_variances) else 0.025
        # Predict step
        pred_var = var + process_variance
        # Update step
        k_gain = pred_var / max(pred_var + r, 1e-9)
        mean = mean + k_gain * (z - mean)
        var = (1.0 - k_gain) * pred_var

    return {
        "filtered_mean": round(float(mean), 4),
        "filtered_std": round(float(var**0.5), 4),
    }
