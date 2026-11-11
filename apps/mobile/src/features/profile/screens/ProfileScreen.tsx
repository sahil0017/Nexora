import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Screen } from '../../../shared/components/Screen';
import { QuickSettingsSheet } from '../../../shared/components/QuickSettingsSheet';
import { Card, Input, PrimaryButton, SectionHeading } from '../../../core/design-system/components';
import { FadeIn, Skeleton, StatusPill, Tappable } from '../../../core/design-system/motion';
import { colors, spacing } from '../../../app/theme/tokens';
import { modeLabel, platformApi } from '../../../core/api/move';
import { getAuthToken, setAuthToken } from '../../../core/api/client';
import { useMe } from '../../../core/auth/useMe';
import { useNavPreferences } from '../../../core/state/useNavPreferences';

function initialsOf(name?: string) {
  if (!name) return 'NX';
  const parts = name.trim().split(/\s+/);
  return parts
    .slice(0, 2)
    .map(p => p[0]?.toUpperCase() ?? '')
    .join('');
}

const UPCOMING_MODULES = [
  { id: 'health', label: 'Health', tag: 'Vitals & Care' },
  { id: 'finance', label: 'Finance', tag: 'Spend & Budget' },
  { id: 'work', label: 'Work', tag: 'Focus & Tasks' },
] as const;

