# NEXORA Finance — Financial Intelligence Network & Technical Architecture

> **15 Intelligence Domains · 163 Specialized Engines · 1 Unified AI CFO**
>
> Comprehensive product specification and end-to-end technical architecture for **NEXORA Finance**, built natively on NEXORA's **Go Modular Monolith (`nexora-api`)**, **Python Intelligence & Quantitative Engine (`nexora-ml`)**, **Event Backbone (`nexora-worker` + Redpanda / AWS SNS-SQS)**, **PostgreSQL + pgvector + Redis + S3/DynamoDB**, and **React Native / Expo Client (`apps/mobile`)**.

---

## 1. Executive Vision & Architectural Alignment

**NEXORA Finance** transforms personal, wealth, tax, debt, insurance, and entrepreneurial finance from passive expense tracking into an autonomous, evidence-backed **Financial Intelligence Network** orchestrated by a **Unified AI CFO**.

Per [`docs/architecture/blueprint.md`](../architecture/blueprint.md) and [`docs/adr/0001-modular-monolith-with-separate-ml.md`](../adr/0001-modular-monolith-with-separate-ml.md), NEXORA Finance adheres strictly to five locked architectural invariants:

1. **Deterministic Math Never Runs in an LLM**: Balances, XIRR, FIFO/LIFO capital gains, Indian Income Tax slabs, GST reconciliation, EMI amortization, Monte Carlo distributions, and portfolio covariance are computed strictly in deterministic Go and Python (NumPy/SciPy/Pandas) kernels. LLMs interpret intent, synthesize narratives, critique trade-offs, and explain evidence.
2. **Modular Monolith Control Plane + Separate ML/Quant Brain**: Business state, double-entry/canonical ledgers, external provider adapters, consent verification, and approval workflows live in `platform/api/internal/modules/finance/`. Heavy ML, NLP document extraction, graph traversal, vectorized simulation, and multi-agent reasoning live in `intelligence/ml-platform/src/nexora/finance/`.
3. **Consent-First & Zero Implicit Connection**: Extending `finance.accounts.is_connected` in [`0001_initial_schema.up.sql`](../../platform/api/migrations/0001_initial_schema.up.sql), manual entries never imply live bank/broker connectivity; every external data pull is backed by an explicit, revocable consent artefact (e.g., Sahamati Account Aggregator).
4. **Human-in-the-Loop Action Gate**: Every `external_write`, `sensitive`, or `high_impact` financial action (rebalance execution, tax filing submission, loan prepayment trigger, policy switch) creates an immutable approval ticket in `intelligence.action_approvals` and blocks until explicit user approval.
5. **Baseline-First Resilience**: Routed through [`ModelGateway`](../../intelligence/gateway/model_gateway.py), every ML/LLM capability degrades gracefully to deterministic mathematical rules (`DeterministicBaseline`) when upstream market feeds or LLM providers are unavailable.

---

## 2. End-to-End System Topology

```text
+---------------------------------------------------------------------------------------------------+
|                                   CLIENT LAYER (apps/mobile)                                      |
|  React Native + Expo + TypeScript + TanStack Query (apps/mobile/src/features/finance/)            |
|  - Personal CFO Cockpit & Financial Digital Twin Radar   - What-If Decision Laboratory Sliders    |
|  - Accounts, UPI, Portfolio, Tax & Business Hubs         - Evidence & Confidence Citations Drawer |
|  - Approval Cards (intelligence.action_approvals)        - Continuous Opportunity Radar Feed      |
+-------------------------------------------------+-------------------------------------------------+
                                                  | HTTPS + JWT Bearer (/api/v1/finance/*)
                                                  v
+---------------------------------------------------------------------------------------------------+
|                           GO CONTROL PLANE (nexora-api :8080, Chi)                                |
|  platform/api/internal/modules/finance/                                                           |
|  +-----------------------+  +-----------------------+  +-----------------------+                  |
|  | ledger/               |  | aggregation/          |  | tax_debt_protect/     |                  |
|  | - Accounts & Balances |  | - Sahamati AA Adapter |  | - Deterministic Tax   |                  |
|  | - Txn Normalization   |  | - CAS/RTA/Broker Sync |  | - Loan/EMI Optimizer  |                  |
|  | - Reconciliation      |  | - AIS/26AS/GSTN Sync  |  | - Insurance Coverage  |                  |
|  +-----------------------+  +-----------------------+  +-----------------------+                  |
|  +-----------------------+  +-----------------------+  +-----------------------+                  |
|  | digital_twin/         |  | business/             |  | orchestrator/         |                  |
|  | - Net Worth & Health  |  | - Unit Economics/P&L  |  | - Tool Registry       |                  |
|  | - Coverage Completeness| | - Valuation/BreakEven |  | - Action Approvals    |                  |
|  | - Goal State Machine  |  | - Side Income/Pricing |  | - Cross-Module Hooks  |
|  +-----------------------+  +-----------------------+  +-----------------------+                  |
+--------+-----------------------------------+-------------------------------------+----------------+
         |                                   | HTTP/gRPC (/v1/finance/*)           | Transactional Outbox
         v                                   v                                     v
+------------------------+   +-----------------------------------------+   +------------------------+
| DATA & STORAGE PLANE   |   | PYTHON INTELLIGENCE & QUANT SERVICE     |   | EVENT & WORKER PLANE   |
|                        |   | (nexora-ml :8000, FastAPI)              |   | (nexora-worker +       |
| - PostgreSQL 16        |   | intelligence/ml-platform/src/nexora/    |   |  Redpanda / SNS-SQS)   |
|   * finance.* schema   |   | finance/                                |   |                        |
|   * pgvector embeddings|   | - nlp/          (OCR, NER, Merchant/UPI)|   | - finance.txn.ingested |
|   * partitioned OHLCV/ |   | - markets/      (IN/Global/MF Quant/HMM)|   | - finance.market.event |
|     NAV/FX time-series |   | - risk/         (VaR, Anomaly, Stress)  |   | - finance.twin.updated |
| - Redis                |   | - simulation/   (Monte Carlo, What-If)  |   | - finance.radar.alert  |
|   * Quotes/NAV/FX cache|   | - behaviour/    (Bias, Impulse, Habits) |   | - finance.tax.deadline |
|   * Twin read-through  |   | - graph/        (Knowledge Graph)       |   | - Cross-module streams |
| - S3 + KMS + DynamoDB  |   | - radar/        (Opportunity & Events)  |   |   from mobility/health/|
|   * Encrypted CAS,     |   | - evidence/     (Confidence & Citations)|   |   work                 |
|     Form 16, Policies  |   | - agents/       (AI CFO + 7 Specialists)|   |                        |
+------------------------+   +-----------------------------------------+   +------------------------+
```

---

## 3. Core Architectural Subsystems & Execution Principles

### 3.1 Hybrid Compute Split (Go vs. Python vs. Worker)

| Workload Class | Execution Plane | Rationale |
|---|---|---|
| CRUD, double-entry ledger, consent verification, AA callbacks, strict FIFO tax lots, EMI amortization, budget state, approval state machine | **Go (`nexora-api`)** | Low-latency transactional consistency, strong typing, strict SQL transaction boundaries, minimal memory footprint |
| Document OCR/parsing (PDF Form 16, CAS, CAMS/KFintech, bank statements, insurance wordings), NER merchant extraction | **Python (`nexora-ml` + `nexora-worker`)** | Rich PDF/NLP ecosystem (`pypdf`/`pdfplumber`/layout models, embeddings) executed asynchronously via Outbox -> Worker |
| Equity/MF factor scoring, overlap matrices, HMM market regimes, VaR/CVaR, Isolation Forest fraud detection, vectorized Monte Carlo (10,000+ paths) | **Python (`nexora-ml`)** | Vectorized NumPy/SciPy/PyTorch execution, cached in Redis/Postgres per snapshot version |
| Knowledge Graph traversal, Continuous Opportunity Radar sweeps, Market Event impact propagation | **Python (`nexora-ml`) + `nexora-worker`** | Reactive event-driven graph updates triggered by Redpanda market/transaction events |
| Multi-Agent Financial Reasoning (Personal CFO + 7 specialists) | **Python (`nexora-ml` + `ModelGateway`)** | Tool-verified multi-agent debate/synthesis with deterministic math callbacks into Go/NumPy |

### 3.2 Canonical Money & Precision Standard
- All monetary columns use `NUMERIC(18, 4)` (or `NUMERIC(18, 2)` for ledger faces, extending [`0001_initial_schema.up.sql`](../../platform/api/migrations/0001_initial_schema.up.sql)) paired with ISO-4217 `currency CHAR(3)` and `fx_rate_to_inr NUMERIC(18, 8)`.
- Floating-point (`float64`) is prohibited for ledger sums, tax liabilities, and capital gains; Go uses fixed-point decimal arithmetic (`shopspring/decimal` or integer paise/micro-units) and Python uses `decimal.Decimal` for accounting and `float64` strictly for vectorized Monte Carlo/ML matrices.

---

## 4. Complete Catalog & Technical Mapping: 15 Domains & 163 Engines

Every domain, engine, and capability in the NEXORA Financial Intelligence Network is mapped below to its concrete service boundary, algorithms, adapters, and persistence layer.

---

### Domain 1: Personal Financial Intelligence (10 Engines)
*Understands the complete financial life of an individual.*

