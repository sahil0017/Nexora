package finance

import (
	"context"
	"encoding/json"
	"strings"
	"time"
)

func (p *PostgresRepository) UpsertProfile(ctx context.Context, fp FinancialProfile) (FinancialProfile, error) {
	if fp.TaxResidency == "" {
		fp.TaxResidency = "resident_ordinary"
	}
	if fp.PreferredTaxRegime == "" {
		fp.PreferredTaxRegime = "auto"
	}
	if fp.RiskTolerance == "" {
		fp.RiskTolerance = "moderate"
	}
	if fp.RiskScore <= 0 {
		fp.RiskScore = 50
	}
	if fp.EmploymentType == "" {
		fp.EmploymentType = "salaried"
	}
	if fp.EmergencyTargetMonths <= 0 {
		fp.EmergencyTargetMonths = 6
	}
	if fp.RetirementTargetAge <= 0 {
		fp.RetirementTargetAge = 60
	}
	_, err := p.pool.Exec(ctx,
		`INSERT INTO finance.financial_profiles (
		     user_id, tax_residency, preferred_tax_regime, risk_tolerance, risk_score,
		     dependents_count, employment_type, annual_gross_income_est, monthly_fixed_obligation,
		     emergency_target_months, retirement_target_age
		 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		 ON CONFLICT (user_id) DO UPDATE SET
		   tax_residency = EXCLUDED.tax_residency,
		   preferred_tax_regime = EXCLUDED.preferred_tax_regime,
		   risk_tolerance = EXCLUDED.risk_tolerance,
		   risk_score = EXCLUDED.risk_score,
		   employment_type = EXCLUDED.employment_type,
		   annual_gross_income_est = EXCLUDED.annual_gross_income_est,
		   monthly_fixed_obligation = EXCLUDED.monthly_fixed_obligation`,
		fp.UserID, fp.TaxResidency, fp.PreferredTaxRegime, fp.RiskTolerance, fp.RiskScore,
		fp.DependentsCount, fp.EmploymentType, fp.AnnualGrossIncomeEst, fp.MonthlyFixedObligation,
		fp.EmergencyTargetMonths, fp.RetirementTargetAge,
	)
	return fp, err
}

func (p *PostgresRepository) CreateConsent(ctx context.Context, c ConsentArtefact) (ConsentArtefact, error) {
	if c.ProviderType == "" {
		c.ProviderType = "broker"
	}
	if c.PurposeCode == "" {
		c.PurposeCode = "PORTFOLIO_SYNC"
	}
	err := p.pool.QueryRow(ctx,
		`INSERT INTO finance.consent_artefacts (user_id, provider_type, tsp_name, purpose_code, status, granted_at, expires_at)
		 VALUES ($1, $2, $3, $4, 'active', now(), now() + interval '180 days')
		 RETURNING id::text, status`,
		c.UserID, c.ProviderType, c.TSPName, c.PurposeCode,
	).Scan(&c.ID, &c.Status)
	return c, err
}

func (p *PostgresRepository) CreateBudget(ctx context.Context, b Budget, categoryName string) (Budget, error) {
	if b.Period == "" {
		b.Period = "monthly"
	}
	if b.Currency == "" {
		b.Currency = "INR"
	}
	if b.StartDate == "" {
		b.StartDate = time.Now().UTC().Format("2006-01-02")
	}
	err := p.pool.QueryRow(ctx,
		`INSERT INTO finance.budgets (user_id, name, period, start_date, amount, currency)
		 VALUES ($1, $2, $3, $4::date, $5, $6)
		 RETURNING id::text`,
		b.UserID, b.Name, b.Period, b.StartDate, b.Amount, b.Currency,
	).Scan(&b.ID)
	if err == nil && categoryName != "" {
		var catID string
		_ = p.pool.QueryRow(ctx,
			`INSERT INTO finance.categories (user_id, name) VALUES ($1, $2)
			 ON CONFLICT (user_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id::text`,
			b.UserID, categoryName,
		).Scan(&catID)
		if catID != "" {
			_, _ = p.pool.Exec(ctx,
				`INSERT INTO finance.budget_entries (budget_id, category_id, amount) VALUES ($1::uuid, $2::uuid, $3) ON CONFLICT DO NOTHING`,
				b.ID, catID, b.Amount,
			)
		}
	}
	return b, err
}

