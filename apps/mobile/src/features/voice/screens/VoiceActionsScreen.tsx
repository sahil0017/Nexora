import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { colors, fontFamily, moduleColors, spacing } from '../../../app/theme/tokens';
import { voiceApi } from '../../../core/api/voice';
import { Card, EmptyState, PrimaryButton, SectionHeading } from '../../../core/design-system/components';
import { FadeIn, StatusPill } from '../../../core/design-system/motion';
import { Screen } from '../../../shared/components/Screen';
import { useVoiceData } from '../VoiceContext';
import { ConversationSwitcher } from '../components/ConversationSwitcher';

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
      <Screen title="Follow-ups & Tasks" subtitle="Review suggested reminders, notes & commitments">
        <EmptyState title="No Conversation Selected" hint="Pick a conversation in the Library tab first." />
      </Screen>
    );
  }

  const actions = activeConversation.action_suggestions ?? [];

  return (
    <Screen
      title="Follow-ups & Tasks"
      subtitle={activeConversation.title}
      badge="APPROVALS">
      <View style={styles.stack}>
        <ConversationSwitcher />
        <SectionHeading title={`Suggested Follow-ups (${actions.length})`} />
        {actions.length === 0 ? (
          <Card>
            <EmptyState
              title="No Follow-ups Suggested Yet"
              hint="When a conversation includes commitments or reminders, they will appear here for one-tap approval."
            />
          </Card>
        ) : (
          actions.map((act, idx) => (
            <FadeIn key={act.action_id || `${idx}`} index={idx}>
              <Card variant={act.status === 'suggested' ? 'featured' : 'default'} style={{ gap: spacing.s }}>
                <View style={styles.rowBetween}>
                  <StatusPill label={(act.action_type || 'task').replace(/_/g, ' ').toUpperCase()} tone="info" />
                  <StatusPill
                    label={(act.status || 'suggested').toUpperCase()}
                    tone={act.status === 'approved' ? 'success' : act.status === 'rejected' ? 'danger' : 'warning'}
                  />
                </View>
                <Text style={styles.cardTitle}>{act.title}</Text>
                <Text style={styles.bodySecondary}>{act.rationale}</Text>
                {act.evidence_refs && act.evidence_refs.length > 0 && (
                  <Text style={styles.quoteText}>
                    From {act.evidence_refs[0].speaker_label}: "{act.evidence_refs[0].quote}"
                  </Text>
                )}
                {act.status === 'suggested' && (
                  <View style={styles.pairRow}>
                    <View style={{ flex: 1 }}>
                      <PrimaryButton
                        title="Approve Task"
                        loading={decideMut.isPending}
                        onPress={() => decideMut.mutate({ id: act.action_id, decision: 'approved' })}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <PrimaryButton
                        title="Dismiss"
                        variant="secondary"
                        loading={decideMut.isPending}
                        onPress={() => decideMut.mutate({ id: act.action_id, decision: 'rejected' })}
                      />
                    </View>
                  </View>
                )}
              </Card>
            </FadeIn>
          ))
        )}
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