| # | Intelligence Engine | Capabilities | Technical Implementation |
|---|---|---|---|
| 1.1 | **Financial Profile** | Builds a complete financial identity from authorized data | Go `digital_twin.ProfileService` aggregates KYC-tokenized demographics, tax residency, dependents, risk appetite, and income profile (`finance.financial_profiles`) |
| 1.2 | **Net Worth Intelligence** | Calculates assets minus liabilities | Real-time materialization across `finance.accounts`, `finance.holdings`, `finance.physical_assets`, and `finance.liabilities` converted via live FX (`finance.net_worth_snapshots`) |
| 1.3 | **Income Intelligence** | Analyzes salary, business income, rental income and other earnings | Pattern + payroll/credit classifier tagging inflows (`salary`, `dividend`, `rental`, `freelance`, `business`, `interest`) with regularity & TDS gross-up |
| 1.4 | **Expense Intelligence** | Understands spending patterns and financial leakage | Hierarchical categorization (`finance.categories`), fixed vs. discretionary split, leakage detector (idle fees, overlapping subs, high-markup habits) |
| 1.5 | **Cash Flow Intelligence** | Tracks incoming and outgoing money | Daily/monthly liquidity waterfall, net surplus rate, burn rate, and free cash flow available for deployment (`FCF_investable`) |
| 1.6 | **Financial Health Intelligence** | Evaluates savings, debt, liquidity and stability | Composite deterministic scorecard (0–100): Emergency Runway months, Savings Rate %, DTI %, Debt-to-Asset, Protection Adequacy, Diversification |
| 1.7 | **Financial Behaviour Intelligence** | Learns spending and saving habits | Behavioral feature store extracting payday spike ratio, weekend drift, category elasticity, and savings consistency streaks |
| 1.8 | **Financial Goal Intelligence** | Tracks short-, medium- and long-term goals | Goal state machine (`finance.goals`) linking dedicated asset buckets, required SIPs, inflation-adjusted target corpus, and probability-of-success (`P_goal`) |
| 1.9 | **Financial Digital Twin** | Maintains a continuously updated financial model | Versioned graph + state-vector snapshot (`finance.digital_twin_snapshots`) updated incrementally on every Redpanda `finance.*` event |
| 1.10 | **Financial Coverage Intelligence** | Identifies missing accounts, data gaps and stale information | Completeness auditor checking staleness SLA per institution, orphan transfers (e.g., detected SIP debit with no matching MF folio), and unlinked PAN/AIS assets |

---

### Domain 2: Banking & Account Intelligence (10 Engines)
*Understands the user's banking ecosystem.*

| # | Intelligence Engine | Capabilities | Technical Implementation |
|---|---|---|---|
| 2.1 | **Account Aggregation** | Consolidates supported financial accounts | Consent-gated adapters (`aggregation/aa_client.go`): Sahamati Account Aggregator (FIPs), CSV/PDF statement upload (`storage.go`), broker/RTA sync |
| 2.2 | **Balance Intelligence** | Tracks account balances and historical changes | Daily EOD balance time-series (`finance.balance_history`), minimum-balance breach early warning, idle cash yield drag calculator |
| 2.3 | **Transaction Intelligence** | Normalizes and understands transactions | Multi-stage pipeline: raw narration cleaner -> regex/rule matcher -> fine-tuned transformer/embedding classifier -> transfer/self-transfer deduplicator |
| 2.4 | **Merchant Intelligence** | Identifies merchants and spending categories | Canonical merchant entity resolver (UPI VPA / POS string / MCC code -> canonical merchant ID & category in Knowledge Graph) |
| 2.5 | **UPI Intelligence** | Understands UPI transactions, patterns and counterparties where data permits | UPI VPA parser (`@okicici`, `@ybl`, merchant vs P2P split), counterparty graph, recurring mandate (`UPI AutoPay`) tracker |
| 2.6 | **Card Intelligence** | Analyzes credit/debit card utilization, statements and expenses | Statement PDF parser + live txns: billing cycle tracker, utilization % (`limit` vs `outstanding`), reward-rate optimization, hidden forex/late fees |
| 2.7 | **Bank Fee Intelligence** | Identifies avoidable charges and account fees | Rule + NLP detector flagging MAB penalties, ATM excess fees, SMS charges, forex markups, ECS bounce charges, and annual card fee waiver eligibility |
| 2.8 | **Interest Intelligence** | Tracks deposit interest and loan interest | Effective yield verification on savings/FD/RD vs credit card APR / loan ROI; flags under-earning idle balances vs high-APR debt |
| 2.9 | **Reconciliation Intelligence** | Detects duplicate, missing and mismatched transactions | Fuzzy matching (`amount`, `±2d window`, `merchant/UTR`) across bank feeds, card statements, UPI logs, and self-transfers (`is_internal_transfer`) |
| 2.10 | **Subscription Intelligence** | Identifies recurring payments and upcoming debits | Periodicity detector (FFT/autocorrelation + amount tolerance + UPI AutoPay/SI flags) creating upcoming cash-outflow calendar (`finance.recurring_obligations`) |

---

### Domain 3: Wealth Growth Intelligence (10 Engines)
*Thinks like a wealth strategist.*

| # | Intelligence Engine | Capabilities | Technical Implementation |
|---|---|---|---|
| 3.1 | **Wealth Creation** | Develops long-term wealth-building strategies | Multi-horizon capital growth planner mapping surplus cashflow + career trajectory into asset accumulation milestones |
| 3.2 | **Asset Allocation** | Evaluates allocation across asset classes | Current vs target weight analyzer across Equity (IN/Global), Debt, Gold, Real Estate/REIT, Cash, Alternatives (`finance.allocation_targets`) |
| 3.3 | **Capital Allocation** | Decides how available capital could be deployed | Marginal-utility capital router: Emergency Buffer -> High-APR Debt Payoff -> Tax-Advantaged Buckets -> Goal-Aligned Asset Rebalance |
| 3.4 | **Compounding Intelligence** | Simulates compounding and reinvestment | Exact XIRR/CAGR engine modeling dividend/IDCW reinvestment, step-up SIPs, and tax-drag comparison |
| 3.5 | **Inflation Intelligence** | Measures real purchasing power and inflation-adjusted returns | Personal CPI basket estimator (lifestyle-weighted: education, healthcare, housing, discretionary) computing real post-tax, post-inflation returns |
| 3.6 | **Passive Income Intelligence** | Evaluates potential income-generating assets | Yield & cashflow ladder across dividends, REIT distributions, SWP, G-Secs/SDL/bonds, FDs, and rental properties |
| 3.7 | **Wealth Preservation** | Evaluates capital preservation and downside exposure | Drawdown floor analyzer, tail-risk hedging ratio, real-value preservation score, and sequence-of-returns risk mitigation |
| 3.8 | **Wealth Projection** | Models possible future net worth | Deterministic + stochastic net worth trajectory engine integrating savings step-ups, asset expected returns, and liability paydowns |
| 3.9 | **Financial Independence** | Estimates financial independence timelines | FI/FIRE calculator (Lean/Standard/Fat FI, Safe Withdrawal Rate calibrated for Indian inflation & longevity, Coast-FI milestones) |
| 3.10 | **Generational Wealth** | Models long-term family wealth transfer and preservation | Multi-decade trust/HUF/estate structure modeler, nomination & succession completeness check, multi-beneficiary inflation erosion simulation |

---

### Domain 4: Indian Stock Market Intelligence (12 Engines)
*An AI equity research analyst for NSE and BSE.*

| # | Intelligence Engine | Capabilities | Technical Implementation |
|---|---|---|---|
| 4.1 | **Equity Screening** | Screens listed companies using user-defined criteria | Vectorized SQL + columnar screener over NSE/BSE universe (`market.equities_fundamentals`): ROCE, ROE, FCF yield, D/E, promoter holding, momentum |
| 4.2 | **Fundamental Analysis** | Revenue, earnings, margins, cash flow and debt | Multi-year quarterly/annual financial statement normalizer (P&L, Balance Sheet, Cash Flow, DuPont ROE decomposition, CFO/PAT quality ratio) |
| 4.3 | **Valuation Intelligence** | P/E, P/B, EV/EBITDA, DCF and comparable valuation | Historical percentile bands + peer relative multiples + automated sensitivity-matrix DCF (WACC, terminal growth) |
| 4.4 | **Technical Intelligence** | Trends, momentum, volume and technical indicators | Deterministic TA engine (`pandas-ta`/NumPy): EMA/SMA ribbons, RSI, MACD, ATR, VWAP, volume profile, relative strength vs Nifty 50 |
| 4.5 | **Quantitative Intelligence** | Statistical factors and systematic strategies | Multi-factor cross-sectional scorer (Value, Quality, Momentum, Low-Volatility, Size) with walk-forward backtest metrics (Sharpe, Calmar, MaxDD) |
| 4.6 | **Sector Intelligence** | Identifies sector strength and weakness | Nifty sectoral index relative-rotation graphs (RRG), earnings revision breadth, and macro sensitivity mapping |
| 4.7 | **Small/Mid/Large-Cap Intelligence** | Evaluates companies by market-cap segment | SEBI market-cap tier classifier (Top 100 / 101–250 / 251+), liquidity impact cost check, and cycle dispersion analytics |
| 4.8 | **Corporate Governance** | Analyzes promoter pledging, related-party transactions and governance disclosures | Filing parser scanning shareholding patterns (promoter pledge % delta), RPT-to-revenue ratio, auditor qualifications, SEBI/exchange penal notices |
| 4.9 | **Earnings Intelligence** | Tracks results, earnings surprises and revisions | Quarterly result ingestion + consensus surprise tracker + `pgvector` RAG over earnings call transcripts and management guidance |
| 4.10 | **Corporate Action Intelligence** | Tracks dividends, splits, bonuses, buybacks and mergers | Corporate action calendar & ledger adjuster automatically adjusting cost basis, split/bonus lots, ex-date alerts, and buyback tender math |
| 4.11 | **Market Sentiment** | Studies credible news, disclosures and sentiment signals | Credibility-weighted NLP pipeline (exchange filings > credible financial press > noise filtered out), entity-linked sentiment scoring |
| 4.12 | **Market Regime Detection** | Identifies trending, range-bound and high-volatility environments | Hidden Markov Model (HMM) + India VIX / realized volatility / breadth clustering classifying regime (`bull_trend`, `range_bound`, `high_vol_stress`) |

---

### Domain 5: Mutual Fund & ETF Intelligence (11 Engines)
*An intelligent fund research and comparison engine.*

