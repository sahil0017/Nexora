// Typed wrappers over the NEXORA Finance Intelligence Control Plane endpoints.
import { API_BASE_URL } from '../config';
import { api } from './client';

export type FinanceAccount = {
  id: string;
  user_id: string;
  name: string;
  account_type: string;
  institution?: string;
  masked_number?: string;
  currency: string;
  current_balance: number;
  interest_rate_apr?: number;
  sync_status: string;
  is_connected: boolean;
  updated_at: string;
};

export type FinanceTransaction = {
  id: string;
  user_id: string;
  account_id: string;
  external_txn_id?: string;
  txn_date: string;
  txn_type: 'debit' | 'credit' | 'transfer' | string;
  channel: string;
  source_channel: string;
  amount: number;
  currency: string;
  balance_after_txn?: number;
  merchant?: string;
  category?: string;
  upi_vpa_masked?: string;
  is_internal_transfer: boolean;
  is_discretionary: boolean;
  is_recurring_candidate: boolean;
  created_at: string;
};

export type IngestionChannel = {
  id: string;
  user_id: string;
  channel_type: string;
  provider_name: string;
  vault_alias?: string;
  status: string;
  created_at: string;
};

export type FinanceGoal = {
  id: string;
  user_id: string;
  name: string;
  goal_type: string;
  priority: number;
  target_amount_today: number;
  target_date: string;
  current_funded_inr: number;
  monthly_sip_inr: number;
  probability_of_success: number;
  status: string;
  updated_at: string;
};

export type FinanceHolding = {
  id: string;
  account_id?: string;
  symbol: string;
  name: string;
  asset_class: string;
  instrument_type: string;
  plan_type: string;
  units: number;
  avg_cost_per_unit: number;
  current_value_inr: number;
  unrealized_pnl_inr: number;
  xirr_pct: number;
};

export type FinanceLiability = {
  id: string;
  loan_type: string;
  lender_name: string;
  principal_sanctioned: number;
  principal_outstanding: number;
  interest_rate_apr: number;
  rate_type: string;
  emi_amount: number;
  remaining_months: number;
  status: string;
};

export type FinanceBudget = {
  id: string;
  name: string;
  period: string;
  amount: number;
  currency: string;
  start_date: string;
};

export type TableHealthEntry = {
  table: string;
  rows: number;
  wired_by: string;
};

export type DigitalTwinSnapshot = {
  net_worth_inr: number;
  total_assets_inr: number;
  total_liabilities_inr: number;
  liquid_cash_inr: number;
  investments_inr: number;
  retirement_assets_inr: number;
  physical_assets_inr: number;
  safe_to_spend_inr: number;
  month_credited_inr: number;
  month_debited_inr: number;
  savings_rate_pct?: number;
  dti_pct?: number;
  emergency_runway_months: number;
  health_score: number;
  health_breakdown?: Record<string, number>;
  coverage_gaps?: Array<{
    gap_type?: string;
    type?: string;
    severity: string;
    title?: string;
    suggested_action?: string;
    recommendation?: string;
  }>;
  backward_replay_history?: Array<{ date?: string; step?: number; net_worth_inr?: number; balance_inr?: number; delta_inr?: number }>;
  data_sufficiency?: { complete: boolean; missing_inputs?: string[] };
  policy_version?: string;
  cache_hit?: boolean;
  mode?: string;
};

export type AlertIngestPayload = {
  source_channel: 'android_notification' | 'ios_shortcut' | 'email_forward' | 'manual_import';
  raw_text: string;
  masked_account?: string;
  amount?: number;
  balance_after_txn?: number;
  currency?: string;
};

export type AlertIngestResponse = {
  status: string;
  newly_recorded: boolean;
  transaction: FinanceTransaction;
};

export type SmartSyncBatchResponse = {
  status: string;
  ingested_alerts: number;
  discovered_entities: string[];
  inferred_salary_inr: number;
  e2ee_verified: boolean;
};

export type TaxEvaluateResponse = {
  financial_year: string;
  recommended_regime: 'new' | 'old' | string;
  estimated_tax_new_inr: number;
  estimated_tax_old_inr: number;
  regime_annual_savings_inr: number;
  capital_gains?: {
    stcg_tax_inr?: number;
    ltcg_tax_inr?: number;
    ltcg_exemption_used_inr?: number;
    harvest_opportunities?: Array<{ symbol: string; unrealized_loss_inr: number; estimated_tax_saved_inr: number }>;
  };
};

