package finance

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nexora/platform/api/internal/platform/events"
)

var ErrNotFound = errors.New("finance record not found")

// Repository persists accounts, encrypted transactions, ingestion channels, intelligence state, and outbox events.
type Repository interface {
	ListAccounts(ctx context.Context, userID string) ([]Account, error)
	CreateAccount(ctx context.Context, acct Account, vault *EnvelopeVault) (Account, error)
	ListTransactions(ctx context.Context, userID string, limit int) ([]Transaction, error)
	RecordTransactionAndEnqueue(ctx context.Context, txn Transaction, rawUPIVPA, rawDesc string, vault *EnvelopeVault) (Transaction, bool, error)
	ListIngestionChannels(ctx context.Context, userID string) ([]IngestionChannel, error)
	CreateIngestionChannel(ctx context.Context, ch IngestionChannel, rawSecret string) (IngestionChannel, error)
	LoadSnapshotContext(ctx context.Context, userID string) LiveSnapshotContext

	ListGoals(ctx context.Context, userID string) ([]Goal, error)
	CreateGoal(ctx context.Context, goal Goal) (Goal, error)
	ListHoldings(ctx context.Context, userID string) ([]Holding, error)
	ListLiabilities(ctx context.Context, userID string) ([]Liability, error)
	ListBudgets(ctx context.Context, userID string) ([]Budget, error)

	SaveDigitalTwinSnapshot(ctx context.Context, userID string, snap map[string]any)
	SaveMarketsAnalysis(ctx context.Context, userID string, req, res map[string]any)
	SaveTaxEvaluation(ctx context.Context, userID string, req, res map[string]any)
	SaveSimulationRun(ctx context.Context, userID string, req map[string]any, res map[string]any)
	SaveRadarOpportunities(ctx context.Context, userID string, radarRes map[string]any)
	SaveCFOEvidenceAndDecision(ctx context.Context, userID, query string, res map[string]any)
	SaveKnowledgePropagation(ctx context.Context, userID string, req, res map[string]any)
	UpsertProfile(ctx context.Context, p FinancialProfile) (FinancialProfile, error)
	CreateConsent(ctx context.Context, c ConsentArtefact) (ConsentArtefact, error)
	CreateBudget(ctx context.Context, b Budget, categoryName string) (Budget, error)
	CreateHolding(ctx context.Context, userID, symbol, name, assetClass, instType, planType string, units, avgCost float64) (Holding, error)
	CreatePhysicalAsset(ctx context.Context, a PhysicalAsset) (PhysicalAsset, error)
	CreateParsedDocument(ctx context.Context, d ParsedDocument) (ParsedDocument, error)
	CreateLiability(ctx context.Context, userID string, l Liability) (Liability, error)
	CreateCreditReport(ctx context.Context, c CreditReport) (CreditReport, error)
	CreateInsurancePolicy(ctx context.Context, p InsurancePolicy) (InsurancePolicy, error)
	CreateBusinessEntity(ctx context.Context, b BusinessEntity) (BusinessEntity, error)
	GetTableHealth(ctx context.Context, userID string) ([]TableHealthEntry, error)
	ResetUserData(ctx context.Context, userID string) (int64, error)
}

// MemoryRepository provides thread-safe in-memory storage for tests and DB-less development.
type MemoryRepository struct {
	mu       sync.RWMutex
	accounts map[string][]Account
	txns     map[string][]Transaction
	channels map[string][]IngestionChannel
	goals    map[string][]Goal
	holdings map[string][]Holding
	liabs    map[string][]Liability
	budgets  map[string][]Budget
	profiles map[string]FinancialProfile
	assets   map[string][]PhysicalAsset
	policies map[string][]InsurancePolicy
	biz      map[string][]BusinessEntity
	dedupe   map[string]bool
	twinVer  map[string]int64
}

// NewMemoryRepository initializes an in-memory finance repository with realistic starter state.
func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{
		accounts: make(map[string][]Account),
		txns:     make(map[string][]Transaction),
		channels: make(map[string][]IngestionChannel),
		goals:    make(map[string][]Goal),
		holdings: make(map[string][]Holding),
		liabs:    make(map[string][]Liability),
		budgets:  make(map[string][]Budget),
		profiles: make(map[string]FinancialProfile),
		assets:   make(map[string][]PhysicalAsset),
		policies: make(map[string][]InsurancePolicy),
		biz:      make(map[string][]BusinessEntity),
		dedupe:   make(map[string]bool),
		twinVer:  make(map[string]int64),
	}
}