| # | Intelligence Engine | Capabilities | Technical Implementation |
|---|---|---|---|
| 5.1 | **Fund Discovery** | Finds funds based on goals and requirements | Goal-mapped screener across SEBI categories (Flexi-cap, Index, ELSS, Liquid, Short-Duration, Arbitrage, Gold/Silver ETFs) |
| 5.2 | **Fund Comparison** | Compares performance, fees and risk | Side-by-side comparator: CAGR, Alpha, Beta, Sharpe, Sortino, Information Ratio, Upside/Downside Capture vs category & TRI benchmark |
| 5.3 | **Portfolio Overlap** | Detects duplicate underlying holdings | Security-level holdings intersection engine (`AMFI/factsheet ISIN holdings`) computing pairwise & whole-portfolio stock/sector overlap % |
| 5.4 | **Fund Quality** | Evaluates consistency and investment process | Multi-factor fund rating avoiding point-in-time bias: rolling alpha consistency, style drift detection, AUM capacity check, AMC stewardship |
| 5.5 | **Rolling Return Analysis** | Measures performance over different periods | 1Y/3Y/5Y/7Y/10Y daily-step rolling return distribution (`min`, `median`, `max`, `% beat benchmark`) |
| 5.6 | **Expense Intelligence** | Evaluates expense ratios and other costs | Direct vs Regular TER drag simulator, exit load calendar (`<1yr` / `<3yr` ELSS lock-in), and tracking-cost audit |
| 5.7 | **Tracking Error Intelligence** | Evaluates index-tracking quality | Daily NAV vs Total Return Index (TRI) tracking difference and annualized tracking error for Index Funds & ETFs (plus bid-ask/iNAV spread for ETFs) |
| 5.8 | **Fund Manager Intelligence** | Tracks manager changes and portfolio decisions | Manager tenure ledger, attribution across prior managed schemes, and churn/turnover ratio shifts upon manager transitions |
| 5.9 | **SIP Intelligence** | Simulates investment contributions | SIP / Step-up SIP / XIRR analyzer, SIP date sensitivity backtester, and pause-vs-continue opportunity cost evaluator |
| 5.10 | **Rebalancing Intelligence** | Identifies allocation drift | Threshold & calendar drift detector (`>5%` band) recommending tax-aware inflows first (new SIP routing) before redemption |
| 5.11 | **Fund Risk Intelligence** | Evaluates drawdown, volatility and concentration | Max drawdown, recovery duration, top-10 holding concentration, debt credit-quality breakdown (AAA/AA+/AA/Sovereign), modified duration & YTM |

---

### Domain 6: International Investment Intelligence (10 Engines)
*Understands overseas markets for Indian investors.*

| # | Intelligence Engine | Capabilities | Technical Implementation |
|---|---|---|---|
| 6.1 | **Global Market Discovery** | Researches supported international markets | Multi-exchange universe catalog (US, EU, UK, Japan, Singapore, China/HK, Ireland UCITS ETFs, GIFT City IFSC) |
| 6.2 | **US Market Intelligence** | US companies, indices, funds and ETFs | SEC EDGAR 10-K/10-Q fundamentals, S&P 500 / Nasdaq-100 / Russell analytics, US ETF expense/dividend yield profiles |
| 6.3 | **European Market Intelligence** | European companies, funds and markets | STOXX / FTSE / DAX coverage plus Ireland-domiciled accumulating UCITS ETFs (avoiding US estate-tax / 25% dividend WHT drag) |
| 6.4 | **Asian Market Intelligence** | Japan, China, Singapore and other supported markets | Nikkei/TOPIX, Hang Seng/CSI, STI equities & ETFs, and India-domiciled feeder funds comparison |
| 6.5 | **Currency Intelligence** | INR versus foreign currencies | USD/INR, EUR/INR, GBP/INR, JPY/INR spot/forward tracker, historical depreciation alpha/drag decomposition (`return_local + fx_return`) |
| 6.6 | **Cross-Border Investment Intelligence** | Evaluates eligibility and permitted routes | Rule engine for RBI LRS (`$250,000/FY` cap tracker), TCS thresholds (Section 206C(1G)), GIFT City outbound vs NSE-funded international MFs |
| 6.7 | **Global Diversification** | Measures geographical exposure | Look-through revenue & domicile exposure across user's combined Indian + International holdings (detecting hidden US tech overlap) |
| 6.8 | **Global Macro Intelligence** | Compares economies and central-bank policies | Macro series aggregator: RBI, US Fed, ECB, BoJ policy rates, CPI, yield curves, PMI, and capital-flow correlations |
| 6.9 | **International Tax Intelligence** | Evaluates applicable cross-border tax considerations | W-8BEN / DTAA foreign tax credit (Form 67), Schedule FA / FSI disclosure tracker, Indian LTCG/STCG holding periods for foreign unlisted/listed shares |
| 6.10 | **Global Opportunity Scanner** | Finds research candidates across eligible markets | Cross-market screener ranking global themes/ETFs/equities in **INR-adjusted, post-TCS, post-FX-spread** terms |

---

### Domain 7: Tax & CA Intelligence (11 Engines)
*Acts like a digital CA for financial planning and tax organization.*

| # | Intelligence Engine | Capabilities | Technical Implementation |
|---|---|---|---|
| 7.1 | **Income Tax Intelligence** | Estimates income tax liability | Deterministic Indian Income Tax Act rule kernel (versioned per FY/AY): salary, house property, business/44ADA/44AD, capital gains, other sources, surcharge & cess |
| 7.2 | **Tax Regime Comparison** | Compares applicable tax regimes | Exact Old vs New Regime break-even solver across user's actual HRA, 80C, 80D, 80CCD(1B)/(2), 24(b) home loan interest, and LTA |
| 7.3 | **Deduction Intelligence** | Identifies potentially eligible deductions | Gap scanner matching transactions (ELSS, PPF, NPS, health insurance, school tuition, donations 80G, EV/home loan interest) to unutilized limits |
| 7.4 | **Capital Gains Intelligence** | Tracks equity, mutual fund and other asset gains | Strict FIFO tax-lot ledger (`finance.tax_lots`) tracking acquisition date, grandfathering (31-Jan-2018), STCG vs LTCG thresholds, indexation rules, and ₹1.25L exemption tracking |
| 7.5 | **Tax-Loss Harvesting** | Evaluates legally applicable loss-offset opportunities | Unrealized loss scanner pairing STCL/LTCL against realized STCG/LTCG (respecting set-off hierarchy & carry-forward 8-year expiry) |
| 7.6 | **TDS Intelligence** | Tracks tax deducted at source | Reconciles Form 26AS / AIS / Form 16 / 16A deductions against bank credits and salary slips; flags missing/mismatched TAN credits |
| 7.7 | **Advance Tax Intelligence** | Estimates advance tax obligations | Quarterly installment calculator (`15% / 45% / 75% / 100%` by Jun 15, Sep 15, Dec 15, Mar 15) factoring realized capital gains & 234B/234C interest avoidance |
| 7.8 | **GST Intelligence** | Supports relevant GST analysis for eligible business users | Invoice/GSTR-1/2B/3B reconciliation, ITC eligibility checker, RCM flags, turnover threshold monitor (₹20L/₹40L/Composition) |
| 7.9 | **Tax Document Intelligence** | Extracts information from tax documents | Async Python OCR/layout extractor for Form 16, AIS/TIS JSON/PDF, 26AS, broker P&L/tax reports, rent receipts, and GST invoices |
| 7.10 | **Tax Planning Simulator** | Models alternative financial and tax scenarios | Deterministic counterfactual runner ("What if I max NPS 80CCD(2)?", "Sell equity in March vs April?", "HUF split / bonus timing?") |
| 7.11 | **Tax Compliance Calendar** | Tracks important deadlines | Personalized deadline engine (`nexora-worker` reminders) for Advance Tax, ITR filing, Form 67, Belated/Revised ITR, GSTR-1/3B, and TDS challans |

---

### Domain 8: Loan & Debt Intelligence (10 Engines)
*Thinks like a debt and credit strategist.*

| # | Intelligence Engine | Capabilities | Technical Implementation |
|---|---|---|---|
| 8.1 | **Loan Analysis** | Evaluates outstanding loans | Canonical debt ledger (`finance.liabilities`): Home, Auto, Personal, Education, Gold, BNPL, Credit Card EMI with effective APR & foreclosure penalty terms |
| 8.2 | **EMI Intelligence** | Tracks repayment obligations | Amortization schedule engine splitting each EMI into principal vs interest, tracking floating-rate reset impacts (EBLR/repo changes) |
| 8.3 | **Interest Optimization** | Compares interest costs and repayment options | Computes total interest outgo across tenure vs EMI step-up vs rate negotiation; quantifies after-tax effective interest rate (e.g., 24(b)/80E) |
| 8.4 | **Debt Repayment Strategy** | Compares snowball and avalanche approaches | Integer/linear optimizer simulating Avalanche (highest after-tax APR first), Snowball (smallest balance first), and Hybrid psychological-momentum plans |
| 8.5 | **Refinancing Intelligence** | Evaluates potential refinancing | Break-even analyzer factoring new ROI, processing fees, stamp/MODT charges, and remaining tenure to compute net NPV savings |
| 8.6 | **Credit Card Debt Intelligence** | Identifies expensive revolving balances | Detects minimum-due traps (36–48% APR), GST on interest, loss of interest-free grace period, and models conversion/payoff plans |
| 8.7 | **Credit Score Intelligence** | Interprets supported credit information | Bureau report parser (CIBIL/Experian) decomposing score drivers: utilization (<30%), payment history, credit mix, age, hard inquiries |
| 8.8 | **Debt-to-Income Intelligence** | Evaluates debt burden against income | Computes gross & net FOIR (Fixed Obligation to Income Ratio), stress-testing DTI under +200 bps interest rate hike |
| 8.9 | **Loan Affordability** | Models borrowing capacity | Safe-EMI ceiling calculator balancing FOIR, down-payment opportunity cost, and emergency reserve retention |
| 8.10 | **Early Repayment Simulator** | Evaluates prepayment scenarios | Exact amortization simulator comparing lump-sum prepayments vs investing the surplus post-tax in equity/debt (`prepay_vs_invest` NPV) |

---

### Domain 9: Insurance & Protection Intelligence (10 Engines)
*Thinks like a financial protection planner.*

