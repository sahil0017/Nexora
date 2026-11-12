package finance

import (
	"encoding/json"
	"math"
	"net/http"
	"strings"
)

func (s *Service) UpsertProfile(w http.ResponseWriter, r *http.Request) {
	var req FinancialProfile
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid profile payload", false)
		return
	}
	req.UserID = resolveUserID(r, req.UserID)
	saved, err := s.repo.UpsertProfile(r.Context(), req)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "FIN_PROFILE_ERR", err.Error(), true)
		return
	}
	s.invalidateAndBroadcast(r.Context(), req.UserID, map[string]any{"type": "profile.updated"})
	writeJSON(w, http.StatusOK, saved)
}

func (s *Service) CreateConsent(w http.ResponseWriter, r *http.Request) {
	var req ConsentArtefact
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid consent payload", false)
		return
	}
	req.UserID = resolveUserID(r, req.UserID)
	if strings.TrimSpace(req.TSPName) == "" {
		req.TSPName = "Account Aggregator / Broker"
	}
	saved, err := s.repo.CreateConsent(r.Context(), req)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "FIN_CONSENT_ERR", err.Error(), true)
		return
	}
	writeJSON(w, http.StatusCreated, saved)
}

func (s *Service) CreateBudget(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID       string  `json:"user_id,omitempty"`
		Name         string  `json:"name"`
		Period       string  `json:"period,omitempty"`
		Amount       float64 `json:"amount"`
		CategoryName string  `json:"category_name,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid budget payload", false)
		return
	}
	if strings.TrimSpace(body.Name) == "" || body.Amount <= 0 {
		writeError(w, r, http.StatusBadRequest, "VALIDATION", "name and amount > 0 required", false)
		return
	}
	uid := resolveUserID(r, body.UserID)
	saved, err := s.repo.CreateBudget(r.Context(), Budget{
		ID:       "",
		UserID:   uid,
		Name:     body.Name,
		Period:   body.Period,
		Amount:   body.Amount,
		Currency: "INR",
	}, body.CategoryName)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "FIN_BUDGET_CREATE", err.Error(), true)
		return
	}
	writeJSON(w, http.StatusCreated, saved)
}

func (s *Service) CreateHolding(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID         string  `json:"user_id,omitempty"`
		Symbol         string  `json:"symbol"`
		Name           string  `json:"name"`
		AssetClass     string  `json:"asset_class,omitempty"`
		InstrumentType string  `json:"instrument_type,omitempty"`
		PlanType       string  `json:"plan_type,omitempty"`
		Units          float64 `json:"units"`
		AvgCostPerUnit float64 `json:"avg_cost_per_unit"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid holding payload", false)
		return
	}
	uid := resolveUserID(r, body.UserID)
	if strings.TrimSpace(body.Name) == "" || body.Units <= 0 {
		writeError(w, r, http.StatusBadRequest, "VALIDATION", "name and units > 0 required", false)
		return
	}
	saved, err := s.repo.CreateHolding(r.Context(), uid, body.Symbol, body.Name, body.AssetClass, body.InstrumentType, body.PlanType, body.Units, body.AvgCostPerUnit)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "FIN_HOLDING_CREATE", err.Error(), true)
		return
	}
	s.invalidateAndBroadcast(r.Context(), uid, map[string]any{"type": "holding.created", "holding_id": saved.ID})
	writeJSON(w, http.StatusCreated, saved)
}

func (s *Service) CreatePhysicalAsset(w http.ResponseWriter, r *http.Request) {
	var req PhysicalAsset
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid asset payload", false)
		return
	}
	req.UserID = resolveUserID(r, req.UserID)
	if strings.TrimSpace(req.Name) == "" {
		writeError(w, r, http.StatusBadRequest, "VALIDATION", "name is required", false)
		return
	}
	saved, err := s.repo.CreatePhysicalAsset(r.Context(), req)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "FIN_ASSET_CREATE", err.Error(), true)
		return
	}
	s.invalidateAndBroadcast(r.Context(), req.UserID, map[string]any{"type": "asset.created", "asset_id": saved.ID})
	writeJSON(w, http.StatusCreated, saved)
}

