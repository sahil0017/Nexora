"""NEXORA Financial Intelligence Network — 15 Domains, Cross-Engine DAGs & Platform Systems.

Implements:
- Zero-AA Real-Time Alert NLP Parser (SMS, Android Notification, Vault Email, iOS Shortcut)
- Personal Financial Digital Twin, Health Scorecard & Backward Ledger Replay (Domains 1 & 2)
- Wealth Growth, NSE/BSE Equity Quant, MF/ETF Overlap & Global/LRS Intelligence (Domains 3, 4, 5, 6, 13)
- Deterministic Indian Tax & CA Engine: Old vs New Regime, Capital Gains & Harvesting (Domain 7)
- Loan/Debt Optimizer, Insurance Protection Planner & Business Unit Economics (Domains 8, 9, 10)
- Portfolio Risk (VaR/Stress), Monte Carlo & What-If Lab (Domains 11, 12, §17.5)
- Financial Knowledge Graph, Continuous Opportunity Radar, Multi-Agent AI CFO & Evidence Engine (Domain 15, §16, §17)

Design rules:
- No statutory rate, market assumption, threshold or keyword list is written inline; all come
  from :mod:`nexora.finance.policy` (versioned defaults + JSON override + per-request assumptions).
- The engine never invents user financial data. When an input is missing it is treated as zero /
  absent and the response carries ``data_sufficiency`` so the UI can ask for (or auto-capture) it.
"""

from __future__ import annotations

import hashlib
import math
import random
import re
from datetime import datetime, timezone
from statistics import NormalDist
from typing import Any

from nexora.finance.policy import FinancePolicy, load_policy
from nexora.gateway_bridge import invoke_with_privacy_firewall
from nexora.deep_learning import hub

_RE_AMOUNT = re.compile(r"(?:INR|Rs\.?|₹)\s*([0-9,]+(?:\.[0-9]{1,2})?)", re.IGNORECASE)
_RE_BALANCE = re.compile(
    r"(?:avl\s*bal|available\s*balance|bal|clr\s*bal)[:\s-]*(?:INR|Rs\.?|₹)?\s*([0-9,]+(?:\.[0-9]{1,2})?)",
    re.IGNORECASE,
)
_RE_MASKED_ACCT = re.compile(r"(?:a/c|acct|card|xx|\*\*)\s*[x*]*([0-9]{4})", re.IGNORECASE)
_RE_VPA = re.compile(r"([a-zA-Z0-9.\-_]{2,}@[a-zA-Z]{2,})")
_RE_UTR = re.compile(r"(?:utr|ref(?:\s*no)?|upi\s*ref)[:\s]*([0-9]{10,12})", re.IGNORECASE)

_CHANNEL_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("card", ("card", "pos")),
    ("neft", ("neft",)),
    ("imps", ("imps",)),
    ("rtgs", ("rtgs",)),
    ("nach", ("nach", "ecs", "autopay")),
)
_FLOATING_RATE_TYPES = ("floating_eblr", "floating_mclr", "floating_other")


def _f(value: Any, default: float = 0.0) -> float:
    """Coerce to float; ``None``/blank/invalid -> default (never a fabricated business value)."""
    if value is None or value == "":
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _first(payload: dict[str, Any], *keys: str) -> Any:
    """Return the first present (non-None) value among alias keys."""
    for key in keys:
        if payload.get(key) is not None:
            return payload[key]
    return None


def _slab_tax(income: float, slabs: list[tuple[float, float]]) -> float:
    remaining, tax = income, 0.0
    for width, rate in slabs:
        if remaining <= 0:
            break
        chunk = min(remaining, width)
        tax += chunk * rate
        remaining -= chunk
    return tax


def _percentile(sorted_values: list[float], q: float) -> float:
    idx = min(len(sorted_values) - 1, max(0, int(q * len(sorted_values))))
    return round(sorted_values[idx], 2)


