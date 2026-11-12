"""Unit tests for the NEXORA Finance Intelligence Network (15 Domains, Cross-Engine DAGs & AI CFO)."""

from __future__ import annotations

import unittest

from nexora.inference.api import (
    events_status,
    finance_cfo_reason,
    finance_debt_business_optimize,
    finance_digital_twin,
    finance_graph_propagate,
    finance_markets_analyze,
    finance_parse_alert,
    finance_radar_scan,
    finance_simulate_what_if,
    finance_tax_evaluate,
    ingest_event,
)


class TestFinanceIntelligence(unittest.TestCase):
    def test_zero_aa_realtime_alert_parser_and_blind_index(self) -> None:
        alert = finance_parse_alert(
            {
                "raw_text": (
                    "Rs. 1,450.00 debited from A/c **4821 on 12-11-26 to VPA swiggy@icici "
                    "(UPI Ref No 631412349876). Avl Bal: INR 1,84,230.50"
                ),
                "source_channel": "android_notification",
            }
        )
        self.assertEqual(alert["txn_type"], "debit")
        self.assertEqual(alert["channel"], "upi")
        self.assertEqual(alert["amount"], -1450.0)
        self.assertEqual(alert["balance_after_txn"], 184230.50)
        self.assertEqual(alert["masked_account"], "**4821")
        self.assertEqual(alert["category"], "Food & Dining")
        self.assertEqual(alert["upi_vpa_masked"], "sw***@icici")
        self.assertIsNotNone(alert["upi_vpa_blind_idx"])

    def test_digital_twin_health_score_and_backward_replay(self) -> None:
        twin = finance_digital_twin(
            {
                "accounts": [
                    {"account_type": "bank", "current_balance": 450_000.0},
                    {"account_type": "retirement", "current_balance": 800_000.0},
                ],
                "holdings": [{"current_value_inr": 1_850_000.0}],
                "physical_assets": [{"estimated_value_inr": 500_000.0}],
                "liabilities": [{"principal_outstanding": 1_200_000.0, "emi_amount": 18_500.0}],
                "transactions": [
                    {"amount": 150_000.0, "txn_type": "credit"},
                    {"amount": -42_000.0, "txn_type": "debit", "is_discretionary": False},
                    {"amount": -15_000.0, "txn_type": "debit", "is_discretionary": True},
                    {"amount": -25_000.0, "txn_type": "transfer", "is_internal_transfer": True},
                ],
                "recurring_obligations": [{"expected_amount": 22_000.0, "status": "active"}],
                "insurance_policies": [
                    {"policy_type": "term_life", "cover_source": "personal"},
                    {"policy_type": "health", "cover_source": "personal"},
                ],
            }
        )
        self.assertEqual(twin["total_assets_inr"], 3_600_000.0)
        self.assertEqual(twin["total_liabilities_inr"], 1_200_000.0)
        self.assertEqual(twin["net_worth_inr"], 2_400_000.0)
        self.assertEqual(twin["month_credited_inr"], 150_000.0)
        self.assertEqual(twin["month_debited_inr"], 57_000.0)
        self.assertGreaterEqual(twin["health_score"], 75)
        self.assertEqual(len(twin["coverage_gaps"]), 0)
        self.assertGreaterEqual(len(twin["backward_replay_history"]), 4)

    def test_markets_mf_overlap_and_lrs_intelligence(self) -> None:
        res = finance_markets_analyze(
            {
                "mutual_funds": [
                    {
                        "name": "Flexi Cap Regular",
                        "plan_type": "regular",
                        "value_inr": 600_000.0,
                        "expense_ratio": 0.018,
                        "constituents": [
                            {"symbol": "HDFCBANK", "weight_pct": 9.5},
                            {"symbol": "ICICIBANK", "weight_pct": 8.0},
                        ],
                    },
                    {
                        "name": "Large Cap Direct",
                        "plan_type": "direct",
                        "value_inr": 400_000.0,
                        "constituents": [
                            {"symbol": "HDFCBANK", "weight_pct": 10.0},
                        ],
                    },
                ],
                "equities": [
                    {"symbol": "HDFCBANK", "value_inr": 200_000.0, "roce_pct": 19.0, "pe_ratio": 17.5},
                ],
                "lrs_remitted_usd": 12_000.0,
                "usd_inr": 84.0,
            }
        )
        self.assertGreater(res["portfolio_overlap"]["regular_plan_annual_commission_drag_inr"], 5000.0)
        self.assertGreater(res["portfolio_overlap"]["top_lookthrough_exposures_pct"]["HDFCBANK"], 20.0)
        self.assertGreater(res["global_and_lrs"]["estimated_tcs_206c1g_inr"], 0.0)

    def test_tax_regime_comparison_and_loss_harvesting(self) -> None:
        tax = finance_tax_evaluate(
            {
                "gross_salary_inr": 2_400_000.0,
                "deduction_80c_inr": 150_000.0,
                "deduction_80d_inr": 50_000.0,
                "deduction_80ccd1b_inr": 50_000.0,
                "hra_exemption_inr": 360_000.0,
                "home_loan_interest_24b_inr": 200_000.0,
                "realized_stcg_inr": 80_000.0,
                "realized_ltcg_inr": 225_000.0,
                "unrealized_stcl_inr": 50_000.0,
            }
        )
        self.assertIn(tax["recommended_regime"], ("old", "new"))
        self.assertGreater(tax["capital_gains"]["potential_tax_loss_harvest_savings_inr"], 0.0)

    def test_debt_business_what_if_and_ai_cfo_privacy_firewall(self) -> None:
        opt = finance_debt_business_optimize(
            {
                "loans": [
                    {"name": "Personal Loan", "interest_rate_apr": 0.145, "principal_outstanding": 250_000.0},
                    {"name": "Home Loan", "interest_rate_apr": 0.086, "principal_outstanding": 3_200_000.0},
                ],
                "business": {
                    "unit_price_inr": 3000.0,
                    "unit_variable_cost_inr": 600.0,
                    "monthly_fixed_cost_inr": 180_000.0,
                    "cac_inr": 2400.0,
                    "monthly_churn_pct": 3.0,
                    "active_customers": 150,
                },
            }
        )
        self.assertEqual(opt["debt_strategy"]["avalanche_priority"][0], "Personal Loan")
        self.assertEqual(opt["business_intelligence"]["unit_economics_verdict"], "HEALTHY_SCALABLE")

        sim = finance_simulate_what_if(
            {
                "initial_net_worth_inr": 2_000_000.0,
                "monthly_sip_inr": 40_000.0,
                "what_if_delta_sip_inr": 15_000.0,
                "horizon_years": 10,
                "num_paths": 200,
            }
        )
        self.assertGreater(sim["what_if_outcomes_inr"]["p50"], sim["baseline_outcomes_inr"]["p50"])

        kg = finance_graph_propagate({"event_type": "rbi_policy", "rate_delta_bps": 50.0})
        self.assertEqual(len(kg["edges"]), 3)

        radar = finance_radar_scan(
            {
                "accounts": [{"account_type": "bank", "current_balance": 600_000.0}],
                "gross_salary_inr": 2_200_000.0,
                "realized_stcg_inr": 60_000.0,
                "unrealized_stcl_inr": 40_000.0,
            }
        )
        self.assertGreaterEqual(radar["active_opportunities_count"], 2)

        cfo = finance_cfo_reason(
            {
                "query": "My PAN is ABCDE1234F and VPA is sahil@okicici — should I rebalance and prepay my loan?",
                "accounts": [{"account_type": "bank", "current_balance": 500_000.0}],
                "gross_salary_inr": 2_000_000.0,
            }
        )
        self.assertTrue(cfo["requires_action_approval"])
        self.assertTrue(cfo["evidence_bundle"]["privacy_firewall"]["pii_scrubbed"])
        self.assertGreaterEqual(cfo["evidence_bundle"]["privacy_firewall"]["redacted_tokens_count"], 2)

        ingest_event(
            {
                "event_id": "evt-fin-1",
                "event_type": "finance.transaction.ingested.v1",
                "payload": {"amount": -1450.0, "category": "Food & Dining"},
            }
        )
        self.assertGreaterEqual(events_status()["finance_events_count"], 1)

    def test_policy_overrides_and_zero_fabricated_defaults_when_inputs_missing(self) -> None:
        empty_tax = finance_tax_evaluate({})
        self.assertFalse(empty_tax["data_sufficiency"]["complete"])
        self.assertIn("income", empty_tax["data_sufficiency"]["missing_inputs"])
        self.assertEqual(empty_tax["estimated_tax_new_inr"], 0.0)

        empty_debt = finance_debt_business_optimize({})
        self.assertEqual(empty_debt["business_intelligence"]["unit_economics_verdict"], "INSUFFICIENT_DATA")
        self.assertEqual(empty_debt["debt_strategy"]["prepay_vs_sip_recommendation"], "NO_ACTIVE_DEBT")
        self.assertIsNone(empty_debt["debt_strategy"]["highest_loan_apr"])

        mkt_override = finance_markets_analyze(
            {
                "lrs_remitted_usd": 12_000.0,
                "assumptions": {"usd_inr": 90.0},
            }
        )
        self.assertEqual(mkt_override["assumptions_used"]["usd_inr"], 90.0)
        # 12000 * 90 = 1,080,000 -> (1,080,000 - 1,000,000) * 0.20 = 16,000.0
        self.assertEqual(mkt_override["global_and_lrs"]["estimated_tcs_206c1g_inr"], 16_000.0)


if __name__ == "__main__":
    unittest.main()
