package finance

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func setupFinanceRouter() chi.Router {
	r := chi.NewRouter()
	svc := NewService(NewMemoryRepository(), nil, NewEnvelopeVault("test-secret-key"), nil)
	Mount(r, svc)
	return r
}

func TestEnvelopeVaultAndPrivacyFirewall(t *testing.T) {
	v := NewEnvelopeVault("unit-test-master")
	ct, err := v.EncryptField("user-1", "sahil.kanungo@okicici")
	if err != nil {
		t.Fatalf("encrypt failed: %v", err)
	}
	pt, err := v.DecryptField("user-1", ct)
	if err != nil || pt != "sahil.kanungo@okicici" {
		t.Fatalf("decrypt mismatch: got %q err=%v", pt, err)
	}
	if _, err := v.DecryptField("user-2", ct); err == nil {
		t.Fatalf("expected decryption with wrong user DEK to fail")
	}
	b1 := v.BlindIndex("user-1", "Swiggy@ICICI ")
	b2 := v.BlindIndex("user-1", "swiggy@icici")
	if b1 == "" || b1 != b2 {
		t.Fatalf("expected deterministic normalized blind index")
	}

	scrubbed, cnt := ScrubPromptPII("My PAN is ABCDE1234F, Aadhaar 1234 5678 9012, VPA test@okicici")
	if cnt != 3 {
		t.Fatalf("expected 3 redacted PII items, got %d (%s)", cnt, scrubbed)
	}
}

func TestZeroAAAlertIngestDedupeAndDigitalTwin(t *testing.T) {
	r := setupFinanceRouter()

	payload := []byte(`{
		"source_channel":"android_notification",
		"raw_text":"Rs. 2,500.00 debited from A/c **4821 to VPA zomato@icici. Avl Bal: INR 2,98,000.00",
		"masked_account":"**4821"
	}`)

	req1 := httptest.NewRequest(http.MethodPost, "/finance/ingest/alert", bytes.NewReader(payload))
	w1 := httptest.NewRecorder()
	r.ServeHTTP(w1, req1)
	if w1.Code != http.StatusAccepted {
		t.Fatalf("expected 202 Accepted, got %d: %s", w1.Code, w1.Body.String())
	}
	var resp1 map[string]any
	_ = json.Unmarshal(w1.Body.Bytes(), &resp1)
	if resp1["newly_recorded"] != true {
		t.Fatalf("expected newly_recorded=true on first ingest")
	}

	// Duplicate alert should be deduplicated cleanly
	req2 := httptest.NewRequest(http.MethodPost, "/finance/ingest/alert", bytes.NewReader(payload))
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req2)
	var resp2 map[string]any
	_ = json.Unmarshal(w2.Body.Bytes(), &resp2)
	if resp2["newly_recorded"] != false {
		t.Fatalf("expected deduplication on duplicate alert")
	}

	// Digital twin reflects snapped Avl Bal (298,000) + retirement + holdings - liabilities
	reqTwin := httptest.NewRequest(http.MethodGet, "/finance/digital-twin", nil)
	wTwin := httptest.NewRecorder()
	r.ServeHTTP(wTwin, reqTwin)
	if wTwin.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on digital-twin, got %d", wTwin.Code)
	}
	var twin map[string]any
	_ = json.Unmarshal(wTwin.Body.Bytes(), &twin)
	if twin["liquid_cash_inr"] != 298000.0 {
		t.Fatalf("expected snapped liquid_cash_inr=298000, got %v", twin["liquid_cash_inr"])
	}
}

