import React, { useState } from 'react';
import { StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useNavigation } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { colors, fontFamily, moduleColors, radii, spacing, typography } from '../../../app/theme/tokens';
import { financeApi } from '../../../core/api/finance';
import { Card, PrimaryButton, SectionHeading } from '../../../core/design-system/components';
import { StatusPill } from '../../../core/design-system/motion';
import {
  useRealtimeIntegrations,
  type IntegrationDomain,
  type IntegrationStatus,
} from '../../../core/integrations/useRealtimeIntegrations';
import { Screen } from '../../../shared/components/Screen';

const DOMAIN_META: Array<{
  key: IntegrationDomain;
  title: string;
  sourceLabel: string;
  color: string;
  route: string;
}> = [
  {
    key: 'mobility',
    title: 'Mobility & Traffic',
    sourceLabel: 'Device GPS · Live Corridors · Road Alerts',
    color: moduleColors.move,
    route: 'Mobility',
  },
  {
    key: 'finance',
    title: 'Wealth & Finance',
    sourceLabel: 'Account Aggregator · Notification Listener (Bank / UPI)',
    color: moduleColors.finance,
    route: 'Finance',
  },
  {
    key: 'health',
    title: 'Health & Sensors',
    sourceLabel: 'Phone IMU · Light/Steps · Health Connect (HR, HRV, Sleep, SpO₂)',
    color: moduleColors.health,
    route: 'Health',
  },
  {
    key: 'voice',
    title: 'Voice & Calendar',
    sourceLabel: 'Device Call Logs · Calendar Events · Caller ID',
    color: moduleColors.voice,
    route: 'Voice',
  },
];

function statusTone(status: IntegrationStatus): 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'connected') return 'success';
  if (status === 'needs_access') return 'warning';
  if (status === 'error') return 'danger';
  return 'info';
}

function statusLabel(status: IntegrationStatus): string {
  switch (status) {
    case 'connected':
      return 'LIVE';
    case 'syncing':
      return 'SYNCING';
    case 'needs_access':
      return 'NEEDS ACCESS';
    case 'error':
      return 'RETRY';
    default:
      return 'READY';
  }
}

