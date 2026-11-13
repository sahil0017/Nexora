import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { colors, fontFamily, moduleColors, radii, spacing, typography } from '../../../app/theme/tokens';
import { healthApi, type HardwareTier } from '../../../core/api/health';
import { Card, PrimaryButton, SectionHeading, SegmentedControl } from '../../../core/design-system/components';
import { StatusPill } from '../../../core/design-system/motion';
import { useDevicePhysioSensors } from '../../../core/sensors/useDevicePhysioSensors';
import { Screen } from '../../../shared/components/Screen';
import {
  HealthMetricBar,
  SensorModalityMatrix,
  SparklineChart,
  type ModalityStatusItem,
} from '../components/HealthVisualizations';

const TIER_OPTIONS: ReadonlyArray<{ key: HardwareTier; label: string }> = [
  { key: 'consumer_phone_sensors', label: 'Phone' },
  { key: 'wearable_ppg_imu', label: 'Watch + Phone' },
  { key: 'clinical_eeg_ppg_resp', label: 'Sleep Lab' },
];

function formatPosture(raw: string): string {
  switch (raw) {
    case 'face_up_supine_proxy':
      return 'Face Up';
    case 'face_down_prone_proxy':
      return 'Face Down';
    case 'lateral_right_proxy':
      return 'Right Side';
    case 'lateral_left_proxy':
      return 'Left Side';
    case 'upright_device':
      return 'Upright';
    default:
      return 'Calibrating';
  }
}

