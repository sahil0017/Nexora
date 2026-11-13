import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useMutation, useQuery } from '@tanstack/react-query';
import { colors, fontFamily, moduleColors, radii, spacing, typography } from '../../../app/theme/tokens';
import {
  healthApi,
  type HardwareTier,
  type SleepClearanceSession,
} from '../../../core/api/health';
import { Card, PrimaryButton, SectionHeading } from '../../../core/design-system/components';
import { Chip, StatusPill } from '../../../core/design-system/motion';
import { useDevicePhysioSensors } from '../../../core/sensors/useDevicePhysioSensors';
import { Screen } from '../../../shared/components/Screen';
import {
  HealthMetricBar,
  SleepArchitectureBar,
  SleepConfidenceRangeBar,
  SparklineChart,
} from '../components/HealthVisualizations';

const HARDWARE_TIERS: { key: HardwareTier; label: string }[] = [
  { key: 'consumer_phone_sensors', label: 'Phone Only' },
  { key: 'wearable_ppg_imu', label: 'Watch + Phone' },
  { key: 'clinical_eeg_ppg_resp', label: 'Sleep Lab (EEG)' },
  { key: 'paired_mri_cohort', label: 'MRI Study Group' },
];

export default function SleepClearanceScreen() {
  const nav = useNavigation<any>();
  const [hardwareTier, setHardwareTier] = useState<HardwareTier>('wearable_ppg_imu');
  const [modelStage, setModelStage] = useState<'M0' | 'M1'>('M1');
  const [presetMode, setPresetMode] = useState<'deep_n3' | 'fragmented'>('deep_n3');
  const [latestSession, setLatestSession] = useState<SleepClearanceSession | null>(null);

  const sensors = useDevicePhysioSensors({ hardwareTier, autoUpload: false });

  const historyQuery = useQuery({
    queryKey: ['health', 'sleep-clearance', 'sessions'],
    queryFn: () => healthApi.listSleepSessions('default-user', 7),
  });

  const runModel = useMutation({
    mutationFn: () => {
      const isDeep = presetMode === 'deep_n3';
      const hasEeg = hardwareTier === 'clinical_eeg_ppg_resp' || hardwareTier === 'paired_mri_cohort';
      const hasPpg = hardwareTier !== 'consumer_phone_sensors';
      const orientation =
        sensors.deviceOrientation !== 'unknown'
          ? sensors.deviceOrientation
          : isDeep
            ? 'lateral_right_proxy'
            : 'face_up_supine_proxy';

      return healthApi.createSleepSession({
        cohort_id: 'nexora-pilot-01',
        model_stage: modelStage,
        hardware_tier: hardwareTier,
        is_simulated: false,
        eeg_delta_ratio: hasEeg ? (isDeep ? 0.48 : 0.19) : undefined,
        n3_fraction: hasEeg ? (isDeep ? 0.24 : 0.09) : undefined,
        sleep_fragmentation_index: isDeep ? 0.11 : 0.36,
        respiratory_rate_bpm: hasEeg ? (isDeep ? 13.1 : 17.4) : undefined,
        ppg_pulsatility_index: hasPpg ? (isDeep ? 0.78 : 0.46) : undefined,
        hrv_rmssd_ms: hasPpg ? (isDeep ? 54 : 24) : undefined,
        device_orientation: orientation,
        signal_quality_score: isDeep ? 0.9 : 0.62,
        sample_rate_hz: sensors.sampleRateHz,
      });
    },
    onSuccess: res => {
      setLatestSession(res);
      void historyQuery.refetch();
    },
  });

  const sessions = historyQuery.data?.sessions ?? [];
  const activeResult = latestSession ?? sessions[0] ?? null;
  const trendValues = [...sessions]
    .reverse()
    .map(s => s.research_estimate?.value ?? 0)
    .filter(v => v > 0);

  const isDeepPreset = presetMode === 'deep_n3';

  return (
    <Screen
      title="Sleep & Recovery Insights"
      subtitle="Overnight sleep physiology & trend visualization"
      badge="HEALTH · SLEEP">
      <View style={styles.content}>
        {activeResult ? (
          <>
            <SectionHeading title="Overnight Physiology Summary" />
            <Card variant="featured" style={styles.resultCard}>
              <View style={styles.rowBetween}>
                <Text style={styles.monoLabel}>
                  SLEEP INDEX ({activeResult.model_stage === 'M0' ? 'QUICK' : 'ADAPTIVE'})
                </Text>
                <StatusPill
                  label={activeResult.is_fallback ? 'OFFLINE' : 'RECORDED'}
                  tone={activeResult.is_fallback ? 'warning' : 'success'}
                />
              </View>
              <Text style={styles.estimateValue}>
                {activeResult.research_estimate.value.toFixed(2)}
                <Text style={styles.unitInline}> {activeResult.research_estimate.unit}</Text>
              </Text>

              <SleepConfidenceRangeBar
                value={activeResult.research_estimate.value}
                ciLow={activeResult.research_estimate.confidence_interval[0]}
                ciHigh={activeResult.research_estimate.confidence_interval[1]}
              />

              <Text style={[styles.label, { marginTop: spacing.s }]}>Estimated Sleep Stages</Text>
              <SleepArchitectureBar
                deepFraction={isDeepPreset ? 0.24 : 0.1}
                fragmentationIndex={isDeepPreset ? 0.11 : 0.34}
              />

              <HealthMetricBar
                label="Signal Quality"
                valueLabel={`${Math.round((activeResult.evidence.signal_quality_score ?? 0) * 100)}%`}
                progress={activeResult.evidence.signal_quality_score ?? 0}
              />

              <View style={styles.metricsGrid}>
                <View style={styles.metricBox}>
                  <Text style={styles.metricLabel}>Uncertainty</Text>
                  <Text style={styles.metricVal}>
                    ±{activeResult.research_estimate.uncertainty.epistemic.toFixed(3)}
                  </Text>
                </View>
                <View style={styles.metricBox}>
                  <Text style={styles.metricLabel}>Signal Noise</Text>
                  <Text style={styles.metricVal}>
                    {activeResult.research_estimate.uncertainty.aleatoric.toFixed(3)}
                  </Text>
                </View>
                <View style={styles.metricBox}>
                  <Text style={styles.metricLabel}>Deep-Sleep Link</Text>
                  <Text style={styles.metricVal}>
                    +{activeResult.n3_associated_feature_sensitivity.toFixed(3)}
                  </Text>
                </View>
              </View>
            </Card>
          </>
        ) : null}

        <SectionHeading title="Recent Nights Trend" />
        <Card style={{ gap: spacing.s }}>
          <SparklineChart
            values={trendValues}
            height={60}
            emptyLabel="Generate a sleep summary below to start tracking your trend"
          />
        </Card>

        <SectionHeading title="Live Sensor Check-In" />
        <Card variant="subtle" style={{ gap: spacing.s }}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>On-Device Motion & Posture</Text>
            <StatusPill
              label={sensors.isStreaming ? 'LIVE' : 'IDLE'}
              tone={sensors.isStreaming ? 'success' : 'info'}
            />
          </View>
          <Text style={styles.metaText}>
            Posture: {sensors.deviceOrientation} · Micro-motion: {sensors.microMotionRms.toFixed(3)}
          </Text>
          <View style={styles.chipRow}>
            <Chip
              label={sensors.isStreaming ? 'Stop Tracking' : 'Start Live Tracking'}
              active={sensors.isStreaming}
              color={moduleColors.health}
              onPress={() => (sensors.isStreaming ? sensors.stop() : void sensors.start(false))}
            />
            <Chip label="Manage Sensors →" onPress={() => nav.navigate('SensorStream')} />
          </View>
          {sensors.error ? <Text style={styles.warnText}>{sensors.error}</Text> : null}
        </Card>

        <SectionHeading title="Log Sleep Session" />
        <Card style={{ gap: spacing.s }}>
          <Text style={styles.label}>Connected Devices</Text>
          <View style={styles.chipRow}>
            {HARDWARE_TIERS.map(t => (
              <Chip
                key={t.key}
                label={t.label}
                active={hardwareTier === t.key}
                color={moduleColors.health}
                onPress={() => setHardwareTier(t.key)}
              />
            ))}
          </View>

          <Text style={[styles.label, { marginTop: spacing.s }]}>Analysis Mode</Text>
          <View style={styles.chipRow}>
            <Chip
              label="Quick Estimate"
              active={modelStage === 'M0'}
              color={moduleColors.health}
              onPress={() => setModelStage('M0')}
            />
            <Chip
              label="Smart Adaptive"
              active={modelStage === 'M1'}
              color={moduleColors.health}
              onPress={() => setModelStage('M1')}
            />
          </View>

          <Text style={[styles.label, { marginTop: spacing.s }]}>Sleep Pattern</Text>
          <View style={styles.chipRow}>
            <Chip
              label="Deep Restful Sleep"
              active={presetMode === 'deep_n3'}
              color={moduleColors.health}
              onPress={() => setPresetMode('deep_n3')}
            />
            <Chip
              label="Light / Restless Sleep"
              active={presetMode === 'fragmented'}
              color={moduleColors.health}
              onPress={() => setPresetMode('fragmented')}
            />
          </View>

          <View style={{ marginTop: spacing.s }}>
            <PrimaryButton
              title="Calculate Sleep Summary"
              loading={runModel.isPending}
              onPress={() => runModel.mutate()}
            />
          </View>
        </Card>

        <PrimaryButton
          title="Compare With MRI Study Results →"
          variant="secondary"
          onPress={() => nav.navigate('MriValidation')}
        />

        <Card variant="subtle" style={styles.guardrailCard}>
          <StatusPill label="RESEARCH ONLY" tone="warning" />
          <Text style={styles.guardrailText}>
            NEXORA never claims to measure or improve brain waste clearance from ordinary smartwatch
            sleep scores. Missing sensors (EEG, heart, MRI) are never guessed from phone motion.
          </Text>
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.m },
  backText: { fontFamily: fontFamily.medium, fontSize: 13, color: moduleColors.health, fontWeight: '600' },
  guardrailCard: {
    borderColor: 'rgba(245, 158, 11, 0.3)',
    backgroundColor: 'rgba(245, 158, 11, 0.06)',
  },
  guardrailText: { fontFamily: fontFamily.sans, fontSize: 12, lineHeight: 17, color: colors.textSecondary, marginTop: spacing.xs },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.s },
  cardTitle: { ...typography.sectionHeading, color: colors.textPrimary },
  metaText: { ...typography.body, color: colors.textSecondary, marginTop: 2 },
  warnText: { ...typography.body, color: colors.statusWarning, marginTop: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  label: { ...typography.label, color: colors.textSecondary },
  resultCard: { borderColor: 'rgba(45, 212, 191, 0.4)', gap: spacing.s },
  monoLabel: { fontFamily: fontFamily.mono, fontSize: 11, color: moduleColors.health },
  estimateValue: {
    fontFamily: fontFamily.mono,
    fontSize: 28,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  unitInline: { fontSize: 13, fontWeight: '400', color: colors.textSecondary },
  metricsGrid: { flexDirection: 'row', gap: spacing.s, marginTop: spacing.xs },
  metricBox: {
    flex: 1,
    backgroundColor: colors.bgElevated,
    borderRadius: radii.card,
    padding: spacing.s,
  },
  metricLabel: { fontSize: 11, color: colors.textMuted },
  metricVal: { fontFamily: fontFamily.mono, fontSize: 13.5, color: colors.textPrimary, marginTop: 2 },
});