func (m *MemoryRepository) ensureSeededLocked(userID string) {
	if _, ok := m.accounts[userID]; ok {
		return
	}
	now := time.Now().UTC()
	m.accounts[userID] = []Account{
		{
			ID:             "11111111-1111-1111-1111-111111111101",
			UserID:         userID,
			Name:           "HDFC Savings",
			AccountType:    "bank",
			Institution:    "HDFC Bank",
			MaskedNumber:   "**4821",
			Currency:       "INR",
			CurrentBalance: 325000,
			SyncStatus:     "synced",
			IsConnected:    true,
			UpdatedAt:      now,
		},
		{
			ID:             "11111111-1111-1111-1111-111111111102",
			UserID:         userID,
			Name:           "EPF + PPF Retirement",
			AccountType:    "retirement",
			Institution:    "EPFO",
			MaskedNumber:   "**9012",
			Currency:       "INR",
			CurrentBalance: 640000,
			SyncStatus:     "synced",
			IsConnected:    true,
			UpdatedAt:      now,
		},
	}
	m.txns[userID] = []Transaction{
		{
			ID:              "22222222-2222-2222-2222-222222222201",
			UserID:          userID,
			AccountID:       "11111111-1111-1111-1111-111111111101",
			TxnDate:         now.Format("2006-01-02"),
			TxnType:         "credit",
			Channel:         "neft",
			SourceChannel:   "statement_pdf",
			Amount:          165000,
			Currency:        "INR",
			Merchant:        "Employer Payroll",
			Category:        "Salary Income",
			IsDiscretionary: false,
			CreatedAt:       now,
		},
		{
			ID:              "22222222-2222-2222-2222-222222222202",
			UserID:          userID,
			AccountID:       "11111111-1111-1111-1111-111111111101",
			TxnDate:         now.Format("2006-01-02"),
			TxnType:         "debit",
			Channel:         "upi",
			SourceChannel:   "android_notification",
			Amount:          -1450,
			Currency:        "INR",
			Merchant:        "Swiggy",
			Category:        "Food & Dining",
			UPIVPAMasked:    "sw***@icici",
			IsDiscretionary: true,
			CreatedAt:       now,
		},
	}
	m.goals[userID] = []Goal{
		{
			ID:                   "30000000-0000-0000-0000-000000000441",
			UserID:               userID,
			Name:                 "Financial Independence Corpus",
			GoalType:             "retirement",
			Priority:             1,
			TargetAmountToday:    30000000,
			TargetDate:           now.AddDate(15, 0, 0).Format("2006-01-02"),
			CurrentFundedINR:     1725000,
			MonthlySIPINR:        35000,
			ProbabilityOfSuccess: 0.84,
			Status:               "on_track",
			UpdatedAt:            now,
		},
		{
			ID:                   "30000000-0000-0000-0000-000000000442",
			UserID:               userID,
			Name:                 "6-Month Emergency Shield",
			GoalType:             "emergency",
			Priority:             1,
			TargetAmountToday:    300000,
			TargetDate:           now.AddDate(0, 6, 0).Format("2006-01-02"),
			CurrentFundedINR:     300000,
			MonthlySIPINR:        0,
			ProbabilityOfSuccess: 0.99,
			Status:               "achieved",
			UpdatedAt:            now,
		},
	}
	m.holdings[userID] = []Holding{
		{
			ID:               "30000000-0000-0000-0000-000000000411",
			Symbol:           "PPFAS_FLEXI_DIR",
			Name:             "Parag Parikh Flexi Cap Direct Growth",
			AssetClass:       "equity",
			InstrumentType:   "mutual_fund",
			PlanType:         "direct",
			Units:            7200,
			AvgCostPerUnit:   64.5,
			CurrentValueINR:  624960,
			UnrealizedPNLINR: 160560,
			XIRRPct:          17.8,
		},
		{
			ID:               "30000000-0000-0000-0000-000000000412",
			Symbol:           "NIFTYBEES",
			Name:             "Nippon India ETF Nifty 50 BeES",
			AssetClass:       "equity",
			InstrumentType:   "etf",
			PlanType:         "na",
			Units:            1705,
			AvgCostPerUnit:   224,
			CurrentValueINR:  460094,
			UnrealizedPNLINR: 78174,
			XIRRPct:          14.6,
		},
	}
	m.liabs[userID] = []Liability{
		{
			ID:                   "30000000-0000-0000-0000-000000000601",
			LoanType:             "home",
			LenderName:           "SBI Home Loans",
			PrincipalSanctioned:  2500000,
			PrincipalOutstanding: 1450000,
			InterestRateAPR:      0.0855,
			RateType:             "floating_eblr",
			EMIAmount:            24800,
			RemainingMonths:      84,
			Status:               "active",
		},
	}
	m.budgets[userID] = []Budget{
		{
			ID:        "30000000-0000-0000-0000-000000000201",
			Name:      "Monthly Household & Lifestyle",
			Period:    "monthly",
			Amount:    65000,
			Currency:  "INR",
			StartDate: now.Format("2006-01-01"),
		},
	}
}

