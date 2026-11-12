package finance

import "time"

// Account represents a user financial account with anti-spy masked metadata.
type Account struct {
	ID              string    `json:"id"`
	UserID          string    `json:"user_id"`
	Name            string    `json:"name"`
	AccountType     string    `json:"account_type"`
	Institution     string    `json:"institution,omitempty"`
	MaskedNumber    string    `json:"masked_number,omitempty"`
	Currency        string    `json:"currency"`
	CurrentBalance  float64   `json:"current_balance"`
	InterestRateAPR *float64  `json:"interest_rate_apr,omitempty"`
	SyncStatus      string    `json:"sync_status"`
	IsConnected     bool      `json:"is_connected"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// Transaction represents a normalized financial ledger entry.
type Transaction struct {
	ID                   string    `json:"id"`
	UserID               string    `json:"user_id"`
	AccountID            string    `json:"account_id"`
	ExternalTxnID        string    `json:"external_txn_id,omitempty"`
	TxnDate              string    `json:"txn_date"`
	TxnType              string    `json:"txn_type"`
	Channel              string    `json:"channel"`
	SourceChannel        string    `json:"source_channel"`
	Amount               float64   `json:"amount"`
	Currency             string    `json:"currency"`
	BalanceAfterTxn      *float64  `json:"balance_after_txn,omitempty"`
	Merchant             string    `json:"merchant,omitempty"`
	Category             string    `json:"category,omitempty"`
	UPIVPAMasked         string    `json:"upi_vpa_masked,omitempty"`
	IsInternalTransfer   bool      `json:"is_internal_transfer"`
	IsDiscretionary      bool      `json:"is_discretionary"`
	IsRecurringCandidate bool      `json:"is_recurring_candidate"`
	CreatedAt            time.Time `json:"created_at"`
}

// IngestionChannel tracks Zero-AA real-time sources (Vault Email, Notification, Shortcut, Broker OAuth).
type IngestionChannel struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	ChannelType string    `json:"channel_type"`
	Provider    string    `json:"provider_name"`
	VaultAlias  string    `json:"vault_alias,omitempty"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
}

// AlertIngestRequest is sent by Android NotificationListener, iOS Shortcuts, or Vault Email worker.
type AlertIngestRequest struct {
	UserID          string   `json:"user_id,omitempty"`
	AccountID       string   `json:"account_id,omitempty"`
	SourceChannel   string   `json:"source_channel"`
	RawText         string   `json:"raw_text"`
	Amount          *float64 `json:"amount,omitempty"`
	BalanceAfterTxn *float64 `json:"balance_after_txn,omitempty"`
	MaskedAccount   string   `json:"masked_account,omitempty"`
	Currency        string   `json:"currency,omitempty"`
}

// LiveSnapshotContext feeds the Digital Twin, Radar, and AI CFO engines.
type LiveSnapshotContext struct {
	Accounts             []map[string]any `json:"accounts"`
	Holdings             []map[string]any `json:"holdings"`
	PhysicalAssets       []map[string]any `json:"physical_assets"`
	Liabilities          []map[string]any `json:"liabilities"`
	Transactions         []map[string]any `json:"transactions"`
	RecurringObligations []map[string]any `json:"recurring_obligations"`
	InsurancePolicies    []map[string]any `json:"insurance_policies"`
	GrossSalaryINR       float64          `json:"gross_salary_inr,omitempty"`
	MonthlyIncomeINR     float64          `json:"monthly_income_inr,omitempty"`
	MonthlyExpenseINR    float64          `json:"monthly_expense_inr,omitempty"`
}

// Goal tracks a target-dated wealth, emergency, retirement, or purchase milestone.
type Goal struct {
	ID                   string    `json:"id"`
	UserID               string    `json:"user_id"`
	Name                 string    `json:"name"`
	GoalType             string    `json:"goal_type"`
	Priority             int       `json:"priority"`
	TargetAmountToday    float64   `json:"target_amount_today"`
	TargetDate           string    `json:"target_date"`
	CurrentFundedINR     float64   `json:"current_funded_inr"`
	MonthlySIPINR        float64   `json:"monthly_sip_inr"`
	ProbabilityOfSuccess float64   `json:"probability_of_success"`
	Status               string    `json:"status"`
	UpdatedAt            time.Time `json:"updated_at"`
}

// Holding represents an equity, mutual fund, ETF, bond, or SGB holding.
type Holding struct {
	ID               string  `json:"id"`
	AccountID        string  `json:"account_id,omitempty"`
	Symbol           string  `json:"symbol"`
	Name             string  `json:"name"`
	AssetClass       string  `json:"asset_class"`
	InstrumentType   string  `json:"instrument_type"`
	PlanType         string  `json:"plan_type"`
	Units            float64 `json:"units"`
	AvgCostPerUnit   float64 `json:"avg_cost_per_unit"`
	CurrentValueINR  float64 `json:"current_value_inr"`
	UnrealizedPNLINR float64 `json:"unrealized_pnl_inr"`
	XIRRPct          float64 `json:"xirr_pct"`
}

