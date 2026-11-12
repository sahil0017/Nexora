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
import { colors, fontFamily, moduleColors, spacing } from '../../../app/theme/tokens';
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
    title: 'Wealth & Finance',
    subtitle: 'Net worth, cashflow, tax planning & portfolio insights',
    color: moduleColors.finance,
    prompts: ['Audit my cash & tax savings', 'Summarize my monthly spending', 'Should I prepay my loan or increase SIP?'],
  },
  work: {
    title: 'Work',
    subtitle: 'Tasks, projects & smart schedule prep',
    color: moduleColors.work,
    prompts: ['Summarize my work tasks', 'Prepare morning briefing', 'When should I leave for office?'],
  },
  assistant: {
    title: 'Copilot',
    subtitle: 'Personal AI assistant across commute, wealth & daily tasks',
    color: moduleColors.assistant,
    prompts: ['When should I leave for work?', 'Audit my cash & tax savings', 'Prepare morning briefing'],
  },
};

function resolveMeta(rawKey?: string) {
  const key = String(rawKey ?? 'health').trim().toLowerCase();
  if (MODULE_META[key]) return { key, meta: MODULE_META[key] };
  const title = key ? key.charAt(0).toUpperCase() + key.slice(1) : 'Module';
  return {
    key,
    meta: {
      title,
      subtitle: `${title} records, notes & Copilot insights`,
      color: colors.navBlue,
      prompts: [`Show my ${key} summary`, `Help me organize ${key} tasks`],
    },
  };
}

/** Multi-module workspace for Health, Work, and general modules inside NEXORA. */
export default function ModuleOverviewScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const qc = useQueryClient();
  const me = useMe();
  const userId = me.data?.id;

  const { key: moduleKey, meta } = resolveMeta(route.params?.module);
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
          <Text style={{ color: colors.textSecondary, fontFamily: fontFamily.sans, fontSize: 12.5, lineHeight: 18 }}>
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
                <Text style={{ color: colors.textPrimary, fontFamily: fontFamily.medium, fontWeight: '600', fontSize: 13.5 }}>{d.title}</Text>
                <Text style={{ color: colors.textSecondary, fontFamily: fontFamily.sans, fontSize: 12, marginTop: 2 }}>{d.content}</Text>
              </View>
              <Tappable onPress={() => delDoc.mutate(d.id)}>
                <Text style={{ color: colors.statusDanger, fontFamily: fontFamily.medium, fontSize: 11.5, fontWeight: '600' }}>Delete</Text>
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
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
  },
  addBtnText: { color: '#FFFFFF', fontFamily: fontFamily.medium, fontSize: 11.5, fontWeight: '700' },
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
