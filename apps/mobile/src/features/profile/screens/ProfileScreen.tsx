import React, { useState } from 'react';
import { StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Screen } from '../../../shared/components/Screen';
import { QuickSettingsSheet } from '../../../shared/components/QuickSettingsSheet';
import { Card, Input, PrimaryButton, SectionHeading } from '../../../core/design-system/components';
import { FadeIn, Skeleton, StatusPill, Tappable } from '../../../core/design-system/motion';
import { colors, fontFamily, moduleColors, spacing } from '../../../app/theme/tokens';
import { modeLabel, platformApi } from '../../../core/api/move';
import { financeApi } from '../../../core/api/finance';
import { healthApi } from '../../../core/api/health';
import { voiceApi } from '../../../core/api/voice';
import { getAuthToken, setAuthToken } from '../../../core/api/client';
import { useMe } from '../../../core/auth/useMe';
import { usePrivacyPermissions } from '../../../core/permissions/usePrivacyPermissions';
import { useAppSecurity } from '../../../core/security/appSecurity';
import { useNavPreferences } from '../../../core/state/useNavPreferences';
import { formatINR } from '../../finance/components/FinanceIntelligencePanels';
import { HealthMetricBar, SparklineChart } from '../../health/components/HealthVisualizations';

function initialsOf(name?: string) {
  if (!name) return 'NX';
  const parts = name.trim().split(/\s+/);
  return parts
    .slice(0, 2)
    .map(p => p[0]?.toUpperCase() ?? '')
    .join('');
}

const UPCOMING_MODULES = [
  { id: 'work', label: 'Work', tag: 'Focus & Tasks · Next' },
] as const;

