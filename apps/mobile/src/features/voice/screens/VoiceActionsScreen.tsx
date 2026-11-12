import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { colors, fontFamily, moduleColors, spacing } from '../../../app/theme/tokens';
import { voiceApi } from '../../../core/api/voice';
import { Card, EmptyState, PrimaryButton, SectionHeading } from '../../../core/design-system/components';
import { FadeIn, StatusPill } from '../../../core/design-system/motion';
import { Screen } from '../../../shared/components/Screen';
import { useVoiceData } from '../VoiceContext';

export default function VoiceActionsScreen() {
  const { activeConversation, refresh } = useVoiceData();

  const decideMut = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approved' | 'rejected' }) =>
      voiceApi.decideAction(id, decision),
    onSuccess: async () => {
      await refresh();
    },
  });

  if (!activeConversation) {
    return (
      <Screen title="Actions & Review" subtitle="Human-in-the-loop notes, reminders & tasks">
        <EmptyState title="No active conversation" hint="Select a conversation in Capture first." />
      </Screen>
    );
  }

  return (
    <Screen
      title="Actions & Review"
      subtitle={activeConversation.title}
      badge="WS7 · HUMAN APPROVAL GATE">
      <View style={styles.stack}>
        <SectionHeading title="Suggested Outcomes (Approval Required)" />
        {activeConversation.action_suggestions.map((act, idx) => (
          <FadeIn key={act.action_id} index={idx}>
            <Card variant={act.status === 'suggested' ? 'featured' : 'default'} style={{ gap: spacing.s }}>
              <View style={styles.rowBetween}>
                <StatusPill label={act.action_type.toUpperCase()} tone="info" />
                <StatusPill
                  label={act.status.toUpperCase()}
                  tone={act.status === 'approved' ? 'success' : act.status === 'rejected' ? 'danger' : 'warning'}
                />
              </View>
              <Text style={styles.cardTitle}>{act.title}</Text>
              <Text style={styles.bodySecondary}>{act.rationale}</Text>
              {act.evidence_refs && act.evidence_refs.length > 0 && (
                <Text style={styles.quoteText}>
                  Evidence ({act.evidence_refs[0].speaker_label}): "{act.evidence_refs[0].quote}"
                </Text>
              )}
              {act.status === 'suggested' && (
                <View style={styles.pairRow}>
                  <View style={{ flex: 1 }}>
                    <PrimaryButton
                      title="Approve Action"
                      loading={decideMut.isPending}
                      onPress={() => decideMut.mutate({ id: act.action_id, decision: 'approved' })}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <PrimaryButton
                      title="Reject"
                      variant="secondary"
                      loading={decideMut.isPending}
                      onPress={() => decideMut.mutate({ id: act.action_id, decision: 'rejected' })}
                    />
                  </View>
                </View>
              )}
            </Card>
          </FadeIn>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.m },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.s },
  pairRow: { flexDirection: 'row', gap: spacing.s },
  cardTitle: { color: colors.textPrimary, fontFamily: fontFamily.medium, fontSize: 14, fontWeight: '700' },
  bodySecondary: { color: colors.textSecondary, fontFamily: fontFamily.sans, fontSize: 12.5, lineHeight: 18 },
  quoteText: { color: moduleColors.voice, fontFamily: fontFamily.sans, fontSize: 12, fontStyle: 'italic' },
});
