import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { colors, fontFamily, moduleColors, radii, spacing, typography } from '../../../app/theme/tokens';
import { healthApi } from '../../../core/api/health';
import { Card, PrimaryButton, SectionHeading } from '../../../core/design-system/components';
import { StatusPill } from '../../../core/design-system/motion';
import { Screen } from '../../../shared/components/Screen';
import { HealthMetricBar, SparklineChart } from '../components/HealthVisualizations';

const HEALTH_SUBMODULES = [
  {
    key: 'sleep_clearance',
    title: 'Sleep & Recovery Insights',
    subtitle: 'Overnight sleep stages, recovery balance & confidence trend across nights',
    status: 'active' as const,
    tag: '🌙 Sleep & Recovery',
    route: 'SleepClearance' as const,
  },
  {
    key: 'device_sensors',
    title: 'Live Body & Watch Sensors',
    subtitle: 'Real-time phone motion, sleep posture & Apple Health / Health Connect sync',
    status: 'active' as const,
    tag: '📡 On-Device Sensors',
    route: 'SensorStream' as const,
  },
  {
    key: 'mri_validation',
    title: 'MRI Study & Accuracy',
    subtitle: 'Visual agreement between overnight sleep estimates & clinical 3T MRI scans',
    status: 'active' as const,
    tag: '🧠 Clinical Validation',
    route: 'MriValidation' as const,
  },
];