export type WhatIfSimulationPayload = {
  initial_net_worth_inr?: number;
  monthly_sip_inr: number;
  sip_stepup_pct?: number;
  extra_sip_delta_inr?: number;
  extra_emi_prepay_inr?: number;
  horizon_years: number;
  expected_return_pct?: number;
  volatility_pct?: number;
};

export type WhatIfSimulationResponse = {
  horizon_years: number;
  baseline_outcomes_inr: {
    p10?: number;
    p50: number;
    p90?: number;
    fi_probability_of_success?: number;
  };
  what_if_outcomes_inr: {
    p10?: number;
    p50: number;
    p90?: number;
    fi_probability_of_success?: number;
    median_wealth_lift_inr?: number;
  };
  risk_metrics?: {
    var_95_monthly_inr?: number;
    cvar_95_monthly_inr?: number;
  };
};

export type MarketAnalysisResponse = {
  market_regime?: string;
  portfolio_overlap?: {
    regular_plan_annual_commission_drag_inr?: number;
    overlap_pairs?: Array<{ pair: string; overlap_pct: number }>;
  };
  lrs_compliance?: {
    utilized_usd?: number;
    remaining_limit_usd?: number;
  };
};

export type DebtBusinessOptimizeResponse = {
  debt_strategy?: {
    prepay_vs_sip_recommendation?: string;
    effective_spread_pct?: number;
  };
  business_intelligence?: {
    unit_economics_verdict?: string;
    ltv_cac_ratio?: number;
  };
};

export type GraphPropagateResponse = {
  event_type?: string;
  net_annual_impact_inr?: number;
  recommended_mitigation?: string;
  affected_nodes?: Array<{ node_id: string; impact_inr?: number }>;
};

export type RadarOpportunity = {
  engine_key: string;
  category: string;
  title: string;
  annualized_impact_inr: number;
  urgency: string;
  confidence: number;
  summary?: string;
  rationale?: string;
  recommended_action?: string;
};

export type RadarOpportunitiesResponse = {
  active_opportunities_count: number;
  total_annualized_savings_inr: number;
  opportunities: RadarOpportunity[];
};

export type CFOQueryResponse = {
  cfo_synthesis: string;
  specialist_deliberation?: Array<{ agent: string; verdict: string }>;
  prioritized_actions?: string[];
  requires_action_approval: boolean;
  evidence_bundle?: {
    confidence_score?: number;
    confidence_tier?: string;
    privacy_firewall?: {
      pii_scrubbed?: boolean;
      redacted_tokens_count?: number;
      gateway_source?: string;
    };
  };
};

