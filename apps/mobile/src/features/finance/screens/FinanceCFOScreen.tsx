import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors, fontFamily, radii, spacing, typography } from '../../../app/theme/tokens';
import { CFOQueryResponse, financeApi } from '../../../core/api/finance';
import { Card, Input, PrimaryButton, SectionHeading } from '../../../core/design-system/components';
import { Chip, FadeIn, StatusPill } from '../../../core/design-system/motion';
import { usePrivacyPermissions } from '../../../core/permissions/usePrivacyPermissions';
import { Screen } from '../../../shared/components/Screen';
import { FinanceHeaderActions } from '../components/FinanceIntelligencePanels';
import { useFinanceData } from '../FinanceContext';

const ADVISOR_TOPICS = [
  'Compare my current loans against investment returns.',
  'Scan my accounts for idle cash & missing protection coverage.',
  'Summarize my cashflow savings rate and tax efficiency.',
];

export default function FinanceCFOScreen() {
  const nav = useNavigation<any>();
  const { permissions } = usePrivacyPermissions();
  const { twin, privacyMasked, togglePrivacyMask, errorMsg, setErrorMsg } = useFinanceData();
  const [cfoQuery, setCfoQuery] = useState('');
  const [cfoLoading, setCfoLoading] = useState(false);
  const [cfoResult, setCfoResult] = useState<CFOQueryResponse | null>(null);

  const handleAskCFO = async (promptOverride?: string) => {
    if (!permissions.aiCfoTelemetry) {
      setErrorMsg('Wealth Advisor context sharing is turned off in Privacy & Access.');
      return;
    }
    const q = (promptOverride ?? cfoQuery).trim();
    if (!q) {
      setErrorMsg('Type a financial question to get tailored guidance.');
      return;
    }
    setErrorMsg(null);
    if (promptOverride) setCfoQuery(promptOverride);
    setCfoLoading(true);
    try {
      const res = await financeApi.queryCFO(q);
      setCfoResult(res);
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'Wealth Advisor request failed');
    } finally {
      setCfoLoading(false);
    }
  };

  return (
    <Screen
      title="Wealth Advisor"
      subtitle="Private financial guidance tailored to your goals"
      badge="ADVISOR"
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
          <SectionHeading
            title="Personal Wealth Advisor"
            action="Privacy & Access ›"
            onActionPress={() => nav.getParent()?.navigate('PrivacyPermissions')}
          />
          <Card style={{ gap: spacing.m }}>
            {!permissions.aiCfoTelemetry ? (
              <View style={styles.resultBox}>
                <Text style={{ color: colors.textPrimary, fontFamily: fontFamily.medium, fontWeight: '600', fontSize: 13.5 }}>
                  Advisor Context Sharing Paused
                </Text>
                <Text style={styles.subBody}>
                  Enable "Wealth & Tax Context Sharing" in Privacy & Access to receive personalized advice on your balances and ratios.
                </Text>
                <PrimaryButton
                  title="Review Privacy & Permissions"
                  variant="secondary"
                  onPress={() => nav.getParent()?.navigate('PrivacyPermissions')}
                />
              </View>
            ) : null}
            <Text style={styles.subBody}>
              Sensitive details like account numbers, PAN, and UPI IDs are masked on your device before generating advice.
            </Text>

            <View style={styles.chipRow}>
              {ADVISOR_TOPICS.map((topic, i) => (
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
              placeholder="Ask about loans, SIPs, idle cash, or tax saving…"
              multiline
              style={styles.multilineInput}
            />

            <PrimaryButton title="Ask Advisor" onPress={() => void handleAskCFO()} loading={cfoLoading} />

            {cfoResult ? (
              <View style={styles.resultBox}>
                <View style={styles.rowBetween}>
                  <StatusPill
                    label={
                      cfoResult.evidence_bundle?.privacy_firewall?.pii_scrubbed
                        ? 'Details Protected'
                        : 'Private Session'
                    }
                    tone="info"
                  />
                  {cfoResult.requires_action_approval ? (
                    <StatusPill label="Review Recommended" tone="warning" />
                  ) : (
                    <StatusPill
                      label={(cfoResult.evidence_bundle?.confidence_tier ?? 'HIGH CONFIDENCE').replace(/_/g, ' ')}
                      tone="success"
                    />
                  )}
                </View>

                <Text style={[typography.body, { color: colors.textPrimary, marginTop: spacing.xs }]}>
                  {cfoResult.cfo_synthesis}
                </Text>

                {cfoResult.prioritized_actions && cfoResult.prioritized_actions.length > 0 ? (
                  <View style={{ gap: 4, marginTop: spacing.xs }}>
                    <Text style={styles.labelMuted}>RECOMMENDED NEXT STEPS</Text>
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
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.m },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.s },
  labelMuted: { ...typography.label, color: colors.textMuted },
  subBody: { fontFamily: fontFamily.sans, fontSize: 12.5, lineHeight: 18, color: colors.textSecondary },
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
    fontFamily: fontFamily.sans,
    fontSize: 13.5,
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
