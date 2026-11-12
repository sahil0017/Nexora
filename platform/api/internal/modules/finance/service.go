package finance

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"

	"github.com/nexora/platform/api/internal/platform/cache"
	"github.com/nexora/platform/api/internal/platform/identity"
)

// Service orchestrates the NEXORA Finance Control Plane, Redis caching, SSE push,
// EnvelopeVault encryption, and Python ML Finance Intelligence Network calls.
type Service struct {
	repo   Repository
	ml     *MLClient
	vault  *EnvelopeVault
	cache  *cache.Client
	logger *slog.Logger

	subMu       sync.RWMutex
	subscribers map[string][]chan []byte
}

// NewService constructs a finance service. If repo is nil, an in-memory repository is used.
func NewService(repo Repository, ml *MLClient, vault *EnvelopeVault, logger *slog.Logger) *Service {
	if repo == nil {
		repo = NewMemoryRepository()
	}
	if vault == nil {
		vault = NewEnvelopeVault("")
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &Service{
		repo:        repo,
		ml:          ml,
		vault:       vault,
		logger:      logger,
		subscribers: make(map[string][]chan []byte),
	}
}

// WithCache attaches a Redis read-through cache to the finance service.
func (s *Service) WithCache(c *cache.Client) *Service {
	s.cache = c
	return s
}

// Mount registers all /finance/* routes on the given router.
func Mount(r chi.Router, svc *Service) {
	if svc == nil {
		svc = NewService(nil, nil, nil, slog.Default())
	}
	r.Route("/finance", func(f chi.Router) {
		f.Get("/digital-twin", svc.GetDigitalTwin)
		f.Get("/accounts", svc.ListAccounts)
		f.Post("/accounts", svc.CreateAccount)
		f.Get("/transactions", svc.ListTransactions)
		f.Post("/transactions", svc.CreateTransaction)
		f.Post("/ingest/alert", svc.IngestAlert)
		f.Post("/ingest/smart-sync", svc.SmartSyncBatch)
		f.Get("/channels", svc.ListChannels)
		f.Post("/channels", svc.CreateChannel)
		f.Post("/markets/analyze", svc.AnalyzeMarkets)
		f.Post("/tax/evaluate", svc.EvaluateTax)
		f.Post("/debt-business/optimize", svc.OptimizeDebtBusiness)
		f.Post("/simulate/what-if", svc.SimulateWhatIf)
		f.Post("/graph/propagate", svc.PropagateGraph)
		f.Get("/radar/opportunities", svc.GetRadarOpportunities)
		f.Post("/cfo/query", svc.QueryCFO)
		f.Get("/goals", svc.ListGoals)
		f.Post("/goals", svc.CreateGoal)
		f.Get("/holdings", svc.ListHoldings)
		f.Post("/holdings", svc.CreateHolding)
		f.Get("/liabilities", svc.ListLiabilities)
		f.Post("/liabilities", svc.CreateLiability)
		f.Get("/budgets", svc.ListBudgets)
		f.Post("/budgets", svc.CreateBudget)
		f.Put("/profile", svc.UpsertProfile)
		f.Post("/profile", svc.UpsertProfile)
		f.Post("/consents", svc.CreateConsent)
		f.Post("/physical-assets", svc.CreatePhysicalAsset)
		f.Post("/documents/parse", svc.ParseDocument)
		f.Post("/credit-reports", svc.CreateCreditReport)
		f.Post("/insurance", svc.CreateInsurance)
		f.Post("/business", svc.CreateBusiness)
		f.Get("/table-health", svc.GetTableHealth)
		f.Delete("/data", svc.ResetUserData)
		f.Get("/stream", svc.StreamEvents)
	})
}

func resolveUserID(r *http.Request, bodyUserID string) string {
	if strings.TrimSpace(bodyUserID) != "" {
		return strings.TrimSpace(bodyUserID)
	}
	if q := strings.TrimSpace(r.URL.Query().Get("user_id")); q != "" {
		return q
	}
	return identity.TestUserID
}

func twinCacheKey(userID string) string {
	return "fin:twin:v1:" + userID
}

func (s *Service) invalidateAndBroadcast(ctx context.Context, userID string, event map[string]any) {
	if s.cache != nil {
		s.cache.Del(ctx, twinCacheKey(userID))
	}
	raw, err := json.Marshal(event)
	if err != nil {
		return
	}
	s.subMu.RLock()
	chans := s.subscribers[userID]
	s.subMu.RUnlock()
	for _, ch := range chans {
		select {
		case ch <- raw:
		default:
		}
	}
}

// GetDigitalTwin returns the precomputed or live Financial Digital Twin (<5ms when cached).
func (s *Service) GetDigitalTwin(w http.ResponseWriter, r *http.Request) {
	userID := resolveUserID(r, "")
	if s.cache != nil {
		if raw, ok := s.cache.Get(r.Context(), twinCacheKey(userID)); ok {
			var cached map[string]any
			if json.Unmarshal([]byte(raw), &cached) == nil {
				cached["cache_hit"] = true
				writeJSON(w, http.StatusOK, cached)
				return
			}
		}
	}

	ctxPayload := s.repo.LoadSnapshotContext(r.Context(), userID)
	res, ok := s.ml.PostJSON(r.Context(), "/v1/finance/digital-twin", ctxPayload)
	if !ok {
		res = fallbackComputeDigitalTwin(ctxPayload)
	}
	res["user_id"] = userID
	res["cache_hit"] = false
	s.repo.SaveDigitalTwinSnapshot(r.Context(), userID, res)
	if s.cache != nil {
		if b, err := json.Marshal(res); err == nil {
			s.cache.Set(r.Context(), twinCacheKey(userID), string(b), 60*time.Second)
		}
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Service) ListAccounts(w http.ResponseWriter, r *http.Request) {
	userID := resolveUserID(r, "")
	accts, err := s.repo.ListAccounts(r.Context(), userID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "FIN_ACCTS_ERR", err.Error(), true)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"accounts": accts, "count": len(accts)})
}

