"""Versioned, overridable policy for the NEXORA Finance Intelligence Network.

Every statutory rule (tax slabs, rebates, deduction caps, capital-gains rates, LRS/TCS
thresholds), market assumption (returns, volatility, inflation, FX), scoring weight,
radar threshold, and classification rule lives here instead of inside engine math.

Resolution order (later wins):
  1. ``DEFAULT_POLICY`` below (reviewed defaults, versioned via ``policy_version``)
  2. JSON file at ``$NEXORA_FINANCE_POLICY_PATH`` (ops / CA team overrides, no redeploy of code)
  3. Per-request ``assumptions`` object (user-specific return / inflation / FX expectations)

Statutory tables are keyed by Indian financial year (``"2025-26"``, ``"2026-27"``) so a
new Union Budget is a config change, not a code change.
"""

from __future__ import annotations

import copy
import json
import os
from datetime import date
from functools import lru_cache
from typing import Any, Mapping

INF = float("inf")

DEFAULT_POLICY: dict[str, Any] = {
    "policy_version": "2026.11.1",
    # ------------------------------------------------------------------
    # Indian income-tax tables, keyed by financial year
    # ------------------------------------------------------------------
    "tax": {
        "2025-26": {
            "kernel_id": "in_it_act_1961_fy25_26",
            "cess_rate": 0.04,
            "new_regime": {
                "slabs": [[400_000, 0.00], [400_000, 0.05], [400_000, 0.10], [400_000, 0.15],
                          [400_000, 0.20], [400_000, 0.25], [INF, 0.30]],
                "standard_deduction": 75_000,
                "rebate_87a_income_limit": 1_200_000,
            },
            "old_regime": {
                "slabs": [[250_000, 0.00], [250_000, 0.05], [500_000, 0.20], [INF, 0.30]],
                "standard_deduction": 50_000,
                "rebate_87a_income_limit": 500_000,
            },
            "deduction_caps": {"80c": 150_000, "80d": 75_000, "80ccd1b": 50_000, "24b": 200_000},
            "capital_gains": {"stcg_111a_rate": 0.20, "ltcg_112a_rate": 0.125, "ltcg_112a_exemption": 125_000},
            "advance_tax_schedule": [
                {"quarter": "Q1 (Jun 15)", "cumulative_pct": 15},
                {"quarter": "Q2 (Sep 15)", "cumulative_pct": 45},
                {"quarter": "Q3 (Dec 15)", "cumulative_pct": 75},
                {"quarter": "Q4 (Mar 15)", "cumulative_pct": 100},
            ],
            "lrs": {"annual_limit_usd": 250_000, "tcs_threshold_inr": 1_000_000, "tcs_rate": 0.20},
        },
        "2026-27": {
            # Income-tax Act 2025 (effective 1 Apr 2026) retains FY25-26 rates; override via JSON if amended.
            "inherits": "2025-26",
            "kernel_id": "in_it_act_2025_fy26_27",
        },
    },
    # ------------------------------------------------------------------
    # Market & macro assumptions (overridable per request via "assumptions")
    # ------------------------------------------------------------------
    "market": {
        "usd_inr": 84.0,
        "expected_equity_return_apr": 0.115,
        "expected_sip_return_apr": 0.12,
        "portfolio_volatility_annual": 0.15,
        "inflation_rate": 0.065,
        "liquid_vs_savings_yield_spread": 0.038,
        "regular_plan_default_ter": 0.016,
        "direct_plan_default_ter": 0.006,
        "min_regular_vs_direct_ter_gap": 0.005,
        "us_estate_tax_exemption_usd": 60_000,
        "default_equity_share_of_net_worth": 0.70,
        "market_regime_default": "unclassified",
    },
    # ------------------------------------------------------------------
    # Digital Twin & Health Score
    # ------------------------------------------------------------------
    "twin": {
        "liquid_account_types": ["cash", "bank", "wallet", "deposit"],
        "essential_burn_min_ratio_of_expense": 0.60,
        "essential_burn_floor_inr": 15_000,
        "emergency_target_months": 6,
        "backward_replay_points": 5,
        "health_weights": {
            "liquidity_max": 25.0, "liquidity_target_months": 6.0,
            "savings_max": 25.0, "savings_target_pct": 30.0,
            "debt_max": 20.0, "debt_dti_comfort_pct": 15.0, "debt_penalty_per_pct": 0.6,
            "diversification_full": 15.0, "diversification_partial": 7.0,
            "term_cover_present": 8.0, "term_cover_absent": 2.0,
            "health_cover_present": 7.0, "health_cover_absent": 2.0,
        },
        "term_cover_income_multiple": 10,
    },
    # ------------------------------------------------------------------
    # Equities, MF look-through & governance thresholds
    # ------------------------------------------------------------------
    "equity": {
        "lookthrough_overweight_pct": 8.0,
        "promoter_pledge_risk_pct": 15.0,
        "undervalued_max_pe": 18.0,
        "undervalued_min_roce": 16.0,
        "expensive_min_pe": 45.0,
        "valuation_neutral_pe": 15.0,
        "valuation_pe_penalty": 1.6,
        "quality_roce_weight": 2.5,
        "quality_growth_weight": 1.5,
        "quality_pledge_penalty": 2.0,
        "composite_quality_weight": 0.6,
        "composite_valuation_weight": 0.4,
    },
    # ------------------------------------------------------------------
    # Debt & business unit economics
    # ------------------------------------------------------------------
    "debt_business": {
        "post_tax_sip_hurdle_factor": 0.875,
        "healthy_ltv_cac_ratio": 3.0,
        "min_monthly_churn": 0.005,
        "ebitda_valuation_multiple": 6.0,
    },
    # ------------------------------------------------------------------
    # Risk & Monte Carlo
    # ------------------------------------------------------------------
    "risk": {
        "var_confidence": 0.95,
        "monte_carlo_seed": 42,
        "num_paths_default": 500,
        "num_paths_min": 50,
        "num_paths_max": 5000,
        "horizon_years_default": 10,
        "horizon_years_max": 40,
        "fi_corpus_expense_multiple": 25.0,
        "stress_equity_crash_pct": 0.30,
        "stress_rate_hike_bps": 250,
        "stress_job_loss_months": 6,
    },
    # ------------------------------------------------------------------
    # Knowledge-graph transmission sensitivities
    # ------------------------------------------------------------------
    "graph": {
        "default_rate_delta_bps": 25.0,
        "emi_pass_through_ratio": 0.72,
        "debt_fund_modified_duration": 3.8,
        "banking_equity_rate_beta": 1.5,
        "mitigation": {
            "rate_up": "Part-prepay floating EBLR loans using idle low-yield savings, or shorten duration in debt funds.",
            "rate_down": "Refinance high-spread loans and consider locking in longer-duration gilt yields.",
            "neutral": "No material rate transmission detected for current exposures.",
        },
    },
    # ------------------------------------------------------------------
    # Continuous Opportunity Radar
    # ------------------------------------------------------------------
    "radar": {
        "min_tax_impact_inr": 1_000,
        "min_harvest_impact_inr": 1_000,
        "min_ter_drag_inr": 500,
        "min_idle_cash_sweep_inr": 50_000,
        "confidence": {
            "tax_regime": 0.94, "loss_harvest": 0.91, "ter_switch": 0.95,
            "idle_cash": 0.89, "coverage_gap": 0.96,
        },
    },
    # ------------------------------------------------------------------
    # AI CFO
    # ------------------------------------------------------------------
    "cfo": {
        "surplus_sip_share": 0.5,
        "approval_keywords": ["execute", "rebalance", "transfer", "prepay", "file itr", "switch"],
        "confidence_complete": 0.91,
        "confidence_with_gaps": 0.82,
        "max_prioritized_actions": 4,
    },
    # ------------------------------------------------------------------
    # Zero-AA alert NLP
    # ------------------------------------------------------------------
    "alerts": {
        "credit_keywords": ["credited", "received", "deposited", "refund", "salary", "dividend"],
        "debit_keywords": ["debited", "spent", "paid", "sent", "withdrawn", "purchase", "dr "],
        "internal_transfer_keywords": ["self transfer", "own account", "cc bill", "credit card payment"],
        "confidence_with_amount": 0.92,
        "confidence_without_amount": 0.78,
        "recent_buffer_size": 100,
        "merchant_rules": [
            {"keywords": ["swiggy", "zomato", "eatfit", "starbucks", "cafe"], "category": "Food & Dining", "discretionary": True, "recurring": False},
            {"keywords": ["uber", "ola", "rapido", "metro", "irctc", "shell", "hpcl", "bpcl", "ioc"], "category": "Mobility & Fuel", "discretionary": False, "recurring": False},
            {"keywords": ["netflix", "spotify", "prime", "hotstar", "icloud", "youtube", "openai"], "category": "Subscriptions", "discretionary": True, "recurring": True},
            {"keywords": ["zerodha", "groww", "kuvera", "cams", "kfintech", "sip", "mutual fund", "nps"], "category": "Investments", "discretionary": False, "recurring": True},
            {"keywords": ["term life", "insurance", "lic", "hdfc ergo", "niva bupa", "star health"], "category": "Insurance", "discretionary": False, "recurring": True},
            {"keywords": ["emi", "home loan", "auto loan", "bajaj", "hdfc ltd"], "category": "Loan EMI", "discretionary": False, "recurring": True},
            {"keywords": ["salary", "payroll", "stipend"], "category": "Salary Income", "discretionary": False, "recurring": True},
            {"keywords": ["dividend", "interest", "int pd"], "category": "Passive Income", "discretionary": False, "recurring": False},
            {"keywords": ["apollo", "pharmeasy", "1mg", "hospital", "medplus"], "category": "Healthcare", "discretionary": False, "recurring": False},
            {"keywords": ["amazon", "flipkart", "myntra", "nykaa", "ajio"], "category": "Shopping", "discretionary": True, "recurring": False},
            {"keywords": ["bescom", "tsspdcl", "airtel", "jio", "act fibernet", "rent", "maintenance"], "category": "Bills & Utilities", "discretionary": False, "recurring": True},
        ],
    },
}


