import React, { useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors, moduleColors, radii, spacing, typography } from '../../../app/theme/tokens';
import { financeApi } from '../../../core/api/finance';
import { Card, EmptyState, Input, PrimaryButton, SectionHeading } from '../../../core/design-system/components';
import { Chip, FadeIn, StatusPill } from '../../../core/design-system/motion';
import { usePrivacyPermissions } from '../../../core/permissions/usePrivacyPermissions';
import { maskDeviceAlertAtEdge } from '../../../core/security/financeVault';
import { Screen } from '../../../shared/components/Screen';
import {
  AccountAndManualTxnSection,
  FinanceHeaderActions,
  formatINR,
} from '../components/FinanceIntelligencePanels';
import { useFinanceData } from '../FinanceContext';

export default function FinanceLedgerScreen() {
  const nav = useNavigation<any>();
  const { permissions } = usePrivacyPermissions();
  const {
    accounts,
    transactions,
    channels,
    budgets,
    twin,
    privacyMasked,
    togglePrivacyMask,
    errorMsg,
    setErrorMsg,
    smartSyncing,
    refresh,
    syncUserAlerts,
  } = useFinanceData();

  const [alertSource, setAlertSource] = useState<'android_notification' | 'ios_shortcut' | 'email_forward'>(
    'android_notification',
  );
  const [alertText, setAlertText] = useState('');
  const [maskedAccount, setMaskedAccount] = useState('');
  const [ingesting, setIngesting] = useState(false);
  const [ingestBanner, setIngestBanner] = useState<string | null>(null);
  const [creatingChannel, setCreatingChannel] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);

  const edgePreview = useMemo(
    () => (alertText.trim() ? maskDeviceAlertAtEdge(alertText, maskedAccount) : null),
    [alertText, maskedAccount],
  );

  const handleReadClipboard = async () => {
    if (!permissions.clipboardAutoScan) {
      setIngestBanner('Clipboard Read permission is OFF. Enable it in Privacy & Access first.');
      return;
    }
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
        const clip = await navigator.clipboard.readText();
        if (clip.trim()) {
          setAlertText(clip.trim());
          setIngestBanner('Clipboard alert loaded locally for on-device PII review.');
        } else {
          setIngestBanner('Clipboard is currently empty.');
        }
      } else {
        setIngestBanner('Paste copied bank/UPI alert text directly into the field below.');
      }
    } catch {
      setIngestBanner('Browser blocked clipboard read — paste your alert manually below.');
    }
  };

  const handleIngestAlert = async () => {
    if (!permissions.smsAlertIngestion) {
      setIngestBanner('Bank & UPI Alert Parsing permission is OFF. Grant access in Privacy & Access.');
      return;
    }
    const lines = alertText
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return;

    if (lines.length > 1) {
      const res = await syncUserAlerts(
        lines.map(text => ({
          source: alertSource,
          text,
          accountHint: maskedAccount.trim() || undefined,
        })),
      );
      if (res) {
        setIngestBanner(
          `Synced ${res.ingested_alerts} alerts (${res.e2ee_verified ? 'E2EE Verified' : 'Edge Masked'}).`,
        );
        setAlertText('');
      }
      return;
    }

    setIngesting(true);
    setIngestBanner(null);
    try {
      const textToSend = permissions.edgePiiMasking
        ? maskDeviceAlertAtEdge(lines[0], maskedAccount.trim()).scrubbedText
        : lines[0];
      const acctToSend = permissions.edgePiiMasking
        ? maskDeviceAlertAtEdge(lines[0], maskedAccount.trim()).maskedAccount
        : maskedAccount.trim();
      const res = await financeApi.ingestAlert({
        source_channel: alertSource,
        raw_text: textToSend,
        masked_account: acctToSend,
      });
      const txn = res.transaction;
      setIngestBanner(
        `${res.newly_recorded ? 'Ingested' : 'Deduplicated'}: ${txn.txn_type.toUpperCase()} ${formatINR(Math.abs(txn.amount), privacyMasked)} · ${txn.merchant || txn.category || 'General'}`,
      );
      setAlertText('');
      await refresh();
    } catch (err: any) {
      setIngestBanner(`Error: ${err?.message ?? 'Failed to ingest alert'}`);
    } finally {
      setIngesting(false);
    }
  };

  const handleCreateVaultEmail = async () => {
    if (!permissions.emailVaultForwarding) {
      setErrorMsg('Encrypted Vault Email permission is OFF. Enable it in Privacy & Access.');
      return;
    }
    setCreatingChannel(true);
    try {
      await financeApi.createChannel({
        channel_type: 'email_forward',
        provider_name: 'Encrypted Statements Vault',
      });
      await refresh();
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'Could not provision Vault Email channel');
    } finally {
      setCreatingChannel(false);
    }
  };

  return (
    <Screen
      title="Ledger & Alerts"
      subtitle="Accounts · Zero-AA Edge Masking · Live Transactions"
      badge="E2EE INGESTION"
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
        {/* Connected Accounts */}
        <FadeIn index={0}>
          <SectionHeading
            title={`Connected Accounts (${accounts.length})`}
            action={showManualForm ? 'Hide Manual' : '+ Manual Entry'}
            onActionPress={() => setShowManualForm(v => !v)}
          />
          {accounts.length > 0 ? (
            <View style={{ gap: spacing.s }}>
              {accounts.map(acc => (
                <Card key={acc.id} style={{ gap: 4 }}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.cardTitle} numberOfLines={1}>{acc.name}</Text>
                    <Text style={{ color: moduleColors.finance, fontWeight: '800', fontSize: 15 }}>
                      {formatINR(acc.current_balance, privacyMasked)}
                    </Text>
                  </View>
                  <Text style={styles.labelMuted}>
                    {acc.institution || acc.account_type} · {acc.masked_number || 'masked'} · {acc.sync_status}
                  </Text>
                </Card>
              ))}
            </View>
          ) : (
            <EmptyState title="No accounts linked yet" hint="Use 1-Tap Smart Auto-Discover on Twin or ingest an alert below." />
          )}
        </FadeIn>

        {showManualForm ? (
          <AccountAndManualTxnSection
            budgets={budgets}
            privacyMasked={privacyMasked}
            onChanged={refresh}
            onError={msg => setErrorMsg(msg)}
          />
        ) : null}

        {/* Live Ledger Transactions */}
        <FadeIn index={1}>
          <SectionHeading title={`Live Ledger (${transactions.length})`} />
          <Card style={{ gap: spacing.xs }}>
            {transactions.length > 0 ? (
              transactions.slice(0, 15).map(txn => (
                <View key={txn.id} style={styles.txnRow}>
                  <View style={{ flex: 1, paddingRight: spacing.s }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {txn.merchant || txn.category || 'Transaction'}
                    </Text>
                    <Text style={styles.labelMuted} numberOfLines={1}>
                      {txn.txn_date} · {txn.channel.toUpperCase()} · {txn.category || txn.source_channel}
                    </Text>
                  </View>
                  <Text
                    style={{
                      color: txn.amount >= 0 ? colors.accentBright : colors.textPrimary,
                      fontWeight: '800',
                      fontSize: 14,
                    }}>
                    {txn.amount >= 0 ? '+' : ''}
                    {formatINR(txn.amount, privacyMasked)}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={styles.subBody}>No transactions recorded yet.</Text>
            )}
          </Card>
        </FadeIn>

        {/* Zero-AA Edge-Masked Real-Time Ingestion */}
        <FadeIn index={2}>
          <SectionHeading
            title="Zero-AA Alert Ingestion"
            action="Privacy & Access ›"
            onActionPress={() => nav.getParent()?.navigate('PrivacyPermissions')}
          />
          <Card style={{ gap: spacing.m }}>
            {!permissions.smsAlertIngestion ? (
              <View style={styles.resultBox}>
                <Text style={styles.rowTitle}>Alert Parsing Permission Disabled</Text>
                <Text style={styles.subBody}>
                  Enable "Bank & UPI Alert Parsing" in Privacy & Access to parse your real SMS, UPI, or email alerts.
                </Text>
                <PrimaryButton
                  title="Review Privacy & Permissions"
                  variant="secondary"
                  onPress={() => nav.getParent()?.navigate('PrivacyPermissions')}
                />
              </View>
            ) : null}

            <View style={styles.chipRow}>
              {(['android_notification', 'ios_shortcut', 'email_forward'] as const).map(src => (
                <Chip
                  key={src}
                  label={src.replace('_', ' ')}
                  active={alertSource === src}
                  color={moduleColors.finance}
                  onPress={() => setAlertSource(src)}
                />
              ))}
              <Chip
                label={permissions.clipboardAutoScan ? '📋 Paste Clipboard' : '🔒 Clipboard Off'}
                active={permissions.clipboardAutoScan}
                onPress={() => void handleReadClipboard()}
              />
            </View>

            <Input value={maskedAccount} onChangeText={setMaskedAccount} placeholder="Optional masked account hint (e.g. last 4 digits)" />
            <Input
              value={alertText}
              onChangeText={setAlertText}
              placeholder="Paste one or multiple real bank SMS, UPI notification, or card alert lines..."
              multiline
              style={styles.multilineInput}
            />

            {edgePreview ? (
              <View style={styles.resultBox}>
                <View style={styles.rowBetween}>
                  <Text style={styles.labelMuted}>ON-DEVICE MASK + E2EE PREVIEW</Text>
                  <StatusPill
                    label={`${edgePreview.redactedCount} PII scrubbed`}
                    tone={edgePreview.redactedCount > 0 ? 'success' : 'info'}
                  />
                </View>
                <Text style={styles.subBody}>{edgePreview.scrubbedText}</Text>
                <Text style={styles.labelMuted} numberOfLines={1}>
                  Acct {edgePreview.maskedAccount} · {edgePreview.e2eeCiphertext}
                </Text>
              </View>
            ) : null}

            <PrimaryButton
              title="Sync Alert(s) to Ledger"
              onPress={() => void handleIngestAlert()}
              loading={ingesting || smartSyncing}
            />

            {ingestBanner ? (
              <View style={styles.banner}>
                <Text style={{ color: moduleColors.finance, fontSize: 12.5, fontWeight: '700' }}>{ingestBanner}</Text>
              </View>
            ) : null}
          </Card>
        </FadeIn>

        {/* Vault Email Channels */}
        <FadeIn index={3}>
          <SectionHeading
            title={`Vault Channels (${channels.length})`}
            action="+ Provision Alias"
            onActionPress={() => void handleCreateVaultEmail()}
          />
          <Card style={{ gap: spacing.s }}>
            {channels.length > 0 ? (
              channels.slice(0, 5).map(ch => (
                <View key={ch.id} style={styles.txnRow}>
                  <View style={{ flex: 1, paddingRight: spacing.s }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{ch.provider_name}</Text>
                    <Text style={styles.labelMuted} numberOfLines={1}>
                      {ch.channel_type}
                      {ch.vault_alias ? ` · ${ch.vault_alias}` : ''}
                    </Text>
                  </View>
                  <StatusPill label={ch.status.toUpperCase()} tone="success" />
                </View>
              ))
            ) : (
              <Text style={styles.subBody}>No Zero-AA channels provisioned yet.</Text>
            )}
            <PrimaryButton
              title="Provision Encrypted Vault Email"
              variant="secondary"
              onPress={() => void handleCreateVaultEmail()}
              loading={creatingChannel}
            />
          </Card>
        </FadeIn>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.m },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.s },
  cardTitle: { flex: 1, fontSize: 14.5, fontWeight: '700', color: colors.textPrimary },
  rowTitle: { fontSize: 13.5, fontWeight: '700', color: colors.textPrimary },
  labelMuted: { ...typography.label, color: colors.textMuted },
  subBody: { fontSize: 13, lineHeight: 19, color: colors.textSecondary },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  txnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  multilineInput: {
    backgroundColor: colors.bgElevated,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    minHeight: 72,
    color: colors.textPrimary,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  resultBox: {
    backgroundColor: colors.bgElevated,
    borderRadius: radii.button,
    padding: spacing.m,
    gap: 5,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  banner: {
    backgroundColor: colors.bgElevated,
    borderRadius: radii.button,
    padding: spacing.s,
    borderWidth: 1,
    borderColor: moduleColors.finance,
  },
});