// PR-01 Clean NEXORA Profile, Account Session, Active Modules & Cloud Status.
export default function ProfileScreen() {
  const nav = useNavigation<any>();
  const qc = useQueryClient();
  const me = useMe();
  const navPrefs = useNavPreferences();
  const { permissions, consentConfigured } = usePrivacyPermissions();
  const activePermsCount = Object.values(permissions).filter(Boolean).length;
  const totalPermsCount = Object.keys(permissions).length;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState<string | null>(getAuthToken());
  const [showAuthForm, setShowAuthForm] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const health = useQuery({
    queryKey: ['platform-health'],
    queryFn: platformApi.health,
    refetchInterval: 30_000,
    retry: 0,
  });

  const finTwin = useQuery({
    queryKey: ['profile-finance-twin'],
    queryFn: financeApi.digitalTwin,
    retry: 0,
  });

  const finAccounts = useQuery({
    queryKey: ['profile-finance-accounts'],
    queryFn: financeApi.accounts,
    retry: 0,
  });

  const finChannels = useQuery({
    queryKey: ['profile-finance-channels'],
    queryFn: financeApi.channels,
    retry: 0,
  });

  const voiceOverview = useQuery({
    queryKey: ['profile-voice-overview'],
    queryFn: voiceApi.overview,
    retry: 0,
  });

  const voiceInsights = useQuery({
    queryKey: ['profile-voice-insights'],
    queryFn: voiceApi.callLogInsights,
    retry: 0,
  });

  const healthSessions = useQuery({
    queryKey: ['profile-health-sessions'],
    queryFn: () => healthApi.listSleepSessions('default-user', 6),
    retry: 0,
  });

  const healthList = healthSessions.data?.sessions ?? [];
  const latestHealth = healthList[0] ?? null;
  const healthSpark = [...healthList]
    .reverse()
    .map(s => s.research_estimate?.value ?? 0)
    .filter(v => v > 0);

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
              <StatusPill label={token ? 'SIGNED IN' : 'ACTIVE'} tone="success" />
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

          <Tappable
            onPress={() => nav.navigate('Finance')}
            style={styles.moduleRow}>
            <View style={{ flex: 1 }}>
              <View style={styles.rowInline}>
                <Text style={styles.rowTitle}>Wealth & Finance</Text>
                <StatusPill label="LIVE" tone="success" />
              </View>
              <Text style={styles.sub}>
                {finTwin.data
                  ? `Net Worth ${formatINR(finTwin.data.net_worth_inr)} · Score ${finTwin.data.health_score}/100 · ${finAccounts.data?.count ?? 0} accts · ${finChannels.data?.channels?.length ?? 0} channels`
                  : 'Private account sync · Tax planning & wealth advisor'}
              </Text>
            </View>
            <Text style={[styles.chevron, { color: moduleColors.finance }]}>Open ›</Text>
          </Tappable>

          <View style={styles.divider} />

          <Tappable
            onPress={() => nav.navigate('Voice')}
            style={styles.moduleRow}>
            <View style={{ flex: 1 }}>
              <View style={styles.rowInline}>
                <Text style={styles.rowTitle}>Voice & Call Notes</Text>
                <StatusPill label="LIVE" tone="success" />
              </View>
              <Text style={styles.sub}>
                {voiceOverview.data
                  ? `${voiceOverview.data.conversation_count} conversations · ${voiceOverview.data.pending_approvals} follow-ups · ${voiceInsights.data?.total_calls ?? 0} calls`
                  : 'Transcripts, call history, caller ID & verified records'}
              </Text>
            </View>
            <Text style={[styles.chevron, { color: moduleColors.voice }]}>Open ›</Text>
          </Tappable>

          <View style={styles.divider} />

          <Tappable
            onPress={() => nav.navigate('Health')}
            style={{ gap: spacing.s }}>
            <View style={styles.moduleRow}>
              <View style={{ flex: 1 }}>
                <View style={styles.rowInline}>
                  <Text style={styles.rowTitle}>NEXORA Health</Text>
                  <StatusPill label="LIVE" tone="success" />
                </View>
                <Text style={styles.sub}>
                  {latestHealth
                    ? `Sleep Index ${latestHealth.research_estimate.value.toFixed(2)} · ${healthList.length} nights · ${permissions.healthDeviceSensors ? 'Sensors active' : 'Sensors off'}`
                    : `On-device sleep & body sensors · ${permissions.healthDeviceSensors ? 'Sensors active' : 'Tap to enable'}`}
                </Text>
              </View>
              <Text style={[styles.chevron, { color: moduleColors.health }]}>Open ›</Text>
            </View>
            <SparklineChart
              values={healthSpark}
              height={42}
              emptyLabel="No sleep sessions logged yet"
            />
            {latestHealth ? (
              <HealthMetricBar
                label="Latest Signal Quality"
                valueLabel={`${Math.round((latestHealth.evidence.signal_quality_score ?? 0) * 100)}%`}
                progress={latestHealth.evidence.signal_quality_score ?? 0}
              />
            ) : null}
          </Tappable>

          <View style={styles.divider} />

          <View style={styles.upcomingGrid}>
            {UPCOMING_MODULES.map(m => (
              <Tappable
                key={m.id}
                onPress={() => nav.navigate('ModuleHub', { module: m.id })}
                style={styles.upcomingPill}>
                <Text style={styles.upcomingTitle}>{m.label}</Text>
                <Text style={styles.upcomingTag}>{m.tag}</Text>
              </Tappable>
            ))}
          </View>
        </Card>
      </FadeIn>

      {/* 3. Preferences & Sync Status */}
      <SectionHeading
        title="Privacy & Preferences"
        action="Refresh"
        onActionPress={() => {
          health.refetch();
          finTwin.refetch();
          voiceOverview.refetch();
          voiceInsights.refetch();
        }}
      />
      <FadeIn index={2}>
        <Card style={{ gap: spacing.s }}>
          <Tappable onPress={() => nav.navigate('Integrations')} style={styles.between}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Real-Time Integrations & Auto-Sync</Text>
              <Text style={styles.sub}>
                Auto-ingest Mobility GPS, Wealth alerts, Health sensors & Voice calls
              </Text>
            </View>
            <Text style={[styles.chevron, { color: colors.navBlue }]}>Connect ›</Text>
          </Tappable>

          <View style={styles.divider} />

          <Tappable onPress={() => nav.navigate('PrivacyPermissions')} style={styles.between}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Privacy & Data Access Permissions</Text>
              <Text style={styles.sub}>
                Control GPS, Bank/UPI Alerts, Mic, Call History & Caller ID ({activePermsCount}/{totalPermsCount} active)
              </Text>
            </View>
            <StatusPill
              label={consentConfigured ? `${activePermsCount}/${totalPermsCount} ALLOWED` : 'REVIEW'}
              tone={consentConfigured ? 'success' : 'warning'}
            />
          </Tappable>

          <View style={styles.divider} />

          <SecurityControlsBlock />

          <View style={styles.divider} />

          <Tappable onPress={() => nav.navigate('Finance', { screen: 'FinLedger' })} style={styles.between}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Private Financial Protection</Text>
              <Text style={styles.sub}>
                On-device sensitive detail masking · FY26–27 tax rules
              </Text>
            </View>
            <StatusPill label={permissions.edgePiiMasking ? 'ACTIVE' : 'PAUSED'} tone={permissions.edgePiiMasking ? 'info' : 'warning'} />
          </Tappable>

          <View style={styles.divider} />

          <Tappable onPress={() => nav.navigate('DeepIntelligence')} style={styles.between}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>AI Intelligence & Systems</Text>
              <Text style={styles.sub}>
                16 smart features protecting your commute, wealth & voice calls
              </Text>
            </View>
            <StatusPill label="16 ACTIVE" tone="success" />
          </Tappable>

          <View style={styles.divider} />

          <Tappable onPress={() => setSettingsOpen(true)} style={styles.between}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Navigation & Map Display</Text>
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
            <View style={styles.between}>
              <Text style={styles.rowTitle}>Sync Status</Text>
              <StatusPill
                label={health.data.status === 'ok' ? 'CONNECTED' : 'LIMITED'}
                tone={health.data.status === 'ok' ? 'success' : 'warning'}
              />
            </View>
          ) : (
            <View style={styles.between}>
              <Text style={styles.rowTitle}>Sync Status</Text>
              <StatusPill label="OFFLINE" tone="danger" />
            </View>
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
  avatarText: { color: colors.textPrimary, fontFamily: fontFamily.medium, fontSize: 15, fontWeight: '700', letterSpacing: 0.4 },
  name: { color: colors.textPrimary, fontFamily: fontFamily.sans, fontWeight: '700', fontSize: 16 },
  sub: { color: colors.textSecondary, fontFamily: fontFamily.sans, fontSize: 12, lineHeight: 17 },
  meta: { color: colors.textMuted, fontFamily: fontFamily.sans, fontSize: 11 },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
    paddingTop: spacing.s,
  },
  linkBtn: { paddingVertical: 2 },
  linkBtnText: { color: colors.navBlue, fontFamily: fontFamily.medium, fontSize: 12, fontWeight: '600' },
  authDrawer: { gap: spacing.s, paddingTop: spacing.xs },
  row: { flexDirection: 'row', gap: spacing.s },
  rowInline: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.s },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.s },
  moduleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.s },
  rowTitle: { color: colors.textPrimary, fontFamily: fontFamily.medium, fontSize: 13.5, fontWeight: '600', flexShrink: 1 },
  chevron: { color: colors.navBlue, fontFamily: fontFamily.medium, fontSize: 12, fontWeight: '600' },
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
  upcomingTitle: { color: colors.textPrimary, fontFamily: fontFamily.medium, fontSize: 12.5, fontWeight: '600' },
  upcomingTag: { color: colors.textMuted, fontFamily: fontFamily.sans, fontSize: 10.5, marginTop: 2 },
});

