import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { colors, fontFamily, moduleColors, spacing } from '../../../app/theme/tokens';
import { VoiceQAResponse, voiceApi } from '../../../core/api/voice';
import { Card, Input, PrimaryButton, SectionHeading } from '../../../core/design-system/components';
import { Chip, FadeIn, StatusPill } from '../../../core/design-system/motion';
import { Screen } from '../../../shared/components/Screen';
import { useVoiceData } from '../VoiceContext';
import { ConversationSwitcher } from '../components/ConversationSwitcher';

const QUICK_PROMPTS = [
  'What did we decide?',
  'Who promised next steps?',
  'Any pricing or dates mentioned?',
  'Any open questions or risks?',
];

export default function VoiceMemoryScreen() {
  const { activeConversation } = useVoiceData();
  const [question, setQuestion] = useState('');
  const [qaResult, setQaResult] = useState<VoiceQAResponse | null>(null);
  const [searchResults, setSearchResults] = useState<Array<Record<string, any>>>([]);

  const qaMut = useMutation({
    mutationFn: (q: string) => voiceApi.askQA(q, activeConversation?.conversation_id),
    onSuccess: res => setQaResult(res),
  });

  const searchMut = useMutation({
    mutationFn: (q: string) => voiceApi.searchMemory(q),
    onSuccess: res => setSearchResults(res.results ?? []),
  });

  const findings = activeConversation?.reasoning_results ?? [];
  const entities = activeConversation?.extracted_knowledge?.entities ?? [];
  const edges = activeConversation?.extracted_knowledge?.edges ?? [];
  const citations = qaResult?.citations ?? [];

  const askSample = (prompt: string) => {
    setQuestion(prompt);
    qaMut.mutate(prompt);
  };

  return (
    <Screen
      title="Ask & Memory"
      subtitle="Ask questions across calls & meetings with verified quotes"
      badge="VOICE AI">
      <View style={styles.stack}>
        <ConversationSwitcher />

        <FadeIn index={0}>
          <Card variant="featured" style={{ gap: spacing.s }}>
            <Text style={styles.cardTitle}>Ask Your Conversations</Text>
            <Text style={styles.bodySecondary}>
              Get answers backed by exact spoken quotes, or search every saved transcript.
            </Text>
            <Input
              value={question}
              onChangeText={setQuestion}
              placeholder="Ask anything (e.g. What deadline did we agree on?)"
            />
            <View style={styles.chipRow}>
              {QUICK_PROMPTS.map(prompt => (
                <Chip
                  key={prompt}
                  label={prompt}
                  active={question === prompt}
                  color={moduleColors.voice}
                  onPress={() => askSample(prompt)}
                />
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.s }}>
              <View style={{ flex: 1 }}>
                <PrimaryButton
                  title="Ask with Quotes"
                  loading={qaMut.isPending}
                  onPress={() => {
                    if (question.trim()) qaMut.mutate(question.trim());
                  }}
                />
              </View>
              <PrimaryButton
                title="Search Transcripts"
                variant="secondary"
                loading={searchMut.isPending}
                onPress={() => {
                  if (question.trim()) searchMut.mutate(question.trim());
                }}
              />
            </View>
            {searchResults.length > 0 && (
              <View style={styles.qaBox}>
                <Text style={styles.metaText}>{searchResults.length} matching line(s)</Text>
                {searchResults.slice(0, 5).map((hit, idx) => (
                  <View key={`${hit.utterance_id ?? idx}-${idx}`} style={styles.citationCard}>
                    <Text style={styles.citationMeta}>
                      {hit.conversation_title ?? 'Conversation'} · {hit.speaker_label ?? 'Speaker'} @{' '}
                      {((Number(hit.start_ms) || 0) / 1000).toFixed(1)}s
                    </Text>
                    <Text style={styles.citationQuote}>{hit.text}</Text>
                  </View>
                ))}
              </View>
            )}
            {qaResult && (
              <View style={styles.qaBox}>
                <View style={styles.rowBetween}>
                  <StatusPill
                    label={`${qaResult.confidence_tier} (${Math.round((qaResult.confidence ?? 0) * 100)}%)`}
                    tone={qaResult.confidence_tier === 'HIGH' ? 'success' : 'warning'}
                  />
                  <Text style={styles.metaText}>{citations.length} quote(s)</Text>
                </View>
                <Text style={styles.bodyPrimary}>{qaResult.answer}</Text>
                {citations.map((c, idx) => (
                  <View key={`${c.utterance_id}-${c.start_ms}-${idx}`} style={styles.citationCard}>
                    <Text style={styles.citationMeta}>
                      {c.conversation_title} · {c.speaker_label} @ {((c.start_ms ?? 0) / 1000).toFixed(1)}s
                    </Text>
                    <Text style={styles.citationQuote}>"{c.quote}"</Text>
                  </View>
                ))}
              </View>
            )}
          </Card>
        </FadeIn>

        <SectionHeading title={`Key Insights & Shifts (${findings.length})`} />
        {findings.length === 0 ? (
          <Card>
            <Text style={styles.bodySecondary}>
              No contradictions, agreement shifts, or unresolved risks flagged in this conversation.
            </Text>
          </Card>
        ) : (
          findings.map((f, idx) => (
            <FadeIn key={f.finding_id || `${idx}`} index={idx + 1}>
              <Card style={{ gap: 6, borderColor: f.severity === 'high' ? colors.statusWarning : colors.borderSubtle }}>
                <View style={styles.rowBetween}>
                  <StatusPill
                    label={(f.finding_type || 'insight').replace(/_/g, ' ').toUpperCase()}
                    tone={f.severity === 'high' ? 'warning' : 'info'}
                  />
                  <Text style={styles.metaText}>{Math.round((f.confidence ?? 0) * 100)}% match</Text>
                </View>
                <Text style={styles.cardTitle}>{f.title}</Text>
                <Text style={styles.bodySecondary}>{f.explanation}</Text>
              </Card>
            </FadeIn>
          ))
        )}

        <SectionHeading title={`People, Topics & Key Terms (${entities.length})`} />
        <Card style={{ gap: spacing.s }}>
          <View style={styles.chipRow}>
            {entities.length === 0 ? (
              <Text style={styles.bodySecondary}>No key people or topics extracted yet.</Text>
            ) : (
              entities.map((ent, idx) => (
                <Chip
                  key={ent.entity_id || `${idx}`}
                  label={`${ent.canonical_name} (${ent.entity_type})`}
                  active
                  color={moduleColors.voice}
                />
              ))
            )}
          </View>
          {edges.slice(0, 6).map((e, i) => (
            <Text key={`${e.from_entity}-${e.to_entity}-${i}`} style={styles.metaText}>
              • {e.relation_type} ({Math.round((e.confidence ?? 0) * 100)}% match)
            </Text>
          ))}
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.m },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.s },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  cardTitle: { color: colors.textPrimary, fontFamily: fontFamily.medium, fontSize: 14, fontWeight: '700' },
  bodyPrimary: { color: colors.textPrimary, fontFamily: fontFamily.sans, fontSize: 13.5, lineHeight: 19 },
  bodySecondary: { color: colors.textSecondary, fontFamily: fontFamily.sans, fontSize: 12.5, lineHeight: 18 },
  metaText: { color: colors.textMuted, fontFamily: fontFamily.mono, fontSize: 11 },
  qaBox: { gap: spacing.s, paddingTop: spacing.xs },
  citationCard: {
    backgroundColor: colors.bgElevated,
    padding: spacing.s,
    borderRadius: 10,
    gap: 2,
  },
  citationMeta: { color: moduleColors.voice, fontFamily: fontFamily.mono, fontSize: 11 },
  citationQuote: { color: colors.textSecondary, fontFamily: fontFamily.sans, fontSize: 12, fontStyle: 'italic' },
});
