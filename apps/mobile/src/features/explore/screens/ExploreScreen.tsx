import React, { useMemo, useState } from 'react';
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
import { colors, fontFamily, moduleColors, spacing } from '../../../app/theme/tokens';
import { platformApi } from '../../../core/api/move';
import { useMe } from '../../../core/auth/useMe';

const MODULE_INFO: Record<string, { label: string; desc: string }> = {
  move: { label: 'Mobility & Navigation', desc: 'Turn-by-turn routes, live traffic, places & alerts' },
  finance: { label: 'Wealth & Finance', desc: 'Net worth, accounts, tax planning & portfolio insights' },
  voice: { label: 'Voice & Call Notes', desc: 'Call transcripts, meeting notes, follow-ups & caller ID' },
  assistant: { label: 'Copilot', desc: 'Personal AI assistant for commute, wealth & daily tasks' },
  health: { label: 'Health', desc: 'Reports, wellness records & health insights' },
  work: { label: 'Work', desc: 'Tasks, morning briefs & schedule automation' },
};

const MODULE_ORDER = ['move', 'finance', 'voice', 'assistant', 'health', 'work'];

const TABS = [
  { key: 'modules', label: 'Modules' },
  { key: 'notes', label: 'Notes' },
] as const;

// EX-01 NEXORA Explore — directory for all NEXORA modules and shared notes (/documents).
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

  const modules = useMemo(() => {
    const raw = me.data?.modules ?? ['move', 'finance', 'voice', 'health', 'work'];
    return [...raw].sort((a, b) => {
      const ia = MODULE_ORDER.indexOf(a);
      const ib = MODULE_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  }, [me.data?.modules]);

  const openModule = (key: string) => {
    const k = key.trim().toLowerCase();
    if (k === 'move') {
      nav.navigate('Mobility', { screen: 'Navigate' });
    } else if (k === 'finance') {
      nav.navigate('Finance');
    } else if (k === 'voice') {
      nav.navigate('Voice');
    } else if (k === 'assistant') {
      nav.navigate('AI');
    } else {
      nav.navigate('ModuleHub', { module: k });
    }
  };

  return (
    <Screen
      title="Explore"
      subtitle="All your modules and saved notes"
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
            {me.isError && (
              <Text style={{ color: colors.textSecondary, fontFamily: fontFamily.sans, fontSize: 13 }}>
                Modules are unavailable right now.
              </Text>
            )}
            {modules.map((m, i) => {
              const info = MODULE_INFO[m];
              const isLaunched = m === 'move' || m === 'finance' || m === 'voice' || m === 'assistant';
              return (
                <FadeIn key={m} index={i}>
                  <Tappable onPress={() => openModule(m)} accessibilityLabel={`${isLaunched ? 'Launch' : 'Open'} ${m}`}>
                    <Card variant={isLaunched ? 'featured' : 'default'} style={styles.row}>
                      <View
                        style={[
                          styles.badge,
                          { backgroundColor: moduleColors[m as keyof typeof moduleColors] ?? colors.navBlue },
                        ]}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.moduleTitle}>{info?.label ?? m}</Text>
                        {info?.desc ? <Text style={styles.moduleDesc}>{info.desc}</Text> : null}
                      </View>
                      <View
                        style={[
                          styles.driveMiniBtn,
                          m === 'finance' ? { backgroundColor: moduleColors.finance } : null,
                        ]}>
                        <Text style={[styles.driveMiniText, m === 'finance' ? { color: '#060B10' } : null]}>
                          {isLaunched ? 'Launch →' : 'Open →'}
                        </Text>
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
                <Text style={styles.cardHeading}>New note</Text>
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
                  <Text style={styles.addNoteLink}>{showNoteForm ? 'Cancel' : '+ Add note'}</Text>
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
                        <Text style={styles.noteTitle}>{d.title || 'Note'}</Text>
                        <Text numberOfLines={expanded ? undefined : 1} style={styles.noteBody}>
                          {d.content}
                        </Text>
                      </Tappable>
                      <TouchableOpacity
                        onPress={() => delDoc.mutate(d.id)}
                        style={styles.delBtn}
                        accessibilityLabel="Delete note">
                        <Text style={styles.delBtnText}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })
              )}
            </Card>
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actionPill: {
    backgroundColor: colors.navBlue,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
  },
  actionPillText: { color: '#FFFFFF', fontFamily: fontFamily.medium, fontSize: 11.5, fontWeight: '700' },
  cardHeading: { color: colors.textPrimary, fontFamily: fontFamily.medium, fontSize: 14, fontWeight: '600' },
  list: { gap: spacing.s, marginBottom: spacing.l },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.m },
  badge: { width: 9, height: 9, borderRadius: 5 },
  moduleTitle: { color: colors.textPrimary, fontFamily: fontFamily.medium, fontWeight: '600', fontSize: 14 },
  moduleDesc: { color: colors.textSecondary, fontFamily: fontFamily.sans, fontSize: 12, marginTop: 2, lineHeight: 17 },
  placeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  addNoteLink: { color: colors.navBlue, fontFamily: fontFamily.medium, fontSize: 12, fontWeight: '600' },
  driveMiniBtn: {
    backgroundColor: colors.navBlue,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
  },
  driveMiniText: { color: '#FFFFFF', fontFamily: fontFamily.medium, fontSize: 11.5, fontWeight: '700' },
  noteItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.bgElevated,
    borderRadius: 12,
    padding: 12,
  },
  noteTitle: { color: colors.textPrimary, fontFamily: fontFamily.medium, fontWeight: '600', fontSize: 13.5 },
  noteBody: { color: colors.textSecondary, fontFamily: fontFamily.sans, fontSize: 12, marginTop: 2 },
  delBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.14)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  delBtnText: { color: colors.statusDanger, fontFamily: fontFamily.medium, fontSize: 11.5, fontWeight: '600' },
});