func (m *MemoryRepository) ListAccounts(_ context.Context, userID string) ([]Account, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ensureSeededLocked(userID)
	out := make([]Account, len(m.accounts[userID]))
	copy(out, m.accounts[userID])
	return out, nil
}

func (m *MemoryRepository) CreateAccount(_ context.Context, acct Account, _ *EnvelopeVault) (Account, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ensureSeededLocked(acct.UserID)
	if acct.ID == "" {
		acct.ID = uuid.NewString()
	}
	if acct.Currency == "" {
		acct.Currency = "INR"
	}
	if acct.SyncStatus == "" {
		acct.SyncStatus = "manual"
	}
	acct.UpdatedAt = time.Now().UTC()
	m.accounts[acct.UserID] = append(m.accounts[acct.UserID], acct)
	return acct, nil
}

func (m *MemoryRepository) ListTransactions(_ context.Context, userID string, limit int) ([]Transaction, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ensureSeededLocked(userID)
	src := m.txns[userID]
	if limit <= 0 || limit > len(src) {
		limit = len(src)
	}
	out := make([]Transaction, limit)
	copy(out, src[:limit])
	return out, nil
}

func (m *MemoryRepository) RecordTransactionAndEnqueue(_ context.Context, txn Transaction, _ string, _ string, _ *EnvelopeVault) (Transaction, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ensureSeededLocked(txn.UserID)
	if txn.ExternalTxnID != "" {
		k := txn.UserID + ":" + txn.ExternalTxnID
		if m.dedupe[k] {
			return txn, false, nil
		}
		m.dedupe[k] = true
	}
	if txn.ID == "" {
		txn.ID = uuid.NewString()
	}
	if txn.CreatedAt.IsZero() {
		txn.CreatedAt = time.Now().UTC()
	}
	if txn.TxnDate == "" {
		txn.TxnDate = txn.CreatedAt.Format("2006-01-02")
	}

	// Update account balance (self-healing snap to Avl Bal when provided, else running ledger)
	accts := m.accounts[txn.UserID]
	targetIdx := -1
	for i := range accts {
		if (txn.AccountID != "" && accts[i].ID == txn.AccountID) || (txn.AccountID == "" && accts[i].AccountType == "bank") {
			targetIdx = i
			break
		}
	}
	if targetIdx >= 0 {
		txn.AccountID = accts[targetIdx].ID
		if txn.BalanceAfterTxn != nil && *txn.BalanceAfterTxn > 0 {
			accts[targetIdx].CurrentBalance = *txn.BalanceAfterTxn
		} else {
			accts[targetIdx].CurrentBalance += txn.Amount
		}
		accts[targetIdx].SyncStatus = "synced"
		accts[targetIdx].UpdatedAt = txn.CreatedAt
		m.accounts[txn.UserID] = accts
	}

	m.txns[txn.UserID] = append([]Transaction{txn}, m.txns[txn.UserID]...)
	return txn, true, nil
}

func (m *MemoryRepository) ListIngestionChannels(_ context.Context, userID string) ([]IngestionChannel, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	src := m.channels[userID]
	out := make([]IngestionChannel, len(src))
	copy(out, src)
	return out, nil
}

func (m *MemoryRepository) CreateIngestionChannel(_ context.Context, ch IngestionChannel, _ string) (IngestionChannel, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if ch.ID == "" {
		ch.ID = uuid.NewString()
	}
	if ch.Status == "" {
		ch.Status = "active"
	}
	ch.CreatedAt = time.Now().UTC()
	m.channels[ch.UserID] = append(m.channels[ch.UserID], ch)
	return ch, nil
}