export default function SensorStreamScreen() {
  const nav = useNavigation<any>();
  const [tier, setTier] = useState<HardwareTier>('consumer_phone_sensors');
  const [motionHistory, setMotionHistory] = useState<number[]>([]);
  const sensors = useDevicePhysioSensors({ hardwareTier: tier, autoUpload: true });

  useEffect(() => {
    if (!sensors.isStreaming || !sensors.latestFrame) return;
    setMotionHistory(prev => [...prev.slice(-15), Number(sensors.microMotionRms.toFixed(4))]);
  }, [sensors.isStreaming, sensors.latestFrame, sensors.microMotionRms]);

  const telemetryQuery = useQuery({
    queryKey: ['health', 'telemetry'],
    queryFn: () => healthApi.getTelemetry(),
    refetchInterval: sensors.isStreaming ? 3000 : false,
  });

  const latestFeaturesQuery = useQuery({
    queryKey: ['health', 'features', 'latest'],
    queryFn: () => healthApi.listLatestFeatures('default-user', 5),
  });

  const devicesQuery = useQuery({
    queryKey: ['health', 'devices'],
    queryFn: () => healthApi.listDevices('default-user'),
  });

  const serverRec = sensors.lastServerRecord;
  const healthAppName = Platform.OS === 'ios' ? 'Apple Health' : 'Health Connect';

  const modalityItems: ModalityStatusItem[] = [
    {
      key: 'imu',
      label: 'Phone Motion',
      status: sensors.isStreaming ? 'live' : sensors.sensorAllowed ? 'connected' : 'off',
      detail: sensors.isStreaming ? `${sensors.sampleRateHz} Hz streaming` : sensors.sensorAllowed ? 'Ready' : 'Permission off',
    },
    {
      key: 'wearable',
      label: healthAppName,
      status: sensors.wearableBridge?.available ? 'connected' : 'off',
      detail: sensors.wearableBridge
        ? sensors.wearableBridge.available
          ? 'Connected'
          : 'Not installed'
        : 'Tap to pair',
    },
    {
      key: 'hrv',
      label: 'Heart & HRV',
      status: sensors.wearableMetrics?.hrv_rmssd_ms ? 'connected' : tier !== 'consumer_phone_sensors' ? 'connected' : 'off',
      detail: sensors.wearableMetrics?.hrv_rmssd_ms
        ? `${sensors.wearableMetrics.hrv_rmssd_ms.toFixed(0)} ms`
        : tier === 'consumer_phone_sensors'
          ? 'Needs watch'
          : 'Watch ready',
    },
    {
      key: 'resp',
      label: 'Breathing',
      status: tier === 'clinical_eeg_ppg_resp' ? 'connected' : 'off',
      detail: tier === 'clinical_eeg_ppg_resp' ? 'Lab sensor' : 'Not paired',
    },
  ];

  return (
    <Screen
      title="Live Body & Watch Sensors"
      subtitle="On-device motion tracking & wearable health sync"
      badge="HEALTH · SENSORS"
      rightAction={
        <TouchableOpacity onPress={() => nav.goBack()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
      }>
      <View style={styles.content}>
        <Card variant="featured" style={styles.liveCard}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>Real-Time Sensor Stream</Text>
            <StatusPill
              label={sensors.isStreaming ? 'LIVE' : 'IDLE'}
              tone={sensors.isStreaming ? 'success' : 'info'}
            />
          </View>

          <SparklineChart
            values={motionHistory}
            height={68}
            emptyLabel="Tap Start Live Tracking to view real-time body motion"
          />

          <View style={styles.grid}>
            <MetricTile label="Sleep Posture" value={formatPosture(sensors.deviceOrientation)} />
            <MetricTile label="Micro-Motion" value={sensors.microMotionRms.toFixed(3)} />
            <MetricTile
              label="Z-Axis Tilt"
              value={sensors.latestFrame ? `${sensors.latestFrame.az.toFixed(2)}` : '—'}
            />
          </View>

          <HealthMetricBar
            label="On-Device Ring Buffer"
            valueLabel={`${sensors.bufferCount} / 125`}
            progress={sensors.bufferCount / 125}
          />

          <SegmentedControl compact options={TIER_OPTIONS} value={tier} onChange={setTier} />

          <PrimaryButton
            title={sensors.isStreaming ? 'Stop Live Tracking' : 'Start Live Tracking'}
            onPress={() => (sensors.isStreaming ? sensors.stop() : void sensors.start(false))}
          />

          <View style={styles.btnRow}>
            <View style={{ flex: 1 }}>
              <PrimaryButton
                title={`Connect ${healthAppName}`}
                variant="secondary"
                onPress={() => void sensors.syncWearableBridge()}
              />
            </View>
            {sensors.bufferCount > 0 ? (
              <View style={{ flex: 1 }}>
                <PrimaryButton
                  title="Sync Now"
                  variant="nav"
                  onPress={() => void sensors.flushNow()}
                />
              </View>
            ) : null}
          </View>

          {sensors.error ? <Text style={styles.warnText}>{sensors.error}</Text> : null}
        </Card>

        <SectionHeading title="Connected Sensor Channels" />
        <Card style={{ gap: spacing.s }}>
          <SensorModalityMatrix items={modalityItems} />
          <Text style={styles.metaText}>
            Privacy: {sensors.rawConsentAllowed ? 'Research sharing enabled' : 'Features only (raw waveforms stay on device)'}
          </Text>
          {sensors.rawConsentAllowed ? (
            <PrimaryButton
              title="Turn Off Research Data Sharing"
              variant="secondary"
              onPress={() => void sensors.revokeResearchConsent()}
            />
          ) : null}
        </Card>

        <SectionHeading title="Sync Summary" />
        <Card style={{ gap: 6 }}>
          <View style={styles.grid}>
            <MetricTile
              label="Saved Streams"
              value={String(latestFeaturesQuery.data?.streams?.length ?? 0)}
            />
            <MetricTile
              label="Devices"
              value={String(devicesQuery.data?.devices?.length ?? telemetryQuery.data?.devices_count ?? 0)}
            />
            <MetricTile
              label="Dispatched"
              value={String(telemetryQuery.data?.outbox_dispatched ?? 0)}
            />
          </View>
          {sensors.lastSyncAt ? (
            <Text style={styles.syncText}>Last synced: {sensors.lastSyncAt}</Text>
          ) : null}
          {sensors.offlineQueueCount > 0 ? (
            <Text style={styles.warnText}>
              Queued offline: {sensors.offlineQueueCount} batch(es)
            </Text>
          ) : null}
          {serverRec ? (
            <Text style={styles.metaText}>
              Active channels: {serverRec.available_modalities.join(', ') || 'Phone IMU'}
            </Text>
          ) : null}
        </Card>
      </View>
    </Screen>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.m },
  backText: { fontFamily: fontFamily.medium, fontSize: 13, color: moduleColors.health, fontWeight: '600' },
  liveCard: { borderColor: 'rgba(45, 212, 191, 0.35)', gap: spacing.m },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.s },
  cardTitle: { ...typography.sectionHeading, color: colors.textPrimary },
  metaText: { ...typography.body, color: colors.textSecondary, marginTop: 2 },
  btnRow: { flexDirection: 'row', gap: spacing.s },
  warnText: { ...typography.body, color: colors.statusWarning, marginTop: 4 },
  grid: { flexDirection: 'row', gap: spacing.s },
  tile: { flex: 1, backgroundColor: colors.bgElevated, borderRadius: radii.card, padding: spacing.s },
  tileLabel: { fontSize: 11, color: colors.textMuted },
  tileValue: { fontFamily: fontFamily.mono, fontSize: 13, color: colors.textPrimary, marginTop: 2 },
  syncText: { fontFamily: fontFamily.mono, fontSize: 11, color: moduleColors.health, marginTop: 4 },
});