| # | Intelligence Engine | Capabilities | Technical Implementation |
|---|---|---|---|
| 9.1 | **Health Insurance Intelligence** | Reviews coverage and exclusions | Policy wording NLP parser extracting sum insured, room-rent capping, disease sub-limits, co-pay, waiting periods, restoration, and NCB |
| 9.2 | **Life Insurance Intelligence** | Evaluates protection requirements | Human Life Value (HLV) & expense-replacement liability modeler subtracting liquid assets from future dependent/debt obligations |
| 9.3 | **Term Insurance Intelligence** | Estimates coverage gaps | Pure-term adequacy calculator recommending coverage tenure (to retirement/debt-free age), riders (critical illness, waiver of premium), and claim settlement metrics |
| 9.4 | **Motor Insurance Intelligence** | Reviews premiums and coverage | IDV adequacy, NCB protection, zero-depreciation/engine-protect/consumables add-on analyzer, renewal reminder |
| 9.5 | **Policy Comparison** | Compares benefits, exclusions and costs | Normalized policy feature matrix comparing clauses side-by-side (`pgvector` semantic clause retrieval + structured exclusion table) |
| 9.6 | **Premium Intelligence** | Tracks upcoming premiums | Annualized protection cashflow calendar, grace-period alerts, and 80D/10(10D) tax eligibility tagging |
| 9.7 | **Coverage Gap Detection** | Identifies potentially insufficient protection | Rules + Digital Twin detector flagging missing super top-up, corporate-only health cover risk (job loss vulnerability), or under-insured dependents |
| 9.8 | **Claim Readiness** | Organizes required policy and claim documents | Encrypted vault checklist (`DynamoDB`/`S3` refs) tracking policy PDFs, nominee KYC, cashless network hospitals, TPA contacts, and pre-auth steps |
| 9.9 | **Insurance Overlap** | Detects duplicate or overlapping coverage | Compares corporate group health, personal base, super top-ups, and credit-card/travel covers to eliminate redundant premiums & optimize deductibles |
| 9.10 | **Protection Planning** | Models financial protection needs | Holistic risk-transfer blueprint linking emergency fund + health + term + disability/critical-illness protection before wealth aggressiveness |

---

### Domain 10: Business & Entrepreneurial Intelligence (12 Engines)
*Thinks like a business owner, not merely an expense tracker — focused on generating income and building enterprise value.*

