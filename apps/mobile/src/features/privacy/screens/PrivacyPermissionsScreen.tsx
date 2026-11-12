import React, { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { colors, moduleColors, radii, spacing, typography } from '../../../app/theme/tokens';
import { financeApi } from '../../../core/api/finance';
import { Card, PrimaryButton, SectionHeading } from '../../../core/design-system/components';
import { FadeIn, StatusPill } from '../../../core/design-system/motion';
import {
  PERMISSION_CATALOG,
  PermissionKey,
  usePrivacyPermissions,
} from '../../../core/permissions/usePrivacyPermissions';
import { Screen } from '../../../shared/components/Screen';

const DOMAIN_COLOR: Record<string, string> = {
  Mobility: colors.navBlue,
  Finance: moduleColors.finance,
  Copilot: colors.routeCyan,
  Security: colors.accentBright,
};

export default function PrivacyPermissionsScreen() {
  const nav = useNavigation<any>();
  const qc = useQueryClient();
  const [wiping, setWiping] = useState(false);
  const [wipeMsg, setWipeMsg] = useState<string | null>(null);
  const {
    permissions,
    consentConfigured,
    lastUpdatedAt,
    osLocationStatus,
    setPermission,
    applyRecommended,
    revokeOptional,
    markReviewed,
    syncOsPermissions,
    requestOsLocation,
  } = usePrivacyPermissions();

  useEffect(() => {
    void syncOsPermissions();
  }, [syncOsPermissions]);

  const enabledCount = Object.values(permissions).filter(Boolean).length;
  const totalCount = PERMISSION_CATALOG.length;

  const handleToggle = (key: PermissionKey, nextVal: boolean) => {
    if (key === 'gpsLocation' && nextVal) {
      void requestOsLocation();
      return;
    }
    setPermission(key, nextVal);
  };

  const finishAndReturn = () => {
    markReviewed();
    if (nav.canGoBack()) {
      nav.goBack();
    } else {
      nav.navigate('Tabs');
    }
  };

  const handleEraseSyncedData = async () => {
    setWiping(true);
    setWipeMsg(null);
    try {
      const res = await financeApi.resetData();
      setWipeMsg(`Cleared ${res.deleted_rows} synced financial record(s) from your Vault.`);
      await qc.invalidateQueries();
    } catch (err: any) {
      setWipeMsg(`Could not clear data: ${err?.message ?? 'API error'}`);
    } finally {
      setWiping(false);
    }
  };

  return (
    <Screen
      title="Privacy & Access"
      subtitle="Choose exactly what NEXORA can read or process on your device"
      badge="ZERO-AA CONSENT"
      rightAction={
        <StatusPill
          label={`${enabledCount}/${totalCount} Active`}
          tone={consentConfigured ? 'success' : 'warning'}
        />
      }>
      <View style={styles.stack}>
        <FadeIn index={0}>
          <Card variant="featured" style={{ gap: spacing.s }}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>You control every data stream</Text>
              <StatusPill
                label={consentConfigured ? 'Configured' : 'Review Needed'}
                tone={consentConfigured ? 'success' : 'warning'}
              />
            </View>
            <Text style={styles.subBody}>
              NEXORA operates with Zero Account Aggregator logins and zero background bank scraping. Toggle each capability below — turning a permission off immediately stops that feature from reading or sending data.
            </Text>
            <View style={styles.pairRow}>
              <View style={{ flex: 1 }}>
                <PrimaryButton
                  title="Allow Recommended"
                  onPress={() => {
                    applyRecommended();
                    void requestOsLocation();
                  }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <PrimaryButton title="Minimal Local-Only" variant="secondary" onPress={revokeOptional} />
              </View>
            </View>
            {lastUpdatedAt ? (
              <Text style={styles.labelMuted}>
                Last updated: {new Date(lastUpdatedAt).toLocaleString()}
              </Text>
            ) : null}
          </Card>
        </FadeIn>

        <FadeIn index={1}>
          <SectionHeading title="Permission Scopes" />
          <View style={{ gap: spacing.s }}>
            {PERMISSION_CATALOG.map(item => {
              const enabled = permissions[item.key];
              const domainColor = DOMAIN_COLOR[item.domain] ?? colors.navBlue;
              return (
                <Card key={item.key} style={{ gap: spacing.xs }}>
                  <View style={styles.rowBetween}>
                    <View style={{ flex: 1, paddingRight: spacing.s, gap: 4 }}>
                      <View style={styles.titleRow}>
                        <View style={[styles.domainDot, { backgroundColor: domainColor }]} />
                        <Text style={styles.domainText}>{item.domain.toUpperCase()}</Text>
                        {item.recommended ? <StatusPill label="Recommended" tone="info" /> : null}
                      </View>
                      <Text style={styles.cardTitle}>{item.title}</Text>
                    </View>
                    <Switch
                      value={enabled}
                      onValueChange={val => handleToggle(item.key, val)}
                      trackColor={{ false: colors.bgElevated, true: 'rgba(16, 185, 129, 0.55)' }}
                      thumbColor={enabled ? colors.accentBright : colors.textMuted}
                      accessibilityLabel={item.title}
                    />
                  </View>

                  <Text style={styles.subBody}>{item.description}</Text>

                  <View style={styles.metaBox}>
                    <Text style={styles.labelMuted}>DATA HANDLED</Text>
                    <Text style={styles.metaText}>{item.dataHandled}</Text>
                    {item.key === 'gpsLocation' ? (
                      <Text style={styles.osStatus}>
                        OS Permission:{' '}
                        <Text style={{ color: osLocationStatus === 'granted' ? colors.accentBright : colors.statusWarning }}>
                          {osLocationStatus.toUpperCase()}
                        </Text>
                      </Text>
                    ) : null}
                  </View>
                </Card>
              );
            })}
          </View>
        </FadeIn>

        <FadeIn index={2}>
          <PrimaryButton
            title={consentConfigured ? 'Save Permissions & Return' : 'Confirm Selected Access & Continue'}
            variant="nav"
            onPress={finishAndReturn}
          />
          <View style={{ marginTop: spacing.s, gap: spacing.xs }}>
            <PrimaryButton
              title="Erase Synced Finance Data"
              variant="secondary"
              loading={wiping}
              onPress={() => void handleEraseSyncedData()}
            />
            {wipeMsg ? <Text style={styles.osStatus}>{wipeMsg}</Text> : null}
          </View>
        </FadeIn>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.m },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.s },
  pairRow: { flexDirection: 'row', gap: spacing.s },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  domainDot: { width: 8, height: 8, borderRadius: 4 },
  domainText: { ...typography.label, color: colors.textMuted },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, flexShrink: 1 },
  subBody: { fontSize: 13, lineHeight: 19, color: colors.textSecondary },
  labelMuted: { ...typography.label, color: colors.textMuted },
  metaBox: {
    backgroundColor: colors.bgElevated,
    borderRadius: radii.button,
    padding: spacing.s,
    gap: 3,
    marginTop: 2,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  metaText: { fontSize: 12, lineHeight: 17, color: colors.textSecondary },
  osStatus: { fontSize: 11.5, fontWeight: '700', color: colors.textMuted, marginTop: 2 },
});