def indian_financial_year(on: date | None = None) -> str:
    """Return the Indian FY label (April–March) for a date, e.g. 2026-11-12 -> '2026-27'."""
    d = on or date.today()
    start = d.year if d.month >= 4 else d.year - 1
    return f"{start}-{(start + 1) % 100:02d}"


def _deep_merge(base: dict[str, Any], override: Mapping[str, Any]) -> dict[str, Any]:
    out = copy.deepcopy(base)
    for key, val in override.items():
        if isinstance(val, Mapping) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], val)
        else:
            out[key] = copy.deepcopy(val)
    return out


def _normalise_slabs(slabs: list[list[float]]) -> list[tuple[float, float]]:
    return [(INF if (w is None or w == "inf") else float(w), float(r)) for w, r in slabs]


class FinancePolicy:
    """Read-only accessor over the merged policy document."""

    def __init__(self, document: Mapping[str, Any]) -> None:
        self._doc = dict(document)

    @property
    def version(self) -> str:
        return str(self._doc.get("policy_version", "unversioned"))

    def section(self, name: str) -> dict[str, Any]:
        return dict(self._doc.get(name, {}))

    def supported_financial_years(self) -> list[str]:
        return sorted(self._doc.get("tax", {}).keys())

    def tax(self, financial_year: str | None = None) -> dict[str, Any]:
        """Resolve a FY tax table, following ``inherits`` chains; falls back to latest configured FY."""
        tables: dict[str, Any] = self._doc.get("tax", {})
        if not tables:
            raise ValueError("finance policy has no tax tables configured")
        fy = financial_year or indian_financial_year()
        if fy not in tables:
            fy = max(tables.keys())
        resolved: dict[str, Any] = {}
        chain: list[str] = []
        cursor: str | None = fy
        while cursor:
            if cursor in chain:
                raise ValueError(f"circular 'inherits' in tax policy at {cursor}")
            chain.append(cursor)
            cursor = tables.get(cursor, {}).get("inherits")
        for key in reversed(chain):
            resolved = _deep_merge(resolved, {k: v for k, v in tables[key].items() if k != "inherits"})
        for regime in ("new_regime", "old_regime"):
            resolved[regime]["slabs"] = _normalise_slabs(resolved[regime]["slabs"])
        resolved["financial_year"] = fy
        return resolved

    def market(self, overrides: Mapping[str, Any] | None = None) -> dict[str, Any]:
        """Market assumptions merged with per-request ``assumptions`` (only known numeric keys)."""
        base = self.section("market")
        for key, val in (overrides or {}).items():
            if key in base and isinstance(val, (int, float)) and not isinstance(val, bool):
                base[key] = float(val)
        return base


@lru_cache(maxsize=1)
def load_policy() -> FinancePolicy:
    """Load defaults, then merge the optional JSON override file from the environment."""
    doc = copy.deepcopy(DEFAULT_POLICY)
    path = os.getenv("NEXORA_FINANCE_POLICY_PATH", "").strip()
    if path:
        with open(path, encoding="utf-8") as fh:
            doc = _deep_merge(doc, json.load(fh))
    return FinancePolicy(doc)