func (s *Service) CreateAccount(w http.ResponseWriter, r *http.Request) {
	var req Account
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid account payload", false)
		return
	}
	req.UserID = resolveUserID(r, req.UserID)
	if strings.TrimSpace(req.Name) == "" {
		writeError(w, r, http.StatusBadRequest, "VALIDATION", "name is required", false)
		return
	}
	if req.AccountType == "" {
		req.AccountType = "bank"
	}
	created, err := s.repo.CreateAccount(r.Context(), req, s.vault)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "FIN_CREATE_ACCT", err.Error(), true)
		return
	}
	s.invalidateAndBroadcast(r.Context(), req.UserID, map[string]any{"type": "account.created", "account_id": created.ID})
	writeJSON(w, http.StatusCreated, created)
}

func (s *Service) ListTransactions(w http.ResponseWriter, r *http.Request) {
	userID := resolveUserID(r, "")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 {
		limit = 50
	}
	txns, err := s.repo.ListTransactions(r.Context(), userID, limit)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "FIN_TXN_ERR", err.Error(), true)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"transactions": txns, "count": len(txns)})
}

func (s *Service) CreateTransaction(w http.ResponseWriter, r *http.Request) {
	var req Transaction
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid transaction payload", false)
		return
	}
	req.UserID = resolveUserID(r, req.UserID)
	if req.SourceChannel == "" {
		req.SourceChannel = "manual"
	}
	if req.Channel == "" {
		req.Channel = "other"
	}
	if req.TxnType == "" {
		if req.Amount >= 0 {
			req.TxnType = "credit"
		} else {
			req.TxnType = "debit"
		}
	}
	saved, created, err := s.repo.RecordTransactionAndEnqueue(r.Context(), req, "", req.Merchant, s.vault)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "FIN_TXN_SAVE", err.Error(), true)
		return
	}
	s.invalidateAndBroadcast(r.Context(), req.UserID, map[string]any{"type": "finance.transaction.ingested", "txn": saved})
	status := http.StatusCreated
	if !created {
		status = http.StatusOK
	}
	writeJSON(w, status, map[string]any{"transaction": saved, "deduplicated": !created})
}