| # | Intelligence Engine | Capabilities | Technical Implementation |
|---|---|---|---|
| 10.1 | **Business Opportunity Discovery** | Finds potential business opportunities | Matches user's skills/work domain, capital capacity, risk appetite, and local/digital market demand data into structured opportunity briefs |
| 10.2 | **Startup Cost Intelligence** | Estimates capital requirements | Capex + Opex + working-capital buffer estimator with 12-month burn & zero-revenue contingency sizing |
| 10.3 | **Revenue Model Intelligence** | Evaluates monetization models | Compares subscription, marketplace take-rate, SaaS tiered, retainer, transaction-fee, and productized service models |
| 10.4 | **Profit Margin Intelligence** | Calculates margins and profitability | Tracks Gross Margin, Contribution Margin, EBITDA, Net Margin, and GST/tax impact per product/service line (`finance.business_entities`) |
| 10.5 | **Break-Even Intelligence** | Estimates break-even points | Deterministic CVP (Cost-Volume-Profit) solver computing unit break-even, revenue break-even, and time-to-break-even under sensitivity ranges |
| 10.6 | **Cash Flow Management** | Forecasts operating cash requirements | AR/AP aging, Days Sales Outstanding (DSO), working capital cycle, GST/TDS outflow timing, and runway alerts |
| 10.7 | **Business Valuation** | Estimates business value using appropriate methods | Multi-method valuation engine: DCF (FCFF), Revenue/EBITDA market multiples, SDE (Seller's Discretionary Earnings) for MSMEs |
| 10.8 | **Competitor Intelligence** | Researches competitors and market positioning | Retrieval-augmented market research (`FinancialResearchAgent`) structuring competitor pricing, moat, distribution, and margin benchmarks |
| 10.9 | **Pricing Intelligence** | Evaluates pricing and profitability scenarios | Price elasticity & margin sensitivity simulator testing discount/tier changes on contribution margin and break-even volume |
| 10.10 | **Side Income Intelligence** | Identifies possible additional income sources | Cross-references `work` module skills/schedule + `finance` surplus capital to rank active/semi-passive income paths by ROI on time & capital |
| 10.11 | **Business Investment Intelligence** | Evaluates investments in business ventures | Evaluates angel/MSME/franchise/capex proposals via IRR, payback period, downside cap, and personal net-worth concentration limits |
| 10.12 | **Unit Economics** | Calculates CAC, LTV, contribution margin and payback period | Cohort-aware calculator computing `CAC`, `LTV = ARPU * GrossMargin / Churn`, `LTV:CAC`, `CAC Payback Months`, and sensitivity alerts |

---

### Domain 11: Financial Risk Intelligence (11 Engines)
*Identifies what could damage the user's financial position.*

| # | Intelligence Engine | Capabilities | Technical Implementation |
|---|---|---|---|
| 11.1 | **Portfolio Risk** | Measures portfolio-level exposure | Covariance matrix + historical/parametric VaR (95%/99%), Expected Shortfall (CVaR), portfolio Beta, and annualized volatility |
| 11.2 | **Concentration Risk** | Detects excessive exposure to one asset or sector | Herfindahl-Hirschman Index (HHI) across single stock, AMC, sector, issuer, employer equity (ESOP/RSU + salary correlation), and property |
| 11.3 | **Market Risk** | Evaluates volatility and market exposure | Factor beta decomposition (Market, Size, Value, Momentum, Duration, Credit Spread) and drawdown exposure |
| 11.4 | **Credit Risk** | Evaluates issuer and borrower risk | Tracks credit rating migrations (CRISIL/ICRA/CARE) on debt MFs/bonds/NCDs and default probability tiers |
| 11.5 | **Liquidity Risk** | Identifies assets that may be difficult to liquidate | Classifies every asset into Liquidity Tiers (`T+0 Cash`, `T+1/T+2 Listed/MF`, `Locked ELSS/PPF/EPF`, `Illiquid Real Estate/Angel`) and tests 30-day emergency liquidity |
| 11.6 | **Currency Risk** | Evaluates exchange-rate exposure | Net FX exposure matrix across INR, USD, EUR, GBP, JPY assets, foreign liabilities, and planned foreign goals (education/travel) |
| 11.7 | **Fraud Intelligence** | Detects suspicious financial patterns | Real-time rule + graph anomaly scorer flagging SIM-swap/new-payee spikes, late-night high-value UPI drains, disguised phishing charges, and mule patterns |
| 11.8 | **Transaction Anomaly Detection** | Identifies unusual transactions | Streaming Isolation Forest + z-score detector over merchant, amount, velocity, hour-of-day, and geo-consistency (cross-module signal with `mobility`!) |
| 11.9 | **Counterparty Risk** | Evaluates exposure to financial institutions and counterparties | Monitors per-bank DICGC ₹5L insurance coverage excess, single-broker demat/cash exposure, and NBFC/FD concentration |
| 11.10 | **Stress Testing** | Simulates financial shocks | Deterministic shock library: `-30% Equity Crash`, `+250 bps Rate Hike`, `15% INR Depreciation`, `6-Month Job Loss`, `₹10L Medical Emergency` |
| 11.11 | **Downside Protection** | Evaluates potential capital-loss scenarios | Tail-loss floor modeling, stop-loss / collar / asset-buffer recommendations, and minimum survival runway checks |

---

### Domain 12: Predictive & Simulation Intelligence (12 Engines)
*Thinks about possible financial futures.*

| # | Intelligence Engine | Capabilities | Technical Implementation |
|---|---|---|---|
| 12.1 | **Cash Flow Forecasting** | Predicts upcoming cash positions | Time-series + known recurring schedule (`Prophet`/`TFT`/state-space + scheduled EMIs/SIPs/bills) forecasting 30/60/90-day daily cash troughs |
| 12.2 | **Expense Forecasting** | Estimates future expenses | Seasonal + inflation + lifestyle-trend expense forecaster modeling festivals, school fees, insurance renewals, and baseline burn |
| 12.3 | **Income Forecasting** | Models possible income changes | Probabilistic salary growth, bonus variance, variable freelance/business revenue bands, and tax-withholding projections |
| 12.4 | **Net Worth Forecasting** | Projects future net worth | Coupled asset-liability simulation projecting `P10 / P50 / P90` net worth over 1–40 years |
| 12.5 | **Investment Return Simulation** | Models possible investment outcomes | Multi-asset return generator calibrated with fat-tailed shocks and mean-reversion regimes |
| 12.6 | **Monte Carlo Simulation** | Models distributions of uncertain outcomes | Vectorized NumPy engine running 10,000+ correlated multi-asset paths (Cholesky covariance + Student-t/regime switching) in <150ms |
| 12.7 | **Scenario Simulation** | Tests hypothetical financial decisions | Parameterized state-fork engine cloning the user's `FinancialDigitalTwin` into isolated counterfactual branches (`finance.simulation_runs`) |
| 12.8 | **Retirement Simulation** | Estimates retirement readiness | Decumulation simulator testing Safe Withdrawal Rates, bucket strategies, inflation shocks, healthcare escalation, and longevity to age 95 |
| 12.9 | **Inflation Simulation** | Models changes in purchasing power | Multi-basket inflation fan charts showing nominal vs real INR value erosion over 5–30 years |
| 12.10 | **Financial Independence Simulator** | Estimates potential FI timelines | Solves distribution of years-to-FI across savings rate deltas, step-up %, and market return percentiles |
| 12.11 | **Job Loss Simulation** | Models unemployment and income disruption | Stress-tests monthly survival runway, mandatory EMI/insurance obligations, emergency-fund depletion curve, and temporary SIP pause impact |
| 12.12 | **Major Purchase Simulation** | Evaluates homes, cars and other expensive purchases | Full TCO & opportunity-cost modeler (e.g., Buy vs Rent home, Cash vs Loan car, down-payment compounding foregone, maintenance, tax shield) |

---

### Domain 13: Opportunity & Research Intelligence (12 Engines)
*Continuously searches for ways to improve the user's financial position.*

| # | Intelligence Engine | Capabilities | Technical Implementation |
|---|---|---|---|
| 13.1 | **Investment Opportunity Scanner** | Searches eligible investment universes | Continuous screener filtering NSE/BSE, MFs, Bonds, Global ETFs against user's mandate, risk score, and allocation gaps |
| 13.2 | **Undervalued Asset Discovery** | Identifies assets that may be mispriced | Composite valuation-dislocation scorer (DCF margin of safety + historical P/E-EV/EBITDA z-score + quality floor to avoid value traps) |
| 13.3 | **Sector Rotation Intelligence** | Monitors sector leadership changes | Momentum + macro-cycle + earnings-revision tracker spotting early sector leadership transitions |
| 13.4 | **Dividend Intelligence** | Evaluates dividend income and sustainability | Payout ratio, FCF dividend coverage, 5-year consistency, ex-date calendar, and post-tax slab drag vs growth compounding |
| 13.5 | **Fixed Income Discovery** | Compares eligible debt instruments | Yield-to-Maturity (YTM), after-tax yield comparison across G-Secs, SDLs, RBI Floating Rate Bonds, AAA PSU/Corporate Bonds, Debt MFs, Arbitrage funds |
| 13.6 | **Deposit Intelligence** | Compares deposit rates and terms | Tracks bank/SFB FD & RD rate tables, senior-citizen spreads, DICGC ₹5L safety cap, sweep-in FDs, and post-tax yield |
| 13.7 | **Gold Intelligence** | Evaluates gold exposure and available instruments | Compares SGB (secondary market yield + tax-free maturity), Gold ETFs, Gold Mutual Funds, Digital Gold spread/GST drag |
| 13.8 | **Real Estate Intelligence** | Analyzes property economics and rental yield | Gross vs net rental yield, stamp duty/registration amortization, maintenance, vacancy factor, leverage IRR vs Nifty/FD benchmark |
| 13.9 | **REIT Intelligence** | Evaluates listed real estate opportunities | Embassy/Mindspace/Brookfield/Nexus NDCF yield, occupancy, WALE, LTV, distribution tax split (dividend/interest/amortization) |
| 13.10 | **Savings Opportunity Scanner** | Finds avoidable costs | Scans regular-to-direct MF switches, idle savings -> sweep/liquid fund, unused subscriptions, bank fees, high-APR credit balance transfers |
| 13.11 | **Income Opportunity Scanner** | Identifies possible income-generating opportunities | Surfaces underutilized capital yield upgrades, tax-exempt allowances, dividend/REIT income boosts, and business/side-income plays |
| 13.12 | **Market Event Intelligence** | Monitors events that change investment theses | Real-time NLP event classifier linking RBI MPC decisions, SEBI circulars, Union Budget tax changes, earnings misses, and rating downgrades to user holdings |

---

### Domain 14: Financial Behaviour & Decision Intelligence (10 Engines)
*Helps users develop better financial decision-making habits.*

| # | Intelligence Engine | Capabilities | Technical Implementation |
|---|---|---|---|
| 14.1 | **Spending Psychology** | Identifies spending patterns and potential behavioural biases | Clusters temporal/contextual triggers (late-night shopping, post-payday splurges, stress/weekend spending spikes) |
| 14.2 | **Impulse Purchase Detection** | Flags potentially unnecessary spending | Anomaly detector over discretionary merchant categories, rapid repeat orders, and unbudgeted BNPL/card spikes |
| 14.3 | **Lifestyle Inflation Detection** | Detects spending increases after income growth | Rolling comparison of `ΔDiscretionary_Spend / ΔNet_Income` across raises/bonuses; alerts when savings rate stagnates despite income growth |
| 14.4 | **Savings Discipline** | Tracks saving consistency | Measures automated SIP/transfer adherence, savings-first (pay-yourself-first) ratio, and streak scoring |
| 14.5 | **Financial Habit Intelligence** | Evaluates recurring financial behaviour | Habit loop telemetry tracking positive (auto-SIP, bill autopay, monthly review) vs negative (EMI stacking, cash-withdrawal surges) habits |
| 14.6 | **Goal Discipline** | Measures progress towards goals | Tracks goal contribution velocity vs required trajectory, flagging goal raids (early redemptions) |
| 14.7 | **Opportunity Cost Calculator** | Quantifies trade-offs in financial decisions | Translates any purchase or expense into equivalent future compounded wealth (`₹X today = ₹Y at retirement / Z months of FI`) |
| 14.8 | **Purchase Affordability** | Evaluates major purchases against financial context | Pre-purchase gate checking emergency buffer, EMI/cashflow impact, goal delay days, and 3-test affordability rule |
| 14.9 | **Financial Decision Coach** | Explains trade-offs and alternatives | Conversational coaching layer presenting structured Pros/Cons/Alternatives/Reversibility backed by Financial Evidence Engine |
| 14.10 | **Behavioural Bias Detection** | Highlights potential overconfidence, panic and herd behaviour | Trade & portfolio log analyzer detecting Disposition Effect (selling winners early, holding losers), Panic Redemption in drawdowns, Chasing Recent Winners, Home Bias |

---

### Domain 15: AI CFO & Autonomous Financial Intelligence (12 Engines)
*The central intelligence that connects all other engines.*

| # | Intelligence Engine | Capabilities | Technical Implementation |
|---|---|---|---|
| 15.1 | **Personal CFO Agent** | Understands the complete financial position | Top-level stateful orchestrator reading `FinancialDigitalTwin`, synthesizing holistic net-worth, cashflow, risk, tax, and goal priorities |
| 15.2 | **CA Agent** | Coordinates tax, compliance and documentation analysis | Specialist agent invoking deterministic Tax/GST/TDS/Capital-Gains tools and document extractors |
| 15.3 | **Investment Analyst Agent** | Conducts investment research | Specialist agent querying Equity/MF/Global/Fixed-Income quant engines, filings RAG, and Knowledge Graph |
| 15.4 | **Wealth Strategist Agent** | Builds wealth allocation scenarios | Specialist agent optimizing asset allocation, compounding, FI timelines, and rebalancing paths |
| 15.5 | **Risk Manager Agent** | Reviews financial downside | Adversarial critic agent running stress tests, liquidity checks, concentration limits, and insurance adequacy vetoes |
| 15.6 | **Business Strategist Agent** | Evaluates business and income opportunities | Specialist agent analyzing startup unit economics, break-even, pricing, valuation, and side-income ROI |
| 15.7 | **Financial Research Agent** | Retrieves and verifies financial information | Grounded RAG + live market data fetcher verifying source freshness, authority, and conflicting claims |
| 15.8 | **Decision Orchestrator** | Combines outputs from specialized engines | Directed Acyclic Graph (DAG) + multi-agent debate coordinator resolving cross-domain conflicts (e.g., Growth vs Tax vs Risk) |
| 15.9 | **Financial Memory** | Remembers user-approved financial goals and decisions | Extends `intelligence.memory_items` (consent-scoped, encrypted refs) storing approved mandates, risk tolerances, and past decision rationale |
| 15.10 | **Continuous Monitoring** | Monitors material changes and relevant alerts | Background Redpanda/worker watchdog monitoring balance drops, market regime shifts, tax thresholds, credit spikes, and coverage gaps |
| 15.11 | **Action Planner** | Prepares approved financial actions and workflows | Converts recommendations into step-by-step action plans with `intelligence.action_approvals` gates, checklists, and rollback states |
| 15.12 | **Explainability Engine** | Explains the evidence and reasoning behind recommendations | Emits structured `ExplanationPayload` (factor weights, deterministic formula trace, source citations, assumptions, confidence intervals) |

---

## 5. Cross-Engine Intelligence Fabric (Section 16)

NEXORA Finance's differentiating power comes from **deterministic + event-driven composition** across the 15 domains. Cross-engine workflows execute as **DAG pipelines** in `DecisionOrchestrator` triggered either interactively or reactively via Redpanda events.

```text
  [Redpanda Event / User Query]
                |
                v
  +---------------------------+
  |   Decision Orchestrator   |  <-- Reads Financial Digital Twin + Knowledge Graph
  +----+--------+--------+----+
       |        |        |
       v        v        v      (Parallel Specialist Execution)
   [Domain A] [Domain B] [Domain C]
       \        |        /
        v       v       v
  +---------------------------+
  |  Cross-Engine Synthesizer |  <-- Risk Manager Veto + Deterministic Math Verification
  +-------------+-------------+
                |
                v
  +---------------------------+
  | Evidence & Confidence Gate|  --> Recommendation + Action Plan + Approval Ticket
  +---------------------------+
```

### All 10 Cross-Engine Intelligence Compositions

| Cross-Engine Composition | Participating Domains & Engines | Orchestrated Workflow & Technical Output |
|---|---|---|
| **1. Tax + Wealth + Investment** | Tax (7.1–7.5) + Wealth (3.2–3.4) + Equity/MF (4.10, 5.6, 5.10) | *Tax-Efficient Wealth Optimization*: Before proposing any rebalance or redemption, checks FIFO lots (`finance.tax_lots`), remaining ₹1.25L LTCG exemption, harvestable losses, and Regular-to-Direct exit-load expiry; routes new SIP inflows to underweight buckets to minimize tax drag. |
| **2. Banking + Behaviour + Predictive** | Banking (2.2, 2.6, 2.10) + Behaviour (14.1–14.3) + Predictive (12.1–12.2) | *Proactive Cash-Shortage Prevention*: Combines recurring UPI/card mandates + detected payday/weekend behavioural spending velocity + 30-day cashflow forecast; alerts 7–14 days before projected minimum-balance breach or card-due shortfall. |
| **3. Global Market + Currency + Portfolio** | Global (6.2–6.9) + Risk (11.6) + Wealth (3.2) | *INR-Adjusted Global Allocation*: Computes global asset return in INR net of FX volatility, LRS TCS lockup, WHT/DTAA credit, and checks look-through overlap (e.g., Indian Tech/Parag Parikh US holdings + direct Nasdaq ETF). |
| **4. Business + Opportunity + Risk** | Business (10.2–10.12) + Opportunity (13.11) + Risk (11.2, 11.5, 11.10) | *Venture Viability Gate*: Evaluates a business/side-income proposal's unit economics and break-even alongside personal liquidity runway, job-loss buffer, and max acceptable net-worth concentration risk. |
| **5. Insurance + Debt + Financial Health** | Insurance (9.1–9.7) + Debt (8.1, 8.8) + Health (1.6) | *Protection Fragility Audit*: Cross-checks outstanding home/business debt against term-life cover and corporate-only health cover; flags if a job loss or medical event would force distressed asset liquidation. |
| **6. Equity + News + Fundamental** | Equity (4.2, 4.8, 4.9, 4.11) + Event Intel (§17.4) | *Thesis-Drift Detection*: Links live exchange disclosures, earnings surprises, and promoter-pledge changes directly to the user's holding thesis stored in `FinancialMemory` and flags material thesis violations. |
| **7. Mutual Fund + Equity + Portfolio** | MF (5.3) + Equity (4.1) + Risk (11.2) | *True Look-Through Concentration*: Explodes every Mutual Fund & ETF into underlying ISIN stock/sector/credit weights and merges them with direct NSE/BSE/US holdings to reveal hidden concentration (e.g., 28% combined exposure to top 3 private banks). |
| **8. Income + Expense + Goal** | Personal (1.3–1.5, 1.8) + Behaviour (14.4, 14.6) | *Realistic Savings & SIP Capacity*: Computes true investable surplus from verified post-tax income minus fixed/discretionary spend variance, dynamically adjusting goal SIP schedules and FI timelines. |
| **9. Macro + Sector + Equity** | Global Macro (6.8) + Sector (4.6) + Equity/Opportunity (4.2, 13.3) | *Macro-to-Portfolio Transmission*: Propagates RBI rate cuts/hikes, crude/FX moves, or CPI prints through sector sensitivity weights in the Financial Knowledge Graph to highlight portfolio tailwinds and headwinds. |
| **10. Risk + Predictive + Wealth** | Risk (11.10) + Predictive (12.6–12.11) + Wealth (3.7–3.8) | *Future Position Stress-Testing*: Runs 10,000 Monte Carlo + deterministic shock scenarios (stagflation, market crash + job loss, rate spike) on the projected 10-year wealth trajectory and recommends downside hedges. |

### Cross-Module Integration with Existing NEXORA Modules
Because NEXORA is one unified platform (`Move`, `Health`, `Finance`, `Work`, `Assistant`), Finance exchanges versioned events with sibling modules:
- **Move (`mobility.*`) -> Finance**: Commute cost telemetry (`INR/month` fuel, tolls, transit), vehicle maintenance/EV charging expenses, and geo-context signals for card/UPI anomaly verification (e.g., travel mode active vs distant POS alert).
- **Health (`health.*`) -> Finance**: Medical expense trends and preventive health signals feeding Insurance (`9.1` Health Insurance adequacy) and Retirement healthcare inflation (`12.8`).
- **Work (`work.*`) -> Finance**: Billable hours, project milestones, and freelance invoice tracking feeding Business & Entrepreneurial Intelligence (`10.6` Cash Flow, `10.10` Side Income) and Tax (`7.8` GST / `7.7` Advance Tax).

---

## 6. Platform-Level Differentiating Systems (Section 17)

### 6.1 Financial Knowledge Graph (`nexora-ml/finance/graph/`)
Moves beyond flat tables by modeling structural relationships across entities and events.

- **Node Types**: `User`, `Account`, `Holding` (`Stock`, `MF`, `ETF`, `Bond`, `FD`, `Gold`, `Property`, `Business`), `Issuer/Company`, `AMC`, `FundManager`, `Sector`, `Geography/Currency`, `Bank/Institution`, `Loan`, `InsurancePolicy`, `TaxRule/Section`, `Goal`, `MacroIndicator`, `MarketEvent`.
- **Edge Types**: `HOLDS(weight, units, tax_lot_ref)`, `UNDERLYING_EXPOSURE(pct_weight)`, `BELONGS_TO_SECTOR`, `MANAGED_BY`, `CUSTODIAN_AT`, `COVERS_RISK_FOR`, `BACKED_BY_COLLATERAL`, `SENSITIVE_TO(beta, polarity)`, `IMPACTED_BY(severity, confidence)`, `CORRELATED_WITH(rho)`.
- **Storage & Execution**:
  - Persisted cleanly in PostgreSQL (`finance.kg_nodes`, `finance.kg_edges` with GIN-indexed JSONB attributes and recursive CTE / adjacency list queries) with an in-memory `NetworkX` / adjacency subgraph per user session cached in Redis for sub-10ms multi-hop traversal.
  - Supports multi-hop queries like: *"If RBI raises repo rate by 50 bps, how does that propagate across my floating home loan EMI, my Banking-heavy Flexi-cap MF, my Long-Duration Debt Fund, and my FD ladder?"*

### 6.2 Continuous Opportunity Radar (`nexora-worker` + `nexora-ml/finance/radar/`)
An always-on, noise-filtered sentinel replacing manual portfolio checking.

- **Trigger Pipeline**:
  1. **Streaming Triggers**: Redpanda events (`finance.transaction.ingested.v1`, `finance.market.event.v1`, `finance.twin.updated.v1`).
  2. **Scheduled Sweeps**: Daily EOD NAV/Equity scan, weekly idle-cash/fee/subscription scan, monthly tax-loss harvesting & regime check, quarterly advance-tax & insurance-renewal scan.
- **Anti-Spam & Hysteresis Gate** (mirroring MoveSmart's `MeaningfulRouteChange` pattern):
  - Every candidate opportunity is scored on `Annualized_INR_Impact`, `Urgency`, `Actionability`, and `Confidence`.
  - Opportunities below materiality thresholds (e.g., `< ₹1,000/yr` benefit or `< 0.65` confidence) or recently dismissed/snoozed are suppressed (`finance.radar_alerts` with cooldown TTL) so the user only receives high-signal briefings.

### 6.3 Multi-Agent Financial Reasoning (`nexora-ml/finance/agents/`)
For complex or high-stakes decisions, a single LLM prompt is insufficient. NEXORA uses a **structured adversarial reasoning protocol**:

```text
  User Question / Triggered Event
                |
                v
  [1. DecisionOrchestrator] -- Scopes context & assigns specialist agents
                |
      +---------+---------+---------+
      v         v         v         v
  [Wealth]   [Tax/CA]  [Invest]  [Business]   <-- Independent parallel analysis
      \         |         |         /
       +--------+----+----+--------+
                     |
                     v
  [2. RiskManagerAgent (Adversarial Critic)]  <-- Challenges liquidity, downside,
                     |                            concentration, insurance & bias gaps
                     v
  [3. Deterministic Verification Pass]        <-- Re-runs Go/NumPy tax, XIRR, EMI,
                     |                            Monte Carlo math on proposed plan
                     v
  [4. PersonalCFOAgent + Explainability]      <-- Consolidated plan + trade-offs +
                                                  Evidence payload + Approval Gate
```

- Every agent invokes strictly typed, permission-scoped tools via `ModelGateway` (`intelligence/gateway/model_gateway.py`).
- Agents cannot invent numbers: any figure presented in the final CFO synthesis must trace back to a deterministic tool output ID in `intelligence.tool_invocations`.

### 6.4 Financial Event Intelligence (`nexora-ml/finance/radar/event_intel.py`)
Connects external macro/market events and internal life events to personal financial impact:
- **External Events**: RBI MPC rate decisions, Union Budget / GST Council changes, SEBI categorization/tax tweaks, corporate earnings surprises, promoter pledge spikes, AMC manager exits, bond rating downgrades, FX shocks.
- **Internal Life Events**: Salary increment/bonus, job change/loss, new recurring EMI, large medical outflow, upcoming goal deadline, property purchase.
- **Impact Engine**: Maps each event to Knowledge Graph nodes -> computes personal rupee exposure (`ΔNetWorth`, `ΔMonthlyEMI`, `ΔTaxLiability`, `ΔGoalProbability`) -> emits `finance.event.impacted.v1` and proactive CFO briefing.

### 6.5 What-if Decision Laboratory (`nexora-ml/finance/simulation/`)
An interactive counterfactual sandbox where users test decisions before committing:
- Clones the user's live `FinancialDigitalTwin` snapshot into an ephemeral or saved `ScenarioBranch` (`finance.simulation_runs`).
- Supports **instant deterministic recalculation** (tax, EMI, cashflow, allocation) + **vectorized 10,000-path Monte Carlo** comparing `Baseline` vs `Scenario A` vs `Scenario B` side-by-side.
- Prebuilt & custom templates: *Buy vs Rent Home*, *Prepay Home Loan vs Step-Up SIP*, *Switch Tax Regime*, *Leave Job to Start Business (12-mo runway)*, *Market Crash -35% + Job Loss 6m*, *Increase International Allocation to 20%*.

### 6.6 Financial Evidence & Confidence Engine (`nexora-ml/finance/evidence/`)
Every analytical claim and CFO recommendation carries a machine-verifiable `EvidenceBundle`:

```json
{
  "recommendation_id": "rec_8f31...",
  "confidence_score": 0.87,
  "confidence_tier": "HIGH",
  "uncertainty_bounds": { "metric": "annual_tax_saved_inr", "p10": 41200, "p50": 46800, "p90": 49100 },
  "sources": [
    { "type": "ledger_aggregate", "ref": "aa_hdfc_2026_10", "freshness_hours": 2, "sla_ok": true },
    { "type": "statutory_rule", "ref": "in_it_act_fy26_27_sec80ccd2", "version": "2026.04" }
  ],
  "deterministic_checks": [
    { "kernel": "tax_regime_solver_v2", "verified": true, "checksum": "sha256:..." }
  ],
  "assumptions": [
    "Assumes basic salary remains 50% of CTC for remaining 5 months of FY",
    "Excludes unlinked spouse joint-account transactions"
  ],
  "disclaimers": ["Analytical decision support; verify statutory filing before ITR submission."]
}
```

- **Confidence Degradation Rules**: Stale accounts (`> 7 days`), missing coverage (`Financial Coverage Intelligence`), unverified OCR extractions, or thin market history automatically cap `confidence_tier` and surface explicit data-gap prompts to the user.

---

## 7. Data Architecture & PostgreSQL Schema (`0006_finance_intelligence`)

NEXORA already defines `finance.accounts`, `finance.transactions`, `finance.categories`, `finance.budgets`, and `finance.budget_entries` in [`platform/api/migrations/0001_initial_schema.up.sql`](../../platform/api/migrations/0001_initial_schema.up.sql). The finalized schema extension in [`0006_finance_intelligence.up.sql`](../../platform/api/migrations/0006_finance_intelligence.up.sql) (with full symmetric rollback in [`0006_finance_intelligence.down.sql`](../../platform/api/migrations/0006_finance_intelligence.down.sql)) extends `finance.accounts` & `finance.transactions` and adds 41 domain tables:

| Table Group | Finalized Tables (`finance.*`) | Domains Served |
|---|---|---|
| **Accounts & Txn Extensions** | `finance.accounts` (extended with balances, APR, IFSC, masked number, `institution_enc`, `account_number_enc`, consent link, sync status, expanded account types), `finance.transactions` (extended with `txn_type`, `channel`, `source_channel`, `balance_after_txn`, `upi_vpa`, `utr_reference`, `fx_rate_to_inr`, `inr_amount`, `is_internal_transfer`, `reconciliation_group_id`, `income_stream_type`, `tax_section`, `anomaly_score`, `external_txn_id`, plus `*_enc` & `upi_vpa_blind_idx` ciphertext/blind-index columns), `finance.merchants` | Domains 1, 2, 11 |
| **Identity, Consent, Security & Ingestion** | `finance.financial_profiles`, `finance.consent_artefacts` (AA/FIP/AIS/broker/bureau consents), `finance.user_encryption_keys` (KMS & zero-knowledge DEK wrapping), `finance.ingestion_channels` (vault email aliases, Android notification/SMS, iOS shortcut webhooks, broker OAuth), `finance.digital_twin_snapshots` (JSONB state + health metrics), `finance.coverage_gaps` | Domains 1, 2, 15 |
| **Banking & Reconciliation** | `finance.balance_history` (with `source` & `is_verified` for alert/statement/replay provenance), `finance.upi_mandates`, `finance.credit_cards`, `finance.recurring_obligations`, `finance.reconciliation_links` | Domains 2, 11, 14 |
| **Assets, Holdings & Markets** | `finance.market_instruments` (NSE/BSE/AMFI/US/EU/APAC/GIFT/RBI master), `finance.market_prices_ts`, `finance.mf_holdings_constituents` (look-through ISIN weights), `finance.holdings`, `finance.tax_lots` (FIFO lots + 2018 grandfathered FMV), `finance.physical_assets` | Domains 3, 4, 5, 6, 13 |
| **Goals & Wealth Strategy** | `finance.goals`, `finance.goal_allocations`, `finance.allocation_targets` | Domains 1, 3, 12 |
| **Tax & CA** | `finance.parsed_documents` (encrypted S3/DynamoDB refs + OCR confidence), `finance.tax_profiles`, `finance.tax_deductions`, `finance.tds_entries`, `finance.tax_deadlines`, `finance.gst_ledger` | Domain 7 |
| **Debt & Insurance** | `finance.liabilities`, `finance.credit_reports`, `finance.insurance_policies` (health/term/life/motor clauses, exclusions, claim readiness JSONB, `parsed_doc_id`) | Domains 8, 9 |
| **Business & Entrepreneurial** | `finance.business_entities` (unit economics, valuation), `finance.business_metrics_ts` (monthly P&L, EBITDA, churn, DSO) | Domain 10 |
| **Risk, Behaviour & Simulation** | `finance.risk_assessments` (VaR, CVaR, HHI, liquidity, DICGC exposure, stress tests), `finance.behaviour_signals`, `finance.simulation_runs` (What-If + Monte Carlo `P10/P50/P90`) | Domains 11, 12, 14 |
| **Platform Intelligence (§17)** | `finance.evidence_bundles`, `finance.kg_nodes`, `finance.kg_edges`, `finance.market_events`, `finance.radar_alerts`, `finance.decision_journal` | Domains 13, 15, §16, §17 |

*Note*: Cross-cutting agent runs, tool logs, human approvals, and long-term consent-scoped memory reuse the existing `intelligence.agent_runs`, `intelligence.tool_invocations`, `intelligence.action_approvals`, `intelligence.context_references`, and `intelligence.memory_items` tables from [`0001_initial_schema.up.sql`](../../platform/api/migrations/0001_initial_schema.up.sql).

---

## 8. Zero-AA Real-Time Ingestion, Day-0 Bootstrap & Historic Replay

NEXORA operates in **progressive stages** so users get **real-time credits, debits, balances, live portfolios, and 1–5+ years of financial history from Day 1—without requiring an RBI Account Aggregator (AA) license**, while keeping a clean adapter seam (`BankingAggregator`) to add AA later.

### 8.1 What User Info Is Collected (Progressive Tiers) vs. Never Collected

| Tier | User Data Collected | Unlocks |
|---|---|---|
| **Tier 1 (Minimum Viable)** | Basic profile (`financial_profiles`), bank/card alert feeds or 3–6 mo PDF/CSV statements, active loans & credit card terms | Personal Net Worth, Live Cash Flow, Credits/Debits, Subscriptions, Debt Strategy, Behaviour |
| **Tier 2 (Wealth & Protection)** | 1 CAMS/KFintech/NSDL/CDSL Detailed CAS PDF (or Broker OAuth), Insurance policy PDFs, Goals & Physical assets | Equity/MF/Global Overlap, XIRR, FIFO Capital Gains, Insurance Gaps, Risk & Monte Carlo |
| **Tier 3 (Tax & Business)** | Form 16, AIS/TIS JSON, Form 26AS, GST (`GSTR-1/2B/3B`), Business unit metrics | CA Agent, Old vs New Regime, TDS Reconciliation, Advance Tax, Business Valuation |

**Hard Prohibitions (Never Asked or Stored)**: Bank netbanking passwords, ATM/UPI PINs, OTPs, full 16-digit card numbers, CVVs, or plaintext Aadhaar/PAN in logs or LLM prompts. Statement PDF open-passwords (e.g., DOB+PAN) are used once in RAM to decrypt and immediately discarded.

### 8.2 Real-Time & Historic Ingestion Flow (Zero-AA Startup Stack)

```text
  [Day-0 Bootstrap (t0 Anchor)]
   1. Android SMS local backfill / Bank Statement PDF  ──► Sets initial current_balance + past txns
   2. CAMS/KFintech Detailed CAS + eCAS + AIS JSON     ──► Sets FIFO tax_lots + holdings + TDS
   3. Backward Ledger Replay:                          ──► Reconstructs multi-year balance_history
      Balance(d-1) = Balance(d) - Credits(d) + Debits(d)   & historical net worth via market_prices_ts
                         │
                         ▼
  [Real-Time Fast Path (< 5 sec)]                     [Authoritative Truth Path (Monthly/EOD)]
   - Vault Email Auto-Forwarding (<hash>@vault...)     - Forwarded Bank e-Statement PDFs & eCAS
   - Android NotificationListenerService (on-device)   - Broker OAuth & AMFI/NSE/FX live feeds
   - iOS Shortcuts Webhook (/finance/ingest/alert)          │
                         │                                  ▼
                         └──────────► Two-Speed Reconciliation Engine ◄──────────┘
                                       - Snaps current_balance to "Avl Bal" / closing balance
                                       - Deduplicates via external_txn_id & reconciliation_links
                                       - Flags internal self-transfers (is_internal_transfer)
                                       - Steps down loan principal on matched EMI debits
                                       - Emits finance.twin.updated.v1 -> Live Digital Twin
```

### 8.3 External Provider Adapters (`platform/api/internal/modules/finance/aggregation/`)

Following NEXORA's provider-adapter principle (no vendor lock-in), all external integrations sit behind Go interfaces:

| Category | Interface | Day-1 Zero-AA Adapters | Production / Post-PMF Adapters |
|---|---|---|---|
| **Banking & UPI** | `BankingAggregator` | Vault Email Forwarding (`email_forward`), Android `NotificationListener` / local SMS, iOS Shortcuts Webhook, Encrypted PDF/CSV parser | Sahamati Account Aggregator FIU via licensed TSP (Setu / Finvu / OneMoney) |
| **Indian Equities & MF** | `SecuritiesDataProvider` | CAMS/KFintech Detailed CAS, CDSL/NSDL eCAS, Broker OAuth (Kite, Dhan, Upstox, Angel One), AMFI `NAVAll.txt` | Direct RTA / MFCentral APIs + NSE/BSE WebSocket feeds |
| **Global Markets & FX** | `GlobalMarketProvider` | US/EU/APAC equities & UCITS ETF feeds, RBI reference rate & ECB/FX spot feeds, Macro series (RBI/FRED) | Foreign broker OAuth / CSV statement sync |
| **Tax & Compliance** | `TaxDocumentProvider` | User-exported Income Tax AIS/TIS JSON, Form 26AS, Form 16 PDF, EPFO Passbook, NPS CRA PDF | Consented GSTN / Tax portal adapters |
| **Credit & Insurance** | `BureauAndPolicyProvider` | Uploaded CIBIL/Experian report PDF & Insurance Policy wording OCR (`nexora-ml/nlp`) | Consented bureau & IRDAI eIA pulls |

---

## 9. Service, API & Event Contracts

### 9.1 Go Control Plane Public Endpoints (`/api/v1/finance/*`)
Mounted in [`platform/api/internal/http/routes.go`](../../platform/api/internal/http/routes.go) via `finance.Mount(v1, finSvc)`:

| Domain Group | Representative Endpoints |
|---|---|
| **Profile, Twin & Coverage** | `GET /finance/digital-twin`, `GET /finance/health-score`, `GET /finance/coverage-gaps`, `GET/PUT /finance/profile` |
| **Accounts, Txns & UPI** | `GET/POST /finance/accounts`, `POST /finance/consents/aa`, `GET/POST /finance/transactions`, `POST /finance/transactions/reconcile`, `GET /finance/subscriptions`, `GET /finance/fees/audit` |
| **Wealth & Goals** | `GET/POST /finance/goals`, `GET /finance/wealth/allocation`, `POST /finance/wealth/rebalance-plan`, `GET /finance/wealth/fi-timeline` |
| **Equities, MF & Global** | `POST /finance/equities/screen`, `GET /finance/equities/{symbol}/research`, `GET /finance/mf/overlap`, `POST /finance/mf/compare`, `GET /finance/global/exposure`, `GET /finance/global/lrs-status` |
| **Tax & CA** | `POST /finance/tax/estimate`, `GET /finance/tax/regime-compare`, `GET /finance/tax/capital-gains`, `GET /finance/tax/harvest-candidates`, `POST /finance/tax/documents/parse`, `GET /finance/tax/calendar` |
| **Loans & Insurance** | `GET/POST /finance/loans`, `POST /finance/loans/optimize`, `POST /finance/loans/prepay-vs-invest`, `GET/POST /finance/insurance/policies`, `GET /finance/insurance/gaps`, `GET /finance/insurance/claim-readiness` |
| **Business & Unit Econ** | `GET/POST /finance/business/entities`, `POST /finance/business/unit-economics`, `POST /finance/business/breakeven`, `POST /finance/business/valuation` |
| **Risk, Predictive & Lab** | `GET /finance/risk/summary`, `POST /finance/risk/stress-test`, `POST /finance/simulate/what-if`, `POST /finance/simulate/monte-carlo`, `GET /finance/behaviour/insights` |
| **Radar, Graph & AI CFO** | `GET /finance/radar/opportunities`, `GET /finance/graph/impact`, `POST /finance/cfo/query`, `GET /finance/cfo/proactive-brief`, `POST /finance/approvals/{id}/decide` |

### 9.2 Internal Python ML & Quant Endpoints (`http://ml:8000/v1/finance/*`)
- `POST /v1/finance/nlp/classify-transactions` & `POST /v1/finance/nlp/parse-document`
- `POST /v1/finance/markets/equity-score`, `POST /v1/finance/markets/regime`, `POST /v1/finance/markets/mf-overlap`
- `POST /v1/finance/risk/portfolio`, `POST /v1/finance/risk/anomaly`, `POST /v1/finance/risk/stress-test`
- `POST /v1/finance/simulate/monte-carlo`, `POST /v1/finance/simulate/what-if`
- `POST /v1/finance/behaviour/analyze`, `POST /v1/finance/graph/propagate`
- `POST /v1/finance/radar/scan`, `POST /v1/finance/cfo/reason` (Multi-Agent + Evidence Bundle)

### 9.3 Versioned Event Contracts & Low-Latency Event-Driven Runtime

Extending [`contracts/events/envelope.schema.json`](../../contracts/events/envelope.schema.json) (`^[a-z]+\.[a-z_]+\.v[0-9]+$`):
- `finance.transaction.ingested.v1` — triggers categorization, UPI/merchant enrichment, anomaly check, subscription detection, and twin update.
- `finance.holding.synced.v1` — triggers overlap recomputation, FIFO tax-lot update, concentration & currency risk check.
- `finance.market.event.v1` — triggers Knowledge Graph impact propagation and Continuous Opportunity Radar.
- `finance.twin.updated.v1` — triggers health score refresh, Redis cache invalidation, SSE UI push, and cross-domain goal/FI recalculation.
- `finance.opportunity.detected.v1` & `finance.risk.alert.v1` — triggers notification delivery after hysteresis deduplication.
- `finance.approval.requested.v1` — triggers UI approval card for `high_impact` / `external_write` actions.

#### Sub-50ms API & Real-Time Event Execution Checklist
To keep `nexora-api` fast under `pgxpool` free-tier limits (`MaxConns = 5` in [`postgres.go`](../../platform/api/internal/platform/database/postgres.go)) and eliminate polling lag:
1. **Thin Write Path (`202 Accepted` in < 15ms)**: Ingestion endpoints (`/finance/ingest/alert`, `/finance/documents/parse`) validate, persist raw records + `EnqueueOutbox()` in one SQL transaction, and return `202` immediately. Heavy OCR, merchant resolution, anomaly scoring, Knowledge Graph propagation, and Digital Twin recomputation execute asynchronously in `nexora-ml` / workers.
2. **Precomputed Reads (`< 5ms`) + Covering Indexes**: Read endpoints (`/finance/digital-twin`, `/finance/radar/opportunities`) serve precomputed snapshots from Redis ([`redis.go`](../../platform/api/internal/platform/cache/redis.go)) and index-only Postgres scans (`idx_txn_user_rollup` on `finance.transactions`), never running Monte Carlo or overlap matrices synchronously on `GET`.
3. **Instant Outbox Wakeup ([`outbox.go`](../../platform/api/internal/platform/events/outbox.go))**: Trigger an immediate `OutboxRelay.Notify()` channel (or Postgres `LISTEN/NOTIFY`) on commit instead of waiting for the 5s fallback ticker, and drain with `FOR UPDATE SKIP LOCKED` across replicas.
4. **Isolated `finance.*` Worker Queue**: Route `finance.*` events to a dedicated Finance consumer in `nexora-ml` (in AWS prod, a dedicated SQS queue subscribed to SNS with `MessageAttributes.event_type` prefix filter `"finance."`; in local dev, direct `ML_SERVICE_URL/v1/events/ingest` or Redpanda `KAFKA_BROKERS`).
5. **Live Client Push (`GET /api/v1/finance/stream`)**: Publish `finance.twin.updated.v1` and `finance.risk.alert.v1` onto Redis Pub/Sub to push instant updates to the mobile/web UI via SSE/WebSocket.

---

## 10. Anti-Spy Encryption, Privacy & Regulatory Compliance

NEXORA Finance implements a **4-Layer Anti-Spy Architecture** so sensitive financial records remain unreadable to network eavesdroppers, database leaks, curious cloud/DB insiders, and external LLM providers:

1. **Layer 1 — Network & Ingestion Isolation**: TLS 1.3 + certificate pinning on mobile clients; Vault Email ingestion parses strictly filtered bank/card alerts in memory and discards raw emails immediately; Android `NotificationListenerService` filters non-bank notifications locally on-device.
2. **Layer 2 — Per-User Envelope Encryption & Blind Indexing (`finance.user_encryption_keys`)**:
   - Each user has an `AES-256-GCM` Data Encryption Key (DEK) wrapped either via AWS KMS (`kms_envelope` mode) or a device passkey/PIN via Argon2id (`zero_knowledge` mode, unreadable even to DB admins).
   - Sensitive columns (`accounts.institution_enc`, `accounts.account_number_enc`, `transactions.description_enc`, `transactions.upi_vpa_enc`, `transactions.counterparty_enc`, `insurance_policies.policy_number_encrypted`) store ciphertext `BYTEA`; exact deduplication/matching uses keyed HMAC-SHA256 blind indexes (`upi_vpa_blind_idx`, `vault_alias_hash`, `webhook_token_hash`).
   - Raw PDFs (Form 16, CAS, Statements, Policies) are stored envelope-encrypted in S3/MinIO via `storage_ref`.
3. **Layer 3 — AI / LLM Privacy Firewall (`ModelGateway`)**: Before any context reaches an external LLM via [`ModelGateway`](../../intelligence/gateway/model_gateway.py), names, PANs, UPI VPAs, and account numbers are pseudonymized (`Bank_A`, `Counterparty_12`) and deterministic math runs locally in Go/Python—never inside an LLM.
4. **Layer 4 — Device Security & Consent Governance**: Biometric lock (`expo-local-authentication`), Keychain/Keystore secret storage (`expo-secure-store`), screen-capture masking (`FLAG_SECURE`), purpose-limited `consent_artefacts` with instant revocation, immutable `audit.*` trails, and `intelligence.action_approvals` gates for every high-impact action.

---

## 11. Phased Implementation Roadmap (M4–M6)

Aligned with [`README.md`](../../README.md) (*Health / Finance / Work ready for M4–M6*):

| Phase | Scope | Domains & Platform Capabilities Delivered |
|---|---|---|
| **M4: Core Ledger, Digital Twin & Deterministic Foundations** | `0006_finance_intelligence.up.sql`, Go `finance` module mount, Mobile Finance Hub (`apps/mobile/src/features/finance/`) | Domains 1 (Personal), 2 (Banking/UPI/Subscriptions/Reconciliation), 7 (Core Income Tax + Regime Compare + Capital Gains FIFO), 8 (Loan/EMI/Prepay), 9 (Insurance Gap & Vault), Evidence Engine v1 |
| **M5: Markets, Risk, Simulation & Knowledge Graph** | Python `nexora-ml/finance/` quant & simulation services, Redpanda event streams, `pgvector` filing RAG | Domains 3 (Wealth), 4 (NSE/BSE), 5 (MF/ETF Overlap & Rolling Returns), 6 (Global + FX + LRS), 11 (Risk + Anomaly + Stress Tests), 12 (Monte Carlo + What-If Lab), 13 (Scanners), Financial Knowledge Graph & Event Intelligence |
| **M6: Autonomous AI CFO, Behaviour & Business Intelligence** | Multi-agent adversarial orchestrator, Continuous Opportunity Radar, cross-module `Move`/`Health`/`Work` hooks | Domains 10 (Business & Unit Economics), 14 (Behaviour & Biases), 15 (AI CFO + 7 Specialists + Action Planner), Full §16 Cross-Engine DAGs & Continuous Opportunity Radar |

---

## 12. Verification & Quality Gates

Before any Finance milestone ships, it must pass NEXORA's deterministic verification standards:
1. **Accounting & Tax Golden Vectors (Go)**: Zero-tolerance unit tests (`go test ./internal/modules/finance/...`) verifying double-entry balance invariants, FIFO capital gains, Old vs New tax slab edge cases, and EMI amortization to the exact paisa.
2. **Quant & Simulation Stability Tests (Python)**: Deterministic seeded tests (`python3 -m unittest`) verifying Monte Carlo convergence, portfolio VaR/HHI math, MF overlap set intersections, Knowledge Graph hop propagation, and `DeterministicBaseline` fallbacks.
3. **Contract & Security Tests**: OpenAPI schema validation (`contracts/openapi/nexora-v1.yaml`), event envelope validation (`envelope.schema.json`), PII-leakage assertions ensuring zero raw credentials appear in `intelligence.messages` or `tool_invocations`.
4. **Mobile Typecheck & Bundle (`apps/mobile`)**: `npm --prefix apps/mobile run typecheck` and `export:web` clean builds.