func (m *MemoryRepository) LoadSnapshotContext(_ context.Context, userID string) LiveSnapshotContext {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ensureSeededLocked(userID)
	accts := make([]map[string]any, 0, len(m.accounts[userID]))
	for _, a := range m.accounts[userID] {
		accts = append(accts, map[string]any{
			"id":              a.ID,
			"account_type":    a.AccountType,
			"current_balance": a.CurrentBalance,
		})
	}
	txns := make([]map[string]any, 0, len(m.txns[userID]))
	for _, t := range m.txns[userID] {
		txns = append(txns, map[string]any{
			"amount":               t.Amount,
			"inr_amount":           t.Amount,
			"txn_type":             t.TxnType,
			"is_internal_transfer": t.IsInternalTransfer,
			"is_discretionary":     t.IsDiscretionary,
		})
	}
	return LiveSnapshotContext{
		Accounts: accts,
		Holdings: []map[string]any{
			{"name": "Nifty 50 Index Direct", "current_value_inr": 850000.0},
			{"name": "Flexi Cap Direct", "current_value_inr": 420000.0},
		},
		PhysicalAssets: []map[string]any{
			{"name": "Sovereign Gold Bond", "estimated_value_inr": 250000.0},
		},
		Liabilities: []map[string]any{
			{"loan_type": "home", "principal_outstanding": 1400000.0, "emi_amount": 19500.0, "interest_rate_apr": 0.086},
		},
		Transactions: txns,
		RecurringObligations: []map[string]any{
			{"title": "Home Loan EMI", "expected_amount": 19500.0, "status": "active"},
			{"title": "Nifty 50 SIP", "expected_amount": 25000.0, "status": "active"},
		},
		InsurancePolicies: []map[string]any{
			{"policy_type": "term_life", "cover_source": "personal"},
			{"policy_type": "health", "cover_source": "personal"},
		},
		GrossSalaryINR: 1980000,
	}
}

func (m *MemoryRepository) ListGoals(_ context.Context, userID string) ([]Goal, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ensureSeededLocked(userID)
	out := make([]Goal, len(m.goals[userID]))
	copy(out, m.goals[userID])
	return out, nil
}

func (m *MemoryRepository) CreateGoal(_ context.Context, goal Goal) (Goal, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ensureSeededLocked(goal.UserID)
	if goal.ID == "" {
		goal.ID = uuid.NewString()
	}
	if goal.GoalType == "" {
		goal.GoalType = "wealth_milestone"
	}
	if goal.Priority <= 0 {
		goal.Priority = 2
	}
	if goal.Status == "" {
		goal.Status = "on_track"
	}
	if goal.TargetDate == "" {
		goal.TargetDate = time.Now().UTC().AddDate(5, 0, 0).Format("2006-01-02")
	}
	goal.UpdatedAt = time.Now().UTC()
	m.goals[goal.UserID] = append([]Goal{goal}, m.goals[goal.UserID]...)
	return goal, nil
}

func (m *MemoryRepository) ListHoldings(_ context.Context, userID string) ([]Holding, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ensureSeededLocked(userID)
	out := make([]Holding, len(m.holdings[userID]))
	copy(out, m.holdings[userID])
	return out, nil
}

func (m *MemoryRepository) ListLiabilities(_ context.Context, userID string) ([]Liability, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ensureSeededLocked(userID)
	out := make([]Liability, len(m.liabs[userID]))
	copy(out, m.liabs[userID])
	return out, nil
}

func (m *MemoryRepository) ListBudgets(_ context.Context, userID string) ([]Budget, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ensureSeededLocked(userID)
	out := make([]Budget, len(m.budgets[userID]))
	copy(out, m.budgets[userID])
	return out, nil
}

func (m *MemoryRepository) SaveDigitalTwinSnapshot(_ context.Context, userID string, _ map[string]any) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.twinVer[userID]++
}

func (m *MemoryRepository) SaveMarketsAnalysis(_ context.Context, _ string, _, _ map[string]any)    {}
func (m *MemoryRepository) SaveTaxEvaluation(_ context.Context, _ string, _, _ map[string]any)      {}
func (m *MemoryRepository) SaveSimulationRun(_ context.Context, _ string, _, _ map[string]any)      {}
func (m *MemoryRepository) SaveRadarOpportunities(_ context.Context, _ string, _ map[string]any)    {}
func (m *MemoryRepository) SaveCFOEvidenceAndDecision(_ context.Context, _, _ string, _ map[string]any) {
}
func (m *MemoryRepository) SaveKnowledgePropagation(_ context.Context, _ string, _, _ map[string]any) {
}

func (m *MemoryRepository) UpsertProfile(_ context.Context, p FinancialProfile) (FinancialProfile, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.profiles[p.UserID] = p
	return p, nil
}

func (m *MemoryRepository) CreateConsent(_ context.Context, c ConsentArtefact) (ConsentArtefact, error) {
	if c.ID == "" {
		c.ID = uuid.NewString()
	}
	if c.Status == "" {
		c.Status = "active"
	}
	return c, nil
}

func (m *MemoryRepository) CreateBudget(_ context.Context, b Budget, _ string) (Budget, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if b.ID == "" {
		b.ID = uuid.NewString()
	}
	if b.Period == "" {
		b.Period = "monthly"
	}
	if b.Currency == "" {
		b.Currency = "INR"
	}
	return b, nil
}