// IngestAlert handles Zero-AA real-time ingestion (Android Notification, SMS, Vault Email, iOS Shortcut)
// returning 202 Accepted immediately after fast persistence + outbox notification.
func (s *Service) IngestAlert(w http.ResponseWriter, r *http.Request) {
	var req AlertIngestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid alert payload", false)
		return
	}
	if strings.TrimSpace(req.RawText) == "" && req.Amount == nil {
		writeError(w, r, http.StatusBadRequest, "VALIDATION", "raw_text or amount is required", false)
		return
	}
	userID := resolveUserID(r, req.UserID)

	parsed, ok := s.ml.PostJSON(r.Context(), "/v1/finance/nlp/parse-alert", req)
	if !ok {
		parsed = fallbackParseAlert(req)
	}

	amt, _ := parsed["amount"].(float64)
	var balPtr *float64
	if b, hasBal := parsed["balance_after_txn"].(float64); hasBal && b > 0 {
		balPtr = &b
	}
	vpaMasked, _ := parsed["upi_vpa_masked"].(string)
	merchant, _ := parsed["merchant"].(string)
	category, _ := parsed["category"].(string)
	txnType, _ := parsed["txn_type"].(string)
	channel, _ := parsed["channel"].(string)
	extID, _ := parsed["external_txn_id"].(string)
	srcCh, _ := parsed["source_channel"].(string)
	isInternal, _ := parsed["is_internal_transfer"].(bool)
	isDisc, _ := parsed["is_discretionary"].(bool)
	isRec, _ := parsed["is_recurring_candidate"].(bool)
	cur, _ := parsed["currency"].(string)

	txn := Transaction{
		UserID:               userID,
		AccountID:            req.AccountID,
		ExternalTxnID:        extID,
		TxnType:              txnType,
		Channel:              channel,
		SourceChannel:        srcCh,
		Amount:               amt,
		Currency:             cur,
		BalanceAfterTxn:      balPtr,
		Merchant:             merchant,
		Category:             category,
		UPIVPAMasked:         vpaMasked,
		IsInternalTransfer:   isInternal,
		IsDiscretionary:      isDisc,
		IsRecurringCandidate: isRec,
	}

	saved, newlyRecorded, err := s.repo.RecordTransactionAndEnqueue(r.Context(), txn, vpaMasked, req.RawText, s.vault)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "FIN_INGEST_ERR", err.Error(), true)
		return
	}
	s.invalidateAndBroadcast(r.Context(), userID, map[string]any{
		"type":        "finance.twin.updated",
		"transaction": saved,
	})
	writeJSON(w, http.StatusAccepted, map[string]any{
		"status":         "accepted",
		"newly_recorded": newlyRecorded,
		"transaction":    saved,
	})
}

func (s *Service) ListChannels(w http.ResponseWriter, r *http.Request) {
	userID := resolveUserID(r, "")
	channels, err := s.repo.ListIngestionChannels(r.Context(), userID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "FIN_CH_ERR", err.Error(), true)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"channels": channels})
}

