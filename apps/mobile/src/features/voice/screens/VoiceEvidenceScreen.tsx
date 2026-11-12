import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useMutation, useQuery } from '@tanstack/react-query';
import { colors, fontFamily, moduleColors, spacing } from '../../../app/theme/tokens';
import { voiceApi } from '../../../core/api/voice';
import { Card, EmptyState, PrimaryButton, SectionHeading } from '../../../core/design-system/components';
import { FadeIn, StatusPill } from '../../../core/design-system/motion';
import { Screen } from '../../../shared/components/Screen';
import { useVoiceData } from '../VoiceContext';

export default function VoiceEvidenceScreen() {
  const { activeConversation, refresh } = useVoiceData();
  const [exportStatus, setExportStatus] = useState<string | null>(null);

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
      setExportStatus(`Verified package exported (SHA: ${String(res.recording_sha ?? '').slice(0, 14)}...)`);
      await refresh();
    },
  });

  if (!activeConversation) {
    return (
      <Screen title="Evidence & Models" subtitle="Cryptographic provenance & model routing">
        <EmptyState title="No active conversation" hint="Select a conversation in Capture first." />
      </Screen>
    );
  }

  const integrity = activeConversation.recording.integrity;
  const ev = activeConversation.evidence;

  return (
    <Screen
      title="Evidence & Models"
      subtitle={activeConversation.title}
      badge="WS9 & WS10 · CUSTODY & ROUTING">
      <View style={styles.stack}>
        <FadeIn index={0}>
          <Card variant="featured" style={{ gap: spacing.s }}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>WS9 · Cryptographic Chain of Custody</Text>
              <StatusPill
                label={ev?.chain_valid ? 'CHAIN VALID' : 'UNVERIFIED'}
                tone={ev?.chain_valid ? 'success' : 'danger'}
              />
            </View>
            <Text style={styles.monoLine}>Recording SHA-256: {integrity.sha256_original}</Text>
            <Text style={styles.monoLine}>HMAC Seal: {integrity.hmac_seal}</Text>
            {ev && <Text style={styles.monoLine}>Utterance Merkle Root: {ev.merkle_root}</Text>}
            <View style={styles.pairRow}>
              <View style={{ flex: 1 }}>
                <PrimaryButton
                  title={integrity.legal_hold ? 'Release Legal Hold' : 'Enable Legal Hold'}
                  variant={integrity.legal_hold ? 'secondary' : 'nav'}
                  loading={legalHoldMut.isPending}
                  onPress={() => legalHoldMut.mutate(!integrity.legal_hold)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <PrimaryButton
                  title="Export Proof Bundle"
                  loading={exportMut.isPending}
                  onPress={() => exportMut.mutate()}
                />
              </View>
            </View>
            {exportStatus ? <Text style={styles.successText}>{exportStatus}</Text> : null}
          </Card>
        </FadeIn>

        {ev && ev.custody_events.length > 0 && (
          <>
            <SectionHeading title="Custody Audit Log" />
            {ev.custody_events.map(ce => (
              <Card key={ce.id} variant="subtle" style={{ gap: 2 }}>
                <View style={styles.rowBetween}>
                  <Text style={styles.custodyAction}>{ce.event_action.toUpperCase()}</Text>
                  <Text style={styles.monoLine}>{new Date(ce.occurred_at).toLocaleTimeString()}</Text>
                </View>
                <Text style={styles.monoLine}>Hash: {ce.event_hash.slice(0, 24)}...</Text>
              </Card>
            ))}
          </>
        )}

        <SectionHeading title="WS10 · Model Intelligence & Adapter Routing" />
        {activeConversation.model_telemetry.map((tel, idx) => (
          <Card key={`${tel.stage}-${idx}`} style={{ gap: 4 }}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>{tel.stage.toUpperCase()} · {tel.adapter_name}</Text>
              <StatusPill label={`${tel.latency_ms.toFixed(1)} ms`} tone={tel.fallback_used ? 'warning' : 'info'} />
            </View>
            <Text style={styles.bodySecondary}>{tel.routing_reason}</Text>
          </Card>
        ))}

        {modelStatus.data?.registered_adapters && (
          <Card variant="subtle" style={{ gap: 4 }}>
            <Text style={styles.cardTitle}>Registered Replaceable Adapters</Text>
            {(modelStatus.data.registered_adapters as Array<Record<string, any>>).map((ad, idx) => (
              <Text key={`${ad.name}-${idx}`} style={styles.monoLine}>
                • {ad.name} ({ad.role})
              </Text>
            ))}
          </Card>
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
});