func (m *MemoryRepository) CreateHolding(_ context.Context, userID, symbol, name, assetClass, instType, planType string, units, avgCost float64) (Holding, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ensureSeededLocked(userID)
	val := units * avgCost
	h := Holding{
		ID:              uuid.NewString(),
		Symbol:          symbol,
		Name:            name,
		AssetClass:      assetClass,
		InstrumentType:  instType,
		PlanType:        planType,
		Units:           units,
		AvgCostPerUnit:  avgCost,
		CurrentValueINR: val,
	}
	m.holdings[userID] = append([]Holding{h}, m.holdings[userID]...)
	return h, nil
}

func (m *MemoryRepository) CreatePhysicalAsset(_ context.Context, a PhysicalAsset) (PhysicalAsset, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if a.ID == "" {
		a.ID = uuid.NewString()
	}
	m.assets[a.UserID] = append([]PhysicalAsset{a}, m.assets[a.UserID]...)
	return a, nil
}

func (m *MemoryRepository) CreateParsedDocument(_ context.Context, d ParsedDocument) (ParsedDocument, error) {
	if d.ID == "" {
		d.ID = uuid.NewString()
	}
	if d.ExtractionStatus == "" {
		d.ExtractionStatus = "completed"
	}
	return d, nil
}

func (m *MemoryRepository) CreateLiability(_ context.Context, userID string, l Liability) (Liability, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ensureSeededLocked(userID)
	if l.ID == "" {
		l.ID = uuid.NewString()
	}
	if l.Status == "" {
		l.Status = "active"
	}
	m.liabs[userID] = append([]Liability{l}, m.liabs[userID]...)
	return l, nil
}

func (m *MemoryRepository) CreateCreditReport(_ context.Context, c CreditReport) (CreditReport, error) {
	if c.ID == "" {
		c.ID = uuid.NewString()
	}
	return c, nil
}

func (m *MemoryRepository) CreateInsurancePolicy(_ context.Context, p InsurancePolicy) (InsurancePolicy, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if p.ID == "" {
		p.ID = uuid.NewString()
	}
	m.policies[p.UserID] = append([]InsurancePolicy{p}, m.policies[p.UserID]...)
	return p, nil
}

func (m *MemoryRepository) CreateBusinessEntity(_ context.Context, b BusinessEntity) (BusinessEntity, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if b.ID == "" {
		b.ID = uuid.NewString()
	}
	m.biz[b.UserID] = append([]BusinessEntity{b}, m.biz[b.UserID]...)
	return b, nil
}

func (m *MemoryRepository) GetTableHealth(_ context.Context, userID string) ([]TableHealthEntry, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ensureSeededLocked(userID)
	return []TableHealthEntry{
		{Table: "finance.accounts", Rows: int64(len(m.accounts[userID])), WiredBy: "memory"},
		{Table: "finance.transactions", Rows: int64(len(m.txns[userID])), WiredBy: "memory"},
		{Table: "finance.goals", Rows: int64(len(m.goals[userID])), WiredBy: "memory"},
		{Table: "finance.holdings", Rows: int64(len(m.holdings[userID])), WiredBy: "memory"},
		{Table: "finance.liabilities", Rows: int64(len(m.liabs[userID])), WiredBy: "memory"},
		{Table: "finance.budgets", Rows: int64(len(m.budgets[userID])), WiredBy: "memory"},
	}, nil
}

func (m *MemoryRepository) ResetUserData(_ context.Context, userID string) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	total := int64(len(m.accounts[userID]) + len(m.txns[userID]) + len(m.channels[userID]) +
		len(m.goals[userID]) + len(m.holdings[userID]) + len(m.liabs[userID]) + len(m.budgets[userID]))
	m.accounts[userID] = []Account{}
	m.txns[userID] = []Transaction{}
	m.channels[userID] = []IngestionChannel{}
	m.goals[userID] = []Goal{}
	m.holdings[userID] = []Holding{}
	m.liabs[userID] = []Liability{}
	m.budgets[userID] = []Budget{}
	delete(m.profiles, userID)
	m.assets[userID] = []PhysicalAsset{}
	m.policies[userID] = []InsurancePolicy{}
	m.biz[userID] = []BusinessEntity{}
	m.twinVer[userID] = 0
	return total, nil
}

