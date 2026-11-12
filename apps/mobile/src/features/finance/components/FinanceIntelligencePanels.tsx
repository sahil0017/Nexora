import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fontFamily, moduleColors, radii, spacing, typography } from '../../../app/theme/tokens';
import {
  DebtBusinessOptimizeResponse,
  FinanceBudget,
  FinanceGoal,
  FinanceHolding,
  FinanceLiability,
  GraphPropagateResponse,
  MarketAnalysisResponse,
  financeApi,
} from '../../../core/api/finance';
import {
  Card,
  Input,
  PrimaryButton,
  SectionHeading,
} from '../../../core/design-system/components';
import { Chip, FadeIn, StatusPill } from '../../../core/design-system/motion';

export function formatINR(value: number | undefined | null, masked = false): string {
  if (masked) {
    return '₹••,•••';
  }
  if (value === undefined || value === null || Number.isNaN(value)) {
    return '₹0';
  }
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1e7) {
    return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`;
  }
  if (abs >= 1e5) {
    return `${sign}₹${(abs / 1e5).toFixed(2)} L`;
  }
  return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`;
}

export function healthTone(score: number): 'success' | 'warning' | 'danger' {
  if (score >= 75) return 'success';
  if (score >= 50) return 'warning';
  return 'danger';
}

export function FinanceHeaderActions({
  privacyMasked,
  onToggleMask,
  healthScore,
}: {
  privacyMasked: boolean;
  onToggleMask: () => void;
  healthScore?: number;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
      <Chip
        label={privacyMasked ? '🔒 Masked' : '👁 Live'}
        active={privacyMasked}
        color={moduleColors.finance}
        onPress={onToggleMask}
      />
      {typeof healthScore === 'number' ? (
        <StatusPill label={`Health ${healthScore}`} tone={healthTone(healthScore)} />
      ) : null}
    </View>
  );
}

export function MetricTile({
  label,
  value,
  accent = colors.textPrimary,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bgElevated,
        borderRadius: radii.button,
        paddingVertical: 10,
        paddingHorizontal: 12,
        minHeight: 62,
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: colors.borderSubtle,
      }}>
      <Text style={styles.labelMuted} numberOfLines={1}>{label.toUpperCase()}</Text>
      <Text style={{ color: accent, fontFamily: fontFamily.sans, fontSize: 15, fontWeight: '700', marginTop: 3 }} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

