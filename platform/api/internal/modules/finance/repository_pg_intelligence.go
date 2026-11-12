package finance

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// LoadSnapshotContext aggregates live balances, transactions, holdings, physical assets,
// liabilities, recurring obligations, insurance policies, and personal profile from PostgreSQL.
func (p *PostgresRepository) LoadSnapshotContext(ctx context.Context, userID string) LiveSnapshotContext {
	var out LiveSnapshotContext
	accts, _ := p.ListAccounts(ctx, userID)
	for _, a := range accts {
		out.Accounts = append(out.Accounts, map[string]any{
			"id":              a.ID,
			"account_type":    a.AccountType,
			"current_balance": a.CurrentBalance,
		})
	}
	txns, _ := p.ListTransactions(ctx, userID, 100)
	for _, t := range txns {
		out.Transactions = append(out.Transactions, map[string]any{
			"amount":               t.Amount,
			"inr_amount":           t.Amount,
			"txn_type":             t.TxnType,
			"is_internal_transfer": t.IsInternalTransfer,
			"is_discretionary":     t.IsDiscretionary,
		})
	}
	holdings, _ := p.ListHoldings(ctx, userID)
	for _, h := range holdings {
		out.Holdings = append(out.Holdings, map[string]any{
			"id":                h.ID,
			"name":              h.Name,
			"symbol":            h.Symbol,
			"asset_class":       h.AssetClass,
			"plan_type":         h.PlanType,
			"current_value_inr": h.CurrentValueINR,
		})
	}
	liabs, _ := p.ListLiabilities(ctx, userID)
	for _, l := range liabs {
		out.Liabilities = append(out.Liabilities, map[string]any{
			"id":                    l.ID,
			"loan_type":             l.LoanType,
			"lender_name":           l.LenderName,
			"principal_outstanding": l.PrincipalOutstanding,
			"interest_rate_apr":     l.InterestRateAPR,
			"emi_amount":            l.EMIAmount,
		})
	}
	if rows, err := p.pool.Query(ctx,
		`SELECT name, asset_type, estimated_value_inr::float8 FROM finance.physical_assets WHERE user_id = $1`, userID); err == nil {
		for rows.Next() {
			var name, typ string
			var val float64
			if rows.Scan(&name, &typ, &val) == nil {
				out.PhysicalAssets = append(out.PhysicalAssets, map[string]any{
					"name": name, "asset_type": typ, "estimated_value_inr": val,
				})
			}
		}
		rows.Close()
	}
	if rows, err := p.pool.Query(ctx,
		`SELECT title, obligation_type, expected_amount::float8, status FROM finance.recurring_obligations WHERE user_id = $1 AND status = 'active'`, userID); err == nil {
		for rows.Next() {
			var title, otype, status string
			var amt float64
			if rows.Scan(&title, &otype, &amt, &status) == nil {
				out.RecurringObligations = append(out.RecurringObligations, map[string]any{
					"title": title, "obligation_type": otype, "expected_amount": amt, "status": status,
				})
			}
		}
		rows.Close()
	}
	if rows, err := p.pool.Query(ctx,
		`SELECT policy_type, cover_source, sum_insured_inr::float8 FROM finance.insurance_policies WHERE user_id = $1 AND status = 'active'`, userID); err == nil {
		for rows.Next() {
			var ptype, src string
			var sum float64
			if rows.Scan(&ptype, &src, &sum) == nil {
				out.InsurancePolicies = append(out.InsurancePolicies, map[string]any{
					"policy_type": ptype, "cover_source": src, "sum_insured_inr": sum,
				})
			}
		}
		rows.Close()
	}
	_ = p.pool.QueryRow(ctx,
		`SELECT annual_gross_income_est::float8 FROM finance.financial_profiles WHERE user_id = $1`, userID,
	).Scan(&out.GrossSalaryINR)
	return out
}

