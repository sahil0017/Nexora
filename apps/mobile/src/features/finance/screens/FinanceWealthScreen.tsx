import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fontFamily, moduleColors, spacing, typography } from '../../../app/theme/tokens';
import { Card, SectionHeading } from '../../../core/design-system/components';
import { FadeIn } from '../../../core/design-system/motion';
import { Screen } from '../../../shared/components/Screen';
import {
  FinanceHeaderActions,
  GoalsAndPortfolioSection,
  MetricTile,
  formatINR,
} from '../components/FinanceIntelligencePanels';
import { useFinanceData } from '../FinanceContext';

export default function FinanceWealthScreen() {
  const {
    goals,
    holdings,
    liabilities,
    budgets,
    twin,
    privacyMasked,
    togglePrivacyMask,
    errorMsg,
    setErrorMsg,
    refresh,
  } = useFinanceData();

  const totalInvestments = holdings.reduce((acc, h) => acc + (h.current_value_inr || 0), 0);
  const totalDebt = liabilities.reduce((acc, l) => acc + (l.principal_outstanding || 0), 0);

  return (
    <Screen
      title="Portfolio & Goals"
      subtitle="Investments, active loans, goals & budgets"
      badge="PORTFOLIO"
      rightAction={
        <FinanceHeaderActions
          privacyMasked={privacyMasked}
          onToggleMask={togglePrivacyMask}
          healthScore={twin?.health_score}
        />
      }>
      {errorMsg ? (
        <Card style={{ borderColor: colors.statusDanger }}>
          <Text style={{ color: colors.statusDanger, fontFamily: fontFamily.medium, fontSize: 12.5, fontWeight: '600' }}>
            {errorMsg}
          </Text>
        </Card>
      ) : null}

      <View style={styles.stack}>
        <FadeIn index={0}>
          <View style={styles.pairRow}>
            <MetricTile
              label="Total Investments"
              value={formatINR(totalInvestments, privacyMasked)}
              accent={moduleColors.finance}
            />
            <MetricTile
              label="Loan Principal"
              value={formatINR(totalDebt, privacyMasked)}
              accent={colors.statusWarning}
            />
          </View>
        </FadeIn>

        <GoalsAndPortfolioSection
          goals={goals}
          holdings={holdings}
          liabilities={liabilities}
          privacyMasked={privacyMasked}
          onChanged={refresh}
          onError={msg => setErrorMsg(msg)}
        />

        <FadeIn index={5}>
          <SectionHeading title={`Active Budgets (${budgets.length})`} />
          <Card style={{ gap: spacing.xs }}>
            {budgets.length > 0 ? (
              budgets.map((b, idx) => (
                <View
                  key={b.id}
                  style={[styles.lineRow, idx === budgets.length - 1 && styles.lineRowLast]}>
                  <View style={{ flex: 1, paddingRight: spacing.s }}>
                    <Text style={styles.rowTitle}>{b.name}</Text>
                    <Text style={styles.labelMuted}>{b.period.toUpperCase()} BUDGET</Text>
                  </View>
                  <Text style={{ color: moduleColors.finance, fontFamily: fontFamily.sans, fontWeight: '700', fontSize: 14 }}>
                    {formatINR(b.amount, privacyMasked)}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={styles.subBody}>
                No spending budgets set yet. You can add budgets from Accounts → + Manual Entry.
              </Text>
            )}
          </Card>
        </FadeIn>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.m },
  pairRow: { flexDirection: 'row', gap: spacing.s },
  labelMuted: { ...typography.label, color: colors.textMuted },
  subBody: { fontFamily: fontFamily.sans, fontSize: 12.5, lineHeight: 18, color: colors.textSecondary },
  rowTitle: { fontFamily: fontFamily.medium, fontSize: 13, fontWeight: '600', color: colors.textPrimary },
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
});