export const financeApi = {
  digitalTwin: () => api.get<DigitalTwinSnapshot>('/finance/digital-twin'),
  accounts: () => api.get<{ accounts: FinanceAccount[]; count: number }>('/finance/accounts'),
  createAccount: (body: {
    name: string;
    account_type: string;
    institution?: string;
    masked_number?: string;
    current_balance: number;
    interest_rate_apr?: number;
  }) => api.post<FinanceAccount>('/finance/accounts', body),
  transactions: (limit = 30) =>
    api.get<{ transactions: FinanceTransaction[]; count: number }>(`/finance/transactions?limit=${limit}`),
  createTransaction: (body: {
    account_id?: string;
    merchant: string;
    category?: string;
    amount: number;
    txn_type?: 'debit' | 'credit' | 'transfer';
    channel?: string;
  }) => api.post<{ transaction: FinanceTransaction; deduplicated: boolean }>('/finance/transactions', body),
  ingestAlert: (body: AlertIngestPayload) => api.post<AlertIngestResponse>('/finance/ingest/alert', body),
  smartSyncBatch: (body: { alerts: AlertIngestPayload[]; e2ee_envelope?: string }) =>
    api.post<SmartSyncBatchResponse>('/finance/ingest/smart-sync', body),
  channels: () => api.get<{ channels: IngestionChannel[] }>('/finance/channels'),
  createChannel: (body: { channel_type: string; provider_name: string }) =>
    api.post<IngestionChannel>('/finance/channels', body),
  goals: () => api.get<{ goals: FinanceGoal[]; count: number }>('/finance/goals'),
  createGoal: (body: {
    name: string;
    goal_type: string;
    target_amount_today: number;
    current_funded_inr?: number;
    monthly_sip_inr?: number;
  }) => api.post<FinanceGoal>('/finance/goals', body),
  holdings: () => api.get<{ holdings: FinanceHolding[]; count: number }>('/finance/holdings'),
  liabilities: () => api.get<{ liabilities: FinanceLiability[]; count: number }>('/finance/liabilities'),
  budgets: () => api.get<{ budgets: FinanceBudget[]; count: number }>('/finance/budgets'),
  createBudget: (body: { name: string; amount: number; period?: string; category_name?: string }) =>
    api.post<FinanceBudget>('/finance/budgets', body),
  updateProfile: (body: {
    annual_gross_income_est: number;
    risk_tolerance?: string;
    preferred_tax_regime?: string;
  }) => api.post<Record<string, unknown>>('/finance/profile', body),
  createHolding: (body: {
    symbol: string;
    name: string;
    units: number;
    avg_cost_per_unit: number;
    asset_class?: string;
  }) => api.post<FinanceHolding>('/finance/holdings', body),
  createPhysicalAsset: (body: { asset_type: string; name: string; estimated_value_inr: number }) =>
    api.post<Record<string, unknown>>('/finance/physical-assets', body),
  parseDocument: (body: { doc_type: string; storage_ref: string }) =>
    api.post<Record<string, unknown>>('/finance/documents/parse', body),
  createLiability: (body: {
    loan_type: string;
    lender_name: string;
    principal_outstanding: number;
    interest_rate_apr: number;
    emi_amount: number;
    remaining_months: number;
  }) => api.post<FinanceLiability>('/finance/liabilities', body),
  createCreditReport: (body: { bureau: string; score: number; utilization_pct?: number }) =>
    api.post<Record<string, unknown>>('/finance/credit-reports', body),
  createInsurance: (body: {
    policy_type: string;
    insurer_name: string;
    sum_insured_inr: number;
    annual_premium_inr: number;
  }) => api.post<Record<string, unknown>>('/finance/insurance', body),
  createBusiness: (body: {
    name: string;
    entity_type: string;
    gstin?: string;
    monthly_revenue_inr?: number;
  }) => api.post<Record<string, unknown>>('/finance/business', body),
  createConsent: (body: { provider_type: string; tsp_name: string }) =>
    api.post<Record<string, unknown>>('/finance/consents', body),
  tableHealth: () => api.get<{ tables: TableHealthEntry[]; count: number }>('/finance/table-health'),
  resetData: () => api.del<{ status: string; user_id: string; deleted_rows: number }>('/finance/data'),
  analyzeMarkets: (body: Record<string, unknown> = {}) =>
    api.post<MarketAnalysisResponse>('/finance/markets/analyze', body),
  evaluateTax: (body: {
    gross_salary_inr: number;
    sec_80c_inr?: number;
    sec_80d_inr?: number;
    hra_exempt_inr?: number;
    home_loan_interest_inr?: number;
    nps_80ccd2_inr?: number;
  }) => api.post<TaxEvaluateResponse>('/finance/tax/evaluate', body),
  optimizeDebtBusiness: (body: Record<string, unknown> = {}) =>
    api.post<DebtBusinessOptimizeResponse>('/finance/debt-business/optimize', body),
  simulateWhatIf: (body: WhatIfSimulationPayload) =>
    api.post<WhatIfSimulationResponse>('/finance/simulate/what-if', body),
  propagateGraph: (body: { event_type: string; magnitude_bps?: number; inflation_delta_pct?: number }) =>
    api.post<GraphPropagateResponse>('/finance/graph/propagate', body),
  radarOpportunities: () => api.get<RadarOpportunitiesResponse>('/finance/radar/opportunities'),
  queryCFO: (query: string) => api.post<CFOQueryResponse>('/finance/cfo/query', { query }),
};

/**
 * Subscribes to live server-pushed updates from `/finance/stream` (SSE on Web; silent teardown otherwise).
 */
export function subscribeFinanceStream(onEvent: () => void, onStatus?: (live: boolean) => void): () => void {
  const ES = (globalThis as { EventSource?: typeof EventSource }).EventSource;
  if (!ES) {
    onStatus?.(false);
    return () => {};
  }
  const source = new ES(`${API_BASE_URL}/finance/stream`);
  source.addEventListener('connected', () => onStatus?.(true));
  source.addEventListener('finance_update', () => onEvent());
  source.onerror = () => onStatus?.(false);
  return () => {
    onStatus?.(false);
    source.close();
  };
}