function SecurityControlsBlock() {
  const {
    biometricSupported,
    biometricLockEnabled,
    screenshotProtectionEnabled,
    setBiometricLockEnabled,
    setScreenshotProtectionEnabled,
  } = useAppSecurity();

  return (
    <View style={{ gap: spacing.s }}>
      <View style={styles.between}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>Biometric Vault Lock</Text>
          <Text style={styles.sub}>
            {biometricSupported
              ? 'Require Face ID / Fingerprint when returning to NEXORA'
              : 'Biometric hardware not enrolled on this device'}
          </Text>
        </View>
        <Switch
          value={biometricLockEnabled}
          disabled={!biometricSupported}
          onValueChange={val => void setBiometricLockEnabled(val)}
          trackColor={{ false: colors.bgElevated, true: colors.accentBright }}
        />
      </View>

      <View style={styles.divider} />

      <View style={styles.between}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>Screen & Recording Shield</Text>
          <Text style={styles.sub}>
            Block screenshots & app-switcher previews (FLAG_SECURE + Keystore)
          </Text>
        </View>
        <Switch
          value={screenshotProtectionEnabled}
          onValueChange={val => void setScreenshotProtectionEnabled(val)}
          trackColor={{ false: colors.bgElevated, true: colors.accentBright }}
        />
      </View>
    </View>
  );
}