export function GoalsAndPortfolioSection({
  goals,
  holdings,
  liabilities,
  privacyMasked = false,
  onChanged,
  onError,
}: {
  goals: FinanceGoal[];
  holdings: FinanceHolding[];
  liabilities: FinanceLiability[];
  privacyMasked?: boolean;
  onChanged: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [goalName, setGoalName] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalSip, setGoalSip] = useState('');
  const [savingGoal, setSavingGoal] = useState(false);

  const handleCreateGoal = async () => {
    const targetNum = Number(goalTarget);
    const sipNum = Number(goalSip) || 0;
    if (!goalName.trim() || !Number.isFinite(targetNum) || targetNum <= 0) {
      onError('Enter a valid goal name and positive target amount.');
      return;
    }
    setSavingGoal(true);
    try {
      await financeApi.createGoal({
        name: goalName.trim(),
        goal_type: 'wealth',
        target_amount_today: targetNum,
        monthly_sip_inr: Math.max(0, sipNum),
      });
      setGoalName('');
      setGoalTarget('');
      setGoalSip('');
      setShowGoalForm(false);
      await onChanged();
    } catch (err: any) {
      onError(err?.message ?? 'Could not create goal');
    } finally {
      setSavingGoal(false);
    }
  };

  return (
    <>
      <FadeIn index={3}>
        <SectionHeading
          title={`Wealth Goals (${goals.length})`}
          action={showGoalForm ? 'Close' : '+ New Goal'}
          onActionPress={() => setShowGoalForm(v => !v)}
        />
        {showGoalForm ? (
          <Card style={{ gap: spacing.s, marginBottom: spacing.s }}>
            <Input value={goalName} onChangeText={setGoalName} placeholder="Goal name" />
            <View style={styles.splitRow}>
              <View style={{ flex: 1 }}>
                <Input
                  value={goalTarget}
                  onChangeText={setGoalTarget}
                  placeholder="Target ₹"
                  keyboardType="numeric"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Input
                  value={goalSip}
                  onChangeText={setGoalSip}
                  placeholder="Monthly SIP ₹"
                  keyboardType="numeric"
                />
              </View>
            </View>
            <PrimaryButton title="Save Goal" onPress={handleCreateGoal} loading={savingGoal} />
          </Card>
        ) : null}

        <View style={{ gap: spacing.s }}>
          {goals.map(g => (
            <Card key={g.id} style={{ gap: 6 }}>
              <View style={styles.rowBetween}>
                <Text style={styles.cardTitle}>{g.name}</Text>
                <StatusPill
                  label={
                    typeof g.probability_of_success === 'number'
                      ? `${Math.round(g.probability_of_success * 100)}% prob`
                      : 'Tracking'
                  }
                  tone={g.status === 'achieved' ? 'success' : 'info'}
                />
              </View>
              <Text style={styles.subBody}>
                Funded {formatINR(g.current_funded_inr, privacyMasked)} /{' '}
                {formatINR(g.target_amount_today, privacyMasked)} · SIP{' '}
                {formatINR(g.monthly_sip_inr, privacyMasked)}/mo
              </Text>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${Math.min(
                        100,
                        Math.max(
                          6,
                          Math.round(
                            ((g.current_funded_inr || 0) / Math.max(1, g.target_amount_today || 1)) * 100,
                          ),
                        ),
                      )}%`,
                    },
                  ]}
                />
              </View>
            </Card>
          ))}
        </View>
      </FadeIn>

      <FadeIn index={4}>
        <SectionHeading title={`Investments (${holdings.length}) & Loans (${liabilities.length})`} />
        <Card style={{ gap: spacing.xs }}>
          {holdings.length === 0 && liabilities.length === 0 ? (
            <Text style={styles.subBody}>No investments or active loans recorded yet.</Text>
          ) : null}
          {holdings.map((h, idx) => {
            const isLast = idx === holdings.length - 1 && liabilities.length === 0;
            return (
              <View key={h.id} style={[styles.lineRow, isLast && styles.lineRowLast]}>
                <View style={{ flex: 1, paddingRight: spacing.s }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{h.name}</Text>
                  <Text style={styles.labelMuted}>
                    {h.symbol} · {h.plan_type.toUpperCase()} · XIRR {h.xirr_pct.toFixed(1)}%
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: moduleColors.finance, fontFamily: fontFamily.sans, fontWeight: '700', fontSize: 13.5 }}>
                    {formatINR(h.current_value_inr, privacyMasked)}
                  </Text>
                  <Text style={{ color: colors.accentBright, fontFamily: fontFamily.medium, fontSize: 11, fontWeight: '600' }}>
                    +{formatINR(h.unrealized_pnl_inr, privacyMasked)}
                  </Text>
                </View>
              </View>
            );
          })}
          {liabilities.map((l, idx) => {
            const isLast = idx === liabilities.length - 1;
            return (
              <View key={l.id} style={[styles.lineRow, isLast && styles.lineRowLast]}>
                <View style={{ flex: 1, paddingRight: spacing.s }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{l.lender_name}</Text>
                  <Text style={styles.labelMuted}>
                    {l.loan_type.toUpperCase()} · {(l.interest_rate_apr * 100).toFixed(2)}% APR ·{' '}
                    {l.remaining_months}m left
                  </Text>
                </View>
                <Text style={{ color: colors.statusWarning, fontFamily: fontFamily.sans, fontWeight: '700', fontSize: 13.5 }}>
                  -{formatINR(l.principal_outstanding, privacyMasked)}
                </Text>
              </View>
            );
          })}
        </Card>
      </FadeIn>
    </>
  );
}

export function AccountAndManualTxnSection({
  budgets,
  privacyMasked = false,
  onChanged,
  onError,
}: {
  budgets: FinanceBudget[];
  privacyMasked?: boolean;
  onChanged: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [acctName, setAcctName] = useState('');
  const [acctBalance, setAcctBalance] = useState('');
  const [acctType, setAcctType] = useState<'bank' | 'demat' | 'credit_card'>('bank');
  const [creatingAcct, setCreatingAcct] = useState(false);

  const [merchant, setMerchant] = useState('');
  const [amount, setAmount] = useState('');
  const [txnType, setTxnType] = useState<'debit' | 'credit'>('debit');
  const [savingTxn, setSavingTxn] = useState(false);

  const handleAddAccount = async () => {
    const bal = Number(acctBalance);
    if (!acctName.trim() || !Number.isFinite(bal)) {
      onError('Enter an account name and valid numeric balance.');
      return;
    }
    setCreatingAcct(true);
    try {
      await financeApi.createAccount({
        name: acctName.trim(),
        account_type: acctType,
        institution: acctName.trim().split(' ')[0],
        current_balance: bal,
      });
      setAcctName('');
      setAcctBalance('');
      await onChanged();
    } catch (err: any) {
      onError(err?.message ?? 'Account creation failed');
    } finally {
      setCreatingAcct(false);
    }
  };

  const handleManualTxn = async () => {
    const amtNum = Number(amount);
    if (!merchant.trim() || !Number.isFinite(amtNum) || amtNum <= 0) {
      onError('Enter a valid merchant and positive amount.');
      return;
    }
    setSavingTxn(true);
    try {
      const signed = txnType === 'debit' ? -Math.abs(amtNum) : Math.abs(amtNum);
      await financeApi.createTransaction({
        merchant: merchant.trim(),
        amount: signed,
        txn_type: txnType,
        channel: 'manual',
      });
      setMerchant('');
      setAmount('');
      await onChanged();
    } catch (err: any) {
      onError(err?.message ?? 'Failed to record manual transaction');
    } finally {
      setSavingTxn(false);
    }
  };

  return (
    <>
      <FadeIn index={3}>
        <SectionHeading title="Add Account & Manual Entry" />
        <Card style={{ gap: spacing.s }}>
          <Text style={styles.labelMuted}>NEW ACCOUNT</Text>
          <View style={styles.chipRow}>
            {(['bank', 'demat', 'credit_card'] as const).map(t => (
              <Chip
                key={t}
                label={t.replace('_', ' ')}
                active={acctType === t}
                onPress={() => setAcctType(t)}
              />
            ))}
          </View>
          <View style={styles.splitRow}>
            <View style={{ flex: 1.3 }}>
              <Input value={acctName} onChangeText={setAcctName} placeholder="Account name" />
            </View>
            <View style={{ flex: 1 }}>
              <Input
                value={acctBalance}
                onChangeText={setAcctBalance}
                placeholder="Balance ₹"
                keyboardType="numeric"
              />
            </View>
          </View>
          <PrimaryButton
            title="Connect / Add Account"
            variant="secondary"
            onPress={handleAddAccount}
            loading={creatingAcct}
          />

          <View style={styles.divider} />

          <Text style={styles.labelMuted}>LOG MANUAL TRANSACTION</Text>
          <View style={styles.chipRow}>
            {(['debit', 'credit'] as const).map(t => (
              <Chip
                key={t}
                label={t.toUpperCase()}
                active={txnType === t}
                color={t === 'credit' ? colors.accentBright : colors.statusWarning}
                onPress={() => setTxnType(t)}
              />
            ))}
          </View>
          <View style={styles.splitRow}>
            <View style={{ flex: 1.3 }}>
              <Input value={merchant} onChangeText={setMerchant} placeholder="Merchant" />
            </View>
            <View style={{ flex: 1 }}>
              <Input value={amount} onChangeText={setAmount} placeholder="Amount ₹" keyboardType="numeric" />
            </View>
          </View>
          <PrimaryButton title="Record Transaction" onPress={handleManualTxn} loading={savingTxn} />
        </Card>
      </FadeIn>

      {budgets.length > 0 ? (
        <FadeIn index={4}>
          <SectionHeading title={`Active Budgets (${budgets.length})`} />
          <Card style={{ gap: spacing.s }}>
            {budgets.map(b => (
              <View key={b.id} style={styles.lineRow}>
                <View>
                  <Text style={styles.rowTitle}>{b.name}</Text>
                  <Text style={styles.labelMuted}>{b.period.toUpperCase()} BUDGET</Text>
                </View>
                <Text style={{ color: moduleColors.finance, fontWeight: '800', fontSize: 15 }}>
                  {formatINR(b.amount, privacyMasked)}
                </Text>
              </View>
            ))}
          </Card>
        </FadeIn>
      ) : null}
    </>
  );
}

export function MarketsDebtGraphSection({
  privacyMasked = false,
  onError,
}: {
  privacyMasked?: boolean;
  onError: (msg: string) => void;
}) {
  const [marketsLoading, setMarketsLoading] = useState(false);
  const [marketsRes, setMarketsRes] = useState<MarketAnalysisResponse | null>(null);

  const [debtLoading, setDebtLoading] = useState(false);
  const [debtRes, setDebtRes] = useState<DebtBusinessOptimizeResponse | null>(null);

  const [shockEvent, setShockEvent] = useState<'rbi_policy' | 'fx_shock' | 'budget_tax'>('rbi_policy');
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphRes, setGraphRes] = useState<GraphPropagateResponse | null>(null);

  const runMarkets = async () => {
    setMarketsLoading(true);
    try {
      setMarketsRes(await financeApi.analyzeMarkets({}));
    } catch (err: any) {
      onError(err?.message ?? 'Markets analysis failed');
    } finally {
      setMarketsLoading(false);
    }
  };

  const runDebtBusiness = async () => {
    setDebtLoading(true);
    try {
      setDebtRes(await financeApi.optimizeDebtBusiness({}));
    } catch (err: any) {
      onError(err?.message ?? 'Debt & Business optimizer failed');
    } finally {
      setDebtLoading(false);
    }
  };

  const runGraphShock = async () => {
    setGraphLoading(true);
    try {
      setGraphRes(await financeApi.propagateGraph({ event_type: shockEvent, magnitude_bps: 50 }));
    } catch (err: any) {
      onError(err?.message ?? 'Knowledge graph propagation failed');
    } finally {
      setGraphLoading(false);
    }
  };

  return (
    <FadeIn index={2}>
      <SectionHeading title="Portfolio & Debt Insights" />
      <Card style={{ gap: spacing.m }}>
        <View style={styles.splitRow}>
          <View style={{ flex: 1 }}>
            <PrimaryButton
              title="Mutual Fund Check"
              variant="secondary"
              onPress={runMarkets}
              loading={marketsLoading}
            />
          </View>
          <View style={{ flex: 1 }}>
            <PrimaryButton
              title="Loan vs SIP"
              variant="secondary"
              onPress={runDebtBusiness}
              loading={debtLoading}
            />
          </View>
        </View>

        {marketsRes ? (
          <View style={styles.resultBox}>
            <Text style={styles.rowTitle}>
              Market Outlook: {(marketsRes.market_regime ?? 'unclassified').toUpperCase()}
            </Text>
            <Text style={styles.subBody}>
              Regular-Plan Commission Drag:{' '}
              {formatINR(marketsRes.portfolio_overlap?.regular_plan_annual_commission_drag_inr, privacyMasked)}/yr
            </Text>
          </View>
        ) : null}

        {debtRes ? (
          <View style={styles.resultBox}>
            <Text style={styles.rowTitle}>
              Strategy: {(debtRes.debt_strategy?.prepay_vs_sip_recommendation ?? 'NO_ACTIVE_DEBT').replace(/_/g, ' ')}
            </Text>
            <Text style={styles.subBody}>
              Cashflow Verdict: {(debtRes.business_intelligence?.unit_economics_verdict ?? 'BALANCED').replace(/_/g, ' ')}
            </Text>
          </View>
        ) : null}

        <View style={styles.divider} />

        <Text style={styles.labelMuted}>MARKET SCENARIO STRESS TEST</Text>
        <View style={styles.chipRow}>
          {(['rbi_policy', 'fx_shock', 'budget_tax'] as const).map(ev => (
            <Chip
              key={ev}
              label={ev === 'rbi_policy' ? 'RBI Rate Shift' : ev === 'fx_shock' ? 'FX Volatility' : 'Tax Policy Change'}
              active={shockEvent === ev}
              color={moduleColors.finance}
              onPress={() => setShockEvent(ev)}
            />
          ))}
        </View>
        <PrimaryButton title="Run Stress Test" onPress={runGraphShock} loading={graphLoading} />

        {graphRes ? (
          <View style={styles.resultBox}>
            <Text style={styles.rowTitle}>
              Estimated Annual Impact: {formatINR(graphRes.net_annual_impact_inr, privacyMasked)}
            </Text>
            {graphRes.recommended_mitigation ? (
              <Text style={styles.subBody}>{graphRes.recommended_mitigation}</Text>
            ) : null}
          </View>
        ) : null}
      </Card>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.s },
  splitRow: { flexDirection: 'row', gap: spacing.s },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  divider: { height: 1, backgroundColor: colors.borderSubtle, marginVertical: spacing.xs },
  labelMuted: { ...typography.label, color: colors.textMuted },
  subBody: { fontFamily: fontFamily.sans, fontSize: 12.5, lineHeight: 18, color: colors.textSecondary },
  cardTitle: { fontFamily: fontFamily.medium, fontSize: 13.5, fontWeight: '600', color: colors.textPrimary, flex: 1 },
  rowTitle: { fontFamily: fontFamily.medium, fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  progressTrack: {
    height: 6,
    backgroundColor: colors.bgElevated,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: moduleColors.finance,
    borderRadius: 4,
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  lineRowLast: {
    borderBottomWidth: 0,
    paddingBottom: 2,
  },
  resultBox: {
    backgroundColor: colors.bgElevated,
    borderRadius: radii.button,
    padding: spacing.m,
    gap: 4,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
});
