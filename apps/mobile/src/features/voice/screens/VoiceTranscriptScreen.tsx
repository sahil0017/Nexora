import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { colors, fontFamily, moduleColors, radii, spacing } from '../../../app/theme/tokens';
import { voiceApi } from '../../../core/api/voice';
import { Card, EmptyState, Input, PrimaryButton, SectionHeading } from '../../../core/design-system/components';
import { Chip, FadeIn, StatusPill } from '../../../core/design-system/motion';
import { Screen } from '../../../shared/components/Screen';
import { useVoiceData } from '../VoiceContext';

export default function VoiceTranscriptScreen() {
  const { activeConversation, refresh, refreshConversation } = useVoiceData();
  const [editingUttId, setEditingUttId] = useState<string | null>(null);
  const [correctedText, setCorrectedText] = useState('');
  const [reason, setReason] = useState('');

  const reprocessMut = useMutation({
    mutationFn: () => voiceApi.reprocess(activeConversation!.conversation_id),
    onSuccess: async () => {
      await refresh();
    },
  });

  const refreshIrMut = useMutation({
    mutationFn: () => refreshConversation(activeConversation!.conversation_id),
  });

  const correctMut = useMutation({
    mutationFn: () =>
      voiceApi.addCorrection(activeConversation!.conversation_id, {
        target_type: 'utterance_text',
        target_id: editingUttId!,
        corrected_value: correctedText.trim(),
        reason: reason.trim() || 'Human verification edit',
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
      <Screen title="Transcript & IR" subtitle="Speaker-attributed turns & dialogue events">
        <EmptyState title="No active conversation" hint="Capture or select a recording in the Capture tab." />
      </Screen>
    );
  }

  return (
    <Screen
      title="Transcript & Events"
      subtitle={activeConversation.title}
      badge="WS3 & WS4 · TAGSPEECH IR">
      <View style={styles.stack}>
        <SectionHeading title="Participants (JEDIS Speaker Cache)" />
        {activeConversation.recording.caller_name || activeConversation.recording.s3_presigned_status ? (
          <Card variant="subtle" style={{ gap: 4 }}>
            <View style={styles.rowBetween}>
              <Text style={styles.speakerLabel}>
                {activeConversation.recording.caller_name
                  ? `Caller: ${activeConversation.recording.caller_name} (${activeConversation.recording.caller_source || 'native'})`
                  : `Direction: ${activeConversation.recording.call_direction || 'call'}`}
              </Text>
              {activeConversation.recording.s3_presigned_status ? (
                <StatusPill
                  label={`S3 ${activeConversation.recording.s3_presigned_status.toUpperCase()}`}
                  tone={activeConversation.recording.s3_presigned_status === 'uploaded' ? 'success' : 'info'}
                />
              ) : null}
            </View>
            {activeConversation.recording.s3_object_key ? (
              <Text style={styles.metaText} numberOfLines={1}>
                {activeConversation.recording.storage_uri}
              </Text>
            ) : null}
          </Card>
        ) : null}
        <View style={styles.chipRow}>
          <PrimaryButton
            title="Reprocess 10-Workstream IR"
            variant="secondary"
            loading={reprocessMut.isPending}
            onPress={() => reprocessMut.mutate()}
          />
          <PrimaryButton
            title="Refresh IR"
            variant="secondary"
            loading={refreshIrMut.isPending}
            onPress={() => refreshIrMut.mutate()}
          />
        </View>
        <View style={styles.chipRow}>
          {activeConversation.participants.map(p => (
            <Chip
              key={p.participant_id}
              label={`${p.display_name} (${p.speaker_label}) · ${Math.round(p.talk_time_ms / 1000)}s`}
              active
              color={moduleColors.voice}
            />
          ))}
        </View>

        {activeConversation.interaction_edges && activeConversation.interaction_edges.length > 0 && (
          <>
            <SectionHeading title="Who Is Speaking to Whom & What" />
            <Card variant="featured" style={{ gap: spacing.xs, borderColor: moduleColors.voice }}>
              {activeConversation.interaction_edges.map((edge, idx) => (
                <View key={`${edge.from_speaker}->${edge.to_speaker}:${idx}`} style={styles.edgeRow}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.speakerLabel}>
                      {edge.from_name || edge.from_speaker} → {edge.to_name || edge.to_speaker}
                    </Text>
                    <StatusPill
                      label={`${(edge.last_topic || 'general').replace(/_/g, ' ').toUpperCase()} · ${edge.turn_count}x`}
                      tone={edge.primary_acts?.includes('disagreement') ? 'warning' : 'info'}
                    />
                  </View>
                  <Text style={styles.uttText}>{edge.sample_summary}</Text>
                  <Text style={styles.metaText}>
                    Acts: {(edge.primary_acts || []).join(', ') || 'inform'} · Weight {Math.round((edge.strength || 0) * 100)}%
                  </Text>
                </View>
              ))}
            </Card>
          </>
        )}

        <SectionHeading title="Speaker-Attributed Utterances (Immutable Raw Layer)" />
        {activeConversation.utterances.map((u, idx) => {
          const isEditing = editingUttId === u.utterance_id;
          return (
            <FadeIn key={u.utterance_id} index={idx}>
              <Card style={{ gap: spacing.xs }}>
                <View style={styles.rowBetween}>
                  <Text style={styles.speakerLabel}>
                    {u.speaker_label}
                    {u.to_speakers && u.to_speakers.length > 0 ? ` → ${u.to_speakers.join(', ')}` : ''} ·{' '}
                    {(u.start_ms / 1000).toFixed(1)}s–{(u.end_ms / 1000).toFixed(1)}s · {u.language}
                  </Text>
                  <StatusPill
                    label={u.overlap_detected ? 'OVERLAP' : `${Math.round(u.confidence * 100)}%`}
                    tone={u.overlap_detected ? 'warning' : u.confidence >= 0.8 ? 'success' : 'info'}
                  />
                </View>
                {u.what_is_spoken ? (
                  <View style={styles.chipRow}>
                    <StatusPill
                      label={(u.addressing_mode || 'reply_to_previous').replace(/_/g, ' ').toUpperCase()}
                      tone="info"
                    />
                    <Text style={styles.whatText}>{u.what_is_spoken}</Text>
                  </View>
                ) : null}
                <Text style={styles.uttText}>{u.original_text}</Text>
                {u.uncertainty_reason ? (
                  <Text style={styles.warnText}>Uncertainty: {u.uncertainty_reason}</Text>
                ) : null}

                <TouchableOpacity
                  onPress={() => {
                    if (isEditing) {
                      setEditingUttId(null);
                    } else {
                      setEditingUttId(u.utterance_id);
                      setCorrectedText(u.original_text);
                    }
                  }}>
                  <Text style={styles.editLink}>{isEditing ? 'Cancel edit' : '✎ Log Human Correction (WS8)'}</Text>
                </TouchableOpacity>

                {isEditing && (
                  <View style={styles.editBox}>
                    <Input value={correctedText} onChangeText={setCorrectedText} placeholder="Corrected utterance text" />
                    <Input value={reason} onChangeText={setReason} placeholder="Reason (optional)" />
                    <PrimaryButton
                      title="Save Immutable Correction"
                      loading={correctMut.isPending}
                      onPress={() => correctMut.mutate()}
                    />
                  </View>
                )}
              </Card>
            </FadeIn>
          );
        })}

        <SectionHeading title="Structured Conversation Events (WS4)" />
        {activeConversation.conversation_events.map((ev, idx) => (
          <FadeIn key={ev.event_id} index={idx}>
            <Card variant="subtle" style={{ gap: 4 }}>
              <View style={styles.rowBetween}>
                <StatusPill label={ev.event_type.toUpperCase()} tone="info" />
                <Text style={styles.metaText}>
                  {ev.actor_speaker} · {ev.dialogue_act}
                </Text>
              </View>
              <Text style={styles.uttText}>{ev.summary}</Text>
              {ev.due_at ? <Text style={styles.warnText}>Due anchor: {ev.due_at}</Text> : null}
            </Card>
          </FadeIn>
        ))}

        {activeConversation.human_corrections.length > 0 && (
          <>
            <SectionHeading title="Logged Human Corrections (WS8)" />
            {activeConversation.human_corrections.map(hc => (
              <Card key={hc.correction_id} style={{ gap: 4, borderColor: colors.accentPrimary }}>
                <Text style={styles.speakerLabel}>Target: {hc.target_type}</Text>
                <Text style={styles.metaText}>Original: {hc.original_value}</Text>
                <Text style={styles.uttText}>Corrected: {hc.corrected_value}</Text>
              </Card>
            ))}
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.m },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.s },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  speakerLabel: { color: moduleColors.voice, fontFamily: fontFamily.mono, fontSize: 11.5, fontWeight: '700' },
  uttText: { color: colors.textPrimary, fontFamily: fontFamily.sans, fontSize: 13.5, lineHeight: 19 },
  warnText: { color: colors.statusWarning, fontFamily: fontFamily.sans, fontSize: 11.5 },
  metaText: { color: colors.textMuted, fontFamily: fontFamily.mono, fontSize: 11 },
  whatText: { color: colors.textSecondary, fontFamily: fontFamily.sans, fontSize: 11.5, flex: 1 },
  edgeRow: { gap: 3, paddingBottom: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  editLink: { color: colors.navBlue, fontFamily: fontFamily.medium, fontSize: 12, fontWeight: '600', marginTop: 2 },
  editBox: { gap: spacing.s, marginTop: spacing.xs, padding: spacing.s, backgroundColor: colors.bgElevated, borderRadius: radii.card },
});
