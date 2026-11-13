import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Screen } from '../../../shared/components/Screen';
import { Card, PrimaryButton, SectionHeading } from '../../../core/design-system/components';
import { Chip, FadeIn, Skeleton, StatusPill, Tappable } from '../../../core/design-system/motion';
import { colors, fontFamily, moduleColors, spacing, typography } from '../../../app/theme/tokens';
import { digitalTwinApi, moveApi } from '../../../core/api/move';
import { financeApi } from '../../../core/api/finance';
import { healthApi } from '../../../core/api/health';
import { voiceApi } from '../../../core/api/voice';
import { useMe } from '../../../core/auth/useMe';
import { useLocation } from '../../../core/location/useLocation';
import { useRealtimeIntegrations } from '../../../core/integrations/useRealtimeIntegrations';
import { usePrivacyPermissions } from '../../../core/permissions/usePrivacyPermissions';
import { formatINR } from '../../finance/components/FinanceIntelligencePanels';
import { HealthMetricBar, SparklineChart } from '../../health/components/HealthVisualizations';

const SECONDARY_MODULES = [
  { key: 'work', title: 'Work', desc: 'Tasks, prep & schedules' },
] as const;

function quickActions(d = new Date()) {
  const h = d.getHours();
  const financePrompts = ['Audit cash & tax savings', 'Prepay loan or increase SIP?'];
  if (h < 11) return ['When should I leave for work?', 'How is traffic right now?', ...financePrompts];
  if (h < 17) return ['Plan my next trip', 'How is traffic right now?', ...financePrompts];
  return ['Best way home now?', 'Any road hazards near me?', ...financePrompts];
}

