-- Rollback Migration 0006 — Financial Intelligence Network Data Model

-- 1. Drop Section 6 tables (AI CFO, Graph, Radar, Simulation, Behaviour, Risk, Evidence)
DROP TRIGGER IF EXISTS trg_decision_journal_touch ON finance.decision_journal;
DROP TABLE IF EXISTS finance.decision_journal;
DROP TABLE IF EXISTS finance.radar_alerts;
DROP TABLE IF EXISTS finance.market_events;
DROP TABLE IF EXISTS finance.kg_edges;
DROP TABLE IF EXISTS finance.kg_nodes;
DROP TABLE IF EXISTS finance.simulation_runs;
DROP TABLE IF EXISTS finance.behaviour_signals;
DROP TABLE IF EXISTS finance.risk_assessments;
DROP TABLE IF EXISTS finance.evidence_bundles;

-- 2. Drop Section 5 tables (Business, Insurance, Credit, Loans)
DROP TABLE IF EXISTS finance.gst_ledger;
DROP TABLE IF EXISTS finance.business_metrics_ts;
DROP TABLE IF EXISTS finance.business_entities;
DROP TABLE IF EXISTS finance.insurance_policies;
DROP TABLE IF EXISTS finance.credit_reports;
DROP TABLE IF EXISTS finance.liabilities;

-- 3. Drop Section 4 tables (Tax & CA, Parsed Documents)
DROP TABLE IF EXISTS finance.tax_deadlines;
DROP TABLE IF EXISTS finance.tds_entries;
DROP TABLE IF EXISTS finance.tax_deductions;
DROP TABLE IF EXISTS finance.tax_profiles;
DROP TABLE IF EXISTS finance.parsed_documents;

-- 4. Drop Section 3 tables (Goals, Assets, Tax Lots, Holdings, Markets)
DROP TABLE IF EXISTS finance.allocation_targets;
DROP TABLE IF EXISTS finance.goal_allocations;
DROP TABLE IF EXISTS finance.goals;
DROP TABLE IF EXISTS finance.physical_assets;
DROP TABLE IF EXISTS finance.tax_lots;
DROP TABLE IF EXISTS finance.holdings;
DROP TABLE IF EXISTS finance.mf_holdings_constituents;
DROP TABLE IF EXISTS finance.market_prices_ts;
DROP TABLE IF EXISTS finance.market_instruments;

-- 5. Drop Section 2 tables (Coverage, Digital Twin, Reconciliation, Recurring, Cards, UPI, Balances, Consents, Profiles)
DROP TABLE IF EXISTS finance.coverage_gaps;
DROP TABLE IF EXISTS finance.digital_twin_snapshots;
DROP TABLE IF EXISTS finance.reconciliation_links;
DROP TABLE IF EXISTS finance.recurring_obligations;
DROP TABLE IF EXISTS finance.credit_cards;
DROP TABLE IF EXISTS finance.upi_mandates;
DROP TRIGGER IF EXISTS trg_ingestion_channels_touch ON finance.ingestion_channels;
DROP TABLE IF EXISTS finance.ingestion_channels;
DROP TABLE IF EXISTS finance.user_encryption_keys;
DROP TABLE IF EXISTS finance.balance_history;

ALTER TABLE finance.accounts
    DROP CONSTRAINT IF EXISTS fk_accounts_consent;

DROP TRIGGER IF EXISTS trg_consents_touch ON finance.consent_artefacts;
DROP TABLE IF EXISTS finance.consent_artefacts;
DROP TRIGGER IF EXISTS trg_fin_profiles_touch ON finance.financial_profiles;
DROP TABLE IF EXISTS finance.financial_profiles;

-- 6. Revert extensions to finance.transactions & finance.accounts
DROP INDEX IF EXISTS idx_txn_user_rollup;
DROP INDEX IF EXISTS idx_txn_reconcile;
DROP INDEX IF EXISTS idx_txn_merchant;
DROP INDEX IF EXISTS idx_txn_account_external_id;

ALTER TABLE finance.transactions
    DROP COLUMN IF EXISTS upi_vpa_blind_idx,
    DROP COLUMN IF EXISTS counterparty_enc,
    DROP COLUMN IF EXISTS upi_vpa_enc,
    DROP COLUMN IF EXISTS description_enc,
    DROP COLUMN IF EXISTS balance_after_txn,
    DROP COLUMN IF EXISTS source_channel,
    DROP COLUMN IF EXISTS external_txn_id,
    DROP COLUMN IF EXISTS raw_payload_ref,
    DROP COLUMN IF EXISTS classification_confidence,
    DROP COLUMN IF EXISTS anomaly_score,
    DROP COLUMN IF EXISTS tax_section,
    DROP COLUMN IF EXISTS is_tax_deductible,
    DROP COLUMN IF EXISTS is_discretionary,
    DROP COLUMN IF EXISTS income_stream_type,
    DROP COLUMN IF EXISTS reconciliation_group_id,
    DROP COLUMN IF EXISTS is_internal_transfer,
    DROP COLUMN IF EXISTS inr_amount,
    DROP COLUMN IF EXISTS fx_rate_to_inr,
    DROP COLUMN IF EXISTS utr_reference,
    DROP COLUMN IF EXISTS counterparty_name,
    DROP COLUMN IF EXISTS upi_vpa,
    DROP COLUMN IF EXISTS merchant_id,
    DROP COLUMN IF EXISTS channel,
    DROP COLUMN IF EXISTS txn_type,
    DROP COLUMN IF EXISTS posted_at;

DROP TABLE IF EXISTS finance.merchants;

DROP INDEX IF EXISTS idx_accounts_user_active;
DROP TRIGGER IF EXISTS trg_accounts_touch ON finance.accounts;
ALTER TABLE finance.accounts DROP CONSTRAINT IF EXISTS chk_finance_accounts_type;

ALTER TABLE finance.accounts
    DROP COLUMN IF EXISTS updated_at,
    DROP COLUMN IF EXISTS metadata,
    DROP COLUMN IF EXISTS is_joint,
    DROP COLUMN IF EXISTS sync_status,
    DROP COLUMN IF EXISTS last_synced_at,
    DROP COLUMN IF EXISTS consent_artefact_id,
    DROP COLUMN IF EXISTS account_number_enc,
    DROP COLUMN IF EXISTS institution_enc,
    DROP COLUMN IF EXISTS masked_number,
    DROP COLUMN IF EXISTS ifsc_code,
    DROP COLUMN IF EXISTS minimum_balance,
    DROP COLUMN IF EXISTS interest_rate_apr,
    DROP COLUMN IF EXISTS available_balance,
    DROP COLUMN IF EXISTS current_balance,
    DROP COLUMN IF EXISTS account_subtype;

ALTER TABLE finance.accounts
    ADD CONSTRAINT accounts_account_type_check
    CHECK (account_type IN ('cash','bank','wallet','credit_card','investment'));
