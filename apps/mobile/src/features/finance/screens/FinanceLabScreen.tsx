import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, moduleColors, radii, spacing, typography } from '../../../app/theme/tokens';
import {
  TaxEvaluateResponse,
  WhatIfSimulationResponse,
  financeApi,
} from '../../../core/api/finance';
import { Card, Input, PrimaryButton, SectionHeading } from '../../../core/design-system/components';
import { Chip, FadeIn, StatusPill } from '../../../core/design-system/motion';
import { Screen } from '../../../shared/components/Screen';
import {
  FinanceHeaderActions,
  MarketsDebtGraphSection,
  formatINR,
} from '../components/FinanceIntelligencePanels';
import { useFinanceData } from '../FinanceContext';

export default function FinanceLabScreen() {
  const { twin, goals, privacyMasked, togglePrivacyMask, errorMsg, setErrorMsg } = useFinanceData();

  const liveAnnualIncome = twin && twin.month_credited_inr > 0 ? Math.round(twin.month_credited_inr * 12) : 0;
  const liveMonthlySip = goals.reduce((acc, g) => acc + (g.monthly_sip_inr || 0), 0);

  const [grossSalary, setGrossSalary] = useState(liveAnnualIncome > 0 ? String(liveAnnualIncome) : '');
  const [sec80c, setSec80c] = useState('');
  const [sec80d, setSec80d] = useState('');
  const [taxLoading, setTaxLoading] = useState(false);
  const [taxResult, setTaxResult] = useState<TaxEvaluateResponse | null>(null);

  const [monthlySip, setMonthlySip] = useState(liveMonthlySip > 0 ? String(Math.round(liveMonthlySip)) : '');
  const [extraSipDelta, setExtraSipDelta] = useState('');
  const [horizonYears, setHorizonYears] = useState('');
  const [simLoading, setSimLoading] = useState(false);
  const [simResult, setSimResult] = useState<WhatIfSimulationResponse | null>(null);

  const handleEvaluateTax = async () => {
    const salNum = Number(grossSalary);
    if (!Number.isFinite(salNum) || salNum <= 0) {
      setErrorMsg('Enter your real gross annual salary in INR to compare tax regimes.');
      return;
    }
    setErrorMsg(null);
    setTaxLoading(true);
    try {
      const res = await financeApi.evaluateTax({
        gross_salary_inr: salNum,
        sec_80c_inr: Math.max(0, Number(sec80c) || 0),
        sec_80d_inr: Math.max(0, Number(sec80d) || 0),
      });
      setTaxResult(res);
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'Tax evaluation failed');
    } finally {
      setTaxLoading(false);
    }
  };

  const handleSimulateWhatIf = async () => {
    const baseSipNum = Number(monthlySip) || 0;
    const extraNum = Number(extraSipDelta) || 0;
    const horizonNum = Number(horizonYears);
    if (!Number.isFinite(horizonNum) || horizonNum < 1) {
      setErrorMsg('Enter a valid investment horizon in years (at least 1).');
      return;
    }
    if (baseSipNum <= 0 && extraNum <= 0 && (twin?.total_assets_inr ?? 0) <= 0) {
      setErrorMsg('Enter your monthly SIP / step-up or link assets first to run simulation.');
      return;
    }
    setErrorMsg(null);
    setSimLoading(true);
    try {
      const res = await financeApi.simulateWhatIf({
        initial_net_worth_inr: Math.max(0, twin?.total_assets_inr ?? 0),
        monthly_sip_inr: Math.max(0, baseSipNum),
        extra_sip_delta_inr: Math.max(0, extraNum),
        horizon_years: Math.round(horizonNum),
      });
      setSimResult(res);
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'Simulation failed');
    } finally {
      setSimLoading(false);
    }
  };

  return (
    <Screen
      title="Tax & Decision Lab"
      subtitle="Indian Income Tax · Monte Carlo · Macro Graph"
      badge="QUANT LAB"
      rightAction={
        <FinanceHeaderActions
          privacyMasked={privacyMasked}
          onToggleMask={togglePrivacyMask}
          healthScore={twin?.health_score}
        />
      }>
      {errorMsg ? (
        <Card style={{ borderColor: colors.statusDanger }}>
          <Text style={{ color: colors.statusDanger, fontSize: 12.5, fontWeight: '600' }}>{errorMsg}</Text>
        </Card>
      ) : null}

      <View style={styles.stack}>
        <FadeIn index={0}>
          <SectionHeading
            title="Deterministic Indian Tax Comparator"
            action={liveAnnualIncome > 0 ? 'Use Live Income' : undefined}
            onActionPress={
              liveAnnualIncome > 0 ? () => setGrossSalary(String(liveAnnualIncome)) : undefined
            }
          />
          <Card style={{ gap: spacing.m }}>
            <Text style={styles.labelMuted}>GROSS ANNUAL SALARY (INR)</Text>
            <Input
              value={grossSalary}
              onChangeText={setGrossSalary}
              placeholder={liveAnnualIncome > 0 ? String(liveAnnualIncome) : 'Enter gross annual salary ₹'}
              keyboardType="numeric"
            />

            <View style={styles.pairRow}>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={styles.labelMuted}>SEC 80C (INR)</Text>
                <Input value={sec80c} onChangeText={setSec80c} placeholder="Optional 80C ₹" keyboardType="numeric" />
              </View>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={styles.labelMuted}>SEC 80D (INR)</Text>
                <Input value={sec80d} onChangeText={setSec80d} placeholder="Optional 80D ₹" keyboardType="numeric" />
              </View>
            </View>

            <PrimaryButton
              title="Evaluate Old vs New Regime"
              onPress={() => void handleEvaluateTax()}
              loading={taxLoading}
            />

            {taxResult ? (
              <View style={styles.resultBox}>
                <View style={styles.rowBetween}>
                  <Text style={styles.cardTitle}>
                    Recommended: {taxResult.recommended_regime.toUpperCase()}
                  </Text>
                  <StatusPill
                    label={`Save ${formatINR(taxResult.regime_annual_savings_inr, privacyMasked)}/yr`}
                    tone="success"
                  />
                </View>
                <Text style={styles.subBody}>
                  New: {formatINR(taxResult.estimated_tax_new_inr, privacyMasked)} · Old:{' '}
                  {formatINR(taxResult.estimated_tax_old_inr, privacyMasked)}
                </Text>
                <View style={styles.splitBarTrack}>
                  <View
                    style={[
                      styles.splitBarSegment,
                      { flex: Math.max(0.1, taxResult.estimated_tax_new_inr || 1), backgroundColor: moduleColors.finance },
                    ]}
                  />
                  <View
                    style={[
                      styles.splitBarSegment,
                      { flex: Math.max(0.1, taxResult.estimated_tax_old_inr || 1), backgroundColor: colors.statusWarning },
                    ]}
                  />
                </View>
              </View>
            ) : null}
          </Card>
        </FadeIn>

        <FadeIn index={1}>
          <SectionHeading
            title="Monte Carlo What-If Lab"
            action={liveMonthlySip > 0 ? 'Use Active Goal SIP' : undefined}
            onActionPress={
              liveMonthlySip > 0 ? () => setMonthlySip(String(Math.round(liveMonthlySip))) : undefined
            }
          />
          <Card style={{ gap: spacing.m }}>
            <Text style={styles.subBody}>
              Simulates 500 stochastic return paths seeded from your real net assets ({formatINR(Math.max(0, twin?.total_assets_inr ?? 0), privacyMasked)}).
            </Text>

            <View style={styles.pairRow}>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={styles.labelMuted}>BASE SIP / MO</Text>
                <Input
                  value={monthlySip}
                  onChangeText={setMonthlySip}
                  placeholder="Monthly SIP ₹"
                  keyboardType="numeric"
                />
              </View>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={styles.labelMuted}>+EXTRA SIP / MO</Text>
                <Input
                  value={extraSipDelta}
                  onChangeText={setExtraSipDelta}
                  placeholder="Step-up ₹"
                  keyboardType="numeric"
                />
              </View>
            </View>

            <Text style={styles.labelMuted}>HORIZON (YEARS)</Text>
            <Input
              value={horizonYears}
              onChangeText={setHorizonYears}
              placeholder="Projection horizon in years"
              keyboardType="numeric"
            />

            <PrimaryButton
              title="Run 500-Path Monte Carlo"
              variant="nav"
              onPress={() => void handleSimulateWhatIf()}
              loading={simLoading}
            />

            {simResult ? (
              <View style={styles.resultBox}>
                <Text style={{ color: moduleColors.finance, fontWeight: '800', fontSize: 15 }}>
                  {simResult.horizon_years}Y Median Wealth: {formatINR(simResult.what_if_outcomes_inr.p50, privacyMasked)}
                </Text>
                <Text style={styles.subBody}>
                  Baseline P50: {formatINR(simResult.baseline_outcomes_inr.p50, privacyMasked)}
                  {simResult.what_if_outcomes_inr.median_wealth_lift_inr !== undefined
                    ? ` · Lift: +${formatINR(simResult.what_if_outcomes_inr.median_wealth_lift_inr, privacyMasked)}`
                    : ''}
                </Text>
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: `${Math.min(
                          100,
                          Math.max(
                            15,
                            Math.round(
                              ((simResult.baseline_outcomes_inr.p50 || 1) /
                                Math.max(1, simResult.what_if_outcomes_inr.p50 || 1)) *
                                100,
                            ),
                          ),
                        )}%`,
                      },
                    ]}
                  />
                </View>
                {simResult.what_if_outcomes_inr.fi_probability_of_success !== undefined ? (
                  <Text style={styles.labelMuted}>
                    FI Success Probability: {Math.round(simResult.what_if_outcomes_inr.fi_probability_of_success * 100)}%
                  </Text>
                ) : null}
              </View>
            ) : null}
          </Card>
        </FadeIn>

        <MarketsDebtGraphSection privacyMasked={privacyMasked} onError={msg => setErrorMsg(msg)} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.m },
  pairRow: { flexDirection: 'row', gap: spacing.s },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.s },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  labelMuted: { ...typography.label, color: colors.textMuted },
  subBody: { fontSize: 13, lineHeight: 19, color: colors.textSecondary },
  cardTitle: { flex: 1, fontSize: 14.5, fontWeight: '700', color: colors.textPrimary },
  progressTrack: { height: 7, backgroundColor: colors.bgSurface, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: moduleColors.finance, borderRadius: 4 },
  splitBarTrack: {
    flexDirection: 'row',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: colors.bgSurface,
    gap: 2,
  },
  splitBarSegment: { height: '100%', borderRadius: 3 },
  resultBox: {
    backgroundColor: colors.bgElevated,
    borderRadius: radii.button,
    padding: spacing.m,
    gap: 6,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
});
