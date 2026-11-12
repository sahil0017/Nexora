import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { colors, fontFamily, moduleColors, spacing } from '../../../app/theme/tokens';
import { VoiceQAResponse, voiceApi } from '../../../core/api/voice';
import { Card, Input, PrimaryButton, SectionHeading } from '../../../core/design-system/components';
import { Chip, FadeIn, StatusPill } from '../../../core/design-system/motion';
import { Screen } from '../../../shared/components/Screen';
import { useVoiceData } from '../VoiceContext';

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

  return (
    <Screen
      title="Reasoning & Memory"
      subtitle="Contradictions, temporal knowledge graph & grounded Q&A"
      badge="WS5, WS6 & WS8">
      <View style={styles.stack}>
        <FadeIn index={0}>
          <Card variant="featured" style={{ gap: spacing.s }}>
            <Text style={styles.cardTitle}>Source-Grounded Conversational Q&A</Text>
            <Input
              value={question}
              onChangeText={setQuestion}
              placeholder="Ask across your conversations (e.g. What quote did Ananya propose?)"
            />
            <View style={{ flexDirection: 'row', gap: spacing.s }}>
              <View style={{ flex: 1 }}>
                <PrimaryButton
                  title="Verify & Answer"
                  loading={qaMut.isPending}
                  onPress={() => {
                    if (question.trim()) qaMut.mutate(question.trim());
                  }}
                />
              </View>
              <PrimaryButton
                title="Search Memory"
                variant="secondary"
                loading={searchMut.isPending}
                onPress={() => {
                  if (question.trim()) searchMut.mutate(question.trim());
                }}
              />
            </View>
            {searchResults.length > 0 && (
              <View style={styles.qaBox}>
                <Text style={styles.metaText}>{searchResults.length} matching utterance(s)</Text>
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
                    label={`${qaResult.confidence_tier} (${Math.round(qaResult.confidence * 100)}%)`}
                    tone={qaResult.confidence_tier === 'HIGH' ? 'success' : 'warning'}
                  />
                  <Text style={styles.metaText}>{qaResult.citations.length} citation(s)</Text>
                </View>
                <Text style={styles.bodyPrimary}>{qaResult.answer}</Text>
                {qaResult.citations.map(c => (
                  <View key={`${c.utterance_id}-${c.start_ms}`} style={styles.citationCard}>
                    <Text style={styles.citationMeta}>
                      {c.conversation_title} · {c.speaker_label} @ {(c.start_ms / 1000).toFixed(1)}s
                    </Text>
                    <Text style={styles.citationQuote}>"{c.quote}"</Text>
                  </View>
                ))}
              </View>
            )}
          </Card>
        </FadeIn>

        <SectionHeading title="Reasoning Findings (WS5)" />
        {findings.length === 0 ? (
          <Card>
            <Text style={styles.bodySecondary}>No contradictions, negotiation shifts, or uncertainties detected in this conversation.</Text>
          </Card>
        ) : (
          findings.map((f, idx) => (
            <FadeIn key={f.finding_id} index={idx + 1}>
              <Card style={{ gap: 6, borderColor: f.severity === 'high' ? colors.statusWarning : colors.borderSubtle }}>
                <View style={styles.rowBetween}>
                  <StatusPill label={f.finding_type.toUpperCase()} tone={f.severity === 'high' ? 'warning' : 'info'} />
                  <Text style={styles.metaText}>{Math.round(f.confidence * 100)}% conf</Text>
                </View>
                <Text style={styles.cardTitle}>{f.title}</Text>
                <Text style={styles.bodySecondary}>{f.explanation}</Text>
              </Card>
            </FadeIn>
          ))
        )}

        <SectionHeading title="Temporal Knowledge Graph (WS6)" />
        <Card style={{ gap: spacing.s }}>
          <View style={styles.chipRow}>
            {entities.length === 0 ? (
              <Text style={styles.bodySecondary}>No extracted entities yet.</Text>
            ) : (
              entities.map(ent => (
                <Chip key={ent.entity_id} label={`${ent.canonical_name} (${ent.entity_type})`} active color={moduleColors.voice} />
              ))
            )}
          </View>
          {edges.slice(0, 6).map((e, i) => (
            <Text key={`${e.from_entity}-${e.to_entity}-${i}`} style={styles.metaText}>
              • {e.relation_type} (conf {Math.round(e.confidence * 100)}%)
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