func TestChannelsTaxWhatIfRadarAndCFO(t *testing.T) {
	r := setupFinanceRouter()

	// Create Vault Email channel
	reqCh := httptest.NewRequest(http.MethodPost, "/finance/channels", bytes.NewBufferString(`{"channel_type":"email_forward"}`))
	wCh := httptest.NewRecorder()
	r.ServeHTTP(wCh, reqCh)
	if wCh.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created for channel, got %d", wCh.Code)
	}
	var ch IngestionChannel
	_ = json.Unmarshal(wCh.Body.Bytes(), &ch)
	if ch.VaultAlias == "" {
		t.Fatalf("expected generated vault_alias for email_forward")
	}

	// Tax evaluation
	reqTax := httptest.NewRequest(http.MethodPost, "/finance/tax/evaluate", bytes.NewBufferString(`{"gross_salary_inr":2000000}`))
	wTax := httptest.NewRecorder()
	r.ServeHTTP(wTax, reqTax)
	if wTax.Code != http.StatusOK {
		t.Fatalf("expected 200 on tax evaluate, got %d", wTax.Code)
	}

	// What-If simulation
	reqSim := httptest.NewRequest(http.MethodPost, "/finance/simulate/what-if", bytes.NewBufferString(`{"initial_net_worth_inr":1500000}`))
	wSim := httptest.NewRecorder()
	r.ServeHTTP(wSim, reqSim)
	if wSim.Code != http.StatusOK {
		t.Fatalf("expected 200 on what-if, got %d", wSim.Code)
	}

	// Opportunity Radar
	reqRad := httptest.NewRequest(http.MethodGet, "/finance/radar/opportunities", nil)
	wRad := httptest.NewRecorder()
	r.ServeHTTP(wRad, reqRad)
	if wRad.Code != http.StatusOK {
		t.Fatalf("expected 200 on radar, got %d", wRad.Code)
	}

	// AI CFO query with PII scrubbing + approval gate
	reqCFO := httptest.NewRequest(http.MethodPost, "/finance/cfo/query", bytes.NewBufferString(`{"query":"My PAN is ABCDE1234F, should I execute rebalance?"}`))
	wCFO := httptest.NewRecorder()
	r.ServeHTTP(wCFO, reqCFO)
	if wCFO.Code != http.StatusOK {
		t.Fatalf("expected 200 on cfo query, got %d", wCFO.Code)
	}
	var cfo map[string]any
	_ = json.Unmarshal(wCFO.Body.Bytes(), &cfo)
	if cfo["requires_action_approval"] != true {
		t.Fatalf("expected requires_action_approval=true for execute/rebalance prompt")
	}
}