function greeting(d = new Date()) {
  const h = d.getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function contextLine(d = new Date()) {
  const h = d.getHours();
  const weekday = d.getDay() > 0 && d.getDay() < 6;
  if (weekday && h >= 7 && h < 11) return 'Morning brief — live commute, wealth overview & copilot ready.';
  if (weekday && h >= 16 && h < 21) return 'Evening pulse — live traffic, tax & savings insights ready.';
  return 'Your daily companion for commute, wealth & smart tasks.';
}

// HM-01 NEXORA Super-App Home — multi-module launcher with dedicated Mobility workspace entry.
export default function HomeScreen() {
  const nav = useNavigation<any>();
  const me = useMe();
  const loc = useLocation();
  const { permissions, consentConfigured, hydrateFromServer } = usePrivacyPermissions();
  const [aiExpanded, setAiExpanded] = useState(false);

  const status = useQuery({
    queryKey: ['intelligence-status'],
    queryFn: moveApi.intelligenceStatus,
    refetchInterval: 30_000,
    retry: 0,
  });

  const hazards = useQuery({
    queryKey: ['hazards-nearby', loc.point?.latitude, loc.point?.longitude],
    queryFn: () => moveApi.nearbyHazards(loc.point!),
    enabled: !!loc.point,
    retry: 0,
  });

  const traffic = useQuery({
    queryKey: ['traffic-segments', loc.point?.latitude, loc.point?.longitude],
    queryFn: () => moveApi.trafficSegments(loc.point!, 3000),
    enabled: !!loc.point,
    retry: 0,
  });

  const activeEvents = useQuery({
    queryKey: ['active-city-events', loc.point?.latitude, loc.point?.longitude],
    queryFn: () => moveApi.activeEvents(loc.point),
    retry: 0,
  });

  const anomalies = useQuery({
    queryKey: ['traffic-anomalies'],
    queryFn: () => moveApi.trafficAnomalies(['seg-1', 'seg-2']),
    retry: 0,
  });

  const proactive = useQuery({
    queryKey: ['proactive-brief', loc.point?.latitude, loc.point?.longitude],
    queryFn: () => digitalTwinApi.proactiveBrief(loc.point!),
    enabled: !!loc.point,
    retry: 0,
  });

  const finTwin = useQuery({
    queryKey: ['home-finance-twin'],
    queryFn: financeApi.digitalTwin,
    refetchInterval: 30_000,
    retry: 0,
  });

  const finRadar = useQuery({
    queryKey: ['home-finance-radar'],
    queryFn: financeApi.radarOpportunities,
    refetchInterval: 60_000,
    retry: 0,
  });

  const voiceOverview = useQuery({
    queryKey: ['home-voice-overview'],
    queryFn: voiceApi.overview,
    refetchInterval: 60_000,
    retry: 0,
  });

  const healthSessions = useQuery({
    queryKey: ['home-health-sessions'],
    queryFn: () => healthApi.listSleepSessions('default-user', 6),
    refetchInterval: 60_000,
    retry: 0,
  });

  const healthTelemetry = useQuery({
    queryKey: ['home-health-telemetry'],
    queryFn: () => healthApi.getTelemetry(),
    refetchInterval: 60_000,
    retry: 0,
  });

  const healthList = healthSessions.data?.sessions ?? [];
  const latestHealth = healthList[0] ?? null;
  const healthSpark = [...healthList]
    .reverse()
    .map(s => s.research_estimate?.value ?? 0)
    .filter(v => v > 0);

  const brainUp = status.data?.brain_reachable;
  const hazardCount = hazards.data?.hazards?.length ?? 0;
  const eventCount = activeEvents.data?.events?.length ?? 0;
  const anomalyCount = anomalies.data?.active_anomaly_count ?? 0;
  const segmentList = traffic.data?.segments ?? [];
  const avgSpeed = segmentList.length
    ? Math.round(segmentList.reduce((acc, s) => acc + s.current_speed_kmph, 0) / segmentList.length)
    : null;

  const openMobility = (screen?: 'Navigate' | 'Radar' | 'Places' | 'MovePrefs') =>
    nav.navigate('Mobility', screen ? { screen } : undefined);

  const openFinance = (screen?: 'FinTwin' | 'FinLedger' | 'FinWealth' | 'FinLab' | 'FinCFO') =>
    nav.navigate('Finance', screen ? { screen } : undefined);

  const openVoice = (screen?: 'VoiceCapture' | 'VoiceTranscript' | 'VoiceMemory' | 'VoiceActions' | 'VoiceEvidence') =>
    nav.navigate('Voice', screen ? { screen } : undefined);

  const openHealth = (screen?: 'HealthHub' | 'SleepClearance' | 'SensorStream' | 'MriValidation') =>
    nav.navigate('Health', screen ? { screen } : undefined);

  const integrations = useRealtimeIntegrations();
  const connectedSources = Object.values(integrations.domains).filter(d => d.status === 'connected').length;

  useEffect(() => {
    void hydrateFromServer().then(() => integrations.runAutoSyncOnLaunch());
  }, [hydrateFromServer, integrations.runAutoSyncOnLaunch]);

  return (
    <Screen
      title={greeting()}
      subtitle={contextLine()}
      badge="NEXORA · SMART DAILY COMPANION"
      showBack={false}
      rightAction={
        <TouchableOpacity onPress={() => nav.navigate('Profile')} style={styles.profilePill}>
          <Text style={styles.profilePillText}>
            {me.data?.display_name ? me.data.display_name.split(' ')[0] : 'Account'}
          </Text>
        </TouchableOpacity>
      }>
      {!consentConfigured ? (
        <FadeIn index={0}>
          <Card variant="featured" style={{ gap: spacing.s, marginBottom: spacing.m }}>
            <View style={styles.between}>
              <Text style={styles.mobilityHeading}>Review What NEXORA Can Access</Text>
              <StatusPill label="PRIVACY FIRST" tone="warning" />
            </View>
            <Text style={styles.mobilitySub}>
              Choose individually whether Location (GPS), Bank/UPI Alerts, Statement Email, Clipboard, or Advisor context are allowed.
            </Text>
            <PrimaryButton
              title="Set Data & Access Permissions →"
              onPress={() => nav.navigate('PrivacyPermissions')}
            />
          </Card>
        </FadeIn>
      ) : null}

      {/* Live Data Integrations Quick Card */}
      <FadeIn index={0}>
        <Tappable onPress={() => nav.navigate('Integrations')} accessibilityLabel="Open Real-Time Integrations">
          <Card variant="subtle" style={{ gap: 6, marginBottom: spacing.m, borderColor: 'rgba(45, 212, 191, 0.3)' }}>
            <View style={styles.between}>
              <Text style={styles.mobilityHeading}>Real-Time Integrations</Text>
              <StatusPill
                label={`${connectedSources} / 4 LIVE`}
                tone={connectedSources > 0 ? 'success' : 'info'}
              />
            </View>
            <Text style={styles.mobilitySub} numberOfLines={2}>
              Auto-sync Mobility GPS, Wealth alerts, Health sensors & Voice calls without manual entry.
            </Text>
          </Card>
        </Tappable>
      </FadeIn>

      {/* Flagship Mobility & Navigation Entry Card */}
      <SectionHeading title="Commute & navigation" action="Open map →" onActionPress={() => openMobility('Navigate')} />
      <FadeIn index={0}>
        <Card variant="nav" style={{ gap: spacing.s }}>
          <Tappable onPress={() => openMobility('Navigate')} accessibilityLabel="Open Navigation">
            <View style={styles.between}>
              <View style={styles.modTitleRow}>
                <View style={[styles.moduleIcon, { backgroundColor: 'rgba(29, 143, 225, 0.2)' }]}>
                  <Text style={{ color: colors.navBlue, fontSize: 16, fontWeight: '900' }}>➤</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.mobilityHeading}>MoveSmart Navigation</Text>
                  <Text style={styles.mobilitySub} numberOfLines={2}>
                    Turn-by-turn routes, live traffic & alerts
                  </Text>
                </View>
              </View>
              <StatusPill
                label={hazardCount > 0 ? `${hazardCount} ALERT${hazardCount > 1 ? 'S' : ''}` : 'CLEAR ROAD'}
                tone={hazardCount > 0 ? 'warning' : 'success'}
              />
            </View>
          </Tappable>

          <View style={styles.mobStatsRow}>
            <View style={styles.mobStat}>
              <Text style={styles.mobStatVal}>
                {avgSpeed !== null ? `${avgSpeed} km/h` : !permissions.gpsLocation ? 'GPS Off' : loc.point ? 'Live' : 'Locating'}
              </Text>
              <Text style={styles.mobStatLbl}>Traffic speed</Text>
            </View>
            <View style={styles.mobStat}>
              <Text style={styles.mobStatVal}>{hazardCount}</Text>
              <Text style={styles.mobStatLbl}>Road alerts</Text>
            </View>
            <View style={styles.mobStat}>
              <Text style={styles.mobStatVal}>{eventCount + anomalyCount > 0 ? `${eventCount}ev · ${anomalyCount}an` : 'Smooth'}</Text>
              <Text style={styles.mobStatLbl}>Corridor pulse</Text>
            </View>
          </View>

          <View style={styles.preTravelPill}>
            <Text style={styles.preTravelText}>
              {proactive.data?.headline
                ? `🧠 ${proactive.data.headline}`
                : anomalyCount > 0 || eventCount > 0
                ? `⚡ Pre-travel: ${anomalyCount} traffic anomal${anomalyCount === 1 ? 'y' : 'ies'} & ${eventCount} event${eventCount === 1 ? '' : 's'} factored into departure window`
                : '✓ Pre-travel: Optimal departure & multimodal routes ready in MoveSmart'}
            </Text>
          </View>

          <View style={styles.mobShortcutRow}>
            <Chip label="➤ Plan Route" active onPress={() => openMobility('Navigate')} />
            <Chip label="🌐 Live Radar" onPress={() => openMobility('Radar')} />
            <Chip label="★ Saved Places" onPress={() => openMobility('Places')} />
            <Chip label="⚙ Route Prefs" onPress={() => openMobility('MovePrefs')} />
          </View>

          <PrimaryButton title="Start Navigation" variant="nav" onPress={() => openMobility('Navigate')} />
        </Card>
      </FadeIn>

      {/* Flagship Wealth & Finance Entry Card */}
      <SectionHeading title="Wealth & Cashflow" action="Open Wealth →" onActionPress={() => openFinance('FinTwin')} />
      <FadeIn index={1}>
        <Card variant="featured" style={{ gap: spacing.s }}>
          <Tappable onPress={() => openFinance('FinTwin')} accessibilityLabel="Open Wealth Management">
            <View style={styles.between}>
              <View style={styles.modTitleRow}>
                <View style={[styles.moduleIcon, { backgroundColor: 'rgba(163, 230, 53, 0.18)' }]}>
                  <Text style={{ color: moduleColors.finance, fontSize: 15, fontWeight: '700' }}>₹</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.mobilityHeading}>Wealth Management</Text>
                  <Text style={styles.mobilitySub} numberOfLines={2}>
                    Net worth, accounts, tax savings & smart projections
                  </Text>
                </View>
              </View>
              <StatusPill
                label={finTwin.data ? `SCORE ${finTwin.data.health_score}/100` : 'SYNCED'}
                tone={
                  finTwin.data
                    ? finTwin.data.health_score >= 75
                      ? 'success'
                      : 'warning'
                    : 'info'
                }
              />
            </View>
          </Tappable>

          <View style={styles.mobStatsRow}>
            <View style={styles.mobStat}>
              <Text style={[styles.mobStatVal, { color: moduleColors.finance }]}>
                {finTwin.data ? formatINR(finTwin.data.net_worth_inr) : 'Syncing'}
              </Text>
              <Text style={styles.mobStatLbl}>Net worth</Text>
            </View>
            <View style={styles.mobStat}>
              <Text style={[styles.mobStatVal, { color: colors.accentBright }]}>
                {finTwin.data ? formatINR(finTwin.data.safe_to_spend_inr) : '—'}
              </Text>
              <Text style={styles.mobStatLbl}>Safe to spend</Text>
            </View>
            <View style={styles.mobStat}>
              <Text style={[styles.mobStatVal, { color: colors.textPrimary }]}>
                {finTwin.data ? `${finTwin.data.emergency_runway_months.toFixed(1)} mo` : '—'}
              </Text>
              <Text style={styles.mobStatLbl}>Runway</Text>
            </View>
          </View>

          <View
            style={[
              styles.preTravelPill,
              {
                backgroundColor: 'rgba(163, 230, 53, 0.10)',
                borderColor: 'rgba(163, 230, 53, 0.28)',
              },
            ]}>
            <Text style={[styles.preTravelText, { color: moduleColors.finance }]}>
              {finRadar.data && finRadar.data.total_annualized_savings_inr > 0
                ? `⚡ Savings Radar: ${formatINR(finRadar.data.total_annualized_savings_inr)}/yr tax & cash opportunities`
                : '🔒 Private Sync · Import bank & UPI alerts without sharing logins'}
            </Text>
          </View>

          <View style={styles.mobShortcutRow}>
            <Chip label="📊 Overview" active color={moduleColors.finance} onPress={() => openFinance('FinTwin')} />
            <Chip label="📥 Accounts" onPress={() => openFinance('FinLedger')} />
            <Chip label="🧮 Tax & Plan" onPress={() => openFinance('FinLab')} />
            <Chip label="✦ Advisor" onPress={() => openFinance('FinCFO')} />
          </View>

          <PrimaryButton title="Open Wealth Hub" onPress={() => openFinance('FinTwin')} />
        </Card>
      </FadeIn>

      {/* Flagship Voice & Conversations Entry Card */}
      <SectionHeading title="Voice & Conversations" action="Open Library →" onActionPress={() => openVoice('VoiceCapture')} />
      <FadeIn index={2}>
        <Card variant="featured" style={{ gap: spacing.s }}>
          <Tappable onPress={() => openVoice('VoiceCapture')} accessibilityLabel="Open Voice & Call Notes">
            <View style={styles.between}>
              <View style={styles.modTitleRow}>
                <View style={[styles.moduleIcon, { backgroundColor: 'rgba(167, 139, 250, 0.18)' }]}>
                  <Text style={{ color: moduleColors.voice, fontSize: 16, fontWeight: '700' }}>◉</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.mobilityHeading}>Voice & Call Notes</Text>
                  <Text style={styles.mobilitySub} numberOfLines={2}>
                    Transcripts, speaker insights, follow-ups & caller ID
                  </Text>
                </View>
              </View>
              <StatusPill
                label={
                  voiceOverview.data
                    ? voiceOverview.data.pending_approvals > 0
                      ? `${voiceOverview.data.pending_approvals} TASK${voiceOverview.data.pending_approvals > 1 ? 'S' : ''}`
                      : 'SYNCED'
                    : 'SYNCING'
                }
                tone={
                  voiceOverview.data
                    ? voiceOverview.data.pending_approvals > 0
                      ? 'warning'
                      : 'success'
                    : 'info'
                }
              />
            </View>
          </Tappable>

          <View style={styles.mobStatsRow}>
            <View style={styles.mobStat}>
              <Text style={[styles.mobStatVal, { color: moduleColors.voice }]}>
                {voiceOverview.data ? voiceOverview.data.conversation_count : 'Syncing'}
              </Text>
              <Text style={styles.mobStatLbl}>Conversations</Text>
            </View>
            <View style={styles.mobStat}>
              <Text style={[styles.mobStatVal, { color: colors.accentBright }]}>
                {voiceOverview.data ? voiceOverview.data.commitments_decisions : '—'}
              </Text>
              <Text style={styles.mobStatLbl}>Key decisions</Text>
            </View>
            <View style={styles.mobStat}>
              <Text style={[styles.mobStatVal, { color: colors.textPrimary }]}>
                {voiceOverview.data ? voiceOverview.data.pending_approvals : '—'}
              </Text>
              <Text style={styles.mobStatLbl}>Pending tasks</Text>
            </View>
          </View>

          <View
            style={[
              styles.preTravelPill,
              {
                backgroundColor: 'rgba(167, 139, 250, 0.10)',
                borderColor: 'rgba(167, 139, 250, 0.28)',
              },
            ]}>
            <Text style={[styles.preTravelText, { color: moduleColors.voice }]} numberOfLines={2}>
              {voiceOverview.data?.conversations?.length
                ? `💬 Latest: ${voiceOverview.data.conversations[0].title} (${voiceOverview.data.conversations[0].utterances?.length ?? 0} lines)`
                : '🎙 Save call notes, import audio or sync device call history privately'}
            </Text>
          </View>

          <View style={styles.mobShortcutRow}>
            <Chip label="📚 Library" active color={moduleColors.voice} onPress={() => openVoice('VoiceCapture')} />
            <Chip label="📝 Transcripts" onPress={() => openVoice('VoiceTranscript')} />
            <Chip label="💬 Ask AI" onPress={() => openVoice('VoiceMemory')} />
            <Chip label="✓ Follow-ups" onPress={() => openVoice('VoiceActions')} />
          </View>

          <PrimaryButton title="Open Voice Library" onPress={() => openVoice('VoiceCapture')} />
        </Card>
      </FadeIn>

      {/* Flagship Health & Recovery Card */}
      <SectionHeading title="Health & Recovery" action="Open Health →" onActionPress={() => openHealth('HealthHub')} />
      <FadeIn index={2}>
        <Card variant="featured" style={{ gap: spacing.s }}>
          <Tappable onPress={() => openHealth('HealthHub')} accessibilityLabel="Open Health & Recovery">
            <View style={styles.between}>
              <View style={styles.modTitleRow}>
                <View style={[styles.moduleIcon, { backgroundColor: 'rgba(45, 212, 191, 0.18)' }]}>
                  <Text style={{ color: moduleColors.health, fontSize: 16, fontWeight: '700' }}>♥</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.mobilityHeading}>Sleep & Body Sensors</Text>
                  <Text style={styles.mobilitySub} numberOfLines={2}>
                    Sleep physiology trends, phone motion & wearable sync
                  </Text>
                </View>
              </View>
              <StatusPill
                label={latestHealth ? 'LIVE' : 'READY'}
                tone={latestHealth ? 'success' : 'info'}
              />
            </View>
          </Tappable>

          <View style={styles.mobStatsRow}>
            <View style={styles.mobStat}>
              <Text style={[styles.mobStatVal, { color: moduleColors.health }]}>
                {latestHealth ? latestHealth.research_estimate.value.toFixed(2) : '—'}
              </Text>
              <Text style={styles.mobStatLbl}>Sleep index</Text>
            </View>
            <View style={styles.mobStat}>
              <Text style={[styles.mobStatVal, { color: colors.accentBright }]}>
                {latestHealth ? `${Math.round((latestHealth.evidence.signal_quality_score ?? 0) * 100)}%` : '—'}
              </Text>
              <Text style={styles.mobStatLbl}>Signal quality</Text>
            </View>
            <View style={styles.mobStat}>
              <Text style={[styles.mobStatVal, { color: colors.textPrimary }]}>
                {healthTelemetry.data?.sessions_count ?? healthList.length}
              </Text>
              <Text style={styles.mobStatLbl}>Nights logged</Text>
            </View>
          </View>

          <SparklineChart
            values={healthSpark}
            height={48}
            emptyLabel="Log a sleep session or start live sensors to see trends"
          />

          {latestHealth ? (
            <HealthMetricBar
              label="Latest Signal Quality"
              valueLabel={`${Math.round((latestHealth.evidence.signal_quality_score ?? 0) * 100)}%`}
              progress={latestHealth.evidence.signal_quality_score ?? 0}
            />
          ) : null}

          <View style={styles.mobShortcutRow}>
            <Chip label="🌙 Sleep" active color={moduleColors.health} onPress={() => openHealth('SleepClearance')} />
            <Chip label="📡 Sensors" onPress={() => openHealth('SensorStream')} />
            <Chip label="🧠 MRI Study" onPress={() => openHealth('MriValidation')} />
          </View>

          <PrimaryButton title="Open Health Hub" onPress={() => openHealth('HealthHub')} />
        </Card>
      </FadeIn>

      {/* More NEXORA Modules */}
      <SectionHeading title="More essentials" action="View all →" onActionPress={() => nav.navigate('Explore')} />
      <View style={styles.grid}>
        {SECONDARY_MODULES.map((m, i) => (
          <FadeIn key={m.key} index={i + 2} style={styles.moduleWrap}>
            <Tappable
              onPress={() => nav.navigate('ModuleHub', { module: m.key })}
              accessibilityLabel={m.title}>
              <Card style={{ gap: 4 }}>
                <View style={styles.between}>
                  <View style={[styles.dot, { backgroundColor: moduleColors[m.key] }]} />
                  <Text style={{ color: colors.navBlue, fontSize: 11, fontWeight: '700' }}>Open →</Text>
                </View>
                <Text style={{ color: colors.textPrimary, fontFamily: fontFamily.medium, fontWeight: '600', fontSize: 14 }}>{m.title}</Text>
                <Text style={{ color: colors.textSecondary, fontFamily: fontFamily.sans, fontSize: 11.5 }}>{m.desc}</Text>
              </Card>
            </Tappable>
          </FadeIn>
        ))}
      </View>

      {/* Smart Assistant Card */}
      <SectionHeading title="Smart Assistant" action="Ask anything →" onActionPress={() => nav.navigate('AI')} />
      <FadeIn index={4}>
        <Card variant="featured">
          <TouchableOpacity onPress={() => setAiExpanded(v => !v)} activeOpacity={0.85} style={styles.between}>
            {status.isLoading ? (
              <Skeleton height={12} width={120} />
            ) : status.isError ? (
              <StatusPill label="ASSISTANT · OFFLINE" tone="danger" />
            ) : (
              <StatusPill
                label={brainUp ? 'ASSISTANT · ONLINE' : 'ASSISTANT · READY'}
                tone={brainUp ? 'success' : 'warning'}
              />
            )}
            <Text style={{ color: colors.navBlue, fontSize: 12, fontWeight: '700' }}>
              {aiExpanded ? 'Hide live stats ▲' : 'Live stats ▼'}
            </Text>
          </TouchableOpacity>

          {aiExpanded && status.data && (
            <View style={styles.telemetryGrid}>
              <View style={styles.telemetryCell}>
                <Text style={styles.telemetryVal}>{status.data.health?.events_processed ?? 0}</Text>
                <Text style={styles.telemetryLabel}>Trips analyzed</Text>
              </View>
              <View style={styles.telemetryCell}>
                <Text style={styles.telemetryVal}>{status.data.online_learner?.active_hazards_count ?? hazardCount}</Text>
                <Text style={styles.telemetryLabel}>Road alerts</Text>
              </View>
              <View style={styles.telemetryCell}>
                <Text style={styles.telemetryVal}>{status.data.online_learner?.active_hotspots_count ?? 0}</Text>
                <Text style={styles.telemetryLabel}>Busy zones</Text>
              </View>
            </View>
          )}

          <Text style={[typography.body, { color: colors.textSecondary, marginTop: 10 }]}>
            Quick questions for your day:
          </Text>
          <View style={styles.chipRow}>
            {quickActions().map(a => (
              <Chip key={a} label={a} onPress={() => nav.navigate('AI', { prompt: a, nonce: Date.now() })} />
            ))}
          </View>
        </Card>
      </FadeIn>
    </Screen>
  );
}

