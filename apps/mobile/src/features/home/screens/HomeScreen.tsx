import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Screen } from '../../../shared/components/Screen';
import { Card, PrimaryButton, SectionHeading } from '../../../core/design-system/components';
import { Chip, FadeIn, Skeleton, StatusPill, Tappable } from '../../../core/design-system/motion';
import { colors, moduleColors, spacing, typography } from '../../../app/theme/tokens';
import { digitalTwinApi, moveApi } from '../../../core/api/move';
import { useMe } from '../../../core/auth/useMe';
import { useLocation } from '../../../core/location/useLocation';

const SECONDARY_MODULES = [
  { key: 'health', title: 'Health', desc: 'Reports & wellness timeline' },
  { key: 'finance', title: 'Finance', desc: 'Spending & commute budgets' },
  { key: 'work', title: 'Work', desc: 'Tasks, prep & schedules' },
] as const;

function quickActions(d = new Date()) {
  const h = d.getHours();
  const base = ['Any road hazards near me?', 'Show my health summary'];
  if (h < 11) return ['When should I leave for work?', 'How is traffic right now?', ...base];
  if (h < 17) return ['Plan my next trip', 'How is traffic right now?', ...base];
  return ['Best way home now?', 'How is traffic right now?', ...base];
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
  if (weekday && h >= 7 && h < 11) return 'Morning commute ready — live traffic, routes & daily updates.';
  if (weekday && h >= 16 && h < 21) return 'Heading home? Check live traffic, fastest routes & road alerts.';
  return 'Your smart daily companion for commute, health, money & tasks.';
}

// HM-01 NEXORA Super-App Home — multi-module launcher with dedicated Mobility workspace entry.
export default function HomeScreen() {
  const nav = useNavigation<any>();
  const me = useMe();
  const loc = useLocation();
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
                <View>
                  <Text style={styles.mobilityHeading}>MoveSmart Navigation</Text>
                  <Text style={styles.mobilitySub}>Turn-by-turn routes, live traffic, road alerts & saved places</Text>
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
              <Text style={styles.mobStatVal}>{avgSpeed !== null ? `${avgSpeed} km/h` : loc.point ? 'Live' : 'Locating'}</Text>
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
            <Chip label="🌐 Digital Twin" onPress={() => openMobility('Radar')} />
            <Chip label="★ Saved Places" onPress={() => openMobility('Places')} />
            <Chip label="⚙ Route Prefs" onPress={() => openMobility('MovePrefs')} />
          </View>

          <PrimaryButton title="Start Navigation" variant="nav" onPress={() => openMobility('Navigate')} />
        </Card>
      </FadeIn>

      {/* Daily Essentials */}
      <SectionHeading title="Daily essentials" action="View all →" onActionPress={() => nav.navigate('Explore')} />
      <View style={styles.grid}>
        {SECONDARY_MODULES.map((m, i) => (
          <FadeIn key={m.key} index={i + 1} style={styles.moduleWrap}>
            <Tappable
              onPress={() => nav.navigate('ModuleHub', { module: m.key })}
              accessibilityLabel={m.title}>
              <Card style={{ gap: 4 }}>
                <View style={styles.between}>
                  <View style={[styles.dot, { backgroundColor: moduleColors[m.key] }]} />
                  <Text style={{ color: colors.navBlue, fontSize: 11, fontWeight: '700' }}>Open →</Text>
                </View>
                <Text style={{ color: colors.textPrimary, fontWeight: '700', fontSize: 15 }}>{m.title}</Text>
                <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{m.desc}</Text>
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
  mobilityHeading: { color: colors.textPrimary, fontSize: 16.5, fontWeight: '800' },
  mobilitySub: { color: colors.textSecondary, fontSize: 12, marginTop: 1 },
  mobStatsRow: { flexDirection: 'row', gap: spacing.s },
  mobStat: {
    flex: 1,
    backgroundColor: colors.bgElevated,
    borderRadius: 12,
    padding: 8,
    alignItems: 'center',
  },
  mobStatVal: { color: colors.routeCyan, fontSize: 14, fontWeight: '800' },
  mobStatLbl: { color: colors.textSecondary, fontSize: 10.5, marginTop: 2 },
  preTravelPill: {
    backgroundColor: 'rgba(29, 143, 225, 0.12)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: 'rgba(29, 143, 225, 0.25)',
  },
  preTravelText: { color: colors.routeCyan, fontSize: 11.5, fontWeight: '600', lineHeight: 16 },
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
  telemetryVal: { color: colors.routeCyan, fontSize: 17, fontWeight: '800' },
  telemetryLabel: { color: colors.textSecondary, fontSize: 10.5, marginTop: 2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s, marginTop: spacing.s },
});
