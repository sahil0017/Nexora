import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Screen } from '../../../shared/components/Screen';
import {
  Card,
  EmptyState,
  Input,
  PrimaryButton,
  SectionHeading,
} from '../../../core/design-system/components';
import { Chip, FadeIn, Skeleton, StatusPill, Tappable } from '../../../core/design-system/motion';
import { colors, moduleColors, spacing } from '../../../app/theme/tokens';
import { platformApi } from '../../../core/api/move';
import { useMe } from '../../../core/auth/useMe';

const MODULE_META: Record<
  string,
  { title: string; subtitle: string; color: string; prompts: string[] }
> = {
  health: {
    title: 'Health',
    subtitle: 'Reports, wellness insights & daily check-ins',
    color: moduleColors.health,
    prompts: ['Show my health summary', 'Analyze my latest lab metrics', 'Remind me of daily wellness goals'],
  },
  finance: {
    title: 'Finance',
    subtitle: 'Spending overview, commute cost & budgets',
    color: moduleColors.finance,
    prompts: ['Show my spending overview', 'Summarize my monthly commute spend', 'Budget tips for this week'],
  },
  work: {
    title: 'Work',
    subtitle: 'Tasks, projects & smart schedule prep',
    color: moduleColors.work,
    prompts: ['Summarize my work tasks', 'Prepare morning briefing', 'When should I leave for office?'],
  },
};

/** Multi-module workspace for Health, Finance, and Work modules inside NEXORA. */
export default function ModuleOverviewScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const qc = useQueryClient();
  const me = useMe();
  const userId = me.data?.id;

  const moduleKey: string = route.params?.module ?? 'health';
  const meta = MODULE_META[moduleKey] ?? MODULE_META.health;
  const isEnabled = me.data?.modules?.includes(moduleKey) ?? true;

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const docs = useQuery({
    queryKey: ['documents', userId],
    queryFn: () => platformApi.listDocs(userId!, 15),
    enabled: !!userId,
    retry: 0,
  });

  const addDoc = useMutation({
    mutationFn: () =>
      platformApi.saveDoc({
        user_id: userId!,
        title: `[${meta.title}] ${title.trim() || 'Entry'}`,
        content: body.trim(),
      }),
    onSuccess: () => {
      setTitle('');
      setBody('');
      setShowAdd(false);
      qc.invalidateQueries({ queryKey: ['documents', userId] });
    },
  });

  const delDoc = useMutation({
    mutationFn: (id: string) => platformApi.deleteDoc(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents', userId] }),
  });

  const allDocs = docs.data?.documents ?? [];
  const moduleDocs = allDocs.filter(d => d.title?.toLowerCase().includes(moduleKey));

  return (
    <Screen
      title={meta.title}
      subtitle={meta.subtitle}
      backLabel="← Nexora"
      rightAction={
        <TouchableOpacity onPress={() => setShowAdd(v => !v)} style={styles.addBtn}>
          <Text style={styles.addBtnText}>{showAdd ? 'Close' : '+ New Note'}</Text>
        </TouchableOpacity>
      }>
      <FadeIn index={0}>
        <Card variant="featured" style={{ gap: spacing.s }}>
          <View style={styles.between}>
            <StatusPill
              label={isEnabled ? `${meta.title.toUpperCase()} · CONNECTED` : `${meta.title.toUpperCase()} · PREVIEW`}
              tone={isEnabled ? 'success' : 'warning'}
            />
            <View style={[styles.dot, { backgroundColor: meta.color }]} />
          </View>
          <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
            Ask NEXORA Copilot about your {meta.title.toLowerCase()} workflows or capture quick records below.
          </Text>
          <View style={styles.chips}>
            {meta.prompts.map(p => (
              <Chip
                key={p}
                label={p}
                onPress={() => nav.navigate('Tabs', { screen: 'AI', params: { prompt: p, nonce: Date.now() } })}
              />
            ))}
          </View>
        </Card>
      </FadeIn>

      {showAdd && (
        <FadeIn index={1} style={{ marginTop: spacing.m }}>
          <Card style={{ gap: spacing.s }}>
            <Text style={{ color: colors.textPrimary, fontWeight: '700' }}>Add {meta.title} record</Text>
            <Input value={title} onChangeText={setTitle} placeholder={`${meta.title} title…`} />
            <Input value={body} onChangeText={setBody} placeholder="Details…" />
            <PrimaryButton
              title={`Save to ${meta.title}`}
              variant="nav"
              onPress={() => addDoc.mutate()}
              disabled={!userId || !body.trim()}
              loading={addDoc.isPending}
            />
          </Card>
        </FadeIn>
      )}

      <SectionHeading
        title={`${meta.title} records`}
        action="Ask Copilot →"
        onActionPress={() =>
          nav.navigate('Tabs', {
            screen: 'AI',
            params: { prompt: `Show my ${moduleKey} summary`, nonce: Date.now() },
          })
        }
      />

      <Card style={{ gap: spacing.s }}>
        {docs.isLoading ? (
          <Skeleton height={24} />
        ) : moduleDocs.length === 0 ? (
          <EmptyState
            title={`No ${meta.title.toLowerCase()} records yet`}
            hint="Tap + New Note above to store notes or launch Copilot for insights."
          />
        ) : (
          moduleDocs.map(d => (
            <View key={d.id} style={styles.docRow}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.textPrimary, fontWeight: '700' }}>{d.title}</Text>
                <Text style={{ color: colors.textSecondary, fontSize: 12.5, marginTop: 2 }}>{d.content}</Text>
              </View>
              <Tappable onPress={() => delDoc.mutate(d.id)}>
                <Text style={{ color: colors.statusDanger, fontSize: 12, fontWeight: '700' }}>Delete</Text>
              </Tappable>
            </View>
          ))
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  addBtn: {
    backgroundColor: colors.navBlue,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  addBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.bgElevated,
    borderRadius: 12,
    padding: 12,
  },
});