func (p *PostgresRepository) CreateHolding(ctx context.Context, userID, symbol, name, assetClass, instType, planType string, units, avgCost float64) (Holding, error) {
	if assetClass == "" {
		assetClass = "equity"
	}
	if instType == "" {
		instType = "mutual_fund"
	}
	if planType == "" {
		planType = "direct"
	}
	if symbol == "" {
		symbol = strings.ToUpper(strings.ReplaceAll(name, " ", "_"))
	}
	var instID string
	err := p.pool.QueryRow(ctx,
		`INSERT INTO finance.market_instruments (symbol, exchange, name, instrument_type, asset_class)
		 VALUES ($1, 'NSE', $2, $3, $4)
		 ON CONFLICT (exchange, symbol) DO UPDATE SET name = EXCLUDED.name
		 RETURNING id::text`,
		symbol, name, instType, assetClass,
	).Scan(&instID)
	if err != nil {
		return Holding{}, err
	}
	today := time.Now().UTC().Format("2006-01-02")
	_, _ = p.pool.Exec(ctx,
		`INSERT INTO finance.market_prices_ts (instrument_id, price_date, close_price)
		 VALUES ($1::uuid, $2::date, $3) ON CONFLICT (instrument_id, price_date) DO UPDATE SET close_price = EXCLUDED.close_price`,
		instID, today, avgCost,
	)
	val := units * avgCost
	h := Holding{
		Symbol: symbol, Name: name, AssetClass: assetClass, InstrumentType: instType,
		PlanType: planType, Units: units, AvgCostPerUnit: avgCost, CurrentValueINR: val,
	}
	err = p.pool.QueryRow(ctx,
		`INSERT INTO finance.holdings (user_id, instrument_id, plan_type, units, avg_cost_per_unit, current_value_inr, last_valued_at)
		 VALUES ($1, $2::uuid, $3, $4, $5, $6, now())
		 RETURNING id::text`,
		userID, instID, planType, units, avgCost, val,
	).Scan(&h.ID)
	if err == nil && units > 0 {
		_, _ = p.pool.Exec(ctx,
			`INSERT INTO finance.tax_lots (user_id, holding_id, acquired_at, units_original, units_remaining, cost_per_unit)
			 VALUES ($1, $2::uuid, $3::date, $4, $4, $5)`,
			userID, h.ID, today, units, avgCost,
		)
	}
	return h, err
}

func (p *PostgresRepository) CreatePhysicalAsset(ctx context.Context, a PhysicalAsset) (PhysicalAsset, error) {
	if a.AssetType == "" {
		a.AssetType = "physical_gold"
	}
	if a.LiquidityTier == "" {
		a.LiquidityTier = "locked_medium"
	}
	err := p.pool.QueryRow(ctx,
		`INSERT INTO finance.physical_assets (user_id, asset_type, name, purchase_value_inr, estimated_value_inr, liquidity_tier)
		 VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::text`,
		a.UserID, a.AssetType, a.Name, a.PurchaseValueINR, a.EstimatedValueINR, a.LiquidityTier,
	).Scan(&a.ID)
	return a, err
}

func (p *PostgresRepository) CreateParsedDocument(ctx context.Context, d ParsedDocument) (ParsedDocument, error) {
	if d.DocType == "" {
		d.DocType = "other"
	}
	if d.ExtractionStatus == "" {
		d.ExtractionStatus = "completed"
	}
	if d.ExtractionConfidence <= 0 {
		d.ExtractionConfidence = 0.92
	}
	rawSummary, _ := json.Marshal(d.ExtractedSummary)
	if len(rawSummary) == 0 || string(rawSummary) == "null" {
		rawSummary = []byte("{}")
	}
	err := p.pool.QueryRow(ctx,
		`INSERT INTO finance.parsed_documents (user_id, doc_type, storage_ref, extraction_status, extracted_summary, extraction_confidence)
		 VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING id::text`,
		d.UserID, d.DocType, d.StorageRef, d.ExtractionStatus, string(rawSummary), d.ExtractionConfidence,
	).Scan(&d.ID)
	return d, err
}