func TestGoalsHoldingsLiabilitiesMarketsDebtGraphAndTableHealth(t *testing.T) {
	r := setupFinanceRouter()

	for _, ep := range []struct {
		method string
		path   string
		body   string
		want   int
	}{
		{http.MethodGet, "/finance/goals", "", http.StatusOK},
		{http.MethodPost, "/finance/goals", `{"name":"Japan Family Trip","goal_type":"travel","target_amount_today":450000,"monthly_sip_inr":15000}`, http.StatusCreated},
		{http.MethodGet, "/finance/holdings", "", http.StatusOK},
		{http.MethodGet, "/finance/liabilities", "", http.StatusOK},
		{http.MethodGet, "/finance/budgets", "", http.StatusOK},
		{http.MethodPost, "/finance/accounts", `{"name":"ICICI Wealth Savings","account_type":"bank","institution":"ICICI","current_balance":125000}`, http.StatusCreated},
		{http.MethodPost, "/finance/markets/analyze", `{}`, http.StatusOK},
		{http.MethodPost, "/finance/debt-business/optimize", `{}`, http.StatusOK},
		{http.MethodPost, "/finance/graph/propagate", `{"event_type":"rbi_policy","magnitude_bps":50}`, http.StatusOK},
		{http.MethodPut, "/finance/profile", `{"annual_gross_income_est":2400000,"risk_tolerance":"growth"}`, http.StatusOK},
		{http.MethodPost, "/finance/consents", `{"provider_type":"broker","tsp_name":"Zerodha Kite"}`, http.StatusCreated},
		{http.MethodPost, "/finance/budgets", `{"name":"Food & Dining Budget","amount":15000,"category_name":"Food & Dining"}`, http.StatusCreated},
		{http.MethodPost, "/finance/holdings", `{"symbol":"NIFTYBEES","name":"Nifty 50 ETF","units":500,"avg_cost_per_unit":260}`, http.StatusCreated},
		{http.MethodPost, "/finance/physical-assets", `{"asset_type":"physical_gold","name":"Gold Coins","estimated_value_inr":250000}`, http.StatusCreated},
		{http.MethodPost, "/finance/documents/parse", `{"doc_type":"form16","storage_ref":"vault/form16.pdf"}`, http.StatusCreated},
		{http.MethodPost, "/finance/liabilities", `{"loan_type":"home","lender_name":"HDFC","principal_outstanding":1200000,"interest_rate_apr":0.085,"emi_amount":22000,"remaining_months":72}`, http.StatusCreated},
		{http.MethodPost, "/finance/credit-reports", `{"bureau":"cibil","score":790,"utilization_pct":5.0}`, http.StatusCreated},
		{http.MethodPost, "/finance/insurance", `{"policy_type":"term_life","insurer_name":"HDFC Life","sum_insured_inr":20000000,"annual_premium_inr":18000}`, http.StatusCreated},
		{http.MethodPost, "/finance/business", `{"name":"Nexora Studio","entity_type":"sole_prop","gstin":"29ABCDE1234F1Z5","unit_price_inr":50000,"monthly_revenue_inr":100000}`, http.StatusCreated},
		{http.MethodGet, "/finance/table-health", "", http.StatusOK},
	} {
		var req *http.Request
		if ep.body != "" {
			req = httptest.NewRequest(ep.method, ep.path, bytes.NewBufferString(ep.body))
		} else {
			req = httptest.NewRequest(ep.method, ep.path, nil)
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != ep.want {
			t.Fatalf("%s %s expected %d, got %d: %s", ep.method, ep.path, ep.want, w.Code, w.Body.String())
		}
	}
}

func TestSmartSyncAutoDiscoveryAndE2EE(t *testing.T) {
	r := setupFinanceRouter()
	payload := `{
		"e2ee_envelope": "e2ee_v1:deadbeefcafe:tag01:ciphertext_payload",
		"alerts": [
			{"source_channel": "email_forward", "raw_text": "INR 1,85,000.00 credited to A/c XX4321 towards Monthly Salary. Avl Bal INR 4,40,000.00", "masked_account": "XX4321"},
			{"source_channel": "android_notification", "raw_text": "INR 42,500.00 debited from A/c XX4321 towards Home Loan EMI. Avl Bal INR 3,97,500.00", "masked_account": "XX4321"},
			{"source_channel": "ios_shortcut", "raw_text": "INR 25,000.00 debited from A/c XX4321 towards Zerodha Mutual Fund SIP. Avl Bal INR 3,72,500.00", "masked_account": "XX4321"},
			{"source_channel": "email_forward", "raw_text": "INR 18,500.00 debited from A/c XX4321 towards Term Life Insurance Premium. Avl Bal INR 3,54,000.00", "masked_account": "XX4321"}
		]
	}`
	req := httptest.NewRequest(http.MethodPost, "/finance/ingest/smart-sync", bytes.NewBufferString(payload))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", w.Code, w.Body.String())
	}
	var res map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if res["ingested_alerts"] != float64(4) {
		t.Fatalf("expected ingested_alerts=4, got %v", res["ingested_alerts"])
	}
	if verified, _ := res["e2ee_verified"].(bool); !verified {
		t.Fatalf("expected e2ee_verified=true, got %v", res["e2ee_verified"])
	}
	discovered, _ := res["discovered_entities"].([]any)
	if len(discovered) < 4 {
		t.Fatalf("expected >= 4 discovered entities, got %v", res["discovered_entities"])
	}
	if res["inferred_salary_inr"].(float64) < 2000000 {
		t.Fatalf("expected annualized salary estimate >= 20L, got %v", res["inferred_salary_inr"])
	}
}
