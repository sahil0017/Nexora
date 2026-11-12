import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors, fontFamily, moduleColors, radii, spacing } from '../../../app/theme/tokens';
import { ConversationIR, voiceApi } from '../../../core/api/voice';
import { openRecordingDownload } from '../../../core/native/callerIdBridge';
import { useVoiceData } from '../VoiceContext';

export function formatSourceLabel(sourceType?: string): string {
  switch ((sourceType || '').toLowerCase()) {
    case 'call':
    case 'phone_call':
      return 'Call';
    case 'meeting':
      return 'Meeting';
    case 'upload':
    case 'recording':
      return 'Recording';
    case 'note':
    case 'voice_note':
      return 'Note';
    default:
      return sourceType ? sourceType.replace(/_/g, ' ') : 'Voice';
  }
}

export async function triggerConversationDownload(
  conv: ConversationIR,
): Promise<{ ok: boolean; kind: 'audio' | 'transcript'; resolvedUrl: string }> {
  const safeSlug =
    (conv.title || 'conversation')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 32) || conv.conversation_id.slice(0, 8);

  let targetUrl = voiceApi.downloadTranscriptUrl(conv.conversation_id);
  let kind: 'audio' | 'transcript' = 'transcript';
  let filename = `nexora-${safeSlug}-transcript.txt`;

  if (conv.recording?.recording_id) {
    try {
      const presigned = await voiceApi.presignDownload(conv.recording.recording_id);
      if (presigned?.has_audio_object && presigned.download_url) {
        targetUrl = presigned.download_url;
        kind = 'audio';
        filename = `nexora-${safeSlug}.wav`;
      } else if (presigned?.transcript_download_url) {
        targetUrl = presigned.transcript_download_url;
      } else if (presigned?.download_url) {
        targetUrl = presigned.download_url;
      }
    } catch {
      // Fall back cleanly to transcript archive endpoint
    }
  }

  const res = await openRecordingDownload(targetUrl, filename);
  return { ok: res.opened, kind, resolvedUrl: res.resolvedUrl };
}

export function ConversationSwitcher() {
  const { conversations, activeConversation, setActiveConversationId } = useVoiceData();
  const nav = useNavigation<any>();
  const [dlState, setDlState] = useState<'idle' | 'busy' | 'done' | 'err'>('idle');

  if (!conversations.length) return null;

  const handleDownloadActive = async () => {
    if (!activeConversation) return;
    setDlState('busy');
    try {
      const res = await triggerConversationDownload(activeConversation);
      setDlState(res.ok ? 'done' : 'err');
      setTimeout(() => setDlState('idle'), 2500);
    } catch {
      setDlState('err');
      setTimeout(() => setDlState('idle'), 2500);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.caption}>CONVERSATION ({conversations.length})</Text>
        <View style={styles.headerActions}>
          {activeConversation ? (
            <TouchableOpacity style={styles.smallBtn} onPress={handleDownloadActive} activeOpacity={0.75}>
              <Text style={styles.smallBtnText}>
                {dlState === 'done' ? '✓ Downloaded' : dlState === 'busy' ? 'Preparing…' : dlState === 'err' ? 'Retry ↓' : '↓ Download'}
              </Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={styles.smallBtn}
            onPress={() => nav.navigate('VoiceCapture')}
            activeOpacity={0.75}
          >
            <Text style={[styles.smallBtnText, { color: colors.textSecondary }]}>≡ Library</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollRow}>
        {conversations.map(conv => {
          const isSelected = conv.conversation_id === activeConversation?.conversation_id;
          return (
            <TouchableOpacity
              key={conv.conversation_id}
              onPress={() => setActiveConversationId(conv.conversation_id)}
              activeOpacity={0.8}
              style={[styles.pill, isSelected ? styles.pillActive : null]}
            >
              <Text style={[styles.pillTitle, isSelected ? styles.pillTitleActive : null]} numberOfLines={1}>
                {conv.title || 'Untitled Conversation'}
              </Text>
              <Text style={styles.pillMeta}>
                {formatSourceLabel(conv.recording?.source_type)} · {conv.utterances.length} lines
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.m,
    gap: 6,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.s,
  },
  caption: {
    color: colors.textMuted,
    fontFamily: fontFamily.medium,
    fontWeight: '600',
    fontSize: 10,
    letterSpacing: 0.7,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  smallBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgSurface,
  },
  smallBtnText: {
    color: moduleColors.voice,
    fontFamily: fontFamily.medium,
    fontWeight: '600',
    fontSize: 11,
  },
  scrollRow: {
    gap: spacing.s,
    paddingRight: spacing.s,
  },
  pill: {
    maxWidth: 210,
    paddingHorizontal: spacing.s,
    paddingVertical: 7,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgSurface,
  },
  pillActive: {
    borderColor: moduleColors.voice,
    backgroundColor: 'rgba(167,139,250,0.14)',
  },
  pillTitle: {
    color: colors.textPrimary,
    fontFamily: fontFamily.medium,
    fontSize: 12,
  },
  pillTitleActive: {
    color: moduleColors.voice,
    fontFamily: fontFamily.medium,
    fontWeight: '700',
  },
  pillMeta: {
    color: colors.textMuted,
    fontFamily: fontFamily.mono,
    fontSize: 10,
    marginTop: 2,
  },
});