// PR-01 Clean NEXORA Profile, Account Session, Active Modules & Cloud Status.
export default function ProfileScreen() {
  const nav = useNavigation<any>();
  const qc = useQueryClient();
  const me = useMe();
  const navPrefs = useNavPreferences();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState<string | null>(getAuthToken());
  const [showAuthForm, setShowAuthForm] = useState(false);
  const [showStackDiag, setShowStackDiag] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const health = useQuery({
    queryKey: ['platform-health'],
    queryFn: platformApi.health,
    refetchInterval: 30_000,
    retry: 0,
  });

  const ready = useQuery({
    queryKey: ['platform-ready'],
    queryFn: platformApi.ready,
    retry: 0,
  });

  const signIn = useMutation({
    mutationFn: (mode: 'login' | 'register') =>
      mode === 'login' ? platformApi.login(email.trim(), password) : platformApi.register(email.trim(), password),
    onSuccess: res => {
      setAuthToken(res.access_token);
      setToken(res.access_token);
      setShowAuthForm(false);
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });

  const user = me.data;

  return (
    <Screen title="Profile" subtitle="Account, modules & system preferences">
      {/* 1. Clean Account Identity Card */}
      <FadeIn>
        <Card variant="featured" style={{ gap: spacing.m }}>
          {me.isLoading ? (
            <Skeleton height={44} />
          ) : me.isError || !user ? (
            <Text style={{ color: colors.statusDanger }}>Couldn't load your account.</Text>
          ) : (
            <View style={styles.identityRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initialsOf(user.display_name)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{user.display_name}</Text>
                <Text style={styles.sub}>{user.email}</Text>
                <Text style={[styles.meta, { marginTop: 2 }]}>
                  {user.timezone} · {user.locale}
                </Text>
              </View>
              <StatusPill label={token ? 'JWT' : 'ACTIVE'} tone="success" />
            </View>
          )}

          <View style={styles.cardFooter}>
            <TouchableOpacity onPress={() => setShowAuthForm(v => !v)} style={styles.linkBtn}>
              <Text style={styles.linkBtnText}>{showAuthForm ? 'Close account drawer' : 'Switch account'}</Text>
            </TouchableOpacity>
            {token && (
              <TouchableOpacity
                onPress={() => {
                  setAuthToken(null);
                  setToken(null);
                  qc.invalidateQueries({ queryKey: ['me'] });
                }}>
                <Text style={[styles.linkBtnText, { color: colors.statusDanger }]}>Sign out</Text>
              </TouchableOpacity>
            )}
          </View>

          {showAuthForm && (
            <View style={styles.authDrawer}>
              <Input value={email} onChangeText={setEmail} placeholder="Email" autoCapitalize="none" />
              <Input value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry />
              {signIn.isError && (
                <Text style={{ color: colors.statusDanger, fontSize: 12.5 }}>
                  {(signIn.error as Error)?.message ?? 'Authentication failed.'}
                </Text>
              )}
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <PrimaryButton
                    title="Sign in"
                    variant="nav"
                    onPress={() => signIn.mutate('login')}
                    disabled={!email.trim() || !password}
                    loading={signIn.isPending}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <PrimaryButton
                    title="Register"
                    variant="secondary"
                    onPress={() => signIn.mutate('register')}
                    disabled={!email.trim() || !password}
                    loading={signIn.isPending}
                  />
                </View>
              </View>
            </View>
          )}
        </Card>
      </FadeIn>

      {/* 2. Active Modules */}
      <SectionHeading title="Modules" />
      <FadeIn index={1}>
        <Card style={{ gap: spacing.s }}>
          <Tappable
            onPress={() => nav.navigate('Mobility', { screen: 'MovePrefs' })}
            style={styles.moduleRow}>
            <View style={{ flex: 1 }}>
              <View style={styles.rowInline}>
                <Text style={styles.rowTitle}>Mobility · MoveSmart</Text>
                <StatusPill label="LIVE" tone="success" />
              </View>
              <Text style={styles.sub}>
                {modeLabel(navPrefs.defaultMode)} · {navPrefs.optimizeFor.toLowerCase()} ·{' '}
                {navPrefs.avoidTolls ? 'Avoid tolls' : 'Tolls allowed'} · Max walk {navPrefs.maxWalkingMinutes}m
              </Text>
            </View>
            <Text style={styles.chevron}>Manage ›</Text>
          </Tappable>

          <View style={styles.divider} />

          <View style={styles.upcomingGrid}>
            {UPCOMING_MODULES.map(m => (
              <Tappable
                key={m.id}
                onPress={() => nav.navigate('ModuleHub', { moduleId: m.id })}
                style={styles.upcomingPill}>
                <Text style={styles.upcomingTitle}>{m.label}</Text>
                <Text style={styles.upcomingTag}>{m.tag}</Text>
              </Tappable>
            ))}
          </View>
        </Card>
      </FadeIn>

      {/* 3. Preferences & Cloud Status */}
      <SectionHeading
        title="App & Cloud"
        action="Ping API"
        onActionPress={() => {
          health.refetch();
          ready.refetch();
        }}
      />
      <FadeIn index={2}>
        <Card style={{ gap: spacing.s }}>
          <Tappable onPress={() => setSettingsOpen(true)} style={styles.between}>
            <View>
              <Text style={styles.rowTitle}>HUD & Map Display</Text>
              <Text style={styles.sub}>
                {navPrefs.viewMode} view · {navPrefs.mapStyle} map · {navPrefs.soundMode} alerts
              </Text>
            </View>
            <Text style={styles.chevron}>Configure ›</Text>
          </Tappable>

          <View style={styles.divider} />

          {health.isLoading ? (
            <Skeleton height={16} />
          ) : health.data ? (
            <>
              <Tappable onPress={() => setShowStackDiag(v => !v)} style={styles.between}>
                <View style={styles.rowInline}>
                  <StatusPill
                    label={`API ${health.data.status.toUpperCase()} · READY: ${ready.data?.status?.toUpperCase() ?? '...'}`}
                    tone={health.data.status === 'ok' ? 'success' : 'warning'}
                  />
                </View>
                <Text style={styles.chevron}>{showStackDiag ? 'Hide ▲' : 'Details ▼'}</Text>
              </Tappable>
              {showStackDiag && (
                <View style={styles.diagBox}>
                  <Text style={styles.meta}>Service: {health.data.service} v{health.data.version}</Text>
                  <Text style={styles.meta}>Postgres: {health.data.database}</Text>
                  <Text style={styles.meta}>DocStore: {health.data.docstore}</Text>
                  <Text style={styles.meta}>Redis: {health.data.redis}</Text>
                </View>
              )}
            </>
          ) : (
            <StatusPill label="CLOUD API UNREACHABLE" tone="danger" />
          )}
        </Card>
      </FadeIn>

      <QuickSettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.m },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(29, 143, 225, 0.2)',
    borderWidth: 1,
    borderColor: colors.navBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.textPrimary, fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },
  name: { color: colors.textPrimary, fontWeight: '800', fontSize: 18 },
  sub: { color: colors.textSecondary, fontSize: 12.5, lineHeight: 18 },
  meta: { color: colors.textMuted, fontSize: 11.5 },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
    paddingTop: spacing.s,
  },
  linkBtn: { paddingVertical: 2 },
  linkBtnText: { color: colors.navBlue, fontSize: 12.5, fontWeight: '700' },
  authDrawer: { gap: spacing.s, paddingTop: spacing.xs },
  row: { flexDirection: 'row', gap: spacing.s },
  rowInline: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.s },
  moduleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.s },
  rowTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  chevron: { color: colors.navBlue, fontSize: 12.5, fontWeight: '700' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.borderSubtle },
  upcomingGrid: { flexDirection: 'row', gap: spacing.xs },
  upcomingPill: {
    flex: 1,
    backgroundColor: colors.bgElevated,
    borderRadius: 12,
    paddingVertical: spacing.s,
    paddingHorizontal: spacing.s,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  upcomingTitle: { color: colors.textPrimary, fontSize: 12.5, fontWeight: '700' },
  upcomingTag: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  diagBox: {
    backgroundColor: colors.bgElevated,
    borderRadius: 12,
    padding: 10,
    gap: 4,
  },
});