export default function HealthHubScreen() {
  const nav = useNavigation<any>();

  const submodulesQuery = useQuery({
    queryKey: ['health', 'submodules'],
    queryFn: () => healthApi.listSubmodules(),
  });

  const sessionsQuery = useQuery({
    queryKey: ['health', 'sleep-clearance', 'sessions'],
    queryFn: () => healthApi.listSleepSessions('default-user', 7),
  });

  const featuresQuery = useQuery({
    queryKey: ['health', 'features', 'latest'],
    queryFn: () => healthApi.listLatestFeatures('default-user', 5),
  });

  const telemetryQuery = useQuery({
    queryKey: ['health', 'telemetry'],
    queryFn: () => healthApi.getTelemetry(),
  });

  const sessions = sessionsQuery.data?.sessions ?? [];
  const latestSession = sessions[0] ?? null;
  const sparkValues = [...sessions]
    .reverse()
    .map(s => s.research_estimate?.value ?? 0)
    .filter(v => v > 0);

  const qualityScore = latestSession?.evidence?.signal_quality_score ?? 0;
  const totalSessions = telemetryQuery.data?.sessions_count ?? sessions.length;
  const totalStreams = telemetryQuery.data?.queue?.processed ?? featuresQuery.data?.streams?.length ?? 0;

  const guardrail =
    submodulesQuery.data?.claim_guardrail ??
    'Research surrogate only. NEXORA never claims to measure or improve brain waste clearance from ordinary smartwatch sleep scores or standalone smartphone sensors.';

  return (
    <Screen
      title="NEXORA Health"
      subtitle="Sleep physiology, connected sensors & visual trends"
      badge="HEALTH"
      rightAction={
        <TouchableOpacity onPress={() => nav.goBack()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
      }>
      <View style={styles.content}>
        {/* Visual Health Snapshot */}
        <Card variant="featured" style={styles.heroCard}>
          <View style={styles.rowBetween}>
            <Text style={styles.heroTitle}>Health Snapshot</Text>
            <StatusPill
              label={latestSession ? 'LIVE DATA' : 'READY'}
              tone={latestSession ? 'success' : 'info'}
            />
          </View>

          <View style={styles.kpiRow}>
            <View style={styles.kpiBox}>
              <Text style={styles.kpiVal}>
                {latestSession ? latestSession.research_estimate.value.toFixed(2) : '—'}
              </Text>
              <Text style={styles.kpiLbl}>Sleep Index</Text>
            </View>
            <View style={styles.kpiBox}>
              <Text style={styles.kpiVal}>{totalSessions}</Text>
              <Text style={styles.kpiLbl}>Nights Logged</Text>
            </View>
            <View style={styles.kpiBox}>
              <Text style={styles.kpiVal}>{totalStreams}</Text>
              <Text style={styles.kpiLbl}>Sensor Syncs</Text>
            </View>
          </View>

          <SparklineChart
            values={sparkValues}
            height={58}
            emptyLabel="Log a sleep session to view your overnight trend"
          />

          {latestSession ? (
            <HealthMetricBar
              label="Latest Signal Quality"
              valueLabel={`${Math.round(qualityScore * 100)}%`}
              progress={qualityScore}
            />
          ) : null}
        </Card>

        <SectionHeading title="Health Areas" />

        {HEALTH_SUBMODULES.map(sub => {
          const serverMatch = submodulesQuery.data?.submodules?.find(s => s.key === sub.key);
          const status = serverMatch?.status ?? sub.status;
          return (
            <TouchableOpacity
              key={sub.key}
              activeOpacity={0.85}
              onPress={() => nav.navigate(sub.route)}>
              <Card style={styles.subCard}>
                <View style={styles.rowBetween}>
                  <Text style={styles.subTitle}>{sub.title}</Text>
                  <StatusPill
                    label={status === 'active' ? 'ACTIVE' : 'PREVIEW'}
                    tone={status === 'active' ? 'success' : 'info'}
                  />
                </View>
                <Text style={styles.subDesc}>{sub.subtitle}</Text>
                <View style={styles.subFooter}>
                  <Text style={styles.sensorTag}>{sub.tag}</Text>
                  <Text style={styles.openLink}>Open →</Text>
                </View>
              </Card>
            </TouchableOpacity>
          );
        })}

        <View style={styles.ctaWrap}>
          <PrimaryButton
            title="Start Live Sensor Tracking"
            onPress={() => nav.navigate('SensorStream')}
          />
        </View>

        {/* Non-intrusive research guardrail footer */}
        <Card variant="subtle" style={styles.guardrailCard}>
          <View style={styles.rowBetween}>
            <StatusPill label="RESEARCH ONLY" tone="warning" />
            <Text style={styles.monoTag}>NOT FOR DIAGNOSIS</Text>
          </View>
          <Text style={styles.guardrailText}>{guardrail}</Text>
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.m },
  backText: { fontFamily: fontFamily.medium, fontSize: 13, color: moduleColors.health, fontWeight: '600' },
  heroCard: {
    borderColor: 'rgba(45, 212, 191, 0.35)',
    gap: spacing.m,
  },
  heroTitle: { fontFamily: fontFamily.medium, fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  kpiRow: { flexDirection: 'row', gap: spacing.s },
  kpiBox: {
    flex: 1,
    padding: spacing.s,
    borderRadius: radii.card,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    alignItems: 'center',
  },
  kpiVal: { fontFamily: fontFamily.mono, fontSize: 18, fontWeight: '700', color: moduleColors.health },
  kpiLbl: { fontFamily: fontFamily.sans, fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.s,
  },
  subCard: { borderColor: 'rgba(45, 212, 191, 0.28)' },
  subTitle: { fontFamily: fontFamily.medium, fontSize: 16, fontWeight: '700', color: colors.textPrimary, flex: 1 },
  subDesc: { ...typography.body, color: colors.textSecondary, marginTop: 6 },
  subFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.m },
  sensorTag: { fontFamily: fontFamily.mono, fontSize: 11, color: moduleColors.health },
  openLink: { fontFamily: fontFamily.medium, fontSize: 13, fontWeight: '600', color: moduleColors.health },
  ctaWrap: { marginTop: spacing.xs },
  guardrailCard: {
    borderColor: 'rgba(245, 158, 11, 0.3)',
    backgroundColor: 'rgba(245, 158, 11, 0.06)',
  },
  monoTag: { fontFamily: fontFamily.mono, fontSize: 10.5, color: colors.statusWarning },
  guardrailText: { fontFamily: fontFamily.sans, fontSize: 12, lineHeight: 17, color: colors.textSecondary, marginTop: spacing.s },
});
