import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useMutation, useQuery } from '@tanstack/react-query';
import { colors, fontFamily, moduleColors, spacing } from '../../../app/theme/tokens';
import { voiceApi } from '../../../core/api/voice';
import { Card, EmptyState, PrimaryButton, SectionHeading } from '../../../core/design-system/components';
import { FadeIn, StatusPill } from '../../../core/design-system/motion';
import { Screen } from '../../../shared/components/Screen';
import { useVoiceData } from '../VoiceContext';
import { ConversationSwitcher, triggerConversationDownload } from '../components/ConversationSwitcher';

export default function VoiceEvidenceScreen() {
  const { activeConversation, refresh } = useVoiceData();
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [showTechnical, setShowTechnical] = useState(false);

  const modelStatus = useQuery({
    queryKey: ['voice-model-status'],
    queryFn: voiceApi.modelStatus,
    retry: 0,
  });

  const legalHoldMut = useMutation({
    mutationFn: (nextHold: boolean) =>
      voiceApi.toggleLegalHold(activeConversation!.conversation_id, nextHold, 'User retention control'),
    onSuccess: async () => {
      await refresh();
    },
  });

  const exportMut = useMutation({
    mutationFn: () => voiceApi.exportEvidence(activeConversation!.conversation_id),
    onSuccess: async res => {
      setExportStatus(`Proof bundle verified (SHA: ${String(res.recording_sha ?? '').slice(0, 14)}…).`);
      await refresh();
    },
  });

  const downloadMut = useMutation({
    mutationFn: () => triggerConversationDownload(activeConversation!),
    onSuccess: res => {
      setExportStatus(
        res.kind === 'audio'
          ? 'Opened audio recording download.'
          : 'Downloaded verified transcript & custody record (.txt).',
      );
    },
    onError: err => {
      setExportStatus((err as Error)?.message ?? 'Download failed');
    },
  });

  if (!activeConversation) {
    return (
      <Screen title="Records & Proof" subtitle="Downloads, retention lock & verification">
        <EmptyState title="No Conversation Selected" hint="Pick a conversation in the Library tab first." />
      </Screen>
    );
  }

  const integrity = activeConversation.recording?.integrity ?? ({} as any);
  const ev = activeConversation.evidence;
  const custodyEvents = ev?.custody_events ?? [];
  const telemetry = activeConversation.model_telemetry ?? [];

  return (
    <Screen
      title="Records & Proof"
      subtitle={activeConversation.title}
      badge={ev?.chain_valid ? 'VERIFIED' : 'RECORD'}>
      <View style={styles.stack}>
        <ConversationSwitcher />

        <FadeIn index={0}>
          <Card variant="featured" style={{ gap: spacing.s }}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>Verification & Retention</Text>
              <StatusPill
                label={ev?.chain_valid ? 'VERIFIED RECORD' : 'PENDING SEAL'}
                tone={ev?.chain_valid ? 'success' : 'warning'}
              />
            </View>
            <Text style={styles.bodySecondary}>
              Every saved conversation is sealed against tampering. Download a portable copy or lock it under Legal Hold so it cannot be auto-deleted.
            </Text>

            <View style={styles.pairRow}>
              <View style={{ flex: 1 }}>
                <PrimaryButton
                  title={downloadMut.isPending ? 'Preparing…' : 'Download File'}
                  loading={downloadMut.isPending}
                  onPress={() => downloadMut.mutate()}
                />
              </View>
              <View style={{ flex: 1 }}>
                <PrimaryButton
                  title={integrity.legal_hold ? 'Release Hold' : 'Enable Legal Hold'}
                  variant={integrity.legal_hold ? 'secondary' : 'nav'}
                  loading={legalHoldMut.isPending}
                  onPress={() => legalHoldMut.mutate(!integrity.legal_hold)}
                />
              </View>
            </View>
            <PrimaryButton
              title="Verify & Export Proof Bundle"
              variant="secondary"
              loading={exportMut.isPending}
              onPress={() => exportMut.mutate()}
            />
            {exportStatus ? <Text style={styles.successText}>{exportStatus}</Text> : null}
          </Card>
        </FadeIn>

        {custodyEvents.length > 0 && (
          <>
            <SectionHeading title={`History & Audit Trail (${custodyEvents.length})`} />
            {custodyEvents.map((ce, idx) => (
              <Card key={ce.id || `${idx}`} variant="subtle" style={{ gap: 2 }}>
                <View style={styles.rowBetween}>
                  <Text style={styles.custodyAction}>{(ce.event_action || '').replace(/_/g, ' ').toUpperCase()}</Text>
                  <Text style={styles.monoLine}>{new Date(ce.occurred_at).toLocaleTimeString()}</Text>
                </View>
                <Text style={styles.monoLine}>Seal: {(ce.event_hash || '').slice(0, 24)}…</Text>
              </Card>
            ))}
          </>
        )}

        <TouchableOpacity
          onPress={() => setShowTechnical(v => !v)}
          activeOpacity={0.75}
          style={styles.techToggle}
        >
          <Text style={styles.techToggleText}>
            {showTechnical ? '▾ Hide Technical Fingerprints & AI Pipeline' : '▸ Show Technical Fingerprints & AI Pipeline'}
          </Text>
        </TouchableOpacity>

        {showTechnical && (
          <View style={styles.stack}>
            <Card style={{ gap: 4 }}>
              <Text style={styles.cardTitle}>Cryptographic Hashes</Text>
              <Text style={styles.monoLine}>Recording SHA-256: {integrity.sha256_original || '—'}</Text>
              <Text style={styles.monoLine}>HMAC Seal: {integrity.hmac_seal || '—'}</Text>
              {ev ? <Text style={styles.monoLine}>Utterance Merkle Root: {ev.merkle_root}</Text> : null}
            </Card>

            {telemetry.length > 0 && (
              <>
                <SectionHeading title={`Processing Telemetry (${telemetry.length})`} />
                {telemetry.map((tel, idx) => (
                  <Card key={`${tel.stage}-${idx}`} style={{ gap: 4 }}>
                    <View style={styles.rowBetween}>
                      <Text style={styles.cardTitle}>{tel.stage.toUpperCase()} · {tel.adapter_name}</Text>
                      <StatusPill label={`${(tel.latency_ms ?? 0).toFixed(1)} ms`} tone={tel.fallback_used ? 'warning' : 'info'} />
                    </View>
                    <Text style={styles.bodySecondary}>{tel.routing_reason}</Text>
                  </Card>
                ))}
              </>
            )}

            {modelStatus.data?.registered_adapters && (
              <Card variant="subtle" style={{ gap: 4 }}>
                <Text style={styles.cardTitle}>Active Voice Models</Text>
                {(modelStatus.data.registered_adapters as Array<Record<string, any>>).map((ad, idx) => (
                  <Text key={`${ad.name}-${idx}`} style={styles.monoLine}>
                    • {ad.name} ({ad.role})
                  </Text>
                ))}
              </Card>
            )}
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.m },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.s },
  pairRow: { flexDirection: 'row', gap: spacing.s, marginTop: spacing.xs },
  cardTitle: { color: colors.textPrimary, fontFamily: fontFamily.medium, fontSize: 13.5, fontWeight: '700' },
  bodySecondary: { color: colors.textSecondary, fontFamily: fontFamily.sans, fontSize: 12 },
  monoLine: { color: colors.textMuted, fontFamily: fontFamily.mono, fontSize: 11 },
  custodyAction: { color: moduleColors.voice, fontFamily: fontFamily.mono, fontSize: 11.5, fontWeight: '700' },
  successText: { color: colors.accentBright, fontFamily: fontFamily.medium, fontSize: 12 },
  techToggle: { paddingVertical: 8 },
  techToggleText: { color: colors.textSecondary, fontFamily: fontFamily.medium, fontSize: 12.5 },
});
