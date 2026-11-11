import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Screen } from '../../../shared/components/Screen';
import {
  Card,
  EmptyState,
  Input,
  PrimaryButton,
  SegmentedControl,
} from '../../../core/design-system/components';
import { FadeIn, Skeleton, Tappable } from '../../../core/design-system/motion';
import { colors, moduleColors, spacing } from '../../../app/theme/tokens';
import { moveApi, platformApi } from '../../../core/api/move';
import { useMe } from '../../../core/auth/useMe';

const MODULE_INFO: Record<string, { label: string; desc: string }> = {
  move: { label: 'Mobility (MoveSmart)', desc: '3D Navigation HUD, Live Radar, Places & Prefs' },
  health: { label: 'Health', desc: 'Reports, wellness records & health insights' },
  finance: { label: 'Finance', desc: 'Budgets, commute spend & financial overview' },
  work: { label: 'Work', desc: 'Tasks, morning briefs & schedule automation' },
};

const TABS = [
  { key: 'modules', label: 'Modules' },
  { key: 'notes', label: 'Notes' },
  { key: 'stack', label: 'AI Stack' },
] as const;

// EX-01 NEXORA Explore — directory for all NEXORA modules, shared notes (/documents), and AI stack.
export default function ExploreScreen() {
  const nav = useNavigation<any>();
  const qc = useQueryClient();
  const me = useMe();
  const userId = me.data?.id;

  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('modules');
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [expandedLayer, setExpandedLayer] = useState<string | null>(null);

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
        title: noteTitle.trim() || 'NEXORA note',
        content: noteBody.trim(),
      }),
    onSuccess: () => {
      setNoteTitle('');
      setNoteBody('');
      setShowNoteForm(false);
      qc.invalidateQueries({ queryKey: ['documents', userId] });
    },
  });

  const delDoc = useMutation({
    mutationFn: (id: string) => platformApi.deleteDoc(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents', userId] }),
  });

  const stack = useQuery({
    queryKey: ['stack-libraries'],
    queryFn: moveApi.stackLibraries,
    staleTime: 300_000,
    retry: 0,
  });

  const openModule = (key: string) => {
    if (key === 'move') {
      nav.navigate('Mobility', { screen: 'Navigate' });
    } else {
      nav.navigate('ModuleHub', { module: key });
    }
  };

  return (
    <Screen
      title="Explore"
      subtitle="All NEXORA modules, notes & AI intelligence layers"
      badge="NEXORA · DIRECTORY"
      rightAction={
        tab === 'notes' ? (
          <TouchableOpacity onPress={() => setShowNoteForm(v => !v)} style={styles.actionPill}>
            <Text style={styles.actionPillText}>{showNoteForm ? 'Close' : '+ New Note'}</Text>
          </TouchableOpacity>
        ) : undefined
      }>
      <SegmentedControl compact options={[...TABS]} value={tab} onChange={setTab} />

      <View style={{ marginTop: spacing.m }}>
        {tab === 'modules' && (
          <View style={styles.list}>
            {me.isLoading && <Skeleton height={56} />}
            {me.isError && <Text style={{ color: colors.textSecondary }}>Modules are unavailable right now.</Text>}
            {(me.data?.modules ?? ['move', 'health', 'finance', 'work']).map((m, i) => {
              const info = MODULE_INFO[m];
              return (
                <FadeIn key={m} index={i}>
                  <Tappable onPress={() => openModule(m)} accessibilityLabel={`Open ${m}`}>
                    <Card variant={m === 'move' ? 'featured' : 'default'} style={styles.row}>
                      <View
                        style={[
                          styles.badge,
                          { backgroundColor: moduleColors[m as keyof typeof moduleColors] ?? colors.navBlue },
                        ]}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.textPrimary, fontWeight: '700', fontSize: 15 }}>
                          {info?.label ?? m}
                        </Text>
                        {info?.desc ? (
                          <Text style={{ color: colors.textSecondary, fontSize: 12.5, marginTop: 2 }}>
                            {info.desc}
                          </Text>
                        ) : null}
                      </View>
                      <View style={styles.driveMiniBtn}>
                        <Text style={styles.driveMiniText}>{m === 'move' ? 'Launch →' : 'Open →'}</Text>
                      </View>
                    </Card>
                  </Tappable>
                </FadeIn>
              );
            })}
          </View>
        )}

        {tab === 'notes' && (
          <View style={{ gap: spacing.m }}>
            {showNoteForm && (
              <Card variant="featured" style={{ gap: spacing.s }}>
                <Text style={styles.cardHeading}>New NEXORA note</Text>
                <Input value={noteTitle} onChangeText={setNoteTitle} placeholder="Note title" />
                <Input value={noteBody} onChangeText={setNoteBody} placeholder="Details…" />
                <PrimaryButton
                  title="Save note"
                  variant="nav"
                  onPress={() => addDoc.mutate()}
                  disabled={!userId || !noteBody.trim()}
                  loading={addDoc.isPending}
                />
              </Card>
            )}

            <Card style={{ gap: spacing.s }}>
              <View style={styles.placeRow}>
                <Text style={styles.cardHeading}>Saved records & notes</Text>
                <TouchableOpacity onPress={() => setShowNoteForm(v => !v)}>
                  <Text style={{ color: colors.navBlue, fontSize: 12.5, fontWeight: '700' }}>
                    {showNoteForm ? 'Cancel' : '+ Add note'}
                  </Text>
                </TouchableOpacity>
              </View>

              {docs.isLoading ? (
                <Skeleton height={24} />
              ) : !docs.data?.documents?.length ? (
                <EmptyState title="No saved notes yet" hint="Save commuter passes, health reminders, or tasks." />
              ) : (
                docs.data.documents.map(d => {
                  const expanded = expandedNoteId === d.id;
                  return (
                    <View key={d.id} style={styles.noteItem}>
                      <Tappable onPress={() => setExpandedNoteId(expanded ? null : d.id)} style={{ flex: 1 }}>
                        <Text style={{ color: colors.textPrimary, fontWeight: '700', fontSize: 14 }}>
                          {d.title || 'Note'}
                        </Text>
                        <Text
                          numberOfLines={expanded ? undefined : 1}
                          style={{ color: colors.textSecondary, fontSize: 12.5, marginTop: 2 }}>
                          {d.content}
                        </Text>
                      </Tappable>
                      <TouchableOpacity
                        onPress={() => delDoc.mutate(d.id)}
                        style={styles.delBtn}
                        accessibilityLabel="Delete note">
                        <Text style={{ color: colors.statusDanger, fontSize: 12, fontWeight: '700' }}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })
              )}
            </Card>
          </View>
        )}

        {tab === 'stack' && (
          <Card style={{ gap: spacing.s }}>
            <Text style={styles.cardHeading}>Active intelligence stack</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 12.5 }}>
              Tap any layer to inspect live engines & libraries:
            </Text>
            {stack.isLoading && <Skeleton height={48} />}
            {stack.data?.layers &&
              Object.entries(stack.data.layers).map(([layer, items]) => {
                const isOpen = expandedLayer === layer;
                const list = Array.isArray(items) ? items : [];
                return (
                  <Tappable
                    key={layer}
                    onPress={() => setExpandedLayer(isOpen ? null : layer)}
                    style={styles.layerCard}>
                    <View style={styles.placeRow}>
                      <Text style={{ color: colors.textPrimary, textTransform: 'capitalize', fontWeight: '700', fontSize: 13.5 }}>
                        {layer.replace(/_/g, ' ')}
                      </Text>
                      <Text style={{ color: colors.navBlue, fontSize: 12, fontWeight: '700' }}>
                        {list.length} {isOpen ? '▲' : '▼'}
                      </Text>
                    </View>
                    {isOpen ? (
                      <View style={{ marginTop: 8, gap: 4 }}>
                        {list.map((x: any, idx: number) => (
                          <Text key={idx} style={{ color: colors.textSecondary, fontSize: 12 }}>
                            • {typeof x === 'string' ? x : `${x.name}${x.role ? ` — ${x.role}` : ''}`}
                          </Text>
                        ))}
                      </View>
                    ) : (
                      <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 4 }} numberOfLines={1}>
                        {list
                          .slice(0, 3)
                          .map((x: any) => (typeof x === 'string' ? x : x.name))
                          .join(', ')}
                      </Text>
                    )}
                  </Tappable>
                );
              })}
          </Card>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actionPill: {
    backgroundColor: colors.navBlue,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  actionPillText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  cardHeading: { color: colors.textPrimary, fontSize: 15.5, fontWeight: '800' },
  list: { gap: spacing.s, marginBottom: spacing.l },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.m },
  badge: { width: 10, height: 10, borderRadius: 5 },
  placeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  driveMiniBtn: {
    backgroundColor: colors.navBlue,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  driveMiniText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  noteItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.bgElevated,
    borderRadius: 12,
    padding: 12,
  },
  delBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.14)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  layerCard: {
    backgroundColor: colors.bgElevated,
    borderRadius: 12,
    padding: 12,
  },
});