// Liability represents a loan or EMI obligation tracked for debt optimization.
type Liability struct {
	ID                   string  `json:"id"`
	LoanType             string  `json:"loan_type"`
	LenderName           string  `json:"lender_name"`
	PrincipalSanctioned  float64 `json:"principal_sanctioned"`
	PrincipalOutstanding float64 `json:"principal_outstanding"`
	InterestRateAPR      float64 `json:"interest_rate_apr"`
	RateType             string  `json:"rate_type"`
	EMIAmount            float64 `json:"emi_amount"`
	RemainingMonths      int     `json:"remaining_months"`
	Status               string  `json:"status"`
}

// Budget summarizes an active spending budget.
type Budget struct {
	ID        string  `json:"id"`
	UserID    string  `json:"user_id,omitempty"`
	Name      string  `json:"name"`
	Period    string  `json:"period"`
	Amount    float64 `json:"amount"`
	Currency  string  `json:"currency"`
	StartDate string  `json:"start_date"`
}

// TableHealthEntry reports table readiness across the 46 finance.* schema tables.
type TableHealthEntry struct {
	Table   string `json:"table"`
	Rows    int64  `json:"rows"`
	WiredBy string `json:"wired_by"`
}

// FinancialProfile stores core tax/risk preferences feeding Twin, Tax & Advisory.
type FinancialProfile struct {
	UserID                 string  `json:"user_id"`
	TaxResidency           string  `json:"tax_residency"`
	PreferredTaxRegime     string  `json:"preferred_tax_regime"`
	RiskTolerance          string  `json:"risk_tolerance"`
	RiskScore              int     `json:"risk_score"`
	DependentsCount        int     `json:"dependents_count"`
	EmploymentType         string  `json:"employment_type"`
	AnnualGrossIncomeEst   float64 `json:"annual_gross_income_est"`
	MonthlyFixedObligation float64 `json:"monthly_fixed_obligation"`
	EmergencyTargetMonths  int     `json:"emergency_target_months"`
	RetirementTargetAge    int     `json:"retirement_target_age"`
}

// ConsentArtefact represents AA / Broker / Bureau consent metadata.
type ConsentArtefact struct {
	ID           string `json:"id"`
	UserID       string `json:"user_id"`
	ProviderType string `json:"provider_type"`
	TSPName      string `json:"tsp_name"`
	PurposeCode  string `json:"purpose_code"`
	Status       string `json:"status"`
}

// PhysicalAsset represents gold, real estate, ESOPs, or vehicles.
type PhysicalAsset struct {
	ID                string  `json:"id"`
	UserID            string  `json:"user_id"`
	AssetType         string  `json:"asset_type"`
	Name              string  `json:"name"`
	PurchaseValueINR  float64 `json:"purchase_value_inr"`
	EstimatedValueINR float64 `json:"estimated_value_inr"`
	LiquidityTier     string  `json:"liquidity_tier"`
}

// ParsedDocument captures statement/Form16/AIS/CAS ingestion state.
type ParsedDocument struct {
	ID                   string         `json:"id"`
	UserID               string         `json:"user_id"`
	DocType              string         `json:"doc_type"`
	StorageRef           string         `json:"storage_ref"`
	ExtractionStatus     string         `json:"extraction_status"`
	ExtractionConfidence float64        `json:"extraction_confidence"`
	ExtractedSummary     map[string]any `json:"extracted_summary"`
}

// CreditReport stores bureau scores & utilization signals.
type CreditReport struct {
	ID                  string  `json:"id"`
	UserID              string  `json:"user_id"`
	Bureau              string  `json:"bureau"`
	Score               int     `json:"score"`
	UtilizationPct      float64 `json:"utilization_pct"`
	ActiveAccountsCount int     `json:"active_accounts_count"`
	HardInquiries6M     int     `json:"hard_inquiries_6m"`
}

// InsurancePolicy stores term/health coverage for protection gap detection.
type InsurancePolicy struct {
	ID               string  `json:"id"`
	UserID           string  `json:"user_id"`
	PolicyType       string  `json:"policy_type"`
	InsurerName      string  `json:"insurer_name"`
	CoverSource      string  `json:"cover_source"`
	SumInsuredINR    float64 `json:"sum_insured_inr"`
	AnnualPremiumINR float64 `json:"annual_premium_inr"`
	NomineeVerified  bool    `json:"nominee_verified"`
}

// BusinessEntity stores MSME / freelance / startup unit economics & GST status.
type BusinessEntity struct {
	ID                  string  `json:"id"`
	UserID              string  `json:"user_id"`
	Name                string  `json:"name"`
	EntityType          string  `json:"entity_type"`
	Industry            string  `json:"industry,omitempty"`
	GSTIN               string  `json:"gstin,omitempty"`
	RevenueModel        string  `json:"revenue_model"`
	MonthlyFixedCostINR float64 `json:"monthly_fixed_cost_inr"`
	UnitPriceINR        float64 `json:"unit_price_inr"`
	UnitVariableCostINR float64 `json:"unit_variable_cost_inr"`
	MonthlyRevenueINR   float64 `json:"monthly_revenue_inr,omitempty"`
	CACINR              float64 `json:"cac_inr"`
	LTVINR              float64 `json:"ltv_inr"`
}
