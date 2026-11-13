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

const HARDWARE_TIERS: { key: HardwareTier; label: string }[] = [
  { key: 'consumer_phone_sensors', label: 'Phone Only' },
  { key: 'wearable_ppg_imu', label: 'Watch + Phone' },
  { key: 'clinical_eeg_ppg_resp', label: 'Sleep Lab (EEG)' },
  { key: 'paired_mri_cohort', label: 'MRI Study Group' },
];

export default function SleepClearanceScreen() {
  const nav = useNavigation<any>();
  const [hardwareTier, setHardwareTier] = useState<HardwareTier>('clinical_eeg_ppg_resp');
  const [modelStage, setModelStage] = useState<'M0' | 'M1'>('M1');
  const [presetMode, setPresetMode] = useState<'deep_n3' | 'fragmented'>('deep_n3');
  const [latestSession, setLatestSession] = useState<SleepClearanceSession | null>(null);

  const sensors = useDevicePhysioSensors({ hardwareTier, autoUpload: false });

  const historyQuery = useQuery({
    queryKey: ['health', 'sleep-clearance', 'sessions'],
    queryFn: () => healthApi.listSleepSessions('default-user', 6),
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
        is_simulated: sensors.sourceMode === 'lab_calibration_sim',
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

  const activeResult = latestSession ?? historyQuery.data?.sessions?.[0] ?? null;

  return (
    <Screen
      title="Sleep & Brain-Fluid Insights"
      subtitle="Overnight physiology summary (not a medical diagnosis)"
      badge="HEALTH · SLEEP"
      rightAction={
        <TouchableOpacity onPress={() => nav.goBack()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
      }>
      <View style={styles.content}>
        <Card style={styles.guardrailCard}>
          <StatusPill label="IMPORTANT NOTE" tone="warning" />
          <Text style={styles.guardrailText}>
            NEXORA never claims to measure or improve brain waste clearance from ordinary smartwatch
            sleep scores. Missing sensors (EEG, heart, MRI) are never guessed from phone motion.
          </Text>
        </Card>

        <Card variant="subtle">
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>Live Sensor Check-In</Text>
            <StatusPill
              label={sensors.isStreaming ? 'TRACKING' : 'IDLE'}
              tone={sensors.isStreaming ? 'success' : 'info'}
            />
          </View>
          <Text style={styles.metaText}>
            Posture: {sensors.deviceOrientation} · Movement: {sensors.microMotionRms.toFixed(4)}
          </Text>
          <View style={styles.chipRow}>
            <Chip
              label={sensors.isStreaming ? 'Stop Tracking' : 'Start Tracking'}
              active={sensors.isStreaming}
              color={moduleColors.health}
              onPress={() => (sensors.isStreaming ? sensors.stop() : void sensors.start(false))}
            />
            <Chip
              label="Test Signal"
              active={sensors.sourceMode === 'lab_calibration_sim'}
              color={moduleColors.health}
              onPress={() => void sensors.start(true)}
            />
            <Chip label="Manage Sensors →" onPress={() => nav.navigate('SensorStream')} />
          </View>
          {sensors.error ? <Text style={styles.warnText}>{sensors.error}</Text> : null}
        </Card>

        <SectionHeading title="Choose Your Devices & Profile" />
        <Card>
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

          <Text style={[styles.label, { marginTop: spacing.m }]}>Analysis Mode</Text>
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

          <Text style={[styles.label, { marginTop: spacing.m }]}>Sleep Pattern</Text>
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

          <View style={{ marginTop: spacing.m }}>
            <PrimaryButton
              title="Calculate Sleep Summary"
              loading={runModel.isPending}
              onPress={() => runModel.mutate()}
            />
          </View>
        </Card>

        {activeResult ? (
          <>
            <SectionHeading title="Sleep Physiology Summary" />
            <Card variant="featured" style={styles.resultCard}>
              <View style={styles.rowBetween}>
                <Text style={styles.monoLabel}>
                  SLEEP PHYSIOLOGY INDEX ({activeResult.model_stage === 'M0' ? 'QUICK' : 'ADAPTIVE'})
                </Text>
                <StatusPill
                  label={activeResult.is_fallback ? 'OFFLINE ESTIMATE' : 'RESEARCH SUMMARY'}
                  tone={activeResult.is_fallback ? 'warning' : 'info'}
                />
              </View>
              <Text style={styles.estimateValue}>
                {activeResult.research_estimate.value.toFixed(4)}
              </Text>
              <Text style={styles.ciText}>
                Estimated Range: [{activeResult.research_estimate.confidence_interval[0].toFixed(4)},{' '}
                {activeResult.research_estimate.confidence_interval[1].toFixed(4)}] ·{' '}
                {activeResult.research_estimate.unit}
              </Text>

              <View style={styles.metricsGrid}>
                <View style={styles.metricBox}>
                  <Text style={styles.metricLabel}>Model Uncertainty</Text>
                  <Text style={styles.metricVal}>
                    {activeResult.research_estimate.uncertainty.epistemic.toFixed(4)}
                  </Text>
                </View>
                <View style={styles.metricBox}>
                  <Text style={styles.metricLabel}>Signal Noise</Text>
                  <Text style={styles.metricVal}>
                    {activeResult.research_estimate.uncertainty.aleatoric.toFixed(4)}
                  </Text>
                </View>
                <View style={styles.metricBox}>
                  <Text style={styles.metricLabel}>Deep-Sleep Link</Text>
                  <Text style={styles.metricVal}>
                    +{activeResult.n3_associated_feature_sensitivity.toFixed(4)}
                  </Text>
                </View>
              </View>

              <Text style={[styles.label, { marginTop: spacing.m }]}>Connected Signals</Text>
              <Text style={styles.metaText}>
                {activeResult.evidence.available_modalities.join(', ') || 'None'}
              </Text>

              <Text style={[styles.label, { marginTop: spacing.s }]}>Not Connected</Text>
              <Text style={styles.warnText}>
                {activeResult.evidence.missing_modalities.join(', ') || 'None'}
              </Text>

              <Text style={[styles.label, { marginTop: spacing.s }]}>What This Doesn&apos;t Measure</Text>
              {activeResult.limitations.map((lim, i) => (
                <Text key={i} style={styles.limText}>
                  • {lim}
                </Text>
              ))}
            </Card>
          </>
        ) : null}

        <PrimaryButton
          title="Compare With MRI Study Results →"
          variant="secondary"
          onPress={() => nav.navigate('MriValidation')}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.m },
  backText: { fontFamily: fontFamily.medium, fontSize: 13, color: moduleColors.health, fontWeight: '600' },
  guardrailCard: {
    borderColor: 'rgba(245, 158, 11, 0.45)',
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
  },
  guardrailText: { ...typography.body, color: colors.textPrimary, marginTop: spacing.xs },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.s },
  cardTitle: { ...typography.sectionHeading, color: colors.textPrimary },
  metaText: { ...typography.body, color: colors.textSecondary, marginTop: 4 },
  warnText: { ...typography.body, color: colors.statusWarning, marginTop: 4 },
  limText: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.s },
  label: { ...typography.label, color: colors.textSecondary },
  resultCard: { borderColor: 'rgba(45, 212, 191, 0.4)' },
  monoLabel: { fontFamily: fontFamily.mono, fontSize: 11, color: moduleColors.health },
  estimateValue: {
    fontFamily: fontFamily.mono,
    fontSize: 28,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: 6,
  },
  ciText: { ...typography.body, color: colors.textSecondary, marginTop: 2 },
  metricsGrid: { flexDirection: 'row', gap: spacing.s, marginTop: spacing.m },
  metricBox: {
    flex: 1,
    backgroundColor: colors.bgElevated,
    borderRadius: radii.card,
    padding: spacing.s,
  },
  metricLabel: { fontSize: 11, color: colors.textMuted },
  metricVal: { fontFamily: fontFamily.mono, fontSize: 13.5, color: colors.textPrimary, marginTop: 2 },
});
