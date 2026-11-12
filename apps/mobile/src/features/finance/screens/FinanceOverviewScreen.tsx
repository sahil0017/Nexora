import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors, fontFamily, moduleColors, radii, spacing, typography } from '../../../app/theme/tokens';
import { Card, EmptyState, PrimaryButton, SectionHeading } from '../../../core/design-system/components';
import { Chip, FadeIn, Skeleton, StatusPill, Tappable } from '../../../core/design-system/motion';
import { Screen } from '../../../shared/components/Screen';
import {
  FinanceHeaderActions,
  MetricTile,
  formatINR,
} from '../components/FinanceIntelligencePanels';
import { usePrivacyPermissions } from '../../../core/permissions/usePrivacyPermissions';
import { useFinanceData } from '../FinanceContext';

export default function FinanceOverviewScreen() {
  const nav = useNavigation<any>();
  const { permissions, consentConfigured } = usePrivacyPermissions();
  const {
    loading,
    refreshing,
    sseConnected,
    errorMsg,
    privacyMasked,
    togglePrivacyMask,
    twin,
    radar,
    smartSyncResult,
    completeness,
    refresh,
  } = useFinanceData();

  return (
    <Screen
      title="Wealth Overview"
      subtitle="Net worth, cashflow & savings opportunities"
      badge="NEXORA WEALTH"
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
        {loading && !twin ? (
          <Card style={{ gap: spacing.s }}>
            <Skeleton height={22} width="50%" />
            <Skeleton height={34} width="70%" />
            <Skeleton height={16} />
          </Card>
        ) : twin ? (
          <FadeIn index={0}>
            <Card variant="featured" style={{ gap: spacing.m }}>
              {/* Aligned Net Worth header: label + live pill on top row, display figure cleanly below */}
              <View style={{ gap: 4 }}>
                <View style={styles.rowBetween}>
                  <Text style={styles.labelMuted}>TOTAL NET WORTH</Text>
                  <StatusPill label={sseConnected ? 'Live' : 'Synced'} tone={sseConnected ? 'info' : 'success'} />
                </View>
                <Text style={[typography.display, { color: moduleColors.finance }]}>
                  {formatINR(twin.net_worth_inr, privacyMasked)}
                </Text>
              </View>

              {/* Strictly balanced 2x2 grid */}
              <View style={{ gap: spacing.s }}>
                <View style={styles.pairRow}>
                  <MetricTile label="Total Assets" value={formatINR(twin.total_assets_inr, privacyMasked)} />
                  <MetricTile
                    label="Liabilities"
                    value={formatINR(twin.total_liabilities_inr, privacyMasked)}
                    accent={colors.statusWarning}
                  />
                </View>
                <View style={styles.pairRow}>
                  <MetricTile
                    label="Safe to Spend"
                    value={formatINR(twin.safe_to_spend_inr, privacyMasked)}
                    accent={colors.accentBright}
                  />
                  <MetricTile label="Runway" value={`${twin.emergency_runway_months.toFixed(1)} mo`} />
                </View>
              </View>

              <View style={styles.divider} />

              <View style={{ gap: 6 }}>
                <View style={styles.rowBetween}>
                  <Text style={styles.labelMuted}>LIQUID VS INVESTED</Text>
                  <Text style={styles.labelMuted}>
                    {Math.round(
                      ((twin.investments_inr || 0) /
                        Math.max(1, (twin.liquid_cash_inr || 0) + (twin.investments_inr || 0))) *
                        100,
                    )}
                    % Invested
                  </Text>
                </View>
                <View style={styles.splitBarTrack}>
                  <View
                    style={[
                      styles.splitBarSegment,
                      { flex: Math.max(0.08, twin.liquid_cash_inr || 0), backgroundColor: colors.accentBright },
                    ]}
                  />
                  <View
                    style={[
                      styles.splitBarSegment,
                      { flex: Math.max(0.08, twin.investments_inr || 0), backgroundColor: moduleColors.finance },
                    ]}
                  />
                </View>
                <View style={styles.rowBetween}>
                  <Text style={styles.subBody}>
                    Liquid: <Text style={styles.boldWhite}>{formatINR(twin.liquid_cash_inr, privacyMasked)}</Text>
                  </Text>
                  <Text style={styles.subBody}>
                    Invested: <Text style={styles.boldWhite}>{formatINR(twin.investments_inr, privacyMasked)}</Text>
                  </Text>
                </View>
              </View>

              <View style={{ gap: 6 }}>
                <View style={styles.rowBetween}>
                  <Text style={styles.subBody}>
                    Month In:{' '}
                    <Text style={{ color: colors.accentBright, fontWeight: '600' }}>
                      +{formatINR(twin.month_credited_inr, privacyMasked)}
                    </Text>
                  </Text>
                  <Text style={styles.subBody}>
                    Month Out:{' '}
                    <Text style={{ color: colors.statusWarning, fontWeight: '600' }}>
                      -{formatINR(twin.month_debited_inr, privacyMasked)}
                    </Text>
                  </Text>
                </View>
                <View style={styles.splitBarTrack}>
                  <View
                    style={[
                      styles.splitBarSegment,
                      { flex: Math.max(0.1, twin.month_credited_inr || 0), backgroundColor: colors.accentBright },
                    ]}
                  />
                  <View
                    style={[
                      styles.splitBarSegment,
                      { flex: Math.max(0.1, twin.month_debited_inr || 0), backgroundColor: colors.statusWarning },
                    ]}
                  />
                </View>
              </View>

              <PrimaryButton
                title={refreshing ? 'Refreshing Snapshot…' : 'Refresh Snapshot'}
                variant="secondary"
                onPress={() => void refresh()}
                loading={refreshing}
              />
            </Card>
          </FadeIn>
        ) : (
          <EmptyState title="No snapshot yet" hint="Import bank or UPI alerts in Accounts to build your wealth snapshot." />
        )}

        {/* Quick Workspace Navigation */}
        <FadeIn index={1}>
          <SectionHeading title="Quick Access" />
          <View style={styles.pairRow}>
            <Tappable onPress={() => nav.navigate('FinLedger')} style={styles.navTile}>
              <Text style={styles.navTileTitle}>Accounts & Sync</Text>
              <Text style={styles.navTileSub}>Balances, transactions & alerts</Text>
            </Tappable>
            <Tappable onPress={() => nav.navigate('FinWealth')} style={styles.navTile}>
              <Text style={styles.navTileTitle}>Portfolio & Goals</Text>
              <Text style={styles.navTileSub}>Investments, loans & budgets</Text>
            </Tappable>
          </View>
          <View style={[styles.pairRow, { marginTop: spacing.s }]}>
            <Tappable onPress={() => nav.navigate('FinLab')} style={styles.navTile}>
              <Text style={styles.navTileTitle}>Tax & Planning</Text>
              <Text style={styles.navTileSub}>Tax regimes & wealth forecast</Text>
            </Tappable>
            <Tappable onPress={() => nav.navigate('FinCFO')} style={styles.navTile}>
              <Text style={styles.navTileTitle}>Wealth Advisor</Text>
              <Text style={styles.navTileSub}>Private cashflow & debt strategy</Text>
            </Tappable>
          </View>
        </FadeIn>

        {/* Real Data Ingestion & Permissions Completeness */}
        <FadeIn index={2}>
          <SectionHeading
            title="Account Setup & Coverage"
            action={`${completeness.pct}% Ready`}
            onActionPress={() => nav.getParent()?.navigate('PrivacyPermissions')}
          />
          <Card style={{ gap: spacing.s }}>
            <Text style={styles.subBody}>
              All figures above are calculated from your synced accounts and transactions. Choose which sources NEXORA can access or import alerts in Accounts.
            </Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${completeness.pct}%` }]} />
            </View>
            <View style={styles.chipRow}>
              {completeness.dimensions.map(d => (
                <Chip
                  key={d.label}
                  label={`${d.done ? '✓' : '○'} ${d.label}`}
                  active={d.done}
                  onPress={() => nav.navigate('FinLedger')}
                />
              ))}
            </View>
            <View style={styles.pairRow}>
              <View style={{ flex: 1 }}>
                <PrimaryButton title="Import Alerts" onPress={() => nav.navigate('FinLedger')} />
              </View>
              <View style={{ flex: 1 }}>
                <PrimaryButton
                  title={consentConfigured ? 'Permissions' : 'Grant Access'}
                  variant="secondary"
                  onPress={() => nav.getParent()?.navigate('PrivacyPermissions')}
                />
              </View>
            </View>
            <Text style={styles.labelMuted}>
              ACCESS: Alerts {permissions.smsAlertIngestion ? 'ON' : 'OFF'} · Statements{' '}
              {permissions.emailVaultForwarding ? 'ON' : 'OFF'} · Privacy Mask{' '}
              {permissions.edgePiiMasking ? 'ON' : 'OFF'}
            </Text>
            {smartSyncResult ? (
              <View style={styles.banner}>
                <Text style={styles.bannerText}>
                  {smartSyncResult.e2ee_verified ? 'Private Sync ✓' : 'Synced'} · Imported{' '}
                  {smartSyncResult.ingested_alerts} alerts
                  {smartSyncResult.discovered_entities?.length
                    ? ` · ${smartSyncResult.discovered_entities.join(', ')}`
                    : ''}
                  {smartSyncResult.inferred_salary_inr > 0
                    ? ` · Est. Income ${formatINR(smartSyncResult.inferred_salary_inr, privacyMasked)}/yr`
                    : ''}
                </Text>
              </View>
            ) : null}
          </Card>
        </FadeIn>

        {/* Coverage Gaps */}
        {twin?.coverage_gaps && twin.coverage_gaps.length > 0 ? (
          <FadeIn index={3}>
            <SectionHeading title="Protection Gaps" />
            <Card style={{ gap: spacing.s }}>
              {twin.coverage_gaps.map((g, idx) => (
                <View
                  key={`${g.gap_type ?? g.type ?? 'gap'}-${idx}`}
                  style={[styles.gapItem, idx < (twin.coverage_gaps?.length ?? 0) - 1 && styles.gapItemBorder]}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      {g.title || 'Coverage Recommendation'}
                    </Text>
                    <StatusPill
                      label={g.severity.toUpperCase()}
                      tone={g.severity === 'high' ? 'danger' : 'warning'}
                    />
                  </View>
                  <Text style={styles.subBody}>{g.suggested_action || g.recommendation}</Text>
                </View>
              ))}
            </Card>
          </FadeIn>
        ) : null}

        {/* Continuous Opportunity Radar */}
        <FadeIn index={4}>
          <SectionHeading
            title="Savings Opportunities"
            action={radar ? `${formatINR(radar.total_annualized_savings_inr, privacyMasked)}/yr` : undefined}
          />
          {radar && radar.opportunities.length > 0 ? (
            <View style={{ gap: spacing.s }}>
              {radar.opportunities.map((opp, idx) => (
                <Card key={`${opp.engine_key}-${idx}`} style={{ gap: 6 }}>
                  <View style={styles.rowBetween}>
                    <Text style={[styles.cardTitle, { flex: 1, paddingRight: spacing.s }]}>{opp.title}</Text>
                    <StatusPill
                      label={
                        opp.annualized_impact_inr > 0
                          ? `+${formatINR(opp.annualized_impact_inr, privacyMasked)}/yr`
                          : opp.urgency.toUpperCase()
                      }
                      tone={opp.urgency === 'critical' ? 'danger' : opp.urgency === 'high' ? 'success' : 'info'}
                    />
                  </View>
                  <Text style={styles.labelMuted}>
                    {opp.category.toUpperCase()} · {Math.round((opp.confidence ?? 0.85) * 100)}% confidence
                  </Text>
                  {opp.summary || opp.rationale ? (
                    <Text style={styles.subBody}>{opp.summary || opp.rationale}</Text>
                  ) : null}
                </Card>
              ))}
            </View>
          ) : (
            <EmptyState title="All caught up" hint="No new tax or cashflow savings alerts right now." />
          )}
        </FadeIn>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.m },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.s },
  pairRow: { flexDirection: 'row', gap: spacing.s },
  divider: { height: 1, backgroundColor: colors.borderSubtle },
  boldWhite: { color: colors.textPrimary, fontWeight: '600' },
  labelMuted: { ...typography.label, color: colors.textMuted },
  subBody: { fontFamily: fontFamily.sans, fontSize: 12.5, lineHeight: 18, color: colors.textSecondary },
  cardTitle: { fontFamily: fontFamily.medium, fontSize: 13.5, fontWeight: '600', color: colors.textPrimary, flex: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  gapItem: { gap: 4, paddingBottom: spacing.s },
  gapItemBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSubtle },
  progressTrack: { height: 7, backgroundColor: colors.bgElevated, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: moduleColors.finance, borderRadius: 4 },
  splitBarTrack: {
    flexDirection: 'row',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: colors.bgElevated,
    gap: 2,
  },
  splitBarSegment: { height: '100%', borderRadius: 3 },
  navTile: {
    flex: 1,
    minHeight: 72,
    justifyContent: 'center',
    backgroundColor: colors.bgSurface,
    borderRadius: radii.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    gap: 3,
  },
  navTileTitle: { color: colors.textPrimary, fontFamily: fontFamily.medium, fontSize: 13.5, fontWeight: '600' },
  navTileSub: { color: colors.textMuted, fontFamily: fontFamily.sans, fontSize: 11, lineHeight: 15 },
  banner: {
    backgroundColor: colors.bgElevated,
    borderRadius: radii.button,
    padding: spacing.s,
    borderWidth: 1,
    borderColor: moduleColors.finance,
  },
  bannerText: { color: moduleColors.finance, fontFamily: fontFamily.medium, fontSize: 12, fontWeight: '600' },
});