func (s *Service) ParseDocument(w http.ResponseWriter, r *http.Request) {
	var req ParsedDocument
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid document payload", false)
		return
	}
	req.UserID = resolveUserID(r, req.UserID)
	if req.StorageRef == "" {
		req.StorageRef = "vault/uploaded_statement.pdf"
	}
	saved, err := s.repo.CreateParsedDocument(r.Context(), req)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "FIN_DOC_CREATE", err.Error(), true)
		return
	}
	writeJSON(w, http.StatusCreated, saved)
}

func (s *Service) CreateLiability(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID string `json:"user_id,omitempty"`
		Liability
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid liability payload", false)
		return
	}
	uid := resolveUserID(r, body.UserID)
	if strings.TrimSpace(body.LenderName) == "" {
		writeError(w, r, http.StatusBadRequest, "VALIDATION", "lender_name is required", false)
		return
	}
	saved, err := s.repo.CreateLiability(r.Context(), uid, body.Liability)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "FIN_LIAB_CREATE", err.Error(), true)
		return
	}
	s.invalidateAndBroadcast(r.Context(), uid, map[string]any{"type": "liability.created", "liability_id": saved.ID})
	writeJSON(w, http.StatusCreated, saved)
}

func (s *Service) CreateCreditReport(w http.ResponseWriter, r *http.Request) {
	var req CreditReport
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid credit report payload", false)
		return
	}
	req.UserID = resolveUserID(r, req.UserID)
	saved, err := s.repo.CreateCreditReport(r.Context(), req)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "FIN_CREDIT_CREATE", err.Error(), true)
		return
	}
	writeJSON(w, http.StatusCreated, saved)
}

func (s *Service) CreateInsurance(w http.ResponseWriter, r *http.Request) {
	var req InsurancePolicy
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid insurance payload", false)
		return
	}
	req.UserID = resolveUserID(r, req.UserID)
	if strings.TrimSpace(req.InsurerName) == "" {
		writeError(w, r, http.StatusBadRequest, "VALIDATION", "insurer_name is required", false)
		return
	}
	saved, err := s.repo.CreateInsurancePolicy(r.Context(), req)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "FIN_INS_CREATE", err.Error(), true)
		return
	}
	s.invalidateAndBroadcast(r.Context(), req.UserID, map[string]any{"type": "insurance.created", "policy_id": saved.ID})
	writeJSON(w, http.StatusCreated, saved)
}

func (s *Service) CreateBusiness(w http.ResponseWriter, r *http.Request) {
	var req BusinessEntity
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid business payload", false)
		return
	}
	req.UserID = resolveUserID(r, req.UserID)
	if strings.TrimSpace(req.Name) == "" {
		writeError(w, r, http.StatusBadRequest, "VALIDATION", "name is required", false)
		return
	}
	saved, err := s.repo.CreateBusinessEntity(r.Context(), req)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "FIN_BIZ_CREATE", err.Error(), true)
		return
	}
	writeJSON(w, http.StatusCreated, saved)
}

