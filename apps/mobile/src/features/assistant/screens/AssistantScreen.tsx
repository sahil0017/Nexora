import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, moduleColors, spacing, typography } from '../../../app/theme/tokens';

type Msg = { from: 'user' | 'assistant'; text: string };

// AI-01 Assistant — universal conversation surface.
// Tool approvals (AI-02) and agent run detail (AI-03) attach to this flow in M2.
export default function AssistantScreen() {
  const [messages, setMessages] = useState<Msg[]>([
    { from: 'assistant', text: 'How can I help? Ask about your day, commute, health, finances or tasks.' },
  ]);
  const [draft, setDraft] = useState('');

  const send = () => {
    if (!draft.trim()) return;
    setMessages(m => [...m, { from: 'user', text: draft }, { from: 'assistant', text: 'Thinking…' }]);
    setDraft('');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={styles.header}>
          <Text style={[typography.screenTitle, { color: colors.textPrimary }]}>NEXORA AI</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 13 }}>Your personal assistant</Text>
        </View>

        <View style={{ flex: 1, padding: spacing.m, gap: spacing.s }}>
          {messages.map((m, i) => (
            <View
              key={i}
              style={[styles.bubble, m.from === 'user' ? styles.userBubble : styles.assistantBubble]}>
              <Text style={{ color: colors.textPrimary }}>{m.text}</Text>
            </View>
          ))}
        </View>

        <View style={styles.modulesRow}>
          {(['move', 'health', 'finance', 'work'] as const).map(k => (
            <View key={k} style={styles.moduleChip}>
              <View style={[styles.dot, { backgroundColor: moduleColors[k] }]} />
              <Text style={{ color: colors.textSecondary, fontSize: 12, textTransform: 'capitalize' }}>{k}</Text>
            </View>
          ))}
        </View>

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            placeholder="Message NEXORA..."
            placeholderTextColor={colors.textSecondary}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={send}
          />
          <Text onPress={send} style={styles.send}>
            ↑
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bgPrimary },
  header: { paddingHorizontal: spacing.m, paddingTop: spacing.m },
  bubble: {
    maxWidth: '85%',
    padding: spacing.m,
    borderRadius: 18,
    backgroundColor: colors.bgSurface,
  },
  userBubble: { alignSelf: 'flex-end', backgroundColor: colors.bgElevated },
  assistantBubble: { alignSelf: 'flex-start' },
  modulesRow: {
    flexDirection: 'row',
    gap: spacing.s,
    paddingHorizontal: spacing.m,
    paddingBottom: spacing.s,
  },
  moduleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.bgSurface,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    padding: spacing.m,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  input: {
    flex: 1,
    backgroundColor: colors.bgElevated,
    borderRadius: 999,
    paddingHorizontal: spacing.m,
    height: 46,
    color: colors.textPrimary,
  },
  send: { color: colors.accentPrimary, fontSize: 22, paddingHorizontal: 8 },
});