export default function IntegrationsScreen() {
  const nav = useNavigation<any>();
  const qc = useQueryClient();
  const {
    autoSyncEnabled,
    syncingAll,
    domains,
    setAutoSyncEnabled,
    syncDomain,
    syncAll,
  } = useRealtimeIntegrations();

  const connectedCount = Object.values(domains).filter(d => d.status === 'connected').length;

  const handleSyncAll = async () => {
    await syncAll();
    await qc.invalidateQueries();
  };

  const handleSyncOne = async (key: IntegrationDomain) => {
    await syncDomain(key);
    await qc.invalidateQueries();
  };

  return (
    <Screen
      title="Real-Time Integrations"
      subtitle="Connect live data sources so NEXORA populates automatically"
      badge="AUTO-INGESTION"
      rightAction={
        <TouchableOpacity onPress={() => nav.goBack()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
      }>
      <View style={styles.content}>
        <Card variant="featured" style={styles.heroCard}>
          <View style={styles.rowBetween}>
            <Text style={styles.heroTitle}>Connected Sources</Text>
            <StatusPill
              label={`${connectedCount} / 4 LIVE`}
              tone={connectedCount === 4 ? 'success' : connectedCount > 0 ? 'info' : 'warning'}
            />
          </View>
          <Text style={styles.heroSub}>
            Grant device & account connectors once — NEXORA ingests real-time telemetry, transactions,
            health metrics, and call logs automatically without manual entry.
          </Text>

          <View style={styles.autoRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.autoLabel}>Auto-Sync on App Launch</Text>
              <Text style={styles.autoSub}>Refresh connected sources automatically</Text>
            </View>
            <Switch
              value={autoSyncEnabled}
              onValueChange={setAutoSyncEnabled}
              trackColor={{ false: colors.bgElevated, true: 'rgba(29, 143, 225, 0.5)' }}
              thumbColor={autoSyncEnabled ? colors.navBlue : colors.textMuted}
            />
          </View>

          <PrimaryButton
            title={syncingAll ? 'Syncing All Sources...' : 'Connect & Sync All'}
            loading={syncingAll}
            onPress={() => void handleSyncAll()}
          />
        </Card>

        <SectionHeading title="Data Connectors" />

        {DOMAIN_META.map(meta => {
          const st = domains[meta.key];
          return (
            <Card key={meta.key} style={styles.domainCard}>
              <View style={styles.rowBetween}>
                <View style={styles.titleRow}>
                  <View style={[styles.dot, { backgroundColor: meta.color }]} />
                  <Text style={styles.domainTitle}>{meta.title}</Text>
                </View>
                <StatusPill label={statusLabel(st.status)} tone={statusTone(st.status)} />
              </View>

              <Text style={styles.sourceLabel}>{meta.sourceLabel}</Text>
              <Text style={styles.summaryText}>{st.summary}</Text>

              {st.lastSyncAt ? (
                <Text style={styles.syncTime}>Last synced at {st.lastSyncAt}</Text>
              ) : null}

              <View style={styles.btnRow}>
                <View style={{ flex: 1 }}>
                  <PrimaryButton
                    title={st.status === 'connected' ? 'Sync Now' : 'Connect & Sync'}
                    variant="secondary"
                    loading={st.status === 'syncing'}
                    onPress={() => void handleSyncOne(meta.key)}
                  />
                </View>
                <TouchableOpacity
                  onPress={() => nav.navigate(meta.route)}
                  style={styles.openBtn}>
                  <Text style={[styles.openText, { color: meta.color }]}>Open →</Text>
                </TouchableOpacity>
              </View>
            </Card>
          );
        })}

        <SectionHeading title="Zero-Permission Document Import" />
        <Card style={styles.domainCard}>
          <Text style={styles.domainTitle}>Bank Statements & Lab Reports</Text>
          <Text style={styles.summaryText}>
            Pick a CSV, PDF, or text statement directly from your device without granting storage permissions.
          </Text>
          <DocumentImportRow onImported={() => void handleSyncOne('finance')} />
        </Card>
      </View>
    </Screen>
  );
}

function DocumentImportRow({ onImported }: { onImported: () => void }) {
  const [status, setStatus] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const handlePick = async () => {
    setImporting(true);
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'application/pdf', 'text/plain'],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      const lower = (asset.name ?? '').toLowerCase();
      if (lower.endsWith('.pdf') || asset.mimeType === 'application/pdf') {
        setStatus(`Selected ${asset.name} — export bank statement as CSV or TXT for automatic line-item ingestion.`);
        return;
      }

      const rawText = await fetch(asset.uri).then(r => r.text());
      const lines = rawText
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean);
      // Skip common CSV header line
      const rows =
        lines.length > 1 && /date|amount|description|narration|debit|credit/i.test(lines[0])
          ? lines.slice(1)
          : lines;
      const batch = rows.slice(0, 50).map(line => ({
        source_channel: 'manual_import' as const,
        raw_text: line,
        currency: 'INR',
      }));
      if (batch.length === 0) {
        setStatus(`${asset.name} has no readable transaction rows.`);
        return;
      }
      const result = await financeApi.smartSyncBatch({ alerts: batch });
      setStatus(
        `Imported ${result.ingested_alerts} transaction(s) from ${asset.name}${
          result.discovered_entities?.length ? ` · ${result.discovered_entities.slice(0, 3).join(', ')}` : ''
        }`,
      );
      onImported();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not import document');
    } finally {
      setImporting(false);
    }
  };

  return (
    <View style={{ gap: spacing.xs, marginTop: spacing.xs }}>
      <PrimaryButton
        title={importing ? 'Importing Statement...' : 'Import CSV / PDF Statement'}
        variant="secondary"
        loading={importing}
        onPress={() => void handlePick()}
      />
      {status ? <Text style={styles.syncTime}>{status}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.m },
  backText: { fontFamily: fontFamily.medium, fontSize: 13, color: colors.navBlue, fontWeight: '600' },
  heroCard: { borderColor: 'rgba(29, 143, 225, 0.4)', gap: spacing.m },
  heroTitle: { fontFamily: fontFamily.medium, fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  heroSub: { ...typography.body, color: colors.textSecondary },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.s },
  autoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.s,
    borderRadius: radii.card,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  autoLabel: { fontFamily: fontFamily.medium, fontSize: 13.5, fontWeight: '600', color: colors.textPrimary },
  autoSub: { fontFamily: fontFamily.sans, fontSize: 11.5, color: colors.textSecondary, marginTop: 2 },
  domainCard: { gap: spacing.xs },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  domainTitle: { fontFamily: fontFamily.medium, fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  sourceLabel: { fontFamily: fontFamily.mono, fontSize: 11, color: colors.textMuted, marginTop: 2 },
  summaryText: { ...typography.body, color: colors.textSecondary, marginTop: 2 },
  syncTime: { fontFamily: fontFamily.mono, fontSize: 10.5, color: colors.accentBright },
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.s, marginTop: spacing.s },
  openBtn: {
    paddingHorizontal: spacing.m,
    paddingVertical: 12,
    borderRadius: radii.button,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  openText: { fontFamily: fontFamily.medium, fontSize: 13, fontWeight: '700' },
});