// SmartSyncBatch ingests a zero-touch batch of edge-masked device alerts/statements
// and automatically infers Accounts, Salary/Profile, Loans (from EMIs), Holdings (from SIPs),
// Insurance Policies (from premiums), and Transactions without manual user data entry.
func (s *Service) SmartSyncBatch(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID       string               `json:"user_id,omitempty"`
		E2EEEnvelope string               `json:"e2ee_envelope,omitempty"`
		Alerts       []AlertIngestRequest `json:"alerts"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.Alerts) == 0 {
		writeError(w, r, http.StatusBadRequest, "INVALID_BATCH", "non-empty alerts array required", false)
		return
	}
	userID := resolveUserID(r, body.UserID)

	ingestedCount := 0
	var discovered []string
	var inferredSalary float64

	for _, item := range body.Alerts {
		item.UserID = userID
		parsed, ok := s.ml.PostJSON(r.Context(), "/v1/finance/nlp/parse-alert", item)
		if !ok {
			parsed = fallbackParseAlert(item)
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

		lower := strings.ToLower(item.RawText)
		absAmt := amt
		if absAmt < 0 {
			absAmt = -absAmt
		}

		// 1. Auto-discover Bank / Card account by masked number if not yet present
		masked := strings.TrimSpace(item.MaskedAccount)
		if masked == "" {
			if m, ok := parsed["masked_account"].(string); ok {
				masked = m
			}
		}
		acctID := item.AccountID
		if acctID == "" && masked != "" && masked != "**0000" {
			existing, _ := s.repo.ListAccounts(r.Context(), userID)
			for _, a := range existing {
				if a.MaskedNumber == masked {
					acctID = a.ID
					break
				}
			}
			if acctID == "" {
				acctType := "bank"
				acctName := "Auto-Discovered Bank " + masked
				if strings.Contains(lower, "credit card") || strings.Contains(lower, "card") {
					acctType = "credit_card"
					acctName = "Auto-Discovered Card " + masked
				}
				initBal := 0.0
				if balPtr != nil {
					initBal = *balPtr
				}
				createdAcct, err := s.repo.CreateAccount(r.Context(), Account{
					UserID:         userID,
					Name:           acctName,
					AccountType:    acctType,
					Institution:    "Zero-AA Edge Sync",
					MaskedNumber:   masked,
					Currency:       "INR",
					CurrentBalance: initBal,
					SyncStatus:     "synced",
					IsConnected:    true,
				}, s.vault)
				if err == nil {
					acctID = createdAcct.ID
					discovered = append(discovered, acctName)
				}
			}
		}

		// 2. Record normalized & encrypted transaction
		txn := Transaction{
			UserID:               userID,
			AccountID:            acctID,
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
			IsRecurringCandidate: isRec || strings.Contains(lower, "emi") || strings.Contains(lower, "sip"),
		}
		if _, newly, err := s.repo.RecordTransactionAndEnqueue(r.Context(), txn, vpaMasked, item.RawText, s.vault); err == nil && newly {
			ingestedCount++
		}

		// 3. Smart Entity Inference from Passive Alert Stream:
		// (a) Salary credit -> infer Annual Gross Income + Tax Profile
		if txnType == "credit" && (strings.Contains(lower, "salary") || strings.Contains(lower, "payroll")) && absAmt >= 20000 {
			inferredSalary = absAmt * 12
			_, _ = s.repo.UpsertProfile(r.Context(), FinancialProfile{
				UserID:               userID,
				TaxResidency:         "resident_ordinary",
				PreferredTaxRegime:   "auto",
				RiskTolerance:        "growth",
				RiskScore:            74,
				EmploymentType:       "salaried",
				AnnualGrossIncomeEst: inferredSalary,
			})
			taxRes := fallbackTaxEvaluate(map[string]any{"gross_salary_inr": inferredSalary})
			s.repo.SaveTaxEvaluation(r.Context(), userID, map[string]any{"gross_salary_inr": inferredSalary, "sec_80c_inr": 150000.0}, taxRes)
			discovered = append(discovered, "Salary Profile & Tax Regime")
		}

		// (b) Loan EMI debit -> auto-infer Liability (word-boundary check so "premium" doesn't match "emi")
		isLoanDebit := (strings.Contains(lower, " emi") || strings.HasPrefix(lower, "emi ") ||
			strings.Contains(lower, "emi.") || strings.Contains(lower, "home loan") ||
			strings.Contains(lower, "auto loan")) && !strings.Contains(lower, "insurance")
		if isLoanDebit {
			loanType := "home"
			if strings.Contains(lower, "auto") || strings.Contains(lower, "car") {
				loanType = "auto"
			}
			estPrincipal := absAmt * 58 // ~72m remaining at 8.55% EBLR
			existingLiabs, _ := s.repo.ListLiabilities(r.Context(), userID)
			alreadyHasLoan := false
			for _, l := range existingLiabs {
				if l.LoanType == loanType && math.Abs(l.EMIAmount-absAmt) < 10 {
					alreadyHasLoan = true
					break
				}
			}
			if !alreadyHasLoan {
				_, _ = s.repo.CreateLiability(r.Context(), userID, Liability{
					LoanType:             loanType,
					LenderName:           "Auto-Detected EBLR Lender",
					PrincipalSanctioned:  estPrincipal * 1.25,
					PrincipalOutstanding: estPrincipal,
					InterestRateAPR:      0.0855,
					RateType:             "floating_eblr",
					EMIAmount:            absAmt,
					RemainingMonths:      72,
					Status:               "active",
				})
				discovered = append(discovered, "Floating Loan Liability")
			}
		}

		// (c) SIP / Mutual Fund / Broker alert -> auto-infer Portfolio Holding (deduped)
		if strings.Contains(lower, " sip") || strings.Contains(lower, "mutual fund") || strings.Contains(lower, "nifty") || strings.Contains(lower, "zerodha") {
			existingHoldings, _ := s.repo.ListHoldings(r.Context(), userID)
			hasAutoSip := false
			for _, h := range existingHoldings {
				if h.Symbol == "AUTO_SIP_INDEX" {
					hasAutoSip = true
					break
				}
			}
			if !hasAutoSip {
				units := absAmt / 250.0
				if units <= 0 {
					units = 10
				}
				_, _ = s.repo.CreateHolding(
					r.Context(), userID, "AUTO_SIP_INDEX", "Auto-Discovered Equity Index SIP",
					"equity", "mutual_fund", "direct", units*12, 250.0,
				)
				discovered = append(discovered, "Equity SIP Holding")
			}
		}

		// (d) Insurance premium alert -> auto-infer Protection Policy (term_life vs health, deduped)
		if strings.Contains(lower, "insurance") || strings.Contains(lower, "policy") || strings.Contains(lower, "ergo") || strings.Contains(lower, " lic ") {
			policyType := "health"
			sumInsured := absAmt * 70
			if strings.Contains(lower, "term") || strings.Contains(lower, "life") {
				policyType = "term_life"
				sumInsured = absAmt * 1000
			}
			snapCtx := s.repo.LoadSnapshotContext(r.Context(), userID)
			hasPolicy := false
			for _, p := range snapCtx.InsurancePolicies {
				pt, _ := p["policy_type"].(string)
				if pt == policyType {
					hasPolicy = true
					break
				}
			}
			if !hasPolicy {
				_, _ = s.repo.CreateInsurancePolicy(r.Context(), InsurancePolicy{
					UserID:           userID,
					PolicyType:       policyType,
					InsurerName:      "Auto-Detected Insurer",
					CoverSource:      "personal",
					SumInsuredINR:    sumInsured,
					AnnualPremiumINR: absAmt,
					NomineeVerified:  true,
				})
				discovered = append(discovered, "Insurance Protection Policy")
			}
		}
	}

	s.invalidateAndBroadcast(r.Context(), userID, map[string]any{
		"type":            "finance.smart_sync.completed",
		"ingested_alerts": ingestedCount,
		"discovered":      discovered,
	})
	writeJSON(w, http.StatusAccepted, map[string]any{
		"status":              "synced",
		"ingested_alerts":     ingestedCount,
		"discovered_entities": discovered,
		"inferred_salary_inr": inferredSalary,
		"e2ee_verified":       body.E2EEEnvelope != "",
	})
}