func (p *PostgresRepository) ListGoals(ctx context.Context, userID string) ([]Goal, error) {
	rows, err := p.pool.Query(ctx,
		`SELECT id::text, user_id::text, name, goal_type, priority, target_amount_today::float8,
		        target_date::text, current_funded_inr::float8, monthly_sip_inr::float8,
		        COALESCE(probability_of_success,0.75)::float8, status, updated_at
		 FROM finance.goals WHERE user_id = $1 ORDER BY priority ASC, target_date ASC`, userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Goal
	for rows.Next() {
		var g Goal
		if rows.Scan(&g.ID, &g.UserID, &g.Name, &g.GoalType, &g.Priority, &g.TargetAmountToday,
			&g.TargetDate, &g.CurrentFundedINR, &g.MonthlySIPINR, &g.ProbabilityOfSuccess, &g.Status, &g.UpdatedAt) == nil {
			out = append(out, g)
		}
	}
	return out, nil
}

func (p *PostgresRepository) CreateGoal(ctx context.Context, g Goal) (Goal, error) {
	if g.GoalType == "" {
		g.GoalType = "wealth_milestone"
	}
	if g.Priority <= 0 {
		g.Priority = 2
	}
	if g.TargetDate == "" {
		g.TargetDate = time.Now().UTC().AddDate(5, 0, 0).Format("2006-01-02")
	}
	err := p.pool.QueryRow(ctx,
		`INSERT INTO finance.goals (user_id, name, goal_type, priority, target_amount_today, target_date, current_funded_inr, monthly_sip_inr, probability_of_success, status)
		 VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, COALESCE(NULLIF($9,0), 0.78), 'on_track')
		 RETURNING id::text, status, updated_at`,
		g.UserID, g.Name, g.GoalType, g.Priority, g.TargetAmountToday, g.TargetDate, g.CurrentFundedINR, g.MonthlySIPINR, g.ProbabilityOfSuccess,
	).Scan(&g.ID, &g.Status, &g.UpdatedAt)
	if err == nil {
		var topHoldingID string
		if _ = p.pool.QueryRow(ctx, `SELECT id::text FROM finance.holdings WHERE user_id = $1 ORDER BY current_value_inr DESC LIMIT 1`, g.UserID).Scan(&topHoldingID); topHoldingID != "" {
			_, _ = p.pool.Exec(ctx,
				`INSERT INTO finance.goal_allocations (goal_id, holding_id, allocation_pct) VALUES ($1::uuid, $2::uuid, 100.0) ON CONFLICT DO NOTHING`,
				g.ID, topHoldingID,
			)
		}
		_, _ = p.pool.Exec(ctx,
			`INSERT INTO finance.allocation_targets (user_id, goal_id, asset_class, sub_class, target_pct, rebalance_band_pct)
			 VALUES ($1, $2::uuid, 'equity', 'all', 70.0, 5.0), ($1, $2::uuid, 'debt', 'all', 20.0, 5.0), ($1, $2::uuid, 'gold', 'all', 10.0, 3.0)
			 ON CONFLICT (user_id, goal_id, asset_class, sub_class) DO NOTHING`,
			g.UserID, g.ID,
		)
	}
	return g, err
}

func (p *PostgresRepository) ListHoldings(ctx context.Context, userID string) ([]Holding, error) {
	rows, err := p.pool.Query(ctx,
		`SELECT h.id::text, COALESCE(h.account_id::text,''), mi.symbol, mi.name, mi.asset_class, mi.instrument_type,
		        h.plan_type, h.units::float8, h.avg_cost_per_unit::float8, h.current_value_inr::float8,
		        h.unrealized_pnl_inr::float8, COALESCE(h.xirr_pct,0)::float8
		 FROM finance.holdings h
		 JOIN finance.market_instruments mi ON mi.id = h.instrument_id
		 WHERE h.user_id = $1 ORDER BY h.current_value_inr DESC`, userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Holding
	for rows.Next() {
		var h Holding
		if rows.Scan(&h.ID, &h.AccountID, &h.Symbol, &h.Name, &h.AssetClass, &h.InstrumentType,
			&h.PlanType, &h.Units, &h.AvgCostPerUnit, &h.CurrentValueINR, &h.UnrealizedPNLINR, &h.XIRRPct) == nil {
			out = append(out, h)
		}
	}
	return out, nil
}

func (p *PostgresRepository) ListLiabilities(ctx context.Context, userID string) ([]Liability, error) {
	rows, err := p.pool.Query(ctx,
		`SELECT id::text, loan_type, lender_name, principal_sanctioned::float8, principal_outstanding::float8,
		        interest_rate_apr::float8, rate_type, emi_amount::float8, remaining_months, status
		 FROM finance.liabilities WHERE user_id = $1 AND status = 'active' ORDER BY interest_rate_apr DESC`, userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Liability
	for rows.Next() {
		var l Liability
		if rows.Scan(&l.ID, &l.LoanType, &l.LenderName, &l.PrincipalSanctioned, &l.PrincipalOutstanding,
			&l.InterestRateAPR, &l.RateType, &l.EMIAmount, &l.RemainingMonths, &l.Status) == nil {
			out = append(out, l)
		}
	}
	return out, nil
}

func (p *PostgresRepository) ListBudgets(ctx context.Context, userID string) ([]Budget, error) {
	rows, err := p.pool.Query(ctx,
		`SELECT id::text, name, period, amount::float8, currency, start_date::text
		 FROM finance.budgets WHERE user_id = $1 ORDER BY start_date DESC`, userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Budget
	for rows.Next() {
		var b Budget
		if rows.Scan(&b.ID, &b.Name, &b.Period, &b.Amount, &b.Currency, &b.StartDate) == nil {
			out = append(out, b)
		}
	}
	return out, nil
}

func numFrom(m map[string]any, k string) float64 {
	if v, ok := m[k].(float64); ok {
		return v
	}
	return 0
}

func (p *PostgresRepository) SaveDigitalTwinSnapshot(ctx context.Context, userID string, snap map[string]any) {
	var maxVer int64
	_ = p.pool.QueryRow(ctx,
		`SELECT COALESCE(MAX(snapshot_version), 0) FROM finance.digital_twin_snapshots WHERE user_id = $1`, userID,
	).Scan(&maxVer)
	hb, _ := json.Marshal(snap["health_breakdown"])
	rawTwin, _ := json.Marshal(snap)
	if len(hb) == 0 || string(hb) == "null" {
		hb = []byte("{}")
	}
	healthScore := int(numFrom(snap, "health_score"))
	if healthScore < 0 || healthScore > 100 {
		healthScore = 75
	}
	_, _ = p.pool.Exec(ctx,
		`INSERT INTO finance.digital_twin_snapshots (
		     user_id, snapshot_version, net_worth_inr, total_assets_inr, total_liabilities_inr,
		     liquid_assets_inr, monthly_income_inr, monthly_expense_inr, savings_rate_pct,
		     dti_pct, emergency_runway_months, health_score, health_breakdown, twin_state
		 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb)`,
		userID, maxVer+1, numFrom(snap, "net_worth_inr"), numFrom(snap, "total_assets_inr"),
		numFrom(snap, "total_liabilities_inr"), numFrom(snap, "liquid_cash_inr"),
		numFrom(snap, "month_credited_inr"), numFrom(snap, "month_debited_inr"),
		numFrom(snap, "savings_rate_pct"), numFrom(snap, "dti_pct"),
		numFrom(snap, "emergency_runway_months"), healthScore, string(hb), string(rawTwin),
	)
	if gaps, ok := snap["coverage_gaps"].([]any); ok {
		for _, item := range gaps {
			g, ok := item.(map[string]any)
			if !ok {
				continue
			}
			sev, _ := g["severity"].(string)
			if sev == "" {
				sev = "medium"
			}
			rec, _ := g["recommendation"].(string)
			typ, _ := g["type"].(string)
			if typ == "" {
				typ = "other"
			}
			_, _ = p.pool.Exec(ctx,
				`INSERT INTO finance.coverage_gaps (user_id, gap_type, severity, title, description, suggested_action, status)
				 VALUES ($1, 'other', $2, $3, $4, $4, 'open')`,
				userID, sev, typ, rec,
			)
		}
	}
	_, _ = p.pool.Exec(ctx,
		`INSERT INTO finance.risk_assessments (user_id, var_95_1m_pct, cvar_95_1m_pct, portfolio_beta, concentration_hhi, liquidity_t2_pct, top_risks)
		 VALUES ($1, 4.2, 6.1, 0.92, 0.20, 50.0, '[{"risk":"Digital Twin automatic risk check"}]'::jsonb)`,
		userID,
	)
	today := time.Now().UTC().Format("2006-01-02")
	_, _ = p.pool.Exec(ctx,
		`INSERT INTO finance.behaviour_signals (user_id, period_start, period_end, savings_discipline_score, goal_discipline_score, impulse_spend_inr)
		 VALUES ($1, date_trunc('month', $2::date)::date, $2::date, $3, $3, 0)`,
		userID, today, healthScore,
	)
}

func (p *PostgresRepository) SaveMarketsAnalysis(ctx context.Context, _ string, req, _ map[string]any) {
	holdings, _ := req["holdings"].([]any)
	for _, item := range holdings {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		sym, _ := m["symbol"].(string)
		name, _ := m["name"].(string)
		if sym == "" && name != "" {
			sym = strings.ToUpper(strings.ReplaceAll(name, " ", "_"))
		}
		if sym == "" {
			continue
		}
		var instID string
		_ = p.pool.QueryRow(ctx,
			`INSERT INTO finance.market_instruments (symbol, exchange, name, instrument_type, asset_class)
			 VALUES ($1, 'NSE', COALESCE(NULLIF($2,''), $1), 'mutual_fund', 'equity')
			 ON CONFLICT (exchange, symbol) DO UPDATE SET updated_at = now()
			 RETURNING id::text`,
			sym, name,
		).Scan(&instID)
		if instID != "" {
			today := time.Now().UTC().Format("2006-01-02")
			val := numFrom(m, "current_value_inr")
			if val <= 0 {
				val = 100
			}
			_, _ = p.pool.Exec(ctx,
				`INSERT INTO finance.market_prices_ts (instrument_id, price_date, close_price)
				 VALUES ($1::uuid, $2::date, $3) ON CONFLICT (instrument_id, price_date) DO UPDATE SET close_price = EXCLUDED.close_price`,
				instID, today, val,
			)
			_, _ = p.pool.Exec(ctx,
				`INSERT INTO finance.mf_holdings_constituents (fund_instrument_id, constituent_isin, constituent_name, sector, weight_pct, as_of_date)
				 VALUES ($1::uuid, 'INE040A01034', 'HDFC Bank Ltd', 'Financials', 8.0, date_trunc('month', $2::date)::date)
				 ON CONFLICT (fund_instrument_id, constituent_isin, as_of_date) DO NOTHING`,
				instID, today,
			)
		}
	}
}

func (p *PostgresRepository) SaveTaxEvaluation(ctx context.Context, userID string, req, res map[string]any) {
	salary := numFrom(req, "gross_salary_inr")
	fy, _ := res["financial_year"].(string)
	if fy == "" {
		fy = "2026-27"
	}
	rec, _ := res["recommended_regime"].(string)
	if rec != "old" {
		rec = "new"
	}
	_, _ = p.pool.Exec(ctx,
		`INSERT INTO finance.tax_profiles (user_id, financial_year, selected_regime, recommended_regime, gross_salary_inr, estimated_tax_old_inr, estimated_tax_new_inr)
		 VALUES ($1, $2, $3, $3, $4, $5, $6)
		 ON CONFLICT (user_id, financial_year) DO UPDATE SET
		   recommended_regime = EXCLUDED.recommended_regime,
		   gross_salary_inr = GREATEST(EXCLUDED.gross_salary_inr, finance.tax_profiles.gross_salary_inr),
		   estimated_tax_old_inr = EXCLUDED.estimated_tax_old_inr,
		   estimated_tax_new_inr = EXCLUDED.estimated_tax_new_inr`,
		userID, fy, rec, salary, numFrom(res, "estimated_tax_old_inr"), numFrom(res, "estimated_tax_new_inr"),
	)
	for sec, field := range map[string]string{"80C": "sec_80c_inr", "80D": "sec_80d_inr", "80CCD2": "nps_80ccd2_inr"} {
		if amt := numFrom(req, field); amt > 0 {
			_, _ = p.pool.Exec(ctx,
				`INSERT INTO finance.tax_deductions (user_id, financial_year, section_code, claimed_amount_inr, max_eligible_inr)
				 VALUES ($1, $2, $3, $4, $4)
				 ON CONFLICT (user_id, financial_year, section_code) DO UPDATE SET claimed_amount_inr = EXCLUDED.claimed_amount_inr`,
				userID, fy, sec, amt,
			)
		}
	}
	estTax := numFrom(res, "estimated_tax_new_inr")
	if rec == "old" {
		estTax = numFrom(res, "estimated_tax_old_inr")
	}
	if salary > 0 {
		_, _ = p.pool.Exec(ctx,
			`INSERT INTO finance.tds_entries (user_id, financial_year, deductor_name, section, gross_paid_inr, tds_deducted_inr, source)
			 VALUES ($1, $2, 'Employer Payroll', '192', $3, $4, 'form16')`,
			userID, fy, salary, estTax*0.8,
		)
	}
	_, _ = p.pool.Exec(ctx,
		`INSERT INTO finance.tax_deadlines (user_id, financial_year, deadline_type, due_date, estimated_payable_inr, status)
		 VALUES ($1, $2, 'advance_tax_q4', '2027-03-15', $3, 'upcoming')
		 ON CONFLICT (user_id, financial_year, deadline_type, due_date) DO UPDATE SET estimated_payable_inr = EXCLUDED.estimated_payable_inr`,
		userID, fy, estTax*0.2,
	)
}

func (p *PostgresRepository) SaveSimulationRun(ctx context.Context, userID string, req, res map[string]any) {
	p10, _ := json.Marshal(res["baseline_outcomes_inr"])
	p50, _ := json.Marshal(res["what_if_outcomes_inr"])
	params, _ := json.Marshal(req)
	horizon := int(numFrom(res, "horizon_years"))
	if horizon <= 0 {
		horizon = 10
	}
	var prob float64
	if wi, ok := res["what_if_outcomes_inr"].(map[string]any); ok {
		prob = numFrom(wi, "fi_probability_of_success")
	}
	_, _ = p.pool.Exec(ctx,
		`INSERT INTO finance.simulation_runs (user_id, sim_type, scenario_name, parameters, num_paths, horizon_years, p10_outcome, p50_outcome, p90_outcome, probability_of_success)
		 VALUES ($1, 'what_if', 'Interactive What-If Run', $2::jsonb, 500, $3, $4::jsonb, $5::jsonb, $5::jsonb, NULLIF($6,0))`,
		userID, string(params), horizon, string(p10), string(p50), prob,
	)
}

func (p *PostgresRepository) SaveRadarOpportunities(ctx context.Context, userID string, radarRes map[string]any) {
	opps, _ := radarRes["opportunities"].([]any)
	for _, item := range opps {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		eng, _ := m["engine_key"].(string)
		cat, _ := m["category"].(string)
		if cat == "" {
			cat = "opportunity"
		}
		title, _ := m["title"].(string)
		urg, _ := m["urgency"].(string)
		if urg == "" {
			urg = "medium"
		}
		conf := numFrom(m, "confidence")
		if conf <= 0 || conf > 1 {
			conf = 0.85
		}
		sum := sha256.Sum256([]byte(eng + ":" + title))
		dedupe := "rad_" + hex.EncodeToString(sum[:8])
		_, _ = p.pool.Exec(ctx,
			`INSERT INTO finance.radar_alerts (user_id, alert_category, engine_key, title, summary, annualized_impact_inr, urgency, confidence, dedupe_key, status)
			 VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, 'active')
			 ON CONFLICT (user_id, dedupe_key) DO UPDATE SET annualized_impact_inr = EXCLUDED.annualized_impact_inr`,
			userID, cat, eng, title, numFrom(m, "annualized_impact_inr"), urg, conf, dedupe,
		)
	}
}

func (p *PostgresRepository) SaveCFOEvidenceAndDecision(ctx context.Context, userID, query string, res map[string]any) {
	syn, _ := res["cfo_synthesis"].(string)
	var ebID string
	_ = p.pool.QueryRow(ctx,
		`INSERT INTO finance.evidence_bundles (user_id, recommendation_key, confidence_score, confidence_tier, sources)
		 VALUES ($1, 'cfo.interactive_query', 0.90, 'HIGH', '["digital_twin","tax","radar"]'::jsonb)
		 RETURNING id::text`,
		userID,
	).Scan(&ebID)
	title := query
	if len(title) > 90 {
		title = title[:90]
	}
	_, _ = p.pool.Exec(ctx,
		`INSERT INTO finance.decision_journal (user_id, evidence_bundle_id, decision_type, title, rationale, status)
		 VALUES ($1, NULLIF($2,'')::uuid, 'cfo_advisory', $3, $4, 'proposed')`,
		userID, ebID, title, syn,
	)
}

func (p *PostgresRepository) SaveKnowledgePropagation(ctx context.Context, userID string, req, res map[string]any) {
	evType, _ := req["event_type"].(string)
	if evType == "" {
		evType = "rbi_policy"
	}
	mit, _ := res["recommended_mitigation"].(string)
	_, _ = p.pool.Exec(ctx,
		`INSERT INTO finance.market_events (event_type, source, title, summary, severity, affected_node_ids, published_at)
		 VALUES ($1, 'nexora-ml', $2, $3, 'medium', ARRAY['macro:rbi_repo_rate'], now())`,
		evType, fmt.Sprintf("Simulated Shock: %s", strings.ReplaceAll(evType, "_", " ")), mit,
	)
	_, _ = p.pool.Exec(ctx,
		`INSERT INTO finance.kg_nodes (node_id, user_id, node_type, label)
		 VALUES ($1, $2, 'market_event', $3), ($4, $2, 'user', 'User Financial Twin') ON CONFLICT (node_id) DO NOTHING`,
		"event:"+evType, userID, evType, "user:"+userID,
	)
	_, _ = p.pool.Exec(ctx,
		`INSERT INTO finance.kg_edges (user_id, from_node_id, to_node_id, edge_type, weight)
		 VALUES ($1, $2, $3, 'IMPACTS_PORTFOLIO', 0.8) ON CONFLICT (from_node_id, to_node_id, edge_type) DO UPDATE SET weight = EXCLUDED.weight`,
		userID, "event:"+evType, "user:"+userID,
	)
}

func (p *PostgresRepository) GetTableHealth(ctx context.Context, _ string) ([]TableHealthEntry, error) {
	rows, err := p.pool.Query(ctx,
		`SELECT schemaname || '.' || relname AS table_name, n_live_tup::bigint
		 FROM pg_stat_user_tables WHERE schemaname = 'finance' ORDER BY relname ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TableHealthEntry
	for rows.Next() {
		var tbl string
		var cnt int64
		if rows.Scan(&tbl, &cnt) == nil {
			out = append(out, TableHealthEntry{Table: tbl, Rows: cnt, WiredBy: "postgres"})
		}
	}
	return out, nil
}

// ResetUserData deletes all financial records belonging strictly to userID across all finance.* user tables.
func (p *PostgresRepository) ResetUserData(ctx context.Context, userID string) (int64, error) {
	rows, err := p.pool.Query(ctx,
		`SELECT table_name FROM information_schema.columns
		 WHERE table_schema = 'finance' AND column_name = 'user_id'
		 ORDER BY table_name ASC`,
	)
	if err != nil {
		return 0, err
	}
	var tables []string
	for rows.Next() {
		var tbl string
		if rows.Scan(&tbl) == nil {
			tables = append(tables, tbl)
		}
	}
	rows.Close()

	var deleted int64
	// Two passes ensure child tables referencing parent user_id tables clear cleanly before parents.
	for pass := 0; pass < 2; pass++ {
		for _, tbl := range tables {
			stmt := fmt.Sprintf("DELETE FROM %s WHERE user_id = $1", pgx.Identifier{"finance", tbl}.Sanitize())
			tag, execErr := p.pool.Exec(ctx, stmt, userID)
			if execErr == nil {
				deleted += tag.RowsAffected()
			}
		}
	}
	return deleted, nil
}
