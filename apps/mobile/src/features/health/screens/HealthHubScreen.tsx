import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { colors, fontFamily, moduleColors, radii, spacing, typography } from '../../../app/theme/tokens';
import { healthApi, type ProvenancedFeature } from '../../../core/api/health';
import { Card, PrimaryButton, SectionHeading } from '../../../core/design-system/components';
import { StatusPill } from '../../../core/design-system/motion';
import {
  computeReadiness,
  defaultCheckIn,
  loadTodayCheckIn,
  saveTodayCheckIn,
  type DailyCheckIn,
  type VitalsSnapshot,
} from '../../../core/health/dailyWellness';
import { nativeHealthSensors } from '../../../core/native/healthSensorsBridge';
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
  const qc = useQueryClient();
  const [checkIn, setCheckIn] = useState<DailyCheckIn>(defaultCheckIn);
  const [vitals, setVitals] = useState<VitalsSnapshot>({});
  const [mlSyncing, setMlSyncing] = useState(false);
  const [mlSyncNote, setMlSyncNote] = useState<string | null>(null);

  useEffect(() => {
    void loadTodayCheckIn().then(setCheckIn);
    (async () => {
      const next: VitalsSnapshot = {};
      if (nativeHealthSensors?.fetchAuthorizedWearableMetrics) {
        try {
          const m = await nativeHealthSensors.fetchAuthorizedWearableMetrics(24);
          if (m.authorized) {
            next.heartRateBpm = m.heart_rate_bpm;
            next.hrvMs = m.hrv_rmssd_ms;
            next.steps = m.steps_count;
            next.sleepHours = m.sleep_duration_hours;
            next.spo2Pct = m.spo2_pct;
          }
        } catch {
          // Ignore if Health Connect / HealthKit is not authorized yet
        }
      }
      if (next.steps == null && Platform.OS !== 'web') {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const expoSensors = require('expo-sensors') as {
            Pedometer?: {
              isAvailableAsync: () => Promise<boolean>;
              getStepCountAsync: (s: Date, e: Date) => Promise<{ steps: number }>;
            };
          };
          if (expoSensors?.Pedometer && (await expoSensors.Pedometer.isAvailableAsync())) {
            const end = new Date();
            const start = new Date(end.getFullYear(), end.getMonth(), end.getDate());
            const res = await expoSensors.Pedometer.getStepCountAsync(start, end);
            next.steps = res.steps;
          }
        } catch {
          // Pedometer optional
        }
      }
      setVitals(next);
    })();
  }, []);

  const updateCheckIn = (patch: Partial<DailyCheckIn>) => {
    setCheckIn(prev => {
      const updated: DailyCheckIn = { ...prev, ...patch, updatedAt: new Date().toISOString() };
      void saveTodayCheckIn(updated);
      return updated;
    });
  };

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
  const totalSessions = telemetryQuery.data?.sessions_count ?? sessions.length;
  const totalStreams = telemetryQuery.data?.queue?.processed ?? featuresQuery.data?.streams?.length ?? 0;

  const syncToBackendMl = useCallback(
    async (targetCheckIn: DailyCheckIn) => {
      setMlSyncing(true);
      setMlSyncNote(null);
      try {
        const nowMs = Date.now();
        const prov = {
          source_device: Platform.OS,
          signal_source: vitals.heartRateBpm != null ? 'health_connect_plus_checkin' : 'phone_checkin',
          sampling_rate_hz: 1,
          timestamp_accuracy_ms: 1000,
          placement_protocol: 'daily_checkin',
          calibration_status: vitals.heartRateBpm != null ? 'os_authorized' : 'user_reported',
          signal_quality_score: vitals.heartRateBpm != null ? 0.9 : 0.72,
          measurement_status: 'measured' as const,
          algorithm_version: 'nexora_wellness_v1',
        };
        const extracted: Record<string, ProvenancedFeature> = {
          sleep_duration_hours: { name: 'sleep_duration_hours', value: vitals.sleepHours ?? targetCheckIn.sleepHours, unit: 'h', provenance: prov },
          energy_score: { name: 'energy_score', value: targetCheckIn.energyLevel, unit: '1-5', provenance: prov },
          stress_score: { name: 'stress_score', value: targetCheckIn.stressLevel, unit: '1-5', provenance: prov },
          hydration_glasses: { name: 'hydration_glasses', value: targetCheckIn.waterGlasses, unit: 'glasses', provenance: prov },
        };
        if (vitals.steps != null) {
          extracted.steps_count = { name: 'steps_count', value: vitals.steps, unit: 'steps', provenance: prov };
        }
        if (vitals.heartRateBpm != null) {
          extracted.heart_rate_bpm = { name: 'heart_rate_bpm', value: vitals.heartRateBpm, unit: 'bpm', provenance: prov };
        }
        if (vitals.hrvMs != null) {
          extracted.hrv_rmssd_ms = { name: 'hrv_rmssd_ms', value: vitals.hrvMs, unit: 'ms', provenance: prov };
        }

        await healthApi.ingestFeatures({
          user_id: 'default-user',
          hardware_tier: vitals.heartRateBpm != null ? 'wearable_ppg_imu' : 'consumer_phone_sensors',
          sample_rate_hz: 1,
          is_simulated: false,
          device_timestamp_ms: nowMs,
          monotonic_ms: nowMs,
          sync_uncertainty_ms: 50,
          extracted_features: extracted,
        });

        const sleepHrs = vitals.sleepHours ?? targetCheckIn.sleepHours;
        const n3Frac = Math.min(0.35, Math.max(0.1, (sleepHrs / 8) * 0.22));
        const fragIdx = Math.min(1, Math.max(0.05, targetCheckIn.stressLevel * 0.12));
        const session = await healthApi.createSleepSession({
          user_id: 'default-user',
          hardware_tier: vitals.heartRateBpm != null ? 'wearable_ppg_imu' : 'consumer_phone_sensors',
          is_simulated: false,
          n3_fraction: Number(n3Frac.toFixed(3)),
          sleep_fragmentation_index: Number(fragIdx.toFixed(3)),
          hrv_rmssd_ms: vitals.hrvMs ?? undefined,
          signal_quality_score: vitals.heartRateBpm != null ? 0.88 : 0.68,
        });

        await Promise.all([
          qc.invalidateQueries({ queryKey: ['health'] }),
          sessionsQuery.refetch(),
          featuresQuery.refetch(),
          telemetryQuery.refetch(),
        ]);

        setMlSyncNote(
          `Synced to DB · ML (${session.model_version}): ${session.research_estimate.value.toFixed(2)} ${session.research_estimate.unit}`,
        );
      } catch (err) {
        setMlSyncNote(err instanceof Error ? err.message : 'Unable to reach Health ML backend');
      } finally {
        setMlSyncing(false);
      }
    },
    [featuresQuery, qc, sessionsQuery, telemetryQuery, vitals],
  );
  const sparkValues = [...sessions]
    .reverse()
    .map(s => s.research_estimate?.value ?? 0)
    .filter(v => v > 0);

  const readiness = useMemo(
    () =>
      computeReadiness(checkIn, {
        ...vitals,
        sleepIndex: latestSession?.research_estimate?.value ?? null,
      }),
    [checkIn, vitals, latestSession],
  );

  const guardrail =
    submodulesQuery.data?.claim_guardrail ??
    'Wellness guidance only. NEXORA does not diagnose, treat, or claim clinical brain waste clearance from consumer sensors.';

  return (
    <Screen
      title="NEXORA Health"
      subtitle="Daily readiness, vitals & actionable recovery plan"
      badge="HEALTH · DAILY COACH">
      <View style={styles.content}>
        {/* Consumer Daily Readiness Hero */}
        <Card variant="featured" style={styles.heroCard}>
          <View style={styles.rowBetween}>
            <Text style={styles.heroTitle}>Today’s Readiness</Text>
            <StatusPill
              label={`${readiness.score} / 100 · ${readiness.band.toUpperCase()}`}
              tone={readiness.score >= 70 ? 'success' : readiness.score >= 50 ? 'info' : 'warning'}
            />
          </View>
          <Text style={styles.headlineText}>{readiness.headline}</Text>

          <View style={styles.kpiRow}>
            <View style={styles.kpiBox}>
              <Text style={styles.kpiVal}>
                {(vitals.sleepHours ?? checkIn.sleepHours).toFixed(1)}h
              </Text>
              <Text style={styles.kpiLbl}>Sleep</Text>
            </View>
            <View style={styles.kpiBox}>
              <Text style={styles.kpiVal}>
                {vitals.heartRateBpm != null ? `${Math.round(vitals.heartRateBpm)}` : '—'}
              </Text>
              <Text style={styles.kpiLbl}>Heart Rate</Text>
            </View>
            <View style={styles.kpiBox}>
              <Text style={styles.kpiVal}>
                {vitals.steps != null ? vitals.steps.toLocaleString() : `${checkIn.waterGlasses}/8`}
              </Text>
              <Text style={styles.kpiLbl}>{vitals.steps != null ? 'Steps' : 'Water'}</Text>
            </View>
          </View>

          {vitals.steps != null ? (
            <HealthMetricBar
              label="Daily Step Goal"
              valueLabel={`${vitals.steps.toLocaleString()} / 8,000`}
              progress={Math.min(1, vitals.steps / 8000)}
            />
          ) : (
            <HealthMetricBar
              label="Daily Hydration"
              valueLabel={`${checkIn.waterGlasses} / 8 glasses`}
              progress={Math.min(1, checkIn.waterGlasses / 8)}
            />
          )}

          {sparkValues.length > 1 ? (
            <SparklineChart
              values={sparkValues}
              height={48}
              emptyLabel="Log sleep nights to view recovery trend"
            />
          ) : null}
        </Card>

        {/* 1-Tap Daily Check-In (Works with or without a watch) */}
        <SectionHeading title="1-Tap Daily Check-In" />
        <Card style={{ gap: spacing.s }}>
          <Text style={styles.subDesc}>
            Keep your readiness & daily plan accurate even without a smartwatch:
          </Text>

          <Text style={styles.chipLabel}>Last Night’s Sleep</Text>
          <View style={styles.chipRow}>
            {[5, 6, 7, 8, 9].map(hrs => (
              <TouchableOpacity
                key={hrs}
                onPress={() => updateCheckIn({ sleepHours: hrs })}
                style={[styles.chip, checkIn.sleepHours === hrs && styles.chipActive]}>
                <Text style={[styles.chipText, checkIn.sleepHours === hrs && styles.chipTextActive]}>
                  {hrs}h
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.chipLabel}>Energy & Stress</Text>
          <View style={styles.chipRow}>
            {(
              [
                { label: 'Low Energy', val: 2 },
                { label: 'Steady', val: 3 },
                { label: 'Peak', val: 5 },
              ] as const
            ).map(opt => (
              <TouchableOpacity
                key={opt.label}
                onPress={() => updateCheckIn({ energyLevel: opt.val })}
                style={[styles.chip, checkIn.energyLevel === opt.val && styles.chipActive]}>
                <Text style={[styles.chipText, checkIn.energyLevel === opt.val && styles.chipTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              onPress={() => updateCheckIn({ stressLevel: checkIn.stressLevel >= 4 ? 2 : 4 })}
              style={[styles.chip, checkIn.stressLevel >= 4 && styles.chipWarn]}>
              <Text style={[styles.chipText, checkIn.stressLevel >= 4 && styles.chipTextActive]}>
                {checkIn.stressLevel >= 4 ? 'High Stress ✓' : 'Calm'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.btnRow}>
            <View style={{ flex: 1 }}>
              <PrimaryButton
                title={`+1 Water (${checkIn.waterGlasses}/8)`}
                variant="secondary"
                onPress={() => updateCheckIn({ waterGlasses: Math.min(12, checkIn.waterGlasses + 1) })}
              />
            </View>
            <View style={{ flex: 1 }}>
              <PrimaryButton
                title={mlSyncing ? 'Running ML...' : 'Sync & Run ML'}
                loading={mlSyncing}
                onPress={() => void syncToBackendMl(checkIn)}
              />
            </View>
          </View>
          {mlSyncNote ? <Text style={styles.mlNote}>{mlSyncNote}</Text> : null}
        </Card>

        {/* Live Backend DB & ML Model Insights */}
        <SectionHeading title="ML Model & DB Insights" />
        <Card style={{ gap: spacing.xs }}>
          <View style={styles.rowBetween}>
            <Text style={styles.subTitle}>
              {latestSession ? `Recovery Model (${latestSession.model_version})` : 'Health ML Pipeline'}
            </Text>
            <StatusPill
              label={latestSession ? (latestSession.is_fallback ? 'FALLBACK' : 'ML SCORED') : `${totalSessions} IN DB`}
              tone={latestSession ? 'success' : 'info'}
            />
          </View>
          {latestSession ? (
            <>
              <Text style={styles.subDesc}>
                Physiology State: {(latestSession.physiological_hypotheses.sleep_physiology_state * 100).toFixed(0)}% · Estimate:{' '}
                {latestSession.research_estimate.value.toFixed(2)} {latestSession.research_estimate.unit} (95% CI{' '}
                {latestSession.research_estimate.confidence_interval[0].toFixed(2)}–
                {latestSession.research_estimate.confidence_interval[1].toFixed(2)})
              </Text>
              <Text style={styles.monoMeta}>
                DB: {totalSessions} session(s) · {totalStreams} stream(s) · Quality {Math.round(latestSession.evidence.signal_quality_score * 100)}%
              </Text>
            </>
          ) : (
            <Text style={styles.subDesc}>
              Tap “Sync & Run ML” above to persist your vitals & check-in to the database and score them with the Health ML model.
            </Text>
          )}
          <PrimaryButton
            title="Open Watch & Live Sensors"
            variant="secondary"
            onPress={() => nav.navigate('SensorStream')}
          />
        </Card>

        {/* Actionable Daily Coaching */}
        <SectionHeading title="What To Do Today" />
        {readiness.actions.map(act => (
          <Card key={act.id} style={styles.actionCard}>
            <View style={styles.rowBetween}>
              <Text style={styles.actionTitle}>
                {act.icon}  {act.title}
              </Text>
              <StatusPill label={act.tone === 'success' ? 'ON TRACK' : act.tone === 'warning' ? 'PRIORITY' : 'TIP'} tone={act.tone} />
            </View>
            <Text style={styles.subDesc}>{act.detail}</Text>
          </Card>
        ))}

        <SectionHeading title="Deep-Dive Tools" />

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
  headlineText: { ...typography.body, color: colors.textPrimary, lineHeight: 20 },
  chipLabel: { fontFamily: fontFamily.medium, fontSize: 12, color: colors.textMuted, marginTop: 2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.button,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  chipActive: {
    backgroundColor: 'rgba(45, 212, 191, 0.16)',
    borderColor: moduleColors.health,
  },
  chipWarn: {
    backgroundColor: 'rgba(245, 158, 11, 0.18)',
    borderColor: colors.statusWarning,
  },
  chipText: { fontFamily: fontFamily.medium, fontSize: 12.5, color: colors.textSecondary },
  chipTextActive: { color: colors.textPrimary, fontWeight: '700' },
  btnRow: { flexDirection: 'row', gap: spacing.s, marginTop: spacing.xs },
  actionCard: { gap: 4, borderColor: 'rgba(45, 212, 191, 0.25)' },
  actionTitle: { fontFamily: fontFamily.medium, fontSize: 14.5, fontWeight: '700', color: colors.textPrimary, flex: 1 },
  mlNote: { fontFamily: fontFamily.mono, fontSize: 11, color: moduleColors.health, marginTop: 2 },
  monoMeta: { fontFamily: fontFamily.mono, fontSize: 11, color: colors.textMuted },
  guardrailCard: {
    borderColor: 'rgba(245, 158, 11, 0.3)',
    backgroundColor: 'rgba(245, 158, 11, 0.06)',
  },
  monoTag: { fontFamily: fontFamily.mono, fontSize: 10.5, color: colors.statusWarning },
  guardrailText: { fontFamily: fontFamily.sans, fontSize: 12, lineHeight: 17, color: colors.textSecondary, marginTop: spacing.s },
});
