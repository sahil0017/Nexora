import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors, radii, spacing, typography } from '../../../app/theme/tokens';
import { CFOQueryResponse, financeApi } from '../../../core/api/finance';
import { Card, Input, PrimaryButton, SectionHeading } from '../../../core/design-system/components';
import { Chip, FadeIn, StatusPill } from '../../../core/design-system/motion';
import { usePrivacyPermissions } from '../../../core/permissions/usePrivacyPermissions';
import { Screen } from '../../../shared/components/Screen';
import { FinanceHeaderActions } from '../components/FinanceIntelligencePanels';
import { useFinanceData } from '../FinanceContext';

const CFO_TOPICS = [
  'Compare my current loans against investment returns.',
  'Scan my accounts for idle cash & missing protection coverage.',
  'Summarize my cashflow savings rate and tax efficiency.',
];

export default function FinanceCFOScreen() {
  const nav = useNavigation<any>();
  const { permissions } = usePrivacyPermissions();
  const { twin, tableHealth, privacyMasked, togglePrivacyMask, errorMsg, setErrorMsg } = useFinanceData();
  const [cfoQuery, setCfoQuery] = useState('');
  const [cfoLoading, setCfoLoading] = useState(false);
  const [cfoResult, setCfoResult] = useState<CFOQueryResponse | null>(null);
  const [showAllTables, setShowAllTables] = useState(false);

  const handleAskCFO = async (promptOverride?: string) => {
    if (!permissions.aiCfoTelemetry) {
      setErrorMsg('AI CFO & Tax Context Sharing is OFF. Enable it in Privacy & Access.');
      return;
    }
    const q = (promptOverride ?? cfoQuery).trim();
    if (!q) {
      setErrorMsg('Type your real financial question to consult AI CFO.');
      return;
    }
    setErrorMsg(null);
    if (promptOverride) setCfoQuery(promptOverride);
    setCfoLoading(true);
    try {
      const res = await financeApi.queryCFO(q);
      setCfoResult(res);
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'AI CFO request failed');
    } finally {
      setCfoLoading(false);
    }
  };

  const visibleTables = showAllTables ? tableHealth : tableHealth.slice(0, 8);
  const activeTablesCount = tableHealth.filter(t => t.rows > 0).length;

  return (
    <Screen
      title="AI CFO & Vault"
      subtitle="Privacy-Firewalled Strategy · 46-Table Persistence"
      badge="AI CFO"
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
            title="Multi-Agent AI CFO"
            action="Privacy & Access ›"
            onActionPress={() => nav.getParent()?.navigate('PrivacyPermissions')}
          />
          <Card style={{ gap: spacing.m }}>
            {!permissions.aiCfoTelemetry ? (
              <View style={styles.resultBox}>
                <Text style={{ color: colors.textPrimary, fontWeight: '700', fontSize: 13.5 }}>
                  AI CFO Context Sharing Paused
                </Text>
                <Text style={styles.subBody}>
                  Enable "AI CFO & Tax Context Sharing" in Privacy & Access to let the firewalled advisor inspect anonymized ratios.
                </Text>
                <PrimaryButton
                  title="Review Privacy & Permissions"
                  variant="secondary"
                  onPress={() => nav.getParent()?.navigate('PrivacyPermissions')}
                />
              </View>
            ) : null}
            <Text style={styles.subBody}>
              Go Privacy Firewall strips account numbers, PANs, and UPI VPAs before specialist deliberation.
            </Text>

            <View style={styles.chipRow}>
              {CFO_TOPICS.map((topic, i) => (
                <Chip
                  key={topic}
                  label={i === 0 ? 'Loan vs Invest' : i === 1 ? 'Cash & Coverage' : 'Tax Efficiency'}
                  active={cfoQuery === topic}
                  onPress={() => void handleAskCFO(topic)}
                />
              ))}
            </View>

            <Input
              value={cfoQuery}
              onChangeText={setCfoQuery}
              placeholder="Ask your AI CFO anything..."
              multiline
              style={styles.multilineInput}
            />

            <PrimaryButton title="Consult AI CFO" onPress={() => void handleAskCFO()} loading={cfoLoading} />

            {cfoResult ? (
              <View style={styles.resultBox}>
                <View style={styles.rowBetween}>
                  <StatusPill
                    label={
                      cfoResult.evidence_bundle?.privacy_firewall?.pii_scrubbed
                        ? `PII Scrubbed (${cfoResult.evidence_bundle.privacy_firewall.redacted_tokens_count ?? 0})`
                        : 'Privacy Verified'
                    }
                    tone="info"
                  />
                  {cfoResult.requires_action_approval ? (
                    <StatusPill label="Approval Required" tone="warning" />
                  ) : (
                    <StatusPill label={cfoResult.evidence_bundle?.confidence_tier ?? 'HIGH CONF'} tone="success" />
                  )}
                </View>

                <Text style={[typography.body, { color: colors.textPrimary, marginTop: spacing.xs }]}>
                  {cfoResult.cfo_synthesis}
                </Text>

                {cfoResult.prioritized_actions && cfoResult.prioritized_actions.length > 0 ? (
                  <View style={{ gap: 4, marginTop: spacing.xs }}>
                    <Text style={styles.labelMuted}>PRIORITIZED ACTIONS</Text>
                    {cfoResult.prioritized_actions.map((act, idx) => (
                      <Text key={idx} style={styles.subBody}>
                        • {act}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}
          </Card>
        </FadeIn>

        <FadeIn index={1}>
          <SectionHeading
            title={`Schema Health (${activeTablesCount}/${tableHealth.length} active)`}
            action={showAllTables ? 'Show Top 8' : `Show All (${tableHealth.length})`}
            onActionPress={() => setShowAllTables(v => !v)}
          />
          <Card style={{ gap: 6 }}>
            <Text style={styles.subBody}>
              Backend store:{' '}
              {tableHealth[0]?.wired_by === 'postgres' ? 'PostgreSQL 16 (RDS ap-south-1)' : 'In-memory dev store'}
            </Text>
            {visibleTables.map(t => (
              <View key={t.table} style={styles.rowBetween}>
                <Text style={styles.labelMuted}>{t.table}</Text>
                <Text style={{ color: t.rows > 0 ? colors.accentBright : colors.textSecondary, fontSize: 12.5, fontWeight: '700' }}>
                  {t.rows} rows
                </Text>
              </View>
            ))}
          </Card>
        </FadeIn>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.m },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.s },
  labelMuted: { ...typography.label, color: colors.textMuted },
  subBody: { fontSize: 13, lineHeight: 19, color: colors.textSecondary },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  multilineInput: {
    backgroundColor: colors.bgElevated,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    minHeight: 74,
    color: colors.textPrimary,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  resultBox: {
    backgroundColor: colors.bgElevated,
    borderRadius: radii.button,
    padding: spacing.m,
    gap: 6,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
});