// PostgresRepository implements Repository against PostgreSQL 16 (0001 + 0006 schemas).
type PostgresRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func (p *PostgresRepository) ListAccounts(ctx context.Context, userID string) ([]Account, error) {
	rows, err := p.pool.Query(ctx,
		`SELECT id::text, user_id::text, name, account_type, COALESCE(institution,''), COALESCE(masked_number,''),
		        currency, current_balance::float8, interest_rate_apr::float8, sync_status, is_connected, updated_at
		 FROM finance.accounts
		 WHERE user_id = $1 AND deleted_at IS NULL
		 ORDER BY updated_at DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Account
	for rows.Next() {
		var a Account
		if scanErr := rows.Scan(
			&a.ID, &a.UserID, &a.Name, &a.AccountType, &a.Institution, &a.MaskedNumber,
			&a.Currency, &a.CurrentBalance, &a.InterestRateAPR, &a.SyncStatus, &a.IsConnected, &a.UpdatedAt,
		); scanErr == nil {
			out = append(out, a)
		}
	}
	return out, nil
}

func (p *PostgresRepository) CreateAccount(ctx context.Context, acct Account, vault *EnvelopeVault) (Account, error) {
	if acct.Currency == "" {
		acct.Currency = "INR"
	}
	if acct.SyncStatus == "" {
		acct.SyncStatus = "manual"
	}
	var instEnc []byte
	if vault != nil && acct.Institution != "" {
		instEnc, _ = vault.EncryptField(acct.UserID, acct.Institution)
	}
	err := p.pool.QueryRow(ctx,
		`INSERT INTO finance.accounts (user_id, name, account_type, institution, masked_number, institution_enc, currency, opening_balance, current_balance, available_balance, interest_rate_apr, sync_status, is_connected)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $8, $9, $10, $11)
		 RETURNING id::text, updated_at`,
		acct.UserID, acct.Name, acct.AccountType, acct.Institution, acct.MaskedNumber, instEnc, acct.Currency, acct.CurrentBalance, acct.InterestRateAPR, acct.SyncStatus, acct.IsConnected,
	).Scan(&acct.ID, &acct.UpdatedAt)
	if err == nil {
		_, _ = p.pool.Exec(ctx,
			`INSERT INTO finance.user_encryption_keys (user_id, encryption_mode, key_version) VALUES ($1, 'kms_envelope', 1) ON CONFLICT (user_id) DO NOTHING`,
			acct.UserID,
		)
		if acct.AccountType == "credit_card" {
			issuer := acct.Institution
			if issuer == "" {
				issuer = acct.Name
			}
			_, _ = p.pool.Exec(ctx,
				`INSERT INTO finance.credit_cards (account_id, user_id, issuer, network, credit_limit, current_outstanding, apr)
				 VALUES ($1::uuid, $2, $3, 'visa', GREATEST($4 * 4, 100000), $4, 0.4200)
				 ON CONFLICT (account_id) DO UPDATE SET current_outstanding = EXCLUDED.current_outstanding`,
				acct.ID, acct.UserID, issuer, acct.CurrentBalance,
			)
		}
	}
	return acct, err
}

func (p *PostgresRepository) ListTransactions(ctx context.Context, userID string, limit int) ([]Transaction, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := p.pool.Query(ctx,
		`SELECT id::text, user_id::text, account_id::text, COALESCE(external_txn_id,''), txn_date::text,
		        txn_type, channel, source_channel, amount::float8, currency, balance_after_txn::float8,
		        COALESCE(merchant,''), COALESCE(upi_vpa,''), is_internal_transfer,
		        COALESCE(is_discretionary,false), is_recurring_candidate, created_at
		 FROM finance.transactions
		 WHERE user_id = $1 AND deleted_at IS NULL
		 ORDER BY txn_date DESC, created_at DESC
		 LIMIT $2`,
		userID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Transaction
	for rows.Next() {
		var t Transaction
		if scanErr := rows.Scan(
			&t.ID, &t.UserID, &t.AccountID, &t.ExternalTxnID, &t.TxnDate,
			&t.TxnType, &t.Channel, &t.SourceChannel, &t.Amount, &t.Currency, &t.BalanceAfterTxn,
			&t.Merchant, &t.UPIVPAMasked, &t.IsInternalTransfer, &t.IsDiscretionary, &t.IsRecurringCandidate, &t.CreatedAt,
		); scanErr == nil {
			out = append(out, t)
		}
	}
	return out, nil
}

func (p *PostgresRepository) RecordTransactionAndEnqueue(ctx context.Context, txn Transaction, rawUPIVPA, rawDesc string, vault *EnvelopeVault) (Transaction, bool, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return txn, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	_, _ = tx.Exec(ctx,
		`INSERT INTO finance.user_encryption_keys (user_id, encryption_mode, key_version) VALUES ($1, 'kms_envelope', 1) ON CONFLICT (user_id) DO NOTHING`,
		txn.UserID,
	)
	if txn.AccountID == "" {
		_ = tx.QueryRow(ctx,
			`SELECT id::text FROM finance.accounts WHERE user_id = $1 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1`,
			txn.UserID,
		).Scan(&txn.AccountID)
	}
	if txn.AccountID == "" {
		initBal := 0.0
		if txn.BalanceAfterTxn != nil && *txn.BalanceAfterTxn > 0 {
			initBal = *txn.BalanceAfterTxn
		}
		_ = tx.QueryRow(ctx,
			`INSERT INTO finance.accounts (user_id, name, account_type, institution, masked_number, currency, opening_balance, current_balance, available_balance, sync_status, is_connected)
			 VALUES ($1, 'Primary Bank Account', 'bank', 'Detected via Zero-AA', '**0000', 'INR', $2, $2, $2, 'synced', true)
			 RETURNING id::text`,
			txn.UserID, initBal,
		).Scan(&txn.AccountID)
	}
	if txn.TxnDate == "" {
		txn.TxnDate = time.Now().UTC().Format("2006-01-02")
	}
	if txn.Currency == "" {
		txn.Currency = "INR"
	}

	var merchantID string
	if txn.Merchant != "" {
		catName := txn.Category
		if catName == "" {
			catName = "General"
		}
		_ = tx.QueryRow(ctx,
			`INSERT INTO finance.merchants (canonical_name, default_category_name)
			 VALUES ($1, $2)
			 ON CONFLICT (canonical_name) DO UPDATE SET default_category_name = COALESCE(EXCLUDED.default_category_name, finance.merchants.default_category_name)
			 RETURNING id::text`,
			txn.Merchant, catName,
		).Scan(&merchantID)
	}
	var categoryID string
	if txn.Category != "" {
		_ = tx.QueryRow(ctx,
			`INSERT INTO finance.categories (user_id, name)
			 VALUES ($1, $2)
			 ON CONFLICT (user_id, name) DO UPDATE SET name = EXCLUDED.name
			 RETURNING id::text`,
			txn.UserID, txn.Category,
		).Scan(&categoryID)
	}

	var descEnc, vpaEnc, vpaBlind []byte
	if vault != nil {
		descEnc, _ = vault.EncryptField(txn.UserID, rawDesc)
		vpaEnc, _ = vault.EncryptField(txn.UserID, rawUPIVPA)
		if b := vault.BlindIndex(txn.UserID, rawUPIVPA); b != "" {
			vpaBlind, _ = hex.DecodeString(b)
		}
	}

	err = tx.QueryRow(ctx,
		`INSERT INTO finance.transactions (
		     user_id, account_id, external_txn_id, txn_date, txn_type, channel, source_channel,
		     merchant_id, merchant, category_id, upi_vpa, amount, inr_amount, currency, balance_after_txn,
		     is_internal_transfer, is_discretionary, is_recurring_candidate,
		     description_enc, upi_vpa_enc, upi_vpa_blind_idx
		 )
		 VALUES ($1, $2, NULLIF($3,''), $4::date, $5, $6, $7, NULLIF($8,'')::uuid, $9, NULLIF($10,'')::uuid, $11, $12, $12, $13, $14, $15, $16, $17, $18, $19, $20)
		 ON CONFLICT (account_id, external_txn_id) WHERE external_txn_id IS NOT NULL DO NOTHING
		 RETURNING id::text, created_at`,
		txn.UserID, txn.AccountID, txn.ExternalTxnID, txn.TxnDate, txn.TxnType, txn.Channel, txn.SourceChannel,
		merchantID, txn.Merchant, categoryID, txn.UPIVPAMasked, txn.Amount, txn.Currency, txn.BalanceAfterTxn,
		txn.IsInternalTransfer, txn.IsDiscretionary, txn.IsRecurringCandidate,
		descEnc, vpaEnc, vpaBlind,
	).Scan(&txn.ID, &txn.CreatedAt)
	if err != nil {
		return txn, false, nil // deduplicated or skipped
	}

	if txn.IsRecurringCandidate {
		title := txn.Merchant
		if title == "" {
			title = "Recurring Payment"
		}
		amtAbs := txn.Amount
		if amtAbs < 0 {
			amtAbs = -amtAbs
		}
		_, _ = tx.Exec(ctx,
			`INSERT INTO finance.recurring_obligations (user_id, account_id, merchant_id, title, obligation_type, cadence, expected_amount, currency, auto_debit, status)
			 VALUES ($1, $2::uuid, NULLIF($3,'')::uuid, $4, 'subscription', 'monthly', $5, $6, true, 'active')`,
			txn.UserID, txn.AccountID, merchantID, title, amtAbs, txn.Currency,
		)
		if txn.Channel == "upi" && txn.UPIVPAMasked != "" {
			_, _ = tx.Exec(ctx,
				`INSERT INTO finance.upi_mandates (user_id, account_id, payee_vpa, payee_name, max_amount, frequency, status)
				 VALUES ($1, $2::uuid, $3, $4, GREATEST($5, 100), 'monthly', 'active')`,
				txn.UserID, txn.AccountID, txn.UPIVPAMasked, title, amtAbs,
			)
		}
	}

	if txn.IsInternalTransfer {
		var prevID string
		if _ = tx.QueryRow(ctx,
			`SELECT id::text FROM finance.transactions WHERE user_id = $1 AND id <> $2::uuid ORDER BY created_at DESC LIMIT 1`,
			txn.UserID, txn.ID,
		).Scan(&prevID); prevID != "" {
			_, _ = tx.Exec(ctx,
				`INSERT INTO finance.reconciliation_links (user_id, primary_txn_id, matched_txn_id, link_type, confidence, status)
				 VALUES ($1, $2::uuid, $3::uuid, 'self_transfer', 0.90, 'auto_matched')
				 ON CONFLICT (primary_txn_id, matched_txn_id, link_type) DO NOTHING`,
				txn.UserID, txn.ID, prevID,
			)
		}
	}

	if txn.BalanceAfterTxn != nil && *txn.BalanceAfterTxn > 0 {
		_, _ = tx.Exec(ctx,
			`UPDATE finance.accounts SET current_balance = $2, available_balance = $2, sync_status = 'synced', last_synced_at = now()
			 WHERE id = $1`,
			txn.AccountID, *txn.BalanceAfterTxn,
		)
		_, _ = tx.Exec(ctx,
			`INSERT INTO finance.balance_history (account_id, as_of_date, balance, currency, inr_balance, source, is_verified)
			 VALUES ($1, $2::date, $3, $4, $3, 'alert_avl_bal', true)
			 ON CONFLICT (account_id, as_of_date) DO UPDATE SET balance = EXCLUDED.balance, inr_balance = EXCLUDED.inr_balance, is_verified = true`,
			txn.AccountID, txn.TxnDate, *txn.BalanceAfterTxn, txn.Currency,
		)
	} else {
		_, _ = tx.Exec(ctx,
			`UPDATE finance.accounts SET current_balance = current_balance + $2, available_balance = available_balance + $2, sync_status = 'synced', last_synced_at = now()
			 WHERE id = $1`,
			txn.AccountID, txn.Amount,
		)
	}

	_ = events.EnqueueOutbox(ctx, tx, "finance.transaction.ingested.v1", "finance.transaction", txn.ID, txn.UserID, map[string]any{
		"user_id":     txn.UserID,
		"account_id":  txn.AccountID,
		"txn_id":      txn.ID,
		"amount":      txn.Amount,
		"txn_type":    txn.TxnType,
		"category":    txn.Category,
		"source":      txn.SourceChannel,
	})

	if err := tx.Commit(ctx); err != nil {
		return txn, false, err
	}
	return txn, true, nil
}

func (p *PostgresRepository) ListIngestionChannels(ctx context.Context, userID string) ([]IngestionChannel, error) {
	rows, err := p.pool.Query(ctx,
		`SELECT id::text, user_id::text, channel_type, provider_name, status, created_at
		 FROM finance.ingestion_channels WHERE user_id = $1 ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []IngestionChannel
	for rows.Next() {
		var c IngestionChannel
		if scanErr := rows.Scan(&c.ID, &c.UserID, &c.ChannelType, &c.Provider, &c.Status, &c.CreatedAt); scanErr == nil {
			out = append(out, c)
		}
	}
	return out, nil
}

func (p *PostgresRepository) CreateIngestionChannel(ctx context.Context, ch IngestionChannel, rawSecret string) (IngestionChannel, error) {
	sum := sha256.Sum256([]byte(rawSecret))
	hashHex := hex.EncodeToString(sum[:])
	var aliasHash, webhookHash *string
	if ch.ChannelType == "email_forward" {
		aliasHash = &hashHex
	} else {
		webhookHash = &hashHex
	}
	err := p.pool.QueryRow(ctx,
		`INSERT INTO finance.ingestion_channels (user_id, channel_type, provider_name, vault_alias_hash, webhook_token_hash, status)
		 VALUES ($1, $2, $3, $4, $5, 'active')
		 RETURNING id::text, status, created_at`,
		ch.UserID, ch.ChannelType, ch.Provider, aliasHash, webhookHash,
	).Scan(&ch.ID, &ch.Status, &ch.CreatedAt)
	return ch, err
}