const styles = StyleSheet.create({
  profilePill: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
  },
  profilePillText: { color: colors.textPrimary, fontSize: 12, fontWeight: '700' },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  modTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  moduleIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mobilityHeading: { color: colors.textPrimary, fontFamily: fontFamily.medium, fontSize: 15, fontWeight: '700' },
  mobilitySub: { color: colors.textSecondary, fontFamily: fontFamily.sans, fontSize: 11.5, marginTop: 1 },
  mobStatsRow: { flexDirection: 'row', gap: spacing.s },
  mobStat: {
    flex: 1,
    backgroundColor: colors.bgElevated,
    borderRadius: 12,
    padding: 8,
    alignItems: 'center',
  },
  mobStatVal: { color: colors.routeCyan, fontFamily: fontFamily.sans, fontSize: 13.5, fontWeight: '700' },
  mobStatLbl: { color: colors.textSecondary, fontFamily: fontFamily.sans, fontSize: 10.5, marginTop: 2 },
  preTravelPill: {
    backgroundColor: 'rgba(29, 143, 225, 0.12)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: 'rgba(29, 143, 225, 0.25)',
  },
  preTravelText: { color: colors.routeCyan, fontFamily: fontFamily.medium, fontSize: 11.5, fontWeight: '600', lineHeight: 16 },
  mobShortcutRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s, paddingVertical: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s },
  moduleWrap: { flexGrow: 1, flexBasis: '47%' },
  dot: { width: 9, height: 9, borderRadius: 5, marginBottom: 4 },
  telemetryGrid: {
    flexDirection: 'row',
    gap: spacing.s,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  telemetryCell: {
    flex: 1,
    backgroundColor: colors.bgElevated,
    borderRadius: 12,
    padding: 8,
    alignItems: 'center',
  },
  telemetryVal: { color: colors.routeCyan, fontFamily: fontFamily.sans, fontSize: 15.5, fontWeight: '700' },
  telemetryLabel: { color: colors.textSecondary, fontFamily: fontFamily.sans, fontSize: 10.5, marginTop: 2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s, marginTop: spacing.s },
});