func (p *PostgresRepository) CreateLiability(ctx context.Context, userID string, l Liability) (Liability, error) {
	if l.LoanType == "" {
		l.LoanType = "home"
	}
	if l.RateType == "" {
		l.RateType = "floating_eblr"
	}
	if l.PrincipalSanctioned <= 0 {
		l.PrincipalSanctioned = l.PrincipalOutstanding
	}
	err := p.pool.QueryRow(ctx,
		`INSERT INTO finance.liabilities (user_id, loan_type, lender_name, principal_sanctioned, principal_outstanding, interest_rate_apr, rate_type, emi_amount, remaining_months, status)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')
		 RETURNING id::text, status`,
		userID, l.LoanType, l.LenderName, l.PrincipalSanctioned, l.PrincipalOutstanding, l.InterestRateAPR, l.RateType, l.EMIAmount, l.RemainingMonths,
	).Scan(&l.ID, &l.Status)
	return l, err
}

func (p *PostgresRepository) CreateCreditReport(ctx context.Context, c CreditReport) (CreditReport, error) {
	if c.Bureau == "" {
		c.Bureau = "cibil"
	}
	if c.Score < 300 {
		c.Score = 750
	}
	err := p.pool.QueryRow(ctx,
		`INSERT INTO finance.credit_reports (user_id, bureau, score, utilization_pct, active_accounts_count, hard_inquiries_6m, report_date)
		 VALUES ($1, $2, $3, $4, $5, $6, current_date) RETURNING id::text`,
		c.UserID, c.Bureau, c.Score, c.UtilizationPct, c.ActiveAccountsCount, c.HardInquiries6M,
	).Scan(&c.ID)
	return c, err
}

func (p *PostgresRepository) CreateInsurancePolicy(ctx context.Context, pol InsurancePolicy) (InsurancePolicy, error) {
	if pol.PolicyType == "" {
		pol.PolicyType = "health"
	}
	if pol.CoverSource == "" {
		pol.CoverSource = "personal"
	}
	err := p.pool.QueryRow(ctx,
		`INSERT INTO finance.insurance_policies (user_id, policy_type, insurer_name, cover_source, sum_insured_inr, annual_premium_inr, nominee_verified, status)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, 'active') RETURNING id::text`,
		pol.UserID, pol.PolicyType, pol.InsurerName, pol.CoverSource, pol.SumInsuredINR, pol.AnnualPremiumINR, pol.NomineeVerified,
	).Scan(&pol.ID)
	return pol, err
}

func (p *PostgresRepository) CreateBusinessEntity(ctx context.Context, b BusinessEntity) (BusinessEntity, error) {
	if b.EntityType == "" {
		b.EntityType = "sole_prop"
	}
	if b.RevenueModel == "" {
		b.RevenueModel = "service"
	}
	err := p.pool.QueryRow(ctx,
		`INSERT INTO finance.business_entities (user_id, name, entity_type, industry, gstin, revenue_model, monthly_fixed_cost_inr, unit_price_inr, unit_variable_cost_inr, cac_inr, ltv_inr, status)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active') RETURNING id::text`,
		b.UserID, b.Name, b.EntityType, b.Industry, b.GSTIN, b.RevenueModel,
		b.MonthlyFixedCostINR, b.UnitPriceINR, b.UnitVariableCostINR, b.CACINR, b.LTVINR,
	).Scan(&b.ID)
	if err == nil {
		period := time.Now().UTC().Format("2006-01") + "-01"
		rev := b.MonthlyRevenueINR
		if rev <= 0 {
			rev = b.UnitPriceINR
		}
		_, _ = p.pool.Exec(ctx,
			`INSERT INTO finance.business_metrics_ts (entity_id, period_month, revenue_inr, opex_inr, ebitda_inr, net_cashflow_inr)
			 VALUES ($1::uuid, $2::date, $3, $4, $3 - $4, $3 - $4)
			 ON CONFLICT (entity_id, period_month) DO UPDATE SET revenue_inr = EXCLUDED.revenue_inr`,
			b.ID, period, rev, b.MonthlyFixedCostINR,
		)
		if b.GSTIN != "" {
			_, _ = p.pool.Exec(ctx,
				`INSERT INTO finance.gst_ledger (user_id, business_entity_id, gstin, return_period, gstr_type, taxable_value_inr, cgst_inr, sgst_inr)
				 VALUES ($1, $2::uuid, $3, to_char(current_date,'YYYY-MM'), 'GSTR3B', $4, $4*0.09, $4*0.09)`,
				b.UserID, b.ID, b.GSTIN, rev,
			)
		}
	}
	return b, err
}
