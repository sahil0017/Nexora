import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { colors, fontFamily, moduleColors, spacing } from '../../../app/theme/tokens';
import { voiceApi } from '../../../core/api/voice';
import { Card, EmptyState, Input, PrimaryButton, SectionHeading } from '../../../core/design-system/components';
import { Chip, FadeIn, StatusPill } from '../../../core/design-system/motion';
import { Screen } from '../../../shared/components/Screen';
import { useVoiceData } from '../VoiceContext';
import { ConversationSwitcher, formatSourceLabel, triggerConversationDownload } from '../components/ConversationSwitcher';

export default function VoiceTranscriptScreen() {
  const { activeConversation, refresh, refreshConversation } = useVoiceData();
  const [editingUttId, setEditingUttId] = useState<string | null>(null);
  const [correctedText, setCorrectedText] = useState('');
  const [reason, setReason] = useState('');
  const [downloadNote, setDownloadNote] = useState<string | null>(null);

  const reprocessMut = useMutation({
    mutationFn: () => voiceApi.reprocess(activeConversation!.conversation_id),
    onSuccess: async () => {
      await refresh();
    },
  });

  const refreshIrMut = useMutation({
    mutationFn: () => refreshConversation(activeConversation!.conversation_id),
  });

  const downloadMut = useMutation({
    mutationFn: () => triggerConversationDownload(activeConversation!),
    onSuccess: res => {
      setDownloadNote(
        res.kind === 'audio'
          ? 'Opened audio recording download.'
          : 'Downloaded full conversation transcript (.txt).',
      );
    },
    onError: err => {
      setDownloadNote((err as Error)?.message ?? 'Unable to prepare download right now.');
    },
  });

  const correctMut = useMutation({
    mutationFn: () =>
      voiceApi.addCorrection(activeConversation!.conversation_id, {
        target_type: 'utterance_text',
        target_id: editingUttId!,
        corrected_value: correctedText.trim(),
        reason: reason.trim() || 'User transcript edit',
      }),
    onSuccess: async () => {
      setEditingUttId(null);
      setCorrectedText('');
      setReason('');
      await refresh();
    },
  });

  if (!activeConversation) {
    return (
      <Screen
        title="Transcript"
        subtitle="Select a call, meeting, or voice note to read its transcript"
        badge="VOICE"
      >
        <EmptyState
          title="No Conversation Selected"
          hint="Record a note, start a live call session, or import device call logs from the Library tab first."
        />
      </Screen>
    );
  }

  const utterances = activeConversation.utterances ?? [];
  const participants = activeConversation.participants ?? [];
  const interactionEdges = activeConversation.interaction_edges ?? [];
  const events = activeConversation.conversation_events ?? [];
  const corrections = activeConversation.human_corrections ?? [];
  const languages = activeConversation.detected_languages ?? [];
  const callerName = activeConversation.recording?.caller_name;
  const callerPhone = activeConversation.recording?.caller_phone_masked;

  return (
    <Screen
      title="Transcript"
      subtitle={activeConversation.title || 'Selected Conversation'}
      badge={formatSourceLabel(activeConversation.recording?.source_type).toUpperCase()}
    >
      <View style={styles.stack}>
        <ConversationSwitcher />

        <FadeIn index={0}>
          <Card variant="featured" style={{ gap: spacing.s }}>
            <View style={styles.topMeta}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{activeConversation.title}</Text>
                <Text style={styles.meta}>
                  {formatSourceLabel(activeConversation.recording?.source_type)}
                  {languages.length ? ` · ${languages.join(', ').toUpperCase()}` : ''}
                  {` · ${Math.round((activeConversation.overall_confidence ?? 0) * 100)}% confidence`}
                </Text>
                {callerName || callerPhone ? (
                  <Text style={styles.callerLine}>
                    Caller: {[callerName, callerPhone].filter(Boolean).join(' · ')}
                    {activeConversation.recording?.call_direction
                      ? ` (${activeConversation.recording.call_direction})`
                      : ''}
                  </Text>
                ) : null}
              </View>
              <StatusPill
                label={(activeConversation.status || 'captured').toUpperCase()}
                tone={activeConversation.status === 'processed' ? 'success' : 'info'}
              />
            </View>

            {activeConversation.summary ? (
              <Text style={styles.summary}>{activeConversation.summary}</Text>
            ) : (
              <Text style={styles.summaryMuted}>
                Summary will appear once spoken lines are analyzed.
              </Text>
            )}

            <View style={styles.actionRow}>
              <View style={{ flex: 1 }}>
                <PrimaryButton
                  title={downloadMut.isPending ? 'Preparing…' : 'Download File'}
                  onPress={() => downloadMut.mutate()}
                  loading={downloadMut.isPending}
                />
              </View>
              <View style={{ flex: 1 }}>
                <PrimaryButton
                  title={refreshIrMut.isPending ? 'Refreshing…' : 'Refresh'}
                  onPress={() => refreshIrMut.mutate()}
                  loading={refreshIrMut.isPending}
                  variant="secondary"
                />
              </View>
              <View style={{ flex: 1 }}>
                <PrimaryButton
                  title={reprocessMut.isPending ? 'Analyzing…' : 'Re-analyze'}
                  onPress={() => reprocessMut.mutate()}
                  loading={reprocessMut.isPending}
                  variant="nav"
                />
              </View>
            </View>
            {downloadNote ? <Text style={styles.downloadHint}>{downloadNote}</Text> : null}
          </Card>
        </FadeIn>

        {participants.length > 0 ? (
          <>
            <SectionHeading title={`Speakers (${participants.length})`} />
            <View style={styles.speakerRow}>
              {participants.map((p, idx) => (
                <Chip
                  key={p.participant_id || `${idx}`}
                  label={`${p.display_name} (${p.utterance_count ?? 0} lines)`}
                  active
                  color={moduleColors.voice}
                />
              ))}
            </View>
          </>
        ) : null}

        {interactionEdges.length > 0 ? (
          <FadeIn index={1}>
            <SectionHeading title={`Conversation Dynamics (${interactionEdges.length})`} />
            <Card style={{ gap: 6 }}>
              {interactionEdges.map((edge, idx) => (
                <View key={`${edge.from_speaker}-${edge.to_speaker}-${idx}`} style={styles.dynRow}>
                  <Text style={styles.dynText}>
                    {edge.from_name || edge.from_speaker} → {edge.to_name || edge.to_speaker}
                  </Text>
                  <Text style={styles.dynMeta}>
                    {edge.turn_count} turns{edge.last_topic ? ` · ${edge.last_topic}` : ''}
                  </Text>
                </View>
              ))}
            </Card>
          </FadeIn>
        ) : null}

        <SectionHeading title={`Full Transcript (${utterances.length})`} />
        {utterances.length === 0 ? (
          <Card>
            <EmptyState
              title="No Transcript Lines Yet"
              hint="This conversation has not received spoken lines yet. Add turns or tap Refresh."
            />
          </Card>
        ) : (
          utterances.map((utt, idx) => {
            const isEditing = editingUttId === utt.utterance_id;
            return (
              <FadeIn key={utt.utterance_id || `${idx}`} index={Math.min(idx, 6)}>
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => {
                    setEditingUttId(isEditing ? null : utt.utterance_id);
                    setCorrectedText(utt.original_text || '');
                  }}
                >
                  <Card variant={isEditing ? 'featured' : 'default'} style={{ gap: 6 }}>
                    <View style={styles.uttHeader}>
                      <Text style={styles.speaker}>
                        {utt.speaker_label || 'Speaker'} · {(utt.language || 'en').toUpperCase()}
                      </Text>
                      <Text style={styles.time}>
                        {((utt.start_ms ?? 0) / 1000).toFixed(1)}s – {((utt.end_ms ?? 0) / 1000).toFixed(1)}s
                      </Text>
                    </View>
                    <Text style={styles.uttText}>{utt.original_text}</Text>
                    {utt.what_is_spoken ? (
                      <Text style={styles.translated}>Topic: {utt.what_is_spoken}</Text>
                    ) : null}
                    <View style={styles.flagsRow}>
                      <Text style={styles.flag}>
                        {Math.round((utt.confidence ?? 0) * 100)}% match
                      </Text>
                      {utt.overlap_detected ? <StatusPill label="OVERLAP" tone="warning" /> : null}
                      {utt.uncertainty_reason ? <StatusPill label="UNCERTAIN" tone="info" /> : null}
                      <Text style={styles.tapHint}>{isEditing ? 'Editing…' : 'Tap to fix'}</Text>
                    </View>

                    {isEditing ? (
                      <View style={styles.editBox}>
                        <Text style={styles.fieldLbl}>Correct Transcript Line</Text>
                        <Input
                          value={correctedText}
                          onChangeText={setCorrectedText}
                          multiline
                        />
                        <Text style={styles.fieldLbl}>Reason (Optional)</Text>
                        <Input
                          value={reason}
                          onChangeText={setReason}
                          placeholder="e.g., Fixed speaker name or amount"
                        />
                        <View style={styles.editBtnRow}>
                          <View style={{ flex: 1 }}>
                            <PrimaryButton
                              title={correctMut.isPending ? 'Saving…' : 'Save Edit'}
                              onPress={() => correctMut.mutate()}
                              loading={correctMut.isPending}
                            />
                          </View>
                          <PrimaryButton
                            title="Cancel"
                            onPress={() => setEditingUttId(null)}
                            variant="secondary"
                          />
                        </View>
                      </View>
                    ) : null}
                  </Card>
                </TouchableOpacity>
              </FadeIn>
            );
          })
        )}

        {events.length > 0 ? (
          <>
            <SectionHeading title={`Key Decisions & Commitments (${events.length})`} />
            <Card style={{ gap: spacing.s }}>
              {events.map((ev, idx) => (
                <View key={ev.event_id || `${idx}`} style={styles.eventRow}>
                  <StatusPill label={(ev.event_type || 'event').toUpperCase()} tone="info" />
                  <Text style={styles.eventText}>{ev.summary}</Text>
                  <Text style={styles.eventMeta}>
                    {ev.actor_speaker || 'Speaker'} · {Math.round((ev.confidence ?? 0) * 100)}% confidence
                  </Text>
                </View>
              ))}
            </Card>
          </>
        ) : null}

        {corrections.length > 0 ? (
          <>
            <SectionHeading title={`Transcript Edits (${corrections.length})`} />
            <Card style={{ gap: spacing.s }}>
              {corrections.map((c, idx) => (
                <View key={c.correction_id || `${idx}`} style={styles.corrRow}>
                  <Text style={styles.corrVal}>Updated: {c.corrected_value}</Text>
                  <Text style={styles.corrMeta}>
                    Was: “{c.original_value}” · {c.reason}
                  </Text>
                </View>
              ))}
            </Card>
          </>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.m },
  topMeta: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.s },
  title: { color: colors.textPrimary, fontFamily: fontFamily.medium, fontWeight: '700', fontSize: 16 },
  meta: { color: colors.textMuted, fontFamily: fontFamily.mono, fontSize: 11, marginTop: 2 },
  callerLine: { color: colors.textSecondary, fontFamily: fontFamily.medium, fontSize: 12, marginTop: 4 },
  summary: { color: colors.textSecondary, fontFamily: fontFamily.sans, fontSize: 13, lineHeight: 19 },
  summaryMuted: { color: colors.textMuted, fontFamily: fontFamily.sans, fontSize: 13, fontStyle: 'italic' },
  actionRow: { flexDirection: 'row', gap: spacing.s, flexWrap: 'wrap' },
  downloadHint: { color: moduleColors.voice, fontFamily: fontFamily.medium, fontSize: 12 },
  speakerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s },
  dynRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  dynText: { color: colors.textPrimary, fontFamily: fontFamily.medium, fontSize: 13 },
  dynMeta: { color: colors.textMuted, fontFamily: fontFamily.mono, fontSize: 11 },
  uttHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  speaker: { color: moduleColors.voice, fontFamily: fontFamily.medium, fontWeight: '700', fontSize: 12 },
  time: { color: colors.textMuted, fontFamily: fontFamily.mono, fontSize: 11 },
  uttText: { color: colors.textPrimary, fontFamily: fontFamily.sans, fontSize: 14, lineHeight: 20 },
  translated: { color: colors.textSecondary, fontFamily: fontFamily.sans, fontSize: 12, fontStyle: 'italic' },
  flagsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.s, flexWrap: 'wrap', marginTop: 2 },
  flag: { color: colors.textMuted, fontFamily: fontFamily.mono, fontSize: 11 },
  tapHint: { color: colors.textMuted, fontFamily: fontFamily.sans, fontSize: 11, marginLeft: 'auto' },
  editBox: { gap: spacing.s, marginTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.borderSubtle, paddingTop: spacing.s },
  fieldLbl: { color: colors.textSecondary, fontFamily: fontFamily.medium, fontSize: 11, fontWeight: '600' },
  editBtnRow: { flexDirection: 'row', gap: spacing.s, alignItems: 'center' },
  eventRow: { paddingVertical: 6, gap: 4, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  eventText: { color: colors.textPrimary, fontFamily: fontFamily.medium, fontSize: 13 },
  eventMeta: { color: colors.textMuted, fontFamily: fontFamily.mono, fontSize: 11 },
  corrRow: { paddingVertical: 5, gap: 2 },
  corrVal: { color: colors.statusSuccess, fontFamily: fontFamily.medium, fontSize: 13 },
  corrMeta: { color: colors.textMuted, fontFamily: fontFamily.sans, fontSize: 11 },
});