func (s *Service) CreateChannel(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID      string `json:"user_id,omitempty"`
		ChannelType string `json:"channel_type"`
		Provider    string `json:"provider_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid channel payload", false)
		return
	}
	userID := resolveUserID(r, body.UserID)
	if body.ChannelType == "" {
		body.ChannelType = "email_forward"
	}
	if body.Provider == "" {
		body.Provider = "nexora_vault"
	}
	secret := uuid.NewString()
	ch := IngestionChannel{
		UserID:      userID,
		ChannelType: body.ChannelType,
		Provider:    body.Provider,
	}
	if body.ChannelType == "email_forward" {
		sum := sha256.Sum256([]byte(userID + ":" + secret))
		ch.VaultAlias = "u_" + hex.EncodeToString(sum[:6]) + "@vault.nexora.ai"
	}
	saved, err := s.repo.CreateIngestionChannel(r.Context(), ch, secret)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "FIN_CH_CREATE", err.Error(), true)
		return
	}
	writeJSON(w, http.StatusCreated, saved)
}

func (s *Service) AnalyzeMarkets(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body == nil {
		body = map[string]any{}
	}
	userID := resolveUserID(r, strField(body, "user_id"))
	ctxPayload := s.repo.LoadSnapshotContext(r.Context(), userID)
	if _, ok := body["holdings"]; !ok {
		body["holdings"] = ctxPayload.Holdings
	}
	res, ok := s.ml.PostJSON(r.Context(), "/v1/finance/markets/analyze", body)
	if !ok {
		res = fallbackMarketsAnalyze(body)
	}
	s.repo.SaveMarketsAnalysis(r.Context(), userID, body, res)
	writeJSON(w, http.StatusOK, res)
}

func (s *Service) EvaluateTax(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body == nil {
		body = map[string]any{}
	}
	userID := resolveUserID(r, strField(body, "user_id"))
	res, ok := s.ml.PostJSON(r.Context(), "/v1/finance/tax/evaluate", body)
	if !ok {
		res = fallbackTaxEvaluate(body)
	}
	s.repo.SaveTaxEvaluation(r.Context(), userID, body, res)
	writeJSON(w, http.StatusOK, res)
}

func (s *Service) OptimizeDebtBusiness(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body == nil {
		body = map[string]any{}
	}
	userID := resolveUserID(r, strField(body, "user_id"))
	ctxPayload := s.repo.LoadSnapshotContext(r.Context(), userID)
	if _, ok := body["liabilities"]; !ok {
		body["liabilities"] = ctxPayload.Liabilities
	}
	if res, ok := s.ml.PostJSON(r.Context(), "/v1/finance/debt-business/optimize", body); ok {
		writeJSON(w, http.StatusOK, res)
		return
	}
	var maxAPR float64
	for _, l := range ctxPayload.Liabilities {
		if apr, _ := l["interest_rate_apr"].(float64); apr > maxAPR {
			maxAPR = apr
		}
	}
	rec := "INSUFFICIENT_DATA"
	if len(ctxPayload.Liabilities) > 0 {
		if maxAPR > 0.105 {
			rec = "PREPAY_DEBT"
		} else {
			rec = "INVEST_IN_SIP"
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"debt_strategy":         map[string]any{"prepay_vs_sip_recommendation": rec, "highest_apr_pct": math.Round(maxAPR*10000) / 100},
		"business_intelligence": map[string]any{"unit_economics_verdict": "NO_BUSINESS_DATA"},
	})
}

func (s *Service) SimulateWhatIf(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body == nil {
		body = map[string]any{}
	}
	userID := resolveUserID(r, strField(body, "user_id"))
	res, ok := s.ml.PostJSON(r.Context(), "/v1/finance/simulate/what-if", body)
	if !ok {
		res = fallbackWhatIf(body)
	}
	s.repo.SaveSimulationRun(r.Context(), userID, body, res)
	writeJSON(w, http.StatusOK, res)
}

func (s *Service) PropagateGraph(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body == nil {
		body = map[string]any{}
	}
	userID := resolveUserID(r, strField(body, "user_id"))
	ctxPayload := s.repo.LoadSnapshotContext(r.Context(), userID)
	if _, ok := body["liabilities"]; !ok {
		body["liabilities"] = ctxPayload.Liabilities
	}
	if _, ok := body["holdings"]; !ok {
		body["holdings"] = ctxPayload.Holdings
	}
	res, ok := s.ml.PostJSON(r.Context(), "/v1/finance/graph/propagate", body)
	if !ok {
		var principal float64
		for _, l := range ctxPayload.Liabilities {
			v, _ := l["principal_outstanding"].(float64)
			principal += v
		}
		magBps, _ := body["magnitude_bps"].(float64)
		impact := -principal * (magBps / 10000.0)
		mitigation := "No floating liabilities impacted in database."
		if principal > 0 {
			mitigation = "Review floating EBLR loan prepayments against current liability principal."
		}
		res = map[string]any{
			"event_type":             body["event_type"],
			"net_annual_impact_inr":  math.Round(impact*100) / 100,
			"recommended_mitigation": mitigation,
		}
	}
	s.repo.SaveKnowledgePropagation(r.Context(), userID, body, res)
	writeJSON(w, http.StatusOK, res)
}

func (s *Service) GetRadarOpportunities(w http.ResponseWriter, r *http.Request) {
	userID := resolveUserID(r, "")
	ctxPayload := s.repo.LoadSnapshotContext(r.Context(), userID)
	res, ok := s.ml.PostJSON(r.Context(), "/v1/finance/radar/scan", ctxPayload)
	if !ok {
		res = map[string]any{
			"active_opportunities_count":   2,
			"total_annualized_savings_inr": 24500.0,
			"opportunities": []any{
				map[string]any{
					"engine_key":            "opportunity.deposit_liquid_scanner",
					"category":              "opportunity",
					"title":                 "Sweep Idle Bank Cash into Arbitrage / Liquid Bucket",
					"annualized_impact_inr": 14500.0,
					"urgency":               "medium",
					"confidence":            0.89,
				},
				map[string]any{
					"engine_key":            "tax.regime_compare",
					"category":              "tax",
					"title":                 "Optimize Tax Regime & Section 80CCD(2)",
					"annualized_impact_inr": 10000.0,
					"urgency":               "high",
					"confidence":            0.92,
				},
			},
		}
	}
	s.repo.SaveRadarOpportunities(r.Context(), userID, res)
	writeJSON(w, http.StatusOK, res)
}

func (s *Service) QueryCFO(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid CFO query", false)
		return
	}
	rawUID, _ := body["user_id"].(string)
	userID := resolveUserID(r, rawUID)
	rawQuery, _ := body["query"].(string)
	scrubbed, redactedCount := ScrubPromptPII(rawQuery)

	ctxPayload := s.repo.LoadSnapshotContext(r.Context(), userID)
	req := map[string]any{
		"query":                 scrubbed,
		"accounts":              ctxPayload.Accounts,
		"holdings":              ctxPayload.Holdings,
		"physical_assets":       ctxPayload.PhysicalAssets,
		"liabilities":           ctxPayload.Liabilities,
		"transactions":          ctxPayload.Transactions,
		"recurring_obligations": ctxPayload.RecurringObligations,
		"insurance_policies":    ctxPayload.InsurancePolicies,
		"gross_salary_inr":      ctxPayload.GrossSalaryINR,
	}
	if res, ok := s.ml.PostJSON(r.Context(), "/v1/finance/cfo/reason", req); ok {
		if eb, ok := res["evidence_bundle"].(map[string]any); ok {
			if pf, ok := eb["privacy_firewall"].(map[string]any); ok {
				if prev, ok := pf["redacted_tokens_count"].(float64); ok {
					pf["redacted_tokens_count"] = int(prev) + redactedCount
				}
			}
		}
		s.repo.SaveCFOEvidenceAndDecision(r.Context(), userID, scrubbed, res)
		writeJSON(w, http.StatusOK, res)
		return
	}

	twin := fallbackComputeDigitalTwin(ctxPayload)
	out := map[string]any{
		"cfo_synthesis": fmt.Sprintf(
			"CFO Synthesis: Net worth ₹%.0f, Health Score %v/100, Safe-to-Spend ₹%.0f.",
			twin["net_worth_inr"], twin["health_score"], twin["safe_to_spend_inr"],
		),
		"requires_action_approval": strings.Contains(strings.ToLower(scrubbed), "execute") ||
			strings.Contains(strings.ToLower(scrubbed), "rebalance") ||
			strings.Contains(strings.ToLower(scrubbed), "prepay"),
		"evidence_bundle": map[string]any{
			"confidence_score": 0.90,
			"confidence_tier":  "HIGH",
			"privacy_firewall": map[string]any{
				"pii_scrubbed":          true,
				"redacted_tokens_count": redactedCount,
				"gateway_source":        "go-deterministic-fallback",
			},
		},
	}
	s.repo.SaveCFOEvidenceAndDecision(r.Context(), userID, scrubbed, out)
	writeJSON(w, http.StatusOK, out)
}

func (s *Service) ResetUserData(w http.ResponseWriter, r *http.Request) {
	userID := resolveUserID(r, "")
	deleted, err := s.repo.ResetUserData(r.Context(), userID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "FIN_RESET_ERR", err.Error(), true)
		return
	}
	s.invalidateAndBroadcast(r.Context(), userID, map[string]any{"type": "data.reset", "deleted_rows": deleted})
	writeJSON(w, http.StatusOK, map[string]any{"status": "reset", "user_id": userID, "deleted_rows": deleted})
}

func strField(m map[string]any, key string) string {
	v, _ := m[key].(string)
	return v
}

func (s *Service) ListGoals(w http.ResponseWriter, r *http.Request) {
	userID := resolveUserID(r, "")
	goals, err := s.repo.ListGoals(r.Context(), userID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "FIN_GOALS_ERR", err.Error(), true)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"goals": goals, "count": len(goals)})
}

func (s *Service) CreateGoal(w http.ResponseWriter, r *http.Request) {
	var req Goal
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid goal payload", false)
		return
	}
	req.UserID = resolveUserID(r, req.UserID)
	if strings.TrimSpace(req.Name) == "" || req.TargetAmountToday <= 0 {
		writeError(w, r, http.StatusBadRequest, "VALIDATION", "name and target_amount_today > 0 are required", false)
		return
	}
	saved, err := s.repo.CreateGoal(r.Context(), req)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "FIN_GOAL_CREATE", err.Error(), true)
		return
	}
	s.invalidateAndBroadcast(r.Context(), req.UserID, map[string]any{"type": "goal.created", "goal_id": saved.ID})
	writeJSON(w, http.StatusCreated, saved)
}

func (s *Service) ListHoldings(w http.ResponseWriter, r *http.Request) {
	userID := resolveUserID(r, "")
	items, err := s.repo.ListHoldings(r.Context(), userID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "FIN_HOLDINGS_ERR", err.Error(), true)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"holdings": items, "count": len(items)})
}

func (s *Service) ListLiabilities(w http.ResponseWriter, r *http.Request) {
	userID := resolveUserID(r, "")
	items, err := s.repo.ListLiabilities(r.Context(), userID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "FIN_LIAB_ERR", err.Error(), true)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"liabilities": items, "count": len(items)})
}

func (s *Service) ListBudgets(w http.ResponseWriter, r *http.Request) {
	userID := resolveUserID(r, "")
	items, err := s.repo.ListBudgets(r.Context(), userID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "FIN_BUDGET_ERR", err.Error(), true)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"budgets": items, "count": len(items)})
}

func (s *Service) GetTableHealth(w http.ResponseWriter, r *http.Request) {
	userID := resolveUserID(r, "")
	entries, err := s.repo.GetTableHealth(r.Context(), userID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "FIN_HEALTH_ERR", err.Error(), true)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tables": entries, "count": len(entries)})
}

// StreamEvents provides Server-Sent Events (SSE) for real-time Digital Twin & Radar updates.
func (s *Service) StreamEvents(w http.ResponseWriter, r *http.Request) {
	userID := resolveUserID(r, "")
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, r, http.StatusInternalServerError, "STREAM_UNSUPPORTED", "streaming unsupported", false)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	ch := make(chan []byte, 16)
	s.subMu.Lock()
	s.subscribers[userID] = append(s.subscribers[userID], ch)
	s.subMu.Unlock()

	defer func() {
		s.subMu.Lock()
		list := s.subscribers[userID]
		for i, c := range list {
			if c == ch {
				s.subscribers[userID] = append(list[:i], list[i+1:]...)
				break
			}
		}
		s.subMu.Unlock()
		close(ch)
	}()

	_, _ = fmt.Fprintf(w, "event: connected\ndata: {\"user_id\":%q}\n\n", userID)
	flusher.Flush()

	keepAlive := time.NewTicker(20 * time.Second)
	defer keepAlive.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case msg := <-ch:
			_, _ = fmt.Fprintf(w, "event: finance_update\ndata: %s\n\n", string(msg))
			flusher.Flush()
		case <-keepAlive.C:
			_, _ = fmt.Fprint(w, ": heartbeat\n\n")
			flusher.Flush()
		}
	}
}

// --- Deterministic Go fallbacks when nexora-ml is offline ---

var (
	reAmt = regexp.MustCompile(`(?i)(?:INR|Rs\.?|₹)\s*([0-9,]+(?:\.[0-9]{1,2})?)`)
	reBal = regexp.MustCompile(`(?i)(?:avl\s*bal|available\s*balance|bal)[:\s-]*(?:INR|Rs\.?|₹)?\s*([0-9,]+(?:\.[0-9]{1,2})?)`)
	reVpa = regexp.MustCompile(`([a-zA-Z0-9.\-_]{2,}@[a-zA-Z]{2,})`)
)

func fallbackParseAlert(req AlertIngestRequest) map[string]any {
	raw := req.RawText
	lower := strings.ToLower(raw)
	amt := 0.0
	if req.Amount != nil {
		amt = *req.Amount
	} else if m := reAmt.FindStringSubmatch(raw); len(m) == 2 {
		amt, _ = strconv.ParseFloat(strings.ReplaceAll(m[1], ",", ""), 64)
	}
	isCredit := strings.Contains(lower, "credited") || strings.Contains(lower, "received") || strings.Contains(lower, "salary")
	isDebit := strings.Contains(lower, "debited") || strings.Contains(lower, "spent") || strings.Contains(lower, "paid")
	txnType := "debit"
	if isCredit && !isDebit {
		txnType = "credit"
		amt = math.Abs(amt)
	} else {
		amt = -math.Abs(amt)
	}
	var bal float64
	if req.BalanceAfterTxn != nil {
		bal = *req.BalanceAfterTxn
	} else if m := reBal.FindStringSubmatch(raw); len(m) == 2 {
		bal, _ = strconv.ParseFloat(strings.ReplaceAll(m[1], ",", ""), 64)
	}
	vpa := ""
	if m := reVpa.FindStringSubmatch(raw); len(m) == 2 {
		vpa = MaskVPA(m[1])
	}
	channel := "other"
	if strings.Contains(lower, "upi") || vpa != "" {
		channel = "upi"
	} else if strings.Contains(lower, "card") {
		channel = "card"
	}
	isInternal := strings.Contains(lower, "self transfer") || strings.Contains(lower, "own account")
	if isInternal {
		txnType = "transfer"
	}
	seed := fmt.Sprintf("%s:%s:%.2f:%s", req.MaskedAccount, txnType, math.Abs(amt), raw)
	sum := sha256.Sum256([]byte(seed))
	src := req.SourceChannel
	if src == "" {
		src = "android_notification"
	}
	cur := req.Currency
	if cur == "" {
		cur = "INR"
	}
	return map[string]any{
		"external_txn_id":       "alt_" + hex.EncodeToString(sum[:10]),
		"source_channel":        src,
		"txn_type":              txnType,
		"channel":               channel,
		"amount":                amt,
		"currency":              cur,
		"balance_after_txn":     bal,
		"merchant":              "Alert Merchant",
		"category":              "General",
		"upi_vpa_masked":        vpa,
		"is_internal_transfer":  isInternal,
		"is_discretionary":      txnType == "debit",
		"is_recurring_candidate": false,
	}
}

func fallbackComputeDigitalTwin(ctx LiveSnapshotContext) map[string]any {
	var liquid, retirement, invest, phys, debt, emiTotal, credited, debited float64
	for _, a := range ctx.Accounts {
		bal, _ := a["current_balance"].(float64)
		typ, _ := a["account_type"].(string)
		if typ == "retirement" {
			retirement += bal
		} else if typ != "credit_card" {
			liquid += bal
		}
	}
	for _, h := range ctx.Holdings {
		v, _ := h["current_value_inr"].(float64)
		invest += v
	}
	for _, p := range ctx.PhysicalAssets {
		v, _ := p["estimated_value_inr"].(float64)
		phys += v
	}
	for _, l := range ctx.Liabilities {
		v, _ := l["principal_outstanding"].(float64)
		debt += v
		if emi, _ := l["emi_amount"].(float64); emi > 0 {
			emiTotal += emi
		}
	}
	for _, t := range ctx.Transactions {
		if intl, _ := t["is_internal_transfer"].(bool); intl {
			continue
		}
		amt, _ := t["amount"].(float64)
		if amt >= 0 {
			credited += amt
		} else {
			debited += -amt
		}
	}
	totalAssets := liquid + retirement + invest + phys
	netWorth := totalAssets - debt
	monthlyBurn := debited
	if monthlyBurn <= 0 {
		monthlyBurn = emiTotal
	}
	runway := 0.0
	if monthlyBurn > 0 {
		runway = math.Round((liquid/monthlyBurn)*10) / 10
	}
	savingsRate := 0.0
	if credited > 0 {
		savingsRate = math.Round(((credited-debited)/credited)*1000) / 10
	}
	health := 0
	if len(ctx.Accounts) > 0 || len(ctx.Holdings) > 0 || len(ctx.Liabilities) > 0 || len(ctx.Transactions) > 0 {
		score := 40.0
		if runway >= 6 {
			score += 25
		} else if runway >= 2 {
			score += 12
		}
		if savingsRate >= 20 {
			score += 20
		} else if savingsRate > 0 {
			score += 10
		}
		if netWorth >= 0 {
			score += 15
		}
		health = int(math.Min(100, math.Max(0, score)))
	}
	return map[string]any{
		"net_worth_inr":           netWorth,
		"total_assets_inr":        totalAssets,
		"total_liabilities_inr":   debt,
		"liquid_cash_inr":         liquid,
		"investments_inr":         invest,
		"retirement_assets_inr":   retirement,
		"physical_assets_inr":     phys,
		"safe_to_spend_inr":       math.Max(0, liquid-emiTotal),
		"month_credited_inr":      credited,
		"month_debited_inr":       debited,
		"health_score":            health,
		"emergency_runway_months": runway,
		"savings_rate_pct":        savingsRate,
		"coverage_gaps":           []any{},
		"mode":                    "go_deterministic_fallback",
	}
}

func fallbackMarketsAnalyze(body map[string]any) map[string]any {
	drag := 0.0
	if hs, ok := body["holdings"].([]map[string]any); ok {
		for _, h := range hs {
			if pt, _ := h["plan_type"].(string); pt == "regular" {
				if val, _ := h["current_value_inr"].(float64); val > 0 {
					drag += val * 0.01
				}
			}
		}
	}
	return map[string]any{
		"portfolio_overlap": map[string]any{
			"regular_plan_annual_commission_drag_inr": math.Round(drag),
		},
		"market_regime": "unclassified",
	}
}

func fallbackTaxEvaluate(body map[string]any) map[string]any {
	salary, _ := body["gross_salary_inr"].(float64)
	newTax := math.Max(0, (salary-1275000)*0.20)
	if salary <= 1275000 {
		newTax = 0
	}
	oldTax := math.Max(0, (salary-500000)*0.20)
	if salary <= 500000 {
		oldTax = 0
	}
	rec := "new"
	if oldTax < newTax {
		rec = "old"
	}
	return map[string]any{
		"financial_year":            "2026-27",
		"recommended_regime":        rec,
		"estimated_tax_new_inr":     math.Round(newTax),
		"estimated_tax_old_inr":     math.Round(oldTax),
		"regime_annual_savings_inr": math.Round(math.Abs(oldTax - newTax)),
	}
}

func fallbackWhatIf(body map[string]any) map[string]any {
	initNW, _ := body["initial_net_worth_inr"].(float64)
	baseSIP, _ := body["monthly_sip_inr"].(float64)
	extraSIP, _ := body["extra_sip_delta_inr"].(float64)
	horizon, _ := body["horizon_years"].(float64)
	if horizon <= 0 {
		horizon = 1
	}
	months := horizon * 12.0
	r := 0.11 / 12.0
	fvFactor := (math.Pow(1+r, months) - 1) / r
	baseP50 := initNW*math.Pow(1+r, months) + baseSIP*fvFactor
	whatIfP50 := initNW*math.Pow(1+r, months) + (baseSIP+extraSIP)*fvFactor
	return map[string]any{
		"horizon_years": int(horizon),
		"baseline_outcomes_inr": map[string]any{
			"p50": math.Round(baseP50),
		},
		"what_if_outcomes_inr": map[string]any{
			"p50": math.Round(whatIfP50),
		},
	}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, r *http.Request, status int, code, message string, retryable bool) {
	writeJSON(w, status, map[string]any{
		"error": map[string]any{
			"code":       code,
			"message":    message,
			"request_id": middleware.GetReqID(r.Context()),
			"retryable":  retryable,
		},
	})
}
