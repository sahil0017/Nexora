-- NEXORA Migration 0006 — Financial Intelligence Network Data Model
-- Extends baseline finance.* tables (0001) to support all 15 Intelligence Domains,
-- 163 Engines, Cross-Engine DAGs, Financial Knowledge Graph, Opportunity Radar,
-- What-If Decision Laboratory, Financial Evidence Engine, and Unified AI CFO.

-- ============================================================
-- 1. EXTEND BASELINE ACCOUNTS & TRANSACTIONS (Domains 1, 2, 11)
-- ============================================================
DO $$
DECLARE
    c_name TEXT;
BEGIN
    SELECT conname INTO c_name
    FROM pg_constraint
    WHERE conrelid = 'finance.accounts'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%account_type%';
    IF c_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE finance.accounts DROP CONSTRAINT %I', c_name);
    END IF;
END $$;

ALTER TABLE finance.accounts
    ADD COLUMN IF NOT EXISTS account_subtype     TEXT,
    ADD COLUMN IF NOT EXISTS current_balance     NUMERIC(18,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS available_balance   NUMERIC(18,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS interest_rate_apr   NUMERIC(7,4),
    ADD COLUMN IF NOT EXISTS minimum_balance     NUMERIC(18,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS ifsc_code           TEXT,
    ADD COLUMN IF NOT EXISTS masked_number       TEXT,
    ADD COLUMN IF NOT EXISTS institution_enc     BYTEA,
    ADD COLUMN IF NOT EXISTS account_number_enc  BYTEA,
    ADD COLUMN IF NOT EXISTS consent_artefact_id UUID,
    ADD COLUMN IF NOT EXISTS last_synced_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS sync_status         TEXT NOT NULL DEFAULT 'manual'
        CHECK (sync_status IN ('manual','synced','stale','error','revoked')),
    ADD COLUMN IF NOT EXISTS is_joint            BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS metadata            JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE finance.accounts
    ADD CONSTRAINT chk_finance_accounts_type
    CHECK (account_type IN (
        'cash','bank','wallet','credit_card','investment',
        'loan','deposit','retirement','demat','forex'
    ));

DROP TRIGGER IF EXISTS trg_accounts_touch ON finance.accounts;
CREATE TRIGGER trg_accounts_touch BEFORE UPDATE ON finance.accounts
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX IF NOT EXISTS idx_accounts_user_active
    ON finance.accounts(user_id, account_type)
    WHERE deleted_at IS NULL;

-- Canonical Merchant Catalog (Domain 2.4)
CREATE TABLE IF NOT EXISTS finance.merchants (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_name        TEXT NOT NULL UNIQUE,
    mcc_code              TEXT,
    default_category_name TEXT,
    upi_vpa_patterns      TEXT[] NOT NULL DEFAULT '{}',
    is_subscription_brand BOOLEAN NOT NULL DEFAULT false,
    metadata              JSONB NOT NULL DEFAULT '{}',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE finance.transactions
    ADD COLUMN IF NOT EXISTS posted_at                TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS txn_type                 TEXT NOT NULL DEFAULT 'debit'
        CHECK (txn_type IN ('debit','credit','transfer','investment','fee','interest','tax','dividend','refund')),
    ADD COLUMN IF NOT EXISTS channel                  TEXT NOT NULL DEFAULT 'other'
        CHECK (channel IN ('upi','card','neft','rtgs','imps','nach','ecs','cash','broker','other')),
    ADD COLUMN IF NOT EXISTS merchant_id              UUID REFERENCES finance.merchants(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS upi_vpa                  TEXT,
    ADD COLUMN IF NOT EXISTS counterparty_name        TEXT,
    ADD COLUMN IF NOT EXISTS utr_reference            TEXT,
    ADD COLUMN IF NOT EXISTS fx_rate_to_inr           NUMERIC(18,8) NOT NULL DEFAULT 1.0,
    ADD COLUMN IF NOT EXISTS inr_amount               NUMERIC(18,2),
    ADD COLUMN IF NOT EXISTS is_internal_transfer     BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS reconciliation_group_id  UUID,
    ADD COLUMN IF NOT EXISTS income_stream_type       TEXT
        CHECK (income_stream_type IN ('salary','business','rental','dividend','interest','capital_gain','other')),
    ADD COLUMN IF NOT EXISTS is_discretionary         BOOLEAN,
    ADD COLUMN IF NOT EXISTS is_tax_deductible        BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS tax_section              TEXT,
    ADD COLUMN IF NOT EXISTS anomaly_score            REAL CHECK (anomaly_score BETWEEN 0 AND 1),
    ADD COLUMN IF NOT EXISTS classification_confidence REAL CHECK (classification_confidence BETWEEN 0 AND 1),
    ADD COLUMN IF NOT EXISTS raw_payload_ref          TEXT,
    ADD COLUMN IF NOT EXISTS external_txn_id          TEXT,
    ADD COLUMN IF NOT EXISTS source_channel           TEXT NOT NULL DEFAULT 'manual'
        CHECK (source_channel IN ('manual','android_notification','android_sms','ios_shortcut','email_forward','statement_pdf','broker_oauth','account_aggregator')),
    ADD COLUMN IF NOT EXISTS balance_after_txn        NUMERIC(18,2),
    ADD COLUMN IF NOT EXISTS description_enc          BYTEA,
    ADD COLUMN IF NOT EXISTS upi_vpa_enc              BYTEA,
    ADD COLUMN IF NOT EXISTS counterparty_enc         BYTEA,
    ADD COLUMN IF NOT EXISTS upi_vpa_blind_idx        BYTEA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_txn_account_external_id
    ON finance.transactions(account_id, external_txn_id)
    WHERE external_txn_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_txn_merchant ON finance.transactions(merchant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_txn_reconcile ON finance.transactions(reconciliation_group_id) WHERE reconciliation_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_txn_user_rollup
    ON finance.transactions(user_id, txn_date DESC)
    INCLUDE (amount, inr_amount, txn_type, is_internal_transfer)
    WHERE deleted_at IS NULL;

-- ============================================================
-- 2. PERSONAL PROFILE, CONSENTS, DIGITAL TWIN & COVERAGE (Domain 1, 2)
-- ============================================================
CREATE TABLE IF NOT EXISTS finance.financial_profiles (
    user_id                    UUID PRIMARY KEY REFERENCES identity.users(id) ON DELETE CASCADE,
    tax_residency              TEXT NOT NULL DEFAULT 'resident_ordinary'
        CHECK (tax_residency IN ('resident_ordinary','rnor','nri')),
    preferred_tax_regime       TEXT NOT NULL DEFAULT 'auto'
        CHECK (preferred_tax_regime IN ('auto','new','old')),
    risk_tolerance             TEXT NOT NULL DEFAULT 'moderate'
        CHECK (risk_tolerance IN ('conservative','moderate','growth','aggressive')),
    risk_score                 SMALLINT NOT NULL DEFAULT 50 CHECK (risk_score BETWEEN 1 AND 100),
    dependents_count           SMALLINT NOT NULL DEFAULT 0 CHECK (dependents_count >= 0),
    employment_type            TEXT NOT NULL DEFAULT 'salaried'
        CHECK (employment_type IN ('salaried','self_employed','business_owner','freelancer','retired','student')),
    employer_sector            TEXT,
    annual_gross_income_est    NUMERIC(18,2) NOT NULL DEFAULT 0,
    monthly_fixed_obligation   NUMERIC(18,2) NOT NULL DEFAULT 0,
    emergency_target_months    SMALLINT NOT NULL DEFAULT 6 CHECK (emergency_target_months BETWEEN 1 AND 36),
    retirement_target_age      SMALLINT NOT NULL DEFAULT 60 CHECK (retirement_target_age BETWEEN 30 AND 90),
    personal_cpi_rate          NUMERIC(6,4) NOT NULL DEFAULT 0.0650,
    base_currency              CHAR(3) NOT NULL DEFAULT 'INR',
    preferences                JSONB NOT NULL DEFAULT '{}',
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_fin_profiles_touch ON finance.financial_profiles;
CREATE TRIGGER trg_fin_profiles_touch BEFORE UPDATE ON finance.financial_profiles
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE IF NOT EXISTS finance.consent_artefacts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    provider_type   TEXT NOT NULL
        CHECK (provider_type IN ('account_aggregator','broker','rta_cas','credit_bureau','tax_portal','gstn','insurance_eia')),
    tsp_name        TEXT NOT NULL,
    consent_handle  TEXT,
    consent_id      TEXT,
    purpose_code    TEXT NOT NULL,
    scopes          JSONB NOT NULL DEFAULT '[]',
    status          TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','active','paused','revoked','expired')),
    granted_at      TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    last_pulled_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_consents_user_status ON finance.consent_artefacts(user_id, status);
DROP TRIGGER IF EXISTS trg_consents_touch ON finance.consent_artefacts;
CREATE TRIGGER trg_consents_touch BEFORE UPDATE ON finance.consent_artefacts
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE finance.accounts
    DROP CONSTRAINT IF EXISTS fk_accounts_consent;
ALTER TABLE finance.accounts
    ADD CONSTRAINT fk_accounts_consent
    FOREIGN KEY (consent_artefact_id) REFERENCES finance.consent_artefacts(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS finance.balance_history (
    account_id   UUID NOT NULL REFERENCES finance.accounts(id) ON DELETE CASCADE,
    as_of_date   DATE NOT NULL,
    balance      NUMERIC(18,2) NOT NULL,
    currency     CHAR(3) NOT NULL DEFAULT 'INR',
    inr_balance  NUMERIC(18,2) NOT NULL,
    source       TEXT NOT NULL DEFAULT 'backward_replay'
        CHECK (source IN ('alert_avl_bal','statement_closing','backward_replay','aa_sync','manual')),
    is_verified  BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (account_id, as_of_date)
);

-- Zero-AA Real-Time Ingestion Channels & Anti-Spy Key Management
CREATE TABLE IF NOT EXISTS finance.user_encryption_keys (
    user_id              UUID PRIMARY KEY REFERENCES identity.users(id) ON DELETE CASCADE,
    encryption_mode      TEXT NOT NULL DEFAULT 'kms_envelope'
        CHECK (encryption_mode IN ('kms_envelope','zero_knowledge')),
    key_version          INT NOT NULL DEFAULT 1,
    kms_wrapped_dek      BYTEA,
    passkey_wrapped_dek  BYTEA,
    kdf_salt             BYTEA,
    blind_index_key_enc  BYTEA,
    rotated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finance.ingestion_channels (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    channel_type         TEXT NOT NULL
        CHECK (channel_type IN ('email_forward','android_notification','android_sms','ios_shortcut','broker_oauth','account_aggregator')),
    provider_name        TEXT NOT NULL DEFAULT 'custom',
    vault_alias_hash     TEXT UNIQUE, -- HMAC/SHA-256 of <token>@vault.nexora for email forwarding
    webhook_token_hash   TEXT UNIQUE, -- SHA-256 of iOS Shortcut / Android device push token
    credentials_ref      TEXT,        -- KMS-encrypted OAuth/session ref in docstore
    status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','paused','revoked')),
    last_event_at        TIMESTAMPTZ,
    metadata             JSONB NOT NULL DEFAULT '{}',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ingestion_channels_user ON finance.ingestion_channels(user_id, channel_type, status);
DROP TRIGGER IF EXISTS trg_ingestion_channels_touch ON finance.ingestion_channels;
CREATE TRIGGER trg_ingestion_channels_touch BEFORE UPDATE ON finance.ingestion_channels
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE IF NOT EXISTS finance.upi_mandates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    account_id      UUID REFERENCES finance.accounts(id) ON DELETE SET NULL,
    mandate_umn     TEXT,
    payee_vpa       TEXT NOT NULL,
    payee_name      TEXT,
    max_amount      NUMERIC(18,2) NOT NULL,
    frequency       TEXT NOT NULL DEFAULT 'monthly'
        CHECK (frequency IN ('one_time','weekly','monthly','quarterly','yearly','as_presented')),
    next_debit_date DATE,
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','revoked','expired')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_upi_mandates_user ON finance.upi_mandates(user_id, status);

CREATE TABLE IF NOT EXISTS finance.credit_cards (
    account_id           UUID PRIMARY KEY REFERENCES finance.accounts(id) ON DELETE CASCADE,
    user_id              UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    issuer               TEXT NOT NULL,
    network              TEXT NOT NULL CHECK (network IN ('visa','mastercard','rupay','amex','diners','other')),
    credit_limit         NUMERIC(18,2) NOT NULL CHECK (credit_limit >= 0),
    current_outstanding  NUMERIC(18,2) NOT NULL DEFAULT 0,
    statement_day        SMALLINT CHECK (statement_day BETWEEN 1 AND 31),
    due_day              SMALLINT CHECK (due_day BETWEEN 1 AND 31),
    apr                  NUMERIC(7,4) NOT NULL DEFAULT 0.4200,
    annual_fee           NUMERIC(18,2) NOT NULL DEFAULT 0,
    fee_waiver_spend     NUMERIC(18,2),
    reward_program       JSONB NOT NULL DEFAULT '{}',
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finance.recurring_obligations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    account_id      UUID REFERENCES finance.accounts(id) ON DELETE SET NULL,
    merchant_id     UUID REFERENCES finance.merchants(id) ON DELETE SET NULL,
    title           TEXT NOT NULL,
    obligation_type TEXT NOT NULL
        CHECK (obligation_type IN ('subscription','utility','emi','sip','insurance_premium','rent','other')),
    cadence         TEXT NOT NULL DEFAULT 'monthly' CHECK (cadence IN ('weekly','monthly','quarterly','yearly')),
    expected_amount NUMERIC(18,2) NOT NULL,
    currency        CHAR(3) NOT NULL DEFAULT 'INR',
    next_due_date   DATE,
    auto_debit      BOOLEAN NOT NULL DEFAULT false,
    unused_flag     BOOLEAN NOT NULL DEFAULT false,
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','cancelled')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recurring_user_due ON finance.recurring_obligations(user_id, next_due_date) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS finance.reconciliation_links (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    primary_txn_id  UUID NOT NULL REFERENCES finance.transactions(id) ON DELETE CASCADE,
    matched_txn_id  UUID NOT NULL REFERENCES finance.transactions(id) ON DELETE CASCADE,
    link_type       TEXT NOT NULL
        CHECK (link_type IN ('self_transfer','duplicate','refund_pair','statement_match','card_bill_payment')),
    confidence      REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    status          TEXT NOT NULL DEFAULT 'auto_matched' CHECK (status IN ('auto_matched','confirmed','dismissed')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (primary_txn_id, matched_txn_id, link_type)
);

CREATE TABLE IF NOT EXISTS finance.digital_twin_snapshots (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    snapshot_version        BIGINT NOT NULL,
    as_of                   TIMESTAMPTZ NOT NULL DEFAULT now(),
    net_worth_inr           NUMERIC(18,2) NOT NULL,
    total_assets_inr        NUMERIC(18,2) NOT NULL,
    total_liabilities_inr   NUMERIC(18,2) NOT NULL,
    liquid_assets_inr       NUMERIC(18,2) NOT NULL,
    monthly_income_inr      NUMERIC(18,2) NOT NULL DEFAULT 0,
    monthly_expense_inr     NUMERIC(18,2) NOT NULL DEFAULT 0,
    savings_rate_pct        REAL NOT NULL DEFAULT 0,
    dti_pct                 REAL NOT NULL DEFAULT 0,
    emergency_runway_months REAL NOT NULL DEFAULT 0,
    health_score            SMALLINT NOT NULL CHECK (health_score BETWEEN 0 AND 100),
    health_breakdown        JSONB NOT NULL DEFAULT '{}',
    asset_allocation        JSONB NOT NULL DEFAULT '{}',
    currency_exposure       JSONB NOT NULL DEFAULT '{}',
    twin_state              JSONB NOT NULL DEFAULT '{}',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, snapshot_version)
);
CREATE INDEX IF NOT EXISTS idx_fin_twin_user_latest ON finance.digital_twin_snapshots(user_id, as_of DESC);

CREATE TABLE IF NOT EXISTS finance.coverage_gaps (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    gap_type         TEXT NOT NULL
        CHECK (gap_type IN ('stale_account','missing_account','orphan_sip','unlinked_ais','missing_nominee','missing_policy_doc','other')),
    severity         TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high')),
    title            TEXT NOT NULL,
    description      TEXT NOT NULL,
    suggested_action TEXT,
    status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
    detected_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_coverage_gaps_user ON finance.coverage_gaps(user_id, status);

-- ============================================================
-- 3. MARKETS, HOLDINGS, TAX LOTS, GOALS & ALLOCATION (Domains 3, 4, 5, 6, 13)
-- ============================================================
CREATE TABLE IF NOT EXISTS finance.market_instruments (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    isin              TEXT,
    symbol            TEXT NOT NULL,
    exchange          TEXT NOT NULL
        CHECK (exchange IN ('NSE','BSE','AMFI','NASDAQ','NYSE','LSE','XETRA','TSE','SGX','HKEX','MCX','GIFT','RBI','OTHER')),
    name              TEXT NOT NULL,
    instrument_type   TEXT NOT NULL
        CHECK (instrument_type IN ('equity','mutual_fund','etf','bond','gsec','reit','invit','sgb','commodity','index','fx')),
    asset_class       TEXT NOT NULL
        CHECK (asset_class IN ('equity','debt','gold','real_estate','cash','alternative')),
    market_cap_tier   TEXT NOT NULL DEFAULT 'na'
        CHECK (market_cap_tier IN ('large_cap','mid_cap','small_cap','micro_cap','na')),
    sector            TEXT,
    industry          TEXT,
    domicile_country  CHAR(2) NOT NULL DEFAULT 'IN',
    currency          CHAR(3) NOT NULL DEFAULT 'INR',
    amc_name          TEXT,
    fund_category     TEXT,
    expense_ratio     NUMERIC(6,4),
    benchmark_symbol  TEXT,
    credit_rating     TEXT,
    fundamentals      JSONB NOT NULL DEFAULT '{}',
    governance_flags  JSONB NOT NULL DEFAULT '{}',
    quant_scores      JSONB NOT NULL DEFAULT '{}',
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (exchange, symbol)
);
CREATE INDEX IF NOT EXISTS idx_instruments_isin ON finance.market_instruments(isin) WHERE isin IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_instruments_type_class ON finance.market_instruments(instrument_type, asset_class);

CREATE TABLE IF NOT EXISTS finance.market_prices_ts (
    instrument_id UUID NOT NULL REFERENCES finance.market_instruments(id) ON DELETE CASCADE,
    price_date    DATE NOT NULL,
    open_price    NUMERIC(18,4),
    high_price    NUMERIC(18,4),
    low_price     NUMERIC(18,4),
    close_price   NUMERIC(18,4) NOT NULL,
    adj_close     NUMERIC(18,4),
    volume        BIGINT,
    currency      CHAR(3) NOT NULL DEFAULT 'INR',
    PRIMARY KEY (instrument_id, price_date)
);

CREATE TABLE IF NOT EXISTS finance.mf_holdings_constituents (
    fund_instrument_id UUID NOT NULL REFERENCES finance.market_instruments(id) ON DELETE CASCADE,
    constituent_isin   TEXT NOT NULL,
    constituent_name   TEXT NOT NULL,
    sector             TEXT,
    weight_pct         REAL NOT NULL CHECK (weight_pct BETWEEN 0 AND 100),
    as_of_date         DATE NOT NULL,
    PRIMARY KEY (fund_instrument_id, constituent_isin, as_of_date)
);

CREATE TABLE IF NOT EXISTS finance.holdings (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    account_id        UUID REFERENCES finance.accounts(id) ON DELETE SET NULL,
    instrument_id     UUID NOT NULL REFERENCES finance.market_instruments(id) ON DELETE RESTRICT,
    folio_or_dp_ref   TEXT,
    plan_type         TEXT NOT NULL DEFAULT 'na' CHECK (plan_type IN ('direct','regular','na')),
    units             NUMERIC(20,6) NOT NULL CHECK (units >= 0),
    avg_cost_per_unit NUMERIC(18,4) NOT NULL DEFAULT 0,
    cost_currency     CHAR(3) NOT NULL DEFAULT 'INR',
    current_value_inr NUMERIC(18,2) NOT NULL DEFAULT 0,
    unrealized_pnl_inr NUMERIC(18,2) NOT NULL DEFAULT 0,
    xirr_pct          REAL,
    is_pledged        BOOLEAN NOT NULL DEFAULT false,
    lock_in_until     DATE,
    thesis_note       TEXT,
    last_valued_at    TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_holdings_user ON finance.holdings(user_id);
CREATE INDEX IF NOT EXISTS idx_holdings_instrument ON finance.holdings(instrument_id);

CREATE TABLE IF NOT EXISTS finance.tax_lots (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    holding_id              UUID NOT NULL REFERENCES finance.holdings(id) ON DELETE CASCADE,
    acquired_at             DATE NOT NULL,
    units_original          NUMERIC(20,6) NOT NULL CHECK (units_original > 0),
    units_remaining         NUMERIC(20,6) NOT NULL CHECK (units_remaining >= 0),
    cost_per_unit           NUMERIC(18,4) NOT NULL,
    cost_currency           CHAR(3) NOT NULL DEFAULT 'INR',
    fx_rate_at_acq          NUMERIC(18,8) NOT NULL DEFAULT 1.0,
    grandfathered_fmv_2018  NUMERIC(18,4),
    corporate_action_factor NUMERIC(12,6) NOT NULL DEFAULT 1.0,
    source_txn_id           UUID REFERENCES finance.transactions(id) ON DELETE SET NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tax_lots_holding_fifo ON finance.tax_lots(holding_id, acquired_at ASC) WHERE units_remaining > 0;

CREATE TABLE IF NOT EXISTS finance.physical_assets (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                   UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    asset_type                TEXT NOT NULL
        CHECK (asset_type IN ('real_estate','physical_gold','private_equity','esop','vehicle','art_other')),
    name                      TEXT NOT NULL,
    acquired_at               DATE,
    purchase_value_inr        NUMERIC(18,2) NOT NULL DEFAULT 0,
    estimated_value_inr       NUMERIC(18,2) NOT NULL DEFAULT 0,
    annual_rental_income_inr  NUMERIC(18,2) NOT NULL DEFAULT 0,
    annual_maintenance_inr    NUMERIC(18,2) NOT NULL DEFAULT 0,
    liquidity_tier            TEXT NOT NULL DEFAULT 'illiquid'
        CHECK (liquidity_tier IN ('t0_cash','t2_liquid','locked_medium','illiquid')),
    metadata                  JSONB NOT NULL DEFAULT '{}',
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_physical_assets_user ON finance.physical_assets(user_id);

CREATE TABLE IF NOT EXISTS finance.goals (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    name                   TEXT NOT NULL,
    goal_type              TEXT NOT NULL
        CHECK (goal_type IN ('emergency','retirement','home','education','travel','vehicle','wealth_milestone','business_seed','legacy','other')),
    priority               SMALLINT NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 5),
    target_amount_today    NUMERIC(18,2) NOT NULL,
    inflation_rate         NUMERIC(6,4) NOT NULL DEFAULT 0.0650,
    target_date            DATE NOT NULL,
    current_funded_inr     NUMERIC(18,2) NOT NULL DEFAULT 0,
    monthly_sip_inr        NUMERIC(18,2) NOT NULL DEFAULT 0,
    probability_of_success REAL CHECK (probability_of_success BETWEEN 0 AND 1),
    status                 TEXT NOT NULL DEFAULT 'on_track'
        CHECK (status IN ('on_track','at_risk','behind','achieved','paused')),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_goals_user ON finance.goals(user_id, target_date);

CREATE TABLE IF NOT EXISTS finance.goal_allocations (
    goal_id        UUID NOT NULL REFERENCES finance.goals(id) ON DELETE CASCADE,
    holding_id     UUID NOT NULL REFERENCES finance.holdings(id) ON DELETE CASCADE,
    allocation_pct REAL NOT NULL CHECK (allocation_pct > 0 AND allocation_pct <= 100),
    PRIMARY KEY (goal_id, holding_id)
);

CREATE TABLE IF NOT EXISTS finance.allocation_targets (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    goal_id            UUID REFERENCES finance.goals(id) ON DELETE CASCADE,
    asset_class        TEXT NOT NULL CHECK (asset_class IN ('equity','debt','gold','real_estate','cash','alternative')),
    sub_class          TEXT NOT NULL DEFAULT 'all',
    target_pct         REAL NOT NULL CHECK (target_pct BETWEEN 0 AND 100),
    rebalance_band_pct REAL NOT NULL DEFAULT 5.0,
    UNIQUE (user_id, goal_id, asset_class, sub_class)
);

-- ============================================================
-- 4. TAX & CA INTELLIGENCE (Domain 7)
-- ============================================================
CREATE TABLE IF NOT EXISTS finance.parsed_documents (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    doc_type              TEXT NOT NULL
        CHECK (doc_type IN ('form16','form26as','ais','cas','bank_statement','card_statement','broker_tradebook','epfo_passbook','nps_statement','insurance_policy','credit_report','gst_invoice','other')),
    storage_ref           TEXT NOT NULL,
    doc_hash              TEXT,
    extraction_status     TEXT NOT NULL DEFAULT 'queued'
        CHECK (extraction_status IN ('queued','processing','completed','failed')),
    extracted_summary     JSONB NOT NULL DEFAULT '{}',
    extraction_confidence REAL CHECK (extraction_confidence BETWEEN 0 AND 1),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_parsed_docs_user ON finance.parsed_documents(user_id, doc_type);

CREATE TABLE IF NOT EXISTS finance.tax_profiles (
    user_id               UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    financial_year        TEXT NOT NULL,
    selected_regime       TEXT NOT NULL DEFAULT 'new' CHECK (selected_regime IN ('new','old')),
    recommended_regime    TEXT CHECK (recommended_regime IN ('new','old')),
    gross_salary_inr      NUMERIC(18,2) NOT NULL DEFAULT 0,
    business_income_inr   NUMERIC(18,2) NOT NULL DEFAULT 0,
    house_property_inr    NUMERIC(18,2) NOT NULL DEFAULT 0,
    other_income_inr      NUMERIC(18,2) NOT NULL DEFAULT 0,
    stcg_111a_inr         NUMERIC(18,2) NOT NULL DEFAULT 0,
    stcg_slab_inr         NUMERIC(18,2) NOT NULL DEFAULT 0,
    ltcg_112a_inr         NUMERIC(18,2) NOT NULL DEFAULT 0,
    ltcg_other_inr        NUMERIC(18,2) NOT NULL DEFAULT 0,
    estimated_tax_old_inr NUMERIC(18,2) NOT NULL DEFAULT 0,
    estimated_tax_new_inr NUMERIC(18,2) NOT NULL DEFAULT 0,
    tds_paid_inr          NUMERIC(18,2) NOT NULL DEFAULT 0,
    advance_tax_paid_inr  NUMERIC(18,2) NOT NULL DEFAULT 0,
    lrs_utilized_usd      NUMERIC(18,2) NOT NULL DEFAULT 0,
    metadata              JSONB NOT NULL DEFAULT '{}',
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, financial_year)
);

CREATE TABLE IF NOT EXISTS finance.tax_deductions (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    financial_year     TEXT NOT NULL,
    section_code       TEXT NOT NULL,
    claimed_amount_inr NUMERIC(18,2) NOT NULL DEFAULT 0,
    max_eligible_inr   NUMERIC(18,2) NOT NULL DEFAULT 0,
    evidence_doc_id    UUID REFERENCES finance.parsed_documents(id) ON DELETE SET NULL,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, financial_year, section_code)
);

CREATE TABLE IF NOT EXISTS finance.tds_entries (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    financial_year   TEXT NOT NULL,
    deductor_tan     TEXT,
    deductor_name    TEXT NOT NULL,
    section          TEXT NOT NULL,
    gross_paid_inr   NUMERIC(18,2) NOT NULL,
    tds_deducted_inr NUMERIC(18,2) NOT NULL,
    source           TEXT NOT NULL CHECK (source IN ('form26as','ais','form16','manual')),
    reconciled       BOOLEAN NOT NULL DEFAULT false,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tds_user_fy ON finance.tds_entries(user_id, financial_year);

CREATE TABLE IF NOT EXISTS finance.tax_deadlines (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    financial_year        TEXT NOT NULL,
    deadline_type         TEXT NOT NULL
        CHECK (deadline_type IN ('advance_tax_q1','advance_tax_q2','advance_tax_q3','advance_tax_q4','itr_filing','belated_itr','form67','gstr1','gstr3b','tds_challan')),
    due_date              DATE NOT NULL,
    estimated_payable_inr NUMERIC(18,2) NOT NULL DEFAULT 0,
    status                TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming','paid','filed','overdue','waived')),
    reminded_at           TIMESTAMPTZ,
    UNIQUE (user_id, financial_year, deadline_type, due_date)
);

-- ============================================================
-- 5. LOANS, CREDIT, INSURANCE & BUSINESS (Domains 8, 9, 10)
-- ============================================================
CREATE TABLE IF NOT EXISTS finance.liabilities (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    account_id              UUID REFERENCES finance.accounts(id) ON DELETE SET NULL,
    loan_type               TEXT NOT NULL
        CHECK (loan_type IN ('home','auto','personal','education','gold','business','credit_card_emi','bnpl','other')),
    lender_name             TEXT NOT NULL,
    principal_sanctioned    NUMERIC(18,2) NOT NULL,
    principal_outstanding   NUMERIC(18,2) NOT NULL,
    interest_rate_apr       NUMERIC(7,4) NOT NULL,
    rate_type               TEXT NOT NULL DEFAULT 'floating_eblr'
        CHECK (rate_type IN ('fixed','floating_eblr','floating_mclr','floating_other')),
    emi_amount              NUMERIC(18,2) NOT NULL,
    emi_day                 SMALLINT CHECK (emi_day BETWEEN 1 AND 31),
    remaining_months        INT NOT NULL CHECK (remaining_months >= 0),
    foreclosure_penalty_pct REAL NOT NULL DEFAULT 0,
    tax_deductible_section  TEXT,
    status                  TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed','restructured')),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_liabilities_user ON finance.liabilities(user_id, status);

CREATE TABLE IF NOT EXISTS finance.credit_reports (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    bureau                TEXT NOT NULL CHECK (bureau IN ('cibil','experian','crif','equifax')),
    score                 SMALLINT NOT NULL CHECK (score BETWEEN 300 AND 900),
    utilization_pct       REAL,
    active_accounts_count SMALLINT,
    hard_inquiries_6m     SMALLINT,
    report_date           DATE NOT NULL,
    drivers               JSONB NOT NULL DEFAULT '{}',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_credit_reports_user ON finance.credit_reports(user_id, report_date DESC);

CREATE TABLE IF NOT EXISTS finance.insurance_policies (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                  UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    policy_type              TEXT NOT NULL
        CHECK (policy_type IN ('health','super_topup','term_life','endowment_ulip','motor','personal_accident','home','travel')),
    insurer_name             TEXT NOT NULL,
    policy_number_encrypted  TEXT,
    cover_source             TEXT NOT NULL DEFAULT 'personal' CHECK (cover_source IN ('personal','corporate_group')),
    sum_insured_inr          NUMERIC(18,2) NOT NULL,
    deductible_inr           NUMERIC(18,2) NOT NULL DEFAULT 0,
    annual_premium_inr       NUMERIC(18,2) NOT NULL DEFAULT 0,
    renewal_date             DATE,
    nominee_verified         BOOLEAN NOT NULL DEFAULT false,
    room_rent_limit          TEXT,
    copay_pct                REAL NOT NULL DEFAULT 0,
    waiting_period_months    SMALLINT NOT NULL DEFAULT 0,
    exclusions               JSONB NOT NULL DEFAULT '[]',
    claim_documents_ready    JSONB NOT NULL DEFAULT '{}',
    parsed_doc_id            UUID REFERENCES finance.parsed_documents(id) ON DELETE SET NULL,
    status                   TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','grace','lapsed','expired')),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insurance_user ON finance.insurance_policies(user_id, status);

CREATE TABLE IF NOT EXISTS finance.business_entities (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    name                   TEXT NOT NULL,
    entity_type            TEXT NOT NULL
        CHECK (entity_type IN ('sole_prop','freelance','llp','pvt_ltd','partnership','side_hustle')),
    industry               TEXT,
    gstin                  TEXT,
    revenue_model          TEXT NOT NULL DEFAULT 'service'
        CHECK (revenue_model IN ('subscription','service','ecommerce','marketplace','retainer','product','other')),
    startup_capital_inr    NUMERIC(18,2) NOT NULL DEFAULT 0,
    monthly_fixed_cost_inr NUMERIC(18,2) NOT NULL DEFAULT 0,
    unit_price_inr         NUMERIC(18,2) NOT NULL DEFAULT 0,
    unit_variable_cost_inr NUMERIC(18,2) NOT NULL DEFAULT 0,
    cac_inr                NUMERIC(18,2) NOT NULL DEFAULT 0,
    ltv_inr                NUMERIC(18,2) NOT NULL DEFAULT 0,
    estimated_valuation_inr NUMERIC(18,2) NOT NULL DEFAULT 0,
    valuation_method       TEXT,
    status                 TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('ideation','active','paused','exited')),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_business_entities_user ON finance.business_entities(user_id);

CREATE TABLE IF NOT EXISTS finance.business_metrics_ts (
    entity_id        UUID NOT NULL REFERENCES finance.business_entities(id) ON DELETE CASCADE,
    period_month     DATE NOT NULL,
    revenue_inr      NUMERIC(18,2) NOT NULL DEFAULT 0,
    cogs_inr         NUMERIC(18,2) NOT NULL DEFAULT 0,
    opex_inr         NUMERIC(18,2) NOT NULL DEFAULT 0,
    ebitda_inr       NUMERIC(18,2) NOT NULL DEFAULT 0,
    net_cashflow_inr NUMERIC(18,2) NOT NULL DEFAULT 0,
    active_customers INT NOT NULL DEFAULT 0,
    churn_pct        REAL,
    dso_days         REAL,
    PRIMARY KEY (entity_id, period_month)
);

CREATE TABLE IF NOT EXISTS finance.gst_ledger (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    business_entity_id    UUID REFERENCES finance.business_entities(id) ON DELETE CASCADE,
    gstin                 TEXT NOT NULL,
    return_period         TEXT NOT NULL,
    gstr_type             TEXT NOT NULL CHECK (gstr_type IN ('GSTR1','GSTR2B','GSTR3B')),
    taxable_value_inr     NUMERIC(18,2) NOT NULL DEFAULT 0,
    igst_inr              NUMERIC(18,2) NOT NULL DEFAULT 0,
    cgst_inr              NUMERIC(18,2) NOT NULL DEFAULT 0,
    sgst_inr              NUMERIC(18,2) NOT NULL DEFAULT 0,
    itc_eligible_inr      NUMERIC(18,2) NOT NULL DEFAULT 0,
    rcm_liability_inr     NUMERIC(18,2) NOT NULL DEFAULT 0,
    reconciliation_status TEXT NOT NULL DEFAULT 'pending' CHECK (reconciliation_status IN ('pending','matched','mismatch')),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gst_ledger_entity ON finance.gst_ledger(user_id, return_period);

-- ============================================================
-- 6. RISK, BEHAVIOUR, SIMULATION, KNOWLEDGE GRAPH & AI CFO (§11–17)
-- ============================================================
CREATE TABLE IF NOT EXISTS finance.evidence_bundles (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    agent_run_id        UUID REFERENCES intelligence.agent_runs(id) ON DELETE SET NULL,
    recommendation_key  TEXT NOT NULL,
    confidence_score    REAL NOT NULL CHECK (confidence_score BETWEEN 0 AND 1),
    confidence_tier     TEXT NOT NULL CHECK (confidence_tier IN ('HIGH','MEDIUM','LOW','INSUFFICIENT_DATA')),
    uncertainty_bounds  JSONB NOT NULL DEFAULT '{}',
    sources             JSONB NOT NULL DEFAULT '[]',
    deterministic_checks JSONB NOT NULL DEFAULT '[]',
    assumptions         JSONB NOT NULL DEFAULT '[]',
    disclaimers         TEXT[] NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_evidence_user ON finance.evidence_bundles(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS finance.risk_assessments (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                   UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    as_of                     TIMESTAMPTZ NOT NULL DEFAULT now(),
    var_95_1m_pct             REAL,
    cvar_95_1m_pct            REAL,
    portfolio_beta            REAL,
    concentration_hhi         REAL,
    liquidity_t2_pct          REAL,
    dicgc_excess_exposure_inr NUMERIC(18,2) NOT NULL DEFAULT 0,
    stress_test_results       JSONB NOT NULL DEFAULT '{}',
    top_risks                 JSONB NOT NULL DEFAULT '[]',
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_risk_user_latest ON finance.risk_assessments(user_id, as_of DESC);

CREATE TABLE IF NOT EXISTS finance.behaviour_signals (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                  UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    period_start             DATE NOT NULL,
    period_end               DATE NOT NULL,
    savings_discipline_score SMALLINT CHECK (savings_discipline_score BETWEEN 0 AND 100),
    goal_discipline_score    SMALLINT CHECK (goal_discipline_score BETWEEN 0 AND 100),
    lifestyle_inflation_ratio REAL,
    impulse_spend_inr        NUMERIC(18,2) NOT NULL DEFAULT 0,
    detected_biases          JSONB NOT NULL DEFAULT '[]',
    habit_summary            JSONB NOT NULL DEFAULT '{}',
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_behaviour_user ON finance.behaviour_signals(user_id, period_end DESC);

CREATE TABLE IF NOT EXISTS finance.simulation_runs (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    sim_type               TEXT NOT NULL
        CHECK (sim_type IN ('monte_carlo','what_if','retirement','fi_timeline','job_loss','major_purchase','prepay_vs_invest','tax_scenario')),
    scenario_name          TEXT NOT NULL,
    base_twin_snapshot_id  UUID REFERENCES finance.digital_twin_snapshots(id) ON DELETE SET NULL,
    parameters             JSONB NOT NULL DEFAULT '{}',
    num_paths              INT NOT NULL DEFAULT 1,
    horizon_years          SMALLINT NOT NULL DEFAULT 10,
    p10_outcome            JSONB NOT NULL DEFAULT '{}',
    p50_outcome            JSONB NOT NULL DEFAULT '{}',
    p90_outcome            JSONB NOT NULL DEFAULT '{}',
    probability_of_success REAL CHECK (probability_of_success BETWEEN 0 AND 1),
    delta_summary          JSONB NOT NULL DEFAULT '{}',
    evidence_bundle_id     UUID REFERENCES finance.evidence_bundles(id) ON DELETE SET NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sim_runs_user ON finance.simulation_runs(user_id, created_at DESC);

-- Financial Knowledge Graph (§17.1)
CREATE TABLE IF NOT EXISTS finance.kg_nodes (
    node_id     TEXT PRIMARY KEY,
    user_id     UUID REFERENCES identity.users(id) ON DELETE CASCADE, -- NULL = global market/macro entity
    node_type   TEXT NOT NULL
        CHECK (node_type IN ('user','account','holding','company','amc','sector','currency','bank','loan','policy','tax_rule','goal','macro_indicator','market_event')),
    label       TEXT NOT NULL,
    attributes  JSONB NOT NULL DEFAULT '{}',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kg_nodes_user_type ON finance.kg_nodes(user_id, node_type);

CREATE TABLE IF NOT EXISTS finance.kg_edges (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID REFERENCES identity.users(id) ON DELETE CASCADE,
    from_node_id TEXT NOT NULL REFERENCES finance.kg_nodes(node_id) ON DELETE CASCADE,
    to_node_id   TEXT NOT NULL REFERENCES finance.kg_nodes(node_id) ON DELETE CASCADE,
    edge_type    TEXT NOT NULL,
    weight       REAL NOT NULL DEFAULT 1.0,
    attributes   JSONB NOT NULL DEFAULT '{}',
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (from_node_id, to_node_id, edge_type)
);
CREATE INDEX IF NOT EXISTS idx_kg_edges_from ON finance.kg_edges(from_node_id);
CREATE INDEX IF NOT EXISTS idx_kg_edges_to ON finance.kg_edges(to_node_id);

-- Financial Event Intelligence (§17.4)
CREATE TABLE IF NOT EXISTS finance.market_events (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type        TEXT NOT NULL
        CHECK (event_type IN ('rbi_policy','sebi_circular','budget_tax','earnings_surprise','governance_alert','rating_change','fx_shock','fund_manager_change','macro_print')),
    source            TEXT NOT NULL,
    title             TEXT NOT NULL,
    summary           TEXT NOT NULL,
    severity          TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
    affected_node_ids TEXT[] NOT NULL DEFAULT '{}',
    embedding         REAL[], -- portable across standard PostgreSQL 16 & RDS without pgvector dependency
    published_at      TIMESTAMPTZ NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_market_events_pub ON finance.market_events(published_at DESC);

-- Continuous Opportunity Radar (§17.2)
CREATE TABLE IF NOT EXISTS finance.radar_alerts (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    alert_category        TEXT NOT NULL
        CHECK (alert_category IN ('opportunity','risk','tax','cashflow','behaviour','event_impact','fee_savings')),
    engine_key            TEXT NOT NULL,
    title                 TEXT NOT NULL,
    summary               TEXT NOT NULL,
    annualized_impact_inr NUMERIC(18,2) NOT NULL DEFAULT 0,
    urgency               TEXT NOT NULL DEFAULT 'medium' CHECK (urgency IN ('low','medium','high','critical')),
    confidence            REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    dedupe_key            TEXT NOT NULL,
    cooldown_until        TIMESTAMPTZ,
    evidence_bundle_id    UUID REFERENCES finance.evidence_bundles(id) ON DELETE SET NULL,
    status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','snoozed','acted','dismissed')),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_radar_user_active ON finance.radar_alerts(user_id, status, created_at DESC);

-- AI CFO Financial Memory & Decision Journal (Domain 15.9 & §16.6)
CREATE TABLE IF NOT EXISTS finance.decision_journal (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                   UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    approval_id               UUID REFERENCES intelligence.action_approvals(id) ON DELETE SET NULL,
    evidence_bundle_id        UUID REFERENCES finance.evidence_bundles(id) ON DELETE SET NULL,
    decision_type             TEXT NOT NULL,
    title                     TEXT NOT NULL,
    rationale                 TEXT NOT NULL,
    expected_outcome          JSONB NOT NULL DEFAULT '{}',
    thesis_invalidation_rules JSONB NOT NULL DEFAULT '[]',
    status                    TEXT NOT NULL DEFAULT 'proposed'
        CHECK (status IN ('proposed','approved','executed','reviewed','invalidated')),
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_decision_journal_user ON finance.decision_journal(user_id, created_at DESC);
DROP TRIGGER IF EXISTS trg_decision_journal_touch ON finance.decision_journal;
CREATE TRIGGER trg_decision_journal_touch BEFORE UPDATE ON finance.decision_journal
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
