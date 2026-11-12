import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, moduleColors, spacing, typography } from '../../../app/theme/tokens';
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
      title="Wealth & Debt"
      subtitle="Portfolio Holdings · Active Loans · Goals · Budgets"
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
          <Text style={{ color: colors.statusDanger, fontSize: 12.5, fontWeight: '600' }}>{errorMsg}</Text>
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
          <Card style={{ gap: spacing.s }}>
            {budgets.length > 0 ? (
              budgets.map(b => (
                <View key={b.id} style={styles.lineRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{b.name}</Text>
                    <Text style={styles.labelMuted}>{b.period.toUpperCase()} BUDGET</Text>
                  </View>
                  <Text style={{ color: moduleColors.finance, fontWeight: '800', fontSize: 15 }}>
                    {formatINR(b.amount, privacyMasked)}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={styles.subBody}>
                No custom spending budgets set yet. You can add budgets from Ledger → + Manual Entry.
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
  subBody: { fontSize: 13, lineHeight: 19, color: colors.textSecondary },
  rowTitle: { fontSize: 13.5, fontWeight: '700', color: colors.textPrimary },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
});