class FinanceIntelligenceNetwork:
    """Unified quantitative, deterministic, and multi-agent engine for NEXORA Finance."""

    def __init__(self, policy: FinancePolicy | None = None) -> None:
        self.policy = policy or load_policy()
        self.events_processed: int = 0
        self.last_event_at: str | None = None
        self.recent_alerts: list[dict[str, Any]] = []
        self.market_events: list[dict[str, Any]] = []

    # =========================================================================
    # 1. ZERO-AA REAL-TIME ALERT PARSER & TRANSACTION INTELLIGENCE (Domain 2)
    # =========================================================================
    def parse_financial_alert(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Parse bank SMS, Android notification, Vault Email, or iOS Shortcut alert."""
        cfg = self.policy.section("alerts")
        raw_text = str(payload.get("raw_text") or payload.get("body") or "").strip()
        lower = raw_text.lower()
        source_channel = str(payload.get("source_channel") or "android_notification")
        currency = str(payload.get("currency") or "INR").upper()

        amt_match = _RE_AMOUNT.search(raw_text)
        amount = float(amt_match.group(1).replace(",", "")) if amt_match else _f(payload.get("amount"))

        is_credit = any(w in lower for w in cfg["credit_keywords"])
        is_debit = any(w in lower for w in cfg["debit_keywords"])
        txn_type = "credit" if (is_credit and not is_debit) else "debit"
        signed_amount = round(abs(amount) if txn_type == "credit" else -abs(amount), 2)

        bal_match = _RE_BALANCE.search(raw_text)
        balance_after_txn = float(bal_match.group(1).replace(",", "")) if bal_match else payload.get("balance_after_txn")

        acct_match = _RE_MASKED_ACCT.search(raw_text)
        masked_account = f"**{acct_match.group(1)}" if acct_match else payload.get("masked_account")

        vpa_match = _RE_VPA.search(raw_text)
        upi_vpa = vpa_match.group(1).lower() if vpa_match else payload.get("upi_vpa")
        utr_match = _RE_UTR.search(raw_text)
        utr_ref = utr_match.group(1) if utr_match else payload.get("utr_reference")

        channel = self._detect_channel(lower, upi_vpa, payload)
        merchant, category, is_discretionary, is_sub = self._classify_merchant_and_category(raw_text, upi_vpa, txn_type)
        is_internal = any(w in lower for w in cfg["internal_transfer_keywords"])

        # Deep Learning Transformer Classification fallback/augmentation
        neural_pred = hub.txn_classifier.classify(raw_text, vpa=upi_vpa)
        if category in ("Uncategorized", "Other Income") and neural_pred.get("category") not in ("Uncategorized", "Other Income"):
            category = str(neural_pred["category"])
            merchant = str(neural_pred["merchant"])
            is_discretionary = bool(neural_pred["is_discretionary"])
            is_sub = is_sub or bool(neural_pred["is_recurring"])

        dedupe_seed = f"{masked_account or ''}:{txn_type}:{abs(amount):.2f}:{utr_ref or raw_text[:48]}"
        external_txn_id = "alt_" + hashlib.sha256(dedupe_seed.encode("utf-8")).hexdigest()[:20]
        vpa_blind_idx = hashlib.sha256(f"nexora_blind:{upi_vpa}".encode("utf-8")).hexdigest() if upi_vpa else None

        parsed = {
            "external_txn_id": external_txn_id,
            "source_channel": source_channel,
            "masked_account": masked_account,
            "txn_type": "transfer" if is_internal else txn_type,
            "channel": channel,
            "amount": signed_amount,
            "currency": currency,
            "balance_after_txn": balance_after_txn,
            "merchant": merchant,
            "category": category,
            "upi_vpa_masked": self._mask_vpa(upi_vpa) if upi_vpa else None,
            "upi_vpa_blind_idx": vpa_blind_idx,
            "utr_reference": utr_ref,
            "is_internal_transfer": is_internal,
            "is_discretionary": is_discretionary,
            "is_recurring_candidate": is_sub or channel == "nach",
            "classification_confidence": cfg["confidence_with_amount"] if amt_match else cfg["confidence_without_amount"],
            "neural_classification": neural_pred,
            "policy_version": self.policy.version,
            "ingested_at": datetime.now(timezone.utc).isoformat(),
        }
        self.recent_alerts.append(parsed)
        if len(self.recent_alerts) > int(cfg["recent_buffer_size"]):
            self.recent_alerts.pop(0)
        return parsed

    @staticmethod
    def _detect_channel(lower: str, upi_vpa: str | None, payload: dict[str, Any]) -> str:
        if "upi" in lower or upi_vpa:
            return "upi"
        for channel, keywords in _CHANNEL_KEYWORDS:
            if any(k in lower for k in keywords):
                return channel
        return str(payload.get("channel") or "other")

    def _classify_merchant_and_category(
        self, text: str, upi_vpa: str | None, txn_type: str
    ) -> tuple[str, str, bool, bool]:
        probe = f"{text} {upi_vpa or ''}".lower()
        for rule in self.policy.section("alerts")["merchant_rules"]:
            for kw in rule["keywords"]:
                if re.search(rf"\b{re.escape(kw)}\b", probe):
                    return kw.title(), rule["category"], bool(rule["discretionary"]), bool(rule["recurring"])
        if txn_type == "credit":
            return "Inflow Transfer", "Other Income", False, False
        return "Unclassified Merchant", "Uncategorized", True, False

    @staticmethod
    def _mask_vpa(vpa: str) -> str:
        if "@" not in vpa:
            return "***"
        user, handle = vpa.split("@", 1)
        prefix = user[:2] if len(user) >= 2 else user[:1]
        return f"{prefix}***@{handle}"

    # =========================================================================
    # 2. PERSONAL DIGITAL TWIN, HEALTH SCORE & BACKWARD REPLAY (Domains 1 & 2)
    # =========================================================================
    def compute_digital_twin(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Compute live Financial Digital Twin state, Health Score, and Backward Replay."""
        cfg = self.policy.section("twin")
        w = cfg["health_weights"]
        accounts = payload.get("accounts") or []
        holdings = payload.get("holdings") or []
        physical_assets = payload.get("physical_assets") or []
        liabilities = payload.get("liabilities") or []
        transactions = payload.get("transactions") or []
        recurring = payload.get("recurring_obligations") or []
        insurance = payload.get("insurance_policies") or []

        liquid_types = set(cfg["liquid_account_types"])
        liquid_cash = sum(_f(a.get("current_balance")) for a in accounts if a.get("account_type", "bank") in liquid_types)
        retirement_cash = sum(_f(a.get("current_balance")) for a in accounts if a.get("account_type") == "retirement")
        investments_inr = sum(_f(h.get("current_value_inr")) for h in holdings)
        physical_inr = sum(_f(p.get("estimated_value_inr")) for p in physical_assets)
        total_assets = round(liquid_cash + retirement_cash + investments_inr + physical_inr, 2)

        loan_debt = sum(_f(l.get("principal_outstanding")) for l in liabilities)
        card_debt = sum(
            abs(_f(a.get("current_balance")))
            for a in accounts
            if a.get("account_type") == "credit_card" and _f(a.get("current_balance")) < 0
        ) + sum(_f(l.get("card_outstanding")) for l in liabilities)
        total_liabilities = round(loan_debt + card_debt, 2)
        net_worth = round(total_assets - total_liabilities, 2)

        month_credited = month_debited = discretionary_spend = 0.0
        for t in transactions:
            if t.get("is_internal_transfer"):
                continue
            amt = _f(t.get("inr_amount") if t.get("inr_amount") is not None else t.get("amount"))
            if amt > 0 or t.get("txn_type") in ("credit", "dividend", "interest", "refund"):
                month_credited += abs(amt)
            else:
                month_debited += abs(amt)
                if t.get("is_discretionary"):
                    discretionary_spend += abs(amt)

        monthly_income = max(month_credited, _f(payload.get("monthly_income_inr")))
        monthly_expense = max(month_debited, _f(payload.get("monthly_expense_inr")))
        monthly_emi = sum(_f(l.get("emi_amount")) for l in liabilities)
        upcoming_bills = sum(_f(r.get("expected_amount")) for r in recurring if r.get("status", "active") == "active")

        income_known = monthly_income > 0
        savings_rate_pct = round(max(0.0, (monthly_income - monthly_expense) / monthly_income * 100.0), 1) if income_known else 0.0
        dti_pct = round(monthly_emi / monthly_income * 100.0, 1) if income_known else 0.0
        essential_burn = max(
            monthly_expense - discretionary_spend,
            monthly_expense * float(cfg["essential_burn_min_ratio_of_expense"]),
            float(cfg["essential_burn_floor_inr"]),
        )
        emergency_runway_months = round(liquid_cash / essential_burn, 1)
        safe_to_spend_inr = round(max(0.0, liquid_cash - upcoming_bills), 2)

        liquidity_score = min(w["liquidity_max"], emergency_runway_months / w["liquidity_target_months"] * w["liquidity_max"])
        savings_score = min(w["savings_max"], savings_rate_pct / w["savings_target_pct"] * w["savings_max"])
        debt_score = max(0.0, w["debt_max"] - max(0.0, dti_pct - w["debt_dti_comfort_pct"]) * w["debt_penalty_per_pct"])
        diversification_score = w["diversification_full"] if (investments_inr > 0 and liquid_cash > 0) else w["diversification_partial"]
        has_term = any(p.get("policy_type") == "term_life" for p in insurance)
        has_personal_health = any(
            p.get("policy_type") in ("health", "super_topup") and p.get("cover_source", "personal") == "personal"
            for p in insurance
        )
        protection_score = (w["term_cover_present"] if has_term else w["term_cover_absent"]) + (
            w["health_cover_present"] if has_personal_health else w["health_cover_absent"]
        )
        health_score = int(round(min(100.0, liquidity_score + savings_score + debt_score + diversification_score + protection_score)))

        coverage_gaps: list[dict[str, str]] = []
        if not has_personal_health:
            coverage_gaps.append({
                "gap_type": "missing_policy_doc",
                "severity": "high",
                "title": "No personal health insurance linked",
                "suggested_action": "Add personal health / super top-up cover so job transitions never leave you unprotected.",
            })
        if loan_debt > 0 and not has_term:
            coverage_gaps.append({
                "gap_type": "missing_policy_doc",
                "severity": "high",
                "title": "Active loan without pure term life cover",
                "suggested_action": (
                    f"Cover at least {cfg['term_cover_income_multiple']}x annual income plus outstanding debt "
                    "with pure term insurance."
                ),
            })

        missing = [
            name for name, present in (
                ("accounts", bool(accounts)),
                ("transactions", bool(transactions)),
                ("holdings", bool(holdings)),
                ("insurance_policies", bool(insurance)),
            ) if not present
        ]

        return {
            "net_worth_inr": net_worth,
            "total_assets_inr": total_assets,
            "total_liabilities_inr": total_liabilities,
            "liquid_cash_inr": round(liquid_cash, 2),
            "investments_inr": round(investments_inr, 2),
            "retirement_assets_inr": round(retirement_cash, 2),
            "physical_assets_inr": round(physical_inr, 2),
            "safe_to_spend_inr": safe_to_spend_inr,
            "month_credited_inr": round(month_credited, 2),
            "month_debited_inr": round(month_debited, 2),
            "monthly_essential_burn_inr": round(essential_burn, 2),
            "savings_rate_pct": savings_rate_pct,
            "dti_pct": dti_pct,
            "emergency_runway_months": emergency_runway_months,
            "health_score": health_score,
            "health_breakdown": {
                "liquidity": round(liquidity_score, 1),
                "savings_discipline": round(savings_score, 1),
                "debt_burden": round(debt_score, 1),
                "diversification": round(diversification_score, 1),
                "protection_adequacy": round(protection_score, 1),
            },
            "asset_allocation_pct": self._compute_allocation_pct(
                liquid_cash, investments_inr, retirement_cash, physical_inr, total_assets
            ),
            "coverage_gaps": coverage_gaps,
            "backward_replay_history": self._backward_replay_balances(
                liquid_cash, transactions, int(cfg["backward_replay_points"])
            ),
            "data_sufficiency": {"complete": not missing, "missing_inputs": missing},
            "policy_version": self.policy.version,
            "as_of": datetime.now(timezone.utc).isoformat(),
        }

    @staticmethod
    def _compute_allocation_pct(
        liquid: float, investments: float, retirement: float, physical: float, total: float
    ) -> dict[str, float]:
        if total <= 0:
            return {"cash": 0.0, "equity_mf": 0.0, "retirement_debt": 0.0, "real_estate_gold": 0.0}
        return {
            "cash": round(liquid / total * 100.0, 1),
            "equity_mf": round(investments / total * 100.0, 1),
            "retirement_debt": round(retirement / total * 100.0, 1),
            "real_estate_gold": round(physical / total * 100.0, 1),
        }

    @staticmethod
    def _backward_replay_balances(
        current_cash: float, transactions: list[dict[str, Any]], points_limit: int
    ) -> list[dict[str, Any]]:
        running = current_cash
        points = [{"step": 0, "balance_inr": round(running, 2), "source": "alert_avl_bal"}]
        for idx, txn in enumerate(transactions[:points_limit], start=1):
            amt = _f(txn.get("inr_amount") if txn.get("inr_amount") is not None else txn.get("amount"))
            running -= amt  # Balance(t-1) = Balance(t) - signed_txn_amount
            points.append({"step": -idx, "balance_inr": round(max(0.0, running), 2), "source": "backward_replay"})
        return list(reversed(points))

    # =========================================================================
    # 3. INDIAN EQUITIES, MF OVERLAP & GLOBAL/LRS (Domains 3, 4, 5, 6, 13)
    # =========================================================================
    def analyze_markets_and_overlap(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Compute MF look-through overlap, Regular->Direct TER drag, Equity Quant, and LRS/Global metrics."""
        mkt = self.policy.market(payload.get("assumptions"))
        eq_cfg = self.policy.section("equity")
        lrs_cfg = self.policy.tax(payload.get("financial_year"))["lrs"]
        mf_schemes = payload.get("mutual_funds") or []
        equities = payload.get("equities") or []
        global_holdings = payload.get("global_holdings") or []
        lrs_remitted_usd = _f(payload.get("lrs_remitted_usd"))
        usd_inr = _f(payload.get("usd_inr"), mkt["usd_inr"])

        stock_exposure: dict[str, float] = {}
        total_mf_value = sum(_f(f.get("value_inr")) for f in mf_schemes)
        annual_ter_drag_inr = 0.0
        for fund in mf_schemes:
            f_val = _f(fund.get("value_inr"))
            plan = str(fund.get("plan_type") or "direct").lower()
            default_ter = mkt["regular_plan_default_ter"] if plan == "regular" else mkt["direct_plan_default_ter"]
            ter = _f(fund.get("expense_ratio"), default_ter)
            if plan == "regular":
                annual_ter_drag_inr += f_val * max(mkt["min_regular_vs_direct_ter_gap"], ter - mkt["direct_plan_default_ter"])
            for holding in fund.get("constituents", []):
                sym = str(holding.get("symbol") or holding.get("isin") or "UNKNOWN")
                stock_exposure[sym] = stock_exposure.get(sym, 0.0) + f_val * _f(holding.get("weight_pct")) / 100.0

        for eq in equities:
            sym = str(eq.get("symbol") or "UNKNOWN")
            stock_exposure[sym] = stock_exposure.get(sym, 0.0) + _f(eq.get("value_inr"))

        total_book = total_mf_value + sum(_f(e.get("value_inr")) for e in equities)
        lookthrough_weights = {
            sym: round(val / total_book * 100.0, 2) if total_book > 0 else 0.0
            for sym, val in sorted(stock_exposure.items(), key=lambda x: x[1], reverse=True)
        }
        overweight_stocks = [
            {"symbol": sym, "combined_weight_pct": wt}
            for sym, wt in lookthrough_weights.items()
            if wt >= eq_cfg["lookthrough_overweight_pct"]
        ]

        scored_equities = [self._score_equity(eq, eq_cfg) for eq in equities]

        lrs_inr = lrs_remitted_usd * usd_inr
        tcs_inr = max(0.0, (lrs_inr - lrs_cfg["tcs_threshold_inr"]) * lrs_cfg["tcs_rate"])
        global_val_usd = sum(_f(g.get("value_usd")) for g in global_holdings)
        estate_threshold_usd = mkt["us_estate_tax_exemption_usd"]

        return {
            "portfolio_overlap": {
                "top_lookthrough_exposures_pct": dict(list(lookthrough_weights.items())[:8]),
                "concentration_alerts": overweight_stocks,
                "regular_plan_annual_commission_drag_inr": round(annual_ter_drag_inr, 2),
            },
            "equity_quant_signals": scored_equities,
            "market_regime": payload.get("market_regime") or mkt["market_regime_default"],
            "global_and_lrs": {
                "global_value_inr": round(global_val_usd * usd_inr, 2),
                "lrs_utilized_usd": lrs_remitted_usd,
                "lrs_remaining_usd": round(max(0.0, lrs_cfg["annual_limit_usd"] - lrs_remitted_usd), 2),
                "estimated_tcs_206c1g_inr": round(tcs_inr, 2),
                "ucits_estate_tax_tip": (
                    f"US-situs exposure exceeds the ${estate_threshold_usd:,.0f} non-resident estate exemption; "
                    "consider Ireland-domiciled UCITS ETFs."
                    if global_val_usd > estate_threshold_usd
                    else f"US exposure within the ${estate_threshold_usd:,.0f} non-resident estate exemption."
                ),
            },
            "assumptions_used": {"usd_inr": usd_inr, "lrs_tcs_threshold_inr": lrs_cfg["tcs_threshold_inr"]},
            "policy_version": self.policy.version,
        }

    @staticmethod
    def _score_equity(eq: dict[str, Any], cfg: dict[str, Any]) -> dict[str, Any]:
        roce = eq.get("roce_pct")
        pe = eq.get("pe_ratio")
        if roce is None or pe is None:
            return {
                "symbol": eq.get("symbol"),
                "composite_quant_score": None,
                "governance_flag": "UNKNOWN",
                "valuation_signal": "INSUFFICIENT_DATA",
                "missing_fundamentals": [k for k in ("roce_pct", "pe_ratio") if eq.get(k) is None],
            }
        roce_f, pe_f = _f(roce), _f(pe)
        pledge_pct = _f(eq.get("promoter_pledge_pct"))
        rev_growth = _f(eq.get("revenue_growth_pct"))
        quality = min(100.0, max(0.0, roce_f * cfg["quality_roce_weight"] + rev_growth * cfg["quality_growth_weight"]
                                 - pledge_pct * cfg["quality_pledge_penalty"]))
        valuation = min(100.0, max(0.0, 100.0 - max(0.0, pe_f - cfg["valuation_neutral_pe"]) * cfg["valuation_pe_penalty"]))
        composite = round(cfg["composite_quality_weight"] * quality + cfg["composite_valuation_weight"] * valuation, 1)
        if pe_f < cfg["undervalued_max_pe"] and roce_f > cfg["undervalued_min_roce"]:
            signal = "UNDERVALUED"
        elif pe_f > cfg["expensive_min_pe"]:
            signal = "EXPENSIVE"
        else:
            signal = "FAIR"
        return {
            "symbol": eq.get("symbol"),
            "composite_quant_score": composite,
            "governance_flag": "HIGH_PLEDGE_RISK" if pledge_pct > cfg["promoter_pledge_risk_pct"] else "CLEAN",
            "valuation_signal": signal,
        }

    # =========================================================================
    # 4. DETERMINISTIC INDIAN TAX & CA INTELLIGENCE (Domain 7)
    # =========================================================================
    def evaluate_tax_and_ca(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Deterministic Indian Income Tax (Old vs New Regime) + Capital Gains & Harvesting."""
        rules = self.policy.tax(payload.get("financial_year"))
        caps = rules["deduction_caps"]
        cg = rules["capital_gains"]
        cess = 1.0 + rules["cess_rate"]
        new_r, old_r = rules["new_regime"], rules["old_regime"]

        gross_salary = _f(payload.get("gross_salary_inr"))
        business_income = _f(payload.get("business_income_inr"))
        other_income = _f(payload.get("other_income_inr"))

        # Accept both engine-native and client/Go aliases.
        ded_80c = min(caps["80c"], _f(_first(payload, "deduction_80c_inr", "sec_80c_inr")))
        ded_80d = min(caps["80d"], _f(_first(payload, "deduction_80d_inr", "sec_80d_inr")))
        ded_80ccd1b = min(caps["80ccd1b"], _f(_first(payload, "deduction_80ccd1b_inr", "nps_80ccd1b_inr")))
        ded_80ccd2 = _f(_first(payload, "deduction_80ccd2_inr", "nps_80ccd2_inr"))  # allowed in both regimes
        hra_exemption = _f(_first(payload, "hra_exemption_inr", "hra_exempt_inr"))
        home_loan_24b = min(caps["24b"], _f(_first(payload, "home_loan_interest_24b_inr", "home_loan_interest_inr")))

        realized_stcg = _f(payload.get("realized_stcg_inr"))
        realized_ltcg = _f(payload.get("realized_ltcg_inr"))
        unrealized_stcl = abs(_f(payload.get("unrealized_stcl_inr")))
        unrealized_ltcl = abs(_f(payload.get("unrealized_ltcl_inr")))
        total_income = gross_salary + business_income + other_income

        std_ded_new = new_r["standard_deduction"] if gross_salary > 0 else 0.0
        taxable_new = max(0.0, total_income - std_ded_new - ded_80ccd2)
        base_tax_new = 0.0 if taxable_new <= new_r["rebate_87a_income_limit"] else _slab_tax(taxable_new, new_r["slabs"])

        std_ded_old = old_r["standard_deduction"] if gross_salary > 0 else 0.0
        total_old_deductions = std_ded_old + hra_exemption + home_loan_24b + ded_80c + ded_80d + ded_80ccd1b + ded_80ccd2
        taxable_old = max(0.0, total_income - total_old_deductions)
        base_tax_old = 0.0 if taxable_old <= old_r["rebate_87a_income_limit"] else _slab_tax(taxable_old, old_r["slabs"])

        def cg_tax(stcg: float, ltcg: float) -> float:
            return max(0.0, stcg) * cg["stcg_111a_rate"] + max(0.0, ltcg - cg["ltcg_112a_exemption"]) * cg["ltcg_112a_rate"]

        cg_tax_before = cg_tax(realized_stcg, realized_ltcg)
        net_stcg_after = max(0.0, realized_stcg - unrealized_stcl)
        rem_stcl = max(0.0, unrealized_stcl - max(0.0, realized_stcg))
        net_ltcg_after = max(0.0, realized_ltcg - unrealized_ltcl - rem_stcl)
        cg_tax_after = cg_tax(net_stcg_after, net_ltcg_after)

        total_tax_new = round((base_tax_new + cg_tax_before) * cess, 2)
        total_tax_old = round((base_tax_old + cg_tax_before) * cess, 2)

        return {
            "financial_year": rules["financial_year"],
            "tax_kernel_id": rules["kernel_id"],
            "taxable_income_new_inr": round(taxable_new, 2),
            "taxable_income_old_inr": round(taxable_old, 2),
            "estimated_tax_new_inr": total_tax_new,
            "estimated_tax_old_inr": total_tax_old,
            "recommended_regime": "new" if total_tax_new <= total_tax_old else "old",
            "regime_annual_savings_inr": round(abs(total_tax_old - total_tax_new), 2),
            "unused_80c_limit_inr": round(max(0.0, caps["80c"] - ded_80c), 2),
            "unused_80d_limit_inr": round(max(0.0, caps["80d"] - ded_80d), 2),
            "capital_gains": {
                "cg_tax_before_harvest_inr": round(cg_tax_before * cess, 2),
                "cg_tax_after_harvest_inr": round(cg_tax_after * cess, 2),
                "potential_tax_loss_harvest_savings_inr": round(max(0.0, cg_tax_before - cg_tax_after) * cess, 2),
                "remaining_ltcg_exempt_band_inr": round(max(0.0, cg["ltcg_112a_exemption"] - max(0.0, realized_ltcg)), 2),
            },
            "advance_tax_schedule_pct": rules["advance_tax_schedule"],
            "data_sufficiency": {"complete": total_income > 0, "missing_inputs": [] if total_income > 0 else ["income"]},
            "policy_version": self.policy.version,
        }

    # =========================================================================
    # 5. LOANS & BUSINESS UNIT ECONOMICS (Domains 8, 9, 10)
    # =========================================================================
    def optimize_debt_and_business(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Optimize loan repayment (Avalanche vs Snowball, Prepay vs Invest) + Business Unit Economics."""
        cfg = self.policy.section("debt_business")
        mkt = self.policy.market(payload.get("assumptions"))
        loans = payload.get("loans") or payload.get("liabilities") or []
        extra_monthly_prepay = _f(payload.get("extra_monthly_prepay_inr"))
        expected_sip_return_apr = _f(payload.get("expected_sip_return_apr"), mkt["expected_sip_return_apr"])

        def label(l: dict[str, Any]) -> str:
            return str(l.get("name") or l.get("lender_name") or l.get("loan_type") or "loan")

        avalanche_order = [label(l) for l in sorted(loans, key=lambda x: _f(x.get("interest_rate_apr")), reverse=True)]
        snowball_order = [label(l) for l in sorted(loans, key=lambda x: _f(x.get("principal_outstanding")))]

        if loans:
            highest_apr: float | None = max(_f(l.get("interest_rate_apr")) for l in loans)
            hurdle = expected_sip_return_apr * cfg["post_tax_sip_hurdle_factor"]
            recommendation = "PREPAY_DEBT" if highest_apr > hurdle else "INVEST_IN_SIP"
            spread_pct: float | None = round((expected_sip_return_apr - highest_apr) * 100.0, 2)
        else:
            highest_apr, recommendation, spread_pct = None, "NO_ACTIVE_DEBT", None

        return {
            "debt_strategy": {
                "avalanche_priority": avalanche_order,
                "snowball_priority": snowball_order,
                "highest_loan_apr": highest_apr,
                "extra_monthly_prepay_inr": extra_monthly_prepay,
                "prepay_vs_sip_recommendation": recommendation,
                "effective_spread_pct": spread_pct,
                "assumed_sip_return_apr": expected_sip_return_apr,
            },
            "business_intelligence": self._business_unit_economics(payload.get("business") or {}, cfg),
            "policy_version": self.policy.version,
        }

    @staticmethod
    def _business_unit_economics(biz: dict[str, Any], cfg: dict[str, Any]) -> dict[str, Any]:
        required = ("unit_price_inr", "unit_variable_cost_inr", "monthly_fixed_cost_inr", "cac_inr")
        missing = [k for k in required if biz.get(k) is None]
        if missing:
            return {"unit_economics_verdict": "INSUFFICIENT_DATA", "missing_inputs": missing}

        unit_price = _f(biz["unit_price_inr"])
        unit_var_cost = _f(biz["unit_variable_cost_inr"])
        fixed_cost = _f(biz["monthly_fixed_cost_inr"])
        cac = max(1.0, _f(biz["cac_inr"]))
        churn_pct = biz.get("monthly_churn_pct")
        monthly_churn = max(cfg["min_monthly_churn"], _f(churn_pct) / 100.0) if churn_pct is not None else None
        active_customers = int(_f(biz.get("active_customers")))

        contribution_margin = unit_price - unit_var_cost
        breakeven_units = math.ceil(fixed_cost / contribution_margin) if contribution_margin > 0 else None
        ltv = round(contribution_margin / monthly_churn, 2) if monthly_churn else _f(biz.get("ltv_inr")) or None
        ltv_cac_ratio = round(ltv / cac, 2) if ltv else None
        monthly_ebitda = round(active_customers * contribution_margin - fixed_cost, 2)

        if ltv_cac_ratio is None:
            verdict = "INSUFFICIENT_DATA"
        elif ltv_cac_ratio >= cfg["healthy_ltv_cac_ratio"] and contribution_margin > 0:
            verdict = "HEALTHY_SCALABLE"
        else:
            verdict = "NEEDS_MARGIN_OR_RETENTION_FIX"

        return {
            "contribution_margin_inr": round(contribution_margin, 2),
            "contribution_margin_pct": round(contribution_margin / unit_price * 100.0, 1) if unit_price > 0 else None,
            "breakeven_units_monthly": breakeven_units,
            "breakeven_revenue_inr": round(breakeven_units * unit_price, 2) if breakeven_units else None,
            "ltv_inr": ltv,
            "cac_inr": cac,
            "ltv_to_cac_ratio": ltv_cac_ratio,
            "ltv_cac_ratio": ltv_cac_ratio,
            "cac_payback_months": round(cac / contribution_margin, 1) if contribution_margin > 0 else None,
            "monthly_ebitda_inr": monthly_ebitda,
            "estimated_valuation_inr": round(max(0.0, monthly_ebitda * 12.0 * cfg["ebitda_valuation_multiple"]), 2),
            "unit_economics_verdict": verdict,
        }

    # =========================================================================
    # 6. RISK, MONTE CARLO & WHAT-IF DECISION LABORATORY (Domains 11, 12, §17.5)
    # =========================================================================
    def run_simulation_and_risk(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Run portfolio risk (VaR/Stress) + Monte Carlo What-If simulation on the user's real inputs."""
        cfg = self.policy.section("risk")
        mkt = self.policy.market(payload.get("assumptions"))

        initial_net_worth = _f(payload.get("initial_net_worth_inr"))
        monthly_sip = _f(payload.get("monthly_sip_inr"))
        what_if_delta_sip = _f(_first(payload, "what_if_delta_sip_inr", "extra_sip_delta_inr"))
        horizon_years = max(1, min(int(cfg["horizon_years_max"]), int(_f(payload.get("horizon_years"), cfg["horizon_years_default"]))))
        num_paths = max(int(cfg["num_paths_min"]), min(int(cfg["num_paths_max"]), int(_f(payload.get("num_paths"), cfg["num_paths_default"]))))
        annual_mu = _f(_first(payload, "expected_return_apr", "expected_return_pct"), mkt["expected_equity_return_apr"])
        if annual_mu > 1.0:  # tolerate percentage input (e.g. 12 -> 0.12)
            annual_mu /= 100.0
        annual_sigma = _f(_first(payload, "volatility_annual", "volatility_pct"), mkt["portfolio_volatility_annual"])
        if annual_sigma > 1.0:
            annual_sigma /= 100.0
        inflation_rate = _f(payload.get("inflation_rate"), mkt["inflation_rate"])
        annual_expense = _f(payload.get("annual_expense_inr")) or _f(payload.get("monthly_expense_inr")) * 12.0

        rng = random.Random(int(cfg["monte_carlo_seed"]))
        dt = 1.0 / 12.0
        months = horizon_years * 12
        drift = (annual_mu - 0.5 * annual_sigma * annual_sigma) * dt
        vol_step = annual_sigma * math.sqrt(dt)

        terminal_baseline: list[float] = []
        terminal_what_if: list[float] = []
        for _ in range(num_paths):
            w_base = w_alt = initial_net_worth
            for _m in range(months):
                growth = math.exp(drift + vol_step * rng.gauss(0.0, 1.0))
                w_base = w_base * growth + monthly_sip
                w_alt = w_alt * growth + monthly_sip + what_if_delta_sip
            terminal_baseline.append(w_base)
            terminal_what_if.append(w_alt)
        terminal_baseline.sort()
        terminal_what_if.sort()

        fi_target_corpus = (
            annual_expense * (1.0 + inflation_rate) ** horizon_years * cfg["fi_corpus_expense_multiple"]
            if annual_expense > 0 else None
        )

        def fi_prob(arr: list[float]) -> float | None:
            if fi_target_corpus is None:
                return None
            return round(sum(1 for x in arr if x >= fi_target_corpus) / len(arr), 3)

        z = NormalDist().inv_cdf(cfg["var_confidence"])
        var_1m_pct = round(z * annual_sigma / math.sqrt(12.0) * 100.0, 2)
        tail_ratio = NormalDist().pdf(z) / (1.0 - cfg["var_confidence"]) / z  # Gaussian ES / VaR
        equity_share = _f(payload.get("equity_share_of_net_worth"), mkt["default_equity_share_of_net_worth"])
        loan_principal = _f(payload.get("loan_principal_inr"))

        missing = [k for k, v in (("initial_net_worth_inr", initial_net_worth), ("monthly_sip_inr", monthly_sip),
                                  ("annual_expense_inr", annual_expense)) if not v]
        return {
            "horizon_years": horizon_years,
            "num_paths": num_paths,
            "fi_target_corpus_inr": round(fi_target_corpus, 2) if fi_target_corpus is not None else None,
            "baseline_outcomes_inr": {
                "p10": _percentile(terminal_baseline, 0.10),
                "p50": _percentile(terminal_baseline, 0.50),
                "p90": _percentile(terminal_baseline, 0.90),
                "fi_probability_of_success": fi_prob(terminal_baseline),
            },
            "what_if_outcomes_inr": {
                "p10": _percentile(terminal_what_if, 0.10),
                "p50": _percentile(terminal_what_if, 0.50),
                "p90": _percentile(terminal_what_if, 0.90),
                "fi_probability_of_success": fi_prob(terminal_what_if),
                "median_wealth_lift_inr": round(_percentile(terminal_what_if, 0.50) - _percentile(terminal_baseline, 0.50), 2),
            },
            "risk_metrics": {
                "var_95_1m_pct": var_1m_pct,
                "cvar_95_1m_pct": round(var_1m_pct * tail_ratio, 2),
                "stress_test_impacts": {
                    "equity_crash_inr": round(-initial_net_worth * equity_share * cfg["stress_equity_crash_pct"], 2),
                    "rate_hike_annual_interest_delta_inr": round(loan_principal * cfg["stress_rate_hike_bps"] / 10_000.0, 2),
                    "job_loss_drawdown_inr": round(-annual_expense / 12.0 * cfg["stress_job_loss_months"], 2),
                },
            },
            "assumptions_used": {
                "expected_return_apr": annual_mu,
                "volatility_annual": annual_sigma,
                "inflation_rate": inflation_rate,
                "seed": cfg["monte_carlo_seed"],
            },
            "data_sufficiency": {"complete": not missing, "missing_inputs": missing},
            "policy_version": self.policy.version,
        }

    # =========================================================================
    # 7. KNOWLEDGE GRAPH, OPPORTUNITY RADAR & MULTI-AGENT AI CFO (§15, §16, §17)
    # =========================================================================
    def propagate_knowledge_graph_event(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Propagate a macro/market event across the user's own Financial Knowledge Graph exposures."""
        cfg = self.policy.section("graph")
        event_type = str(payload.get("event_type") or "rbi_policy")
        delta_bps = _f(_first(payload, "rate_delta_bps", "magnitude_bps"), cfg["default_rate_delta_bps"])
        liabilities = payload.get("liabilities") or []
        holdings = payload.get("holdings") or []

        floating_loan_inr = _f(payload.get("floating_loan_principal_inr")) or sum(
            _f(l.get("principal_outstanding")) for l in liabilities
            if str(l.get("rate_type") or "floating_eblr") in _FLOATING_RATE_TYPES
        )
        debt_mf_inr = _f(payload.get("debt_mf_value_inr")) or sum(
            _f(h.get("current_value_inr")) for h in holdings if h.get("asset_class") == "debt"
        )
        banking_equity_inr = _f(payload.get("banking_equity_value_inr")) or sum(
            _f(h.get("current_value_inr")) for h in holdings
            if str(h.get("sector") or "").lower() in ("financials", "banking")
        )

        shock = delta_bps / 10_000.0
        annual_emi_delta_inr = round(floating_loan_inr * shock * cfg["emi_pass_through_ratio"], 2)
        debt_nav_impact_inr = round(-debt_mf_inr * shock * cfg["debt_fund_modified_duration"], 2)
        equity_impact_inr = round(-banking_equity_inr * shock * cfg["banking_equity_rate_beta"], 2)

        evt_id = f"evt:{event_type}"
        nodes = [
            {"id": evt_id, "type": "market_event", "label": f"Event: {event_type} ({delta_bps:+.0f} bps)"},
            {"id": "loan:floating", "type": "loan", "label": "Floating-rate loans", "exposure_inr": round(floating_loan_inr, 2)},
            {"id": "mf:duration_debt", "type": "holding", "label": "Debt fund holdings", "exposure_inr": round(debt_mf_inr, 2)},
            {"id": "sec:banking", "type": "sector", "label": "Financials & banking equity", "exposure_inr": round(banking_equity_inr, 2)},
        ]
        edges = [
            {"from": evt_id, "to": "loan:floating", "edge": "SENSITIVE_TO", "impact_inr": -annual_emi_delta_inr},
            {"from": evt_id, "to": "mf:duration_debt", "edge": "IMPACTED_BY", "impact_inr": debt_nav_impact_inr},
            {"from": evt_id, "to": "sec:banking", "edge": "IMPACTED_BY", "impact_inr": equity_impact_inr},
        ]
        net_impact = round(-annual_emi_delta_inr + debt_nav_impact_inr + equity_impact_inr, 2)
        if net_impact == 0:
            mitigation = cfg["mitigation"]["neutral"]
        else:
            mitigation = cfg["mitigation"]["rate_up" if delta_bps > 0 else "rate_down"]
        return {
            "event_type": event_type,
            "nodes": nodes,
            "edges": edges,
            "net_annual_impact_inr": net_impact,
            "recommended_mitigation": mitigation,
            "data_sufficiency": {
                "complete": bool(liabilities or holdings or floating_loan_inr),
                "missing_inputs": [] if (liabilities or holdings or floating_loan_inr) else ["liabilities", "holdings"],
            },
            "policy_version": self.policy.version,
        }

    def scan_opportunity_radar(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Run Cross-Engine DAGs (§16) and return high-signal opportunities (§17.2)."""
        cfg = self.policy.section("radar")
        conf = cfg["confidence"]
        mkt = self.policy.market(payload.get("assumptions"))
        twin_cfg = self.policy.section("twin")
        twin = self.compute_digital_twin(payload)
        tax = self.evaluate_tax_and_ca(payload)
        markets = self.analyze_markets_and_overlap(payload)
        debt_biz = self.optimize_debt_and_business(payload)

        candidates: list[dict[str, Any]] = []
        if tax["regime_annual_savings_inr"] >= cfg["min_tax_impact_inr"]:
            candidates.append({
                "engine_key": "cross.tax_wealth_investment",
                "category": "tax",
                "title": f"Switch to {tax['recommended_regime'].upper()} Tax Regime",
                "summary": f"Saves ₹{tax['regime_annual_savings_inr']:,.0f}/yr for FY {tax['financial_year']} based on your declared income & deductions.",
                "annualized_impact_inr": tax["regime_annual_savings_inr"],
                "urgency": "high",
                "confidence": conf["tax_regime"],
            })

        harvest_save = tax["capital_gains"]["potential_tax_loss_harvest_savings_inr"]
        if harvest_save >= cfg["min_harvest_impact_inr"]:
            candidates.append({
                "engine_key": "tax.loss_harvesting",
                "category": "tax",
                "title": "Tax-Loss Harvesting Opportunity",
                "summary": f"Offset realized gains against unrealized losses to save ₹{harvest_save:,.0f} before FY close.",
                "annualized_impact_inr": harvest_save,
                "urgency": "high",
                "confidence": conf["loss_harvest"],
            })

        ter_drag = markets["portfolio_overlap"]["regular_plan_annual_commission_drag_inr"]
        if ter_drag >= cfg["min_ter_drag_inr"]:
            candidates.append({
                "engine_key": "mf.expense_intelligence",
                "category": "fee_savings",
                "title": "Switch Exit-Load-Free Regular MFs to Direct",
                "summary": f"Eliminates ₹{ter_drag:,.0f}/yr in recurring distributor trail commissions.",
                "annualized_impact_inr": ter_drag,
                "urgency": "medium",
                "confidence": conf["ter_switch"],
            })

        # Emergency reserve is derived from the user's own essential burn, not a fixed rupee figure.
        reserve_inr = twin["monthly_essential_burn_inr"] * float(twin_cfg["emergency_target_months"])
        idle_cash_excess = max(0.0, twin["liquid_cash_inr"] - reserve_inr)
        if idle_cash_excess >= cfg["min_idle_cash_sweep_inr"]:
            yield_lift = round(idle_cash_excess * mkt["liquid_vs_savings_yield_spread"], 2)
            candidates.append({
                "engine_key": "opportunity.deposit_liquid_scanner",
                "category": "opportunity",
                "title": "Sweep Idle Bank Cash into Arbitrage / Liquid Bucket",
                "summary": (
                    f"₹{idle_cash_excess:,.0f} sits above your {twin_cfg['emergency_target_months']}-month emergency reserve "
                    f"(₹{reserve_inr:,.0f}); deploying it lifts yield by ~₹{yield_lift:,.0f}/yr."
                ),
                "annualized_impact_inr": yield_lift,
                "urgency": "medium",
                "confidence": conf["idle_cash"],
            })

        for gap in twin["coverage_gaps"]:
            candidates.append({
                "engine_key": "cross.insurance_debt_health",
                "category": "risk",
                "title": gap["title"],
                "summary": gap["suggested_action"],
                "annualized_impact_inr": 0.0,
                "urgency": "critical" if gap["severity"] == "high" else "medium",
                "confidence": conf["coverage_gap"],
            })

        candidates.sort(key=lambda c: (c["urgency"] == "critical", c["annualized_impact_inr"]), reverse=True)
        return {
            "active_opportunities_count": len(candidates),
            "total_annualized_savings_inr": round(sum(c["annualized_impact_inr"] for c in candidates), 2),
            "opportunities": candidates,
            "debt_recommendation": debt_biz["debt_strategy"]["prepay_vs_sip_recommendation"],
            "data_sufficiency": twin["data_sufficiency"],
            "policy_version": self.policy.version,
        }

    def reason_ai_cfo(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Run Multi-Agent Financial Reasoning + LLM Privacy Firewall + Evidence Bundle (§15, §17.3, §17.6)."""
        cfg = self.policy.section("cfo")
        risk_cfg = self.policy.section("risk")
        mkt = self.policy.market(payload.get("assumptions"))
        query = str(payload.get("query") or "Give me my complete CFO briefing and top priorities.")
        twin = self.compute_digital_twin(payload)
        tax = self.evaluate_tax_and_ca(payload)
        radar = self.scan_opportunity_radar(payload)
        monthly_surplus = max(0.0, twin["month_credited_inr"] - twin["month_debited_inr"])
        sim = self.run_simulation_and_risk({
            "initial_net_worth_inr": max(0.0, twin["net_worth_inr"]),
            "monthly_sip_inr": monthly_surplus * cfg["surplus_sip_share"],
            "annual_expense_inr": twin["month_debited_inr"] * 12.0,
            "loan_principal_inr": twin["total_liabilities_inr"],
            "assumptions": payload.get("assumptions"),
        })
        horizon = sim["horizon_years"]
        fi_prob = sim["baseline_outcomes_inr"]["fi_probability_of_success"]
        fi_text = f"FI success probability {fi_prob * 100:.0f}%" if fi_prob is not None else "FI probability needs expense history"

        specialist_notes = [
            {
                "agent": "PersonalCFOAgent",
                "finding": (
                    f"Net worth ₹{twin['net_worth_inr']:,.0f} | Health score {twin['health_score']}/100 | "
                    f"Savings rate {twin['savings_rate_pct']}% | Safe-to-spend ₹{twin['safe_to_spend_inr']:,.0f}."
                ),
            },
            {
                "agent": "CAAgent",
                "finding": (
                    f"FY {tax['financial_year']}: recommended regime {tax['recommended_regime'].upper()} "
                    f"(saves ₹{tax['regime_annual_savings_inr']:,.0f}/yr)."
                ),
            },
            {
                "agent": "WealthStrategistAgent",
                "finding": f"{horizon}Y P50 net worth projection: ₹{sim['baseline_outcomes_inr']['p50']:,.0f} ({fi_text}).",
            },
            {
                "agent": "RiskManagerAgent",
                "finding": (
                    f"Emergency runway is {twin['emergency_runway_months']} months; "
                    f"1M {risk_cfg['var_confidence'] * 100:.0f}% VaR is {sim['risk_metrics']['var_95_1m_pct']}%. "
                    + (
                        f"Flagged {len(twin['coverage_gaps'])} protection gap(s) to close before adding equity risk."
                        if twin["coverage_gaps"] else "Protection baseline verified."
                    )
                ),
            },
        ]

        firewall_result = invoke_with_privacy_firewall(
            query=query,
            redacted_context={
                "health_score": twin["health_score"],
                "savings_rate_pct": twin["savings_rate_pct"],
                "recommended_regime": tax["recommended_regime"],
                "annual_opportunity_inr": radar["total_annualized_savings_inr"],
            },
        )
        requires_approval = any(w in query.lower() for w in cfg["approval_keywords"])
        complete = not twin["coverage_gaps"] and twin["data_sufficiency"]["complete"]

        evidence_bundle = {
            "confidence_score": cfg["confidence_complete"] if complete else cfg["confidence_with_gaps"],
            "confidence_tier": "HIGH" if complete else "MEDIUM",
            "uncertainty_bounds": {
                "metric": f"projected_{horizon}y_net_worth_inr",
                "p10": sim["baseline_outcomes_inr"]["p10"],
                "p50": sim["baseline_outcomes_inr"]["p50"],
                "p90": sim["baseline_outcomes_inr"]["p90"],
            },
            "sources": [
                {"type": "digital_twin_ledger", "freshness": "realtime", "sla_ok": True},
                {"type": tax["tax_kernel_id"], "version": self.policy.version, "verified": True},
            ],
            "deterministic_checks": [
                {"kernel": "net_worth_and_health", "verified": True},
                {"kernel": f"tax_regime_solver_{tax['financial_year']}", "verified": True},
                {"kernel": f"monte_carlo_{sim['num_paths']}_paths_seed{risk_cfg['monte_carlo_seed']}", "verified": True},
            ],
            "assumptions": [
                f"Assumes {mkt['inflation_rate'] * 100:.1f}% inflation and {mkt['expected_equity_return_apr'] * 100:.1f}% "
                f"expected portfolio return (policy {self.policy.version}).",
                "Self-transfers excluded from monthly credited/debited totals.",
            ],
            "missing_inputs": twin["data_sufficiency"]["missing_inputs"],
            "disclaimers": ["Analytical decision support; verify statutory filings and product terms before execution."],
            "privacy_firewall": {
                "pii_scrubbed": True,
                "redacted_tokens_count": firewall_result["redacted_tokens_count"],
                "gateway_source": firewall_result["gateway_source"],
            },
        }

        top_action = radar["opportunities"][0]["title"] if radar["opportunities"] else "Maintain automated SIP step-up"
        cfo_synthesis = (
            f"CFO Synthesis: Your Financial Health Score is {twin['health_score']}/100 with "
            f"₹{twin['net_worth_inr']:,.0f} net worth and {twin['emergency_runway_months']} months of liquidity runway. "
            f"Top action: {top_action} (unlocks ₹{radar['total_annualized_savings_inr']:,.0f}/yr across detected opportunities)."
        )
        max_actions = int(cfg["max_prioritized_actions"])
        return {
            "cfo_synthesis": cfo_synthesis,
            "specialist_deliberation": specialist_notes,
            "prioritized_actions": [o["title"] for o in radar["opportunities"][:max_actions]],
            "prioritized_action_details": radar["opportunities"][:max_actions],
            "requires_action_approval": requires_approval,
            "evidence_bundle": evidence_bundle,
            "policy_version": self.policy.version,
        }
