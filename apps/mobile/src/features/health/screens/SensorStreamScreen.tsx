import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { colors, fontFamily, moduleColors, radii, spacing, typography } from '../../../app/theme/tokens';
import { healthApi, type HardwareTier } from '../../../core/api/health';
import { Card, PrimaryButton, SectionHeading } from '../../../core/design-system/components';
import { Chip, StatusPill } from '../../../core/design-system/motion';
import { useDevicePhysioSensors } from '../../../core/sensors/useDevicePhysioSensors';
import { Screen } from '../../../shared/components/Screen';

export default function SensorStreamScreen() {
  const nav = useNavigation<any>();
  const [tier, setTier] = useState<HardwareTier>('consumer_phone_sensors');
  const sensors = useDevicePhysioSensors({ hardwareTier: tier, autoUpload: true });

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

  const capabilitiesQuery = useQuery({
    queryKey: ['health', 'devices', 'capabilities'],
    queryFn: () => healthApi.getDeviceCapabilities(),
  });

  const serverRec = sensors.lastServerRecord;

  return (
    <Screen
      title="Body & Sleep Sensors"
      subtitle="Private, on-device tracking with full control over your data"
      badge="HEALTH · SENSORS"
      rightAction={
        <TouchableOpacity onPress={() => nav.goBack()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
      }>
      <View style={styles.content}>
        <Card variant="featured" style={styles.liveCard}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>Live Tracking</Text>
            <StatusPill
              label={sensors.isStreaming ? 'TRACKING' : 'IDLE'}
              tone={sensors.isStreaming ? 'success' : 'info'}
            />
          </View>
          <Text style={styles.metaText}>
            Sensor Access: {sensors.sensorAllowed ? 'Allowed' : 'Off'} · Raw Data Sharing:{' '}
            {sensors.rawConsentAllowed ? 'Enabled' : 'Private on Device'}
          </Text>
          <Text style={styles.metaText}>
            Local Buffer: {sensors.bufferCount} / 125 readings
          </Text>

          <View style={styles.chipRow}>
            <Chip
              label="Phone Only"
              active={tier === 'consumer_phone_sensors'}
              color={moduleColors.health}
              onPress={() => setTier('consumer_phone_sensors')}
            />
            <Chip
              label="Watch + Phone"
              active={tier === 'wearable_ppg_imu'}
              color={moduleColors.health}
              onPress={() => setTier('wearable_ppg_imu')}
            />
            <Chip
              label="Sleep Lab (EEG)"
              active={tier === 'clinical_eeg_ppg_resp'}
              color={moduleColors.health}
              onPress={() => setTier('clinical_eeg_ppg_resp')}
            />
          </View>

          <View style={styles.btnRow}>
            <View style={{ flex: 1 }}>
              <PrimaryButton
                title={sensors.isStreaming ? 'Stop Tracking' : 'Start Tracking'}
                onPress={() => (sensors.isStreaming ? sensors.stop() : void sensors.start(false))}
              />
            </View>
            <View style={{ flex: 1 }}>
              <PrimaryButton
                title="Test Signal"
                variant="secondary"
                onPress={() => void sensors.start(true)}
              />
            </View>
          </View>

          {sensors.bufferCount > 0 ? (
            <View style={{ marginTop: spacing.s, gap: spacing.xs }}>
              <PrimaryButton
                title="Sync Readings Now"
                variant="nav"
                onPress={() => void sensors.flushNow()}
              />
              {sensors.rawConsentAllowed ? (
                <PrimaryButton
                  title="Upload Raw Research Data"
                  variant="secondary"
                  onPress={() => void sensors.uploadConsentedRawChunk()}
                />
              ) : null}
            </View>
          ) : null}

          <View style={{ marginTop: spacing.s, gap: spacing.xs }}>
            <PrimaryButton
              title="Connect Apple Health / Health Connect"
              variant="secondary"
              onPress={() => void sensors.syncWearableBridge()}
            />
            <PrimaryButton
              title="Turn Off Research Data Sharing"
              variant="secondary"
              onPress={() => void sensors.revokeResearchConsent()}
            />
          </View>
          {sensors.wearableBridge ? (
            <Text style={styles.metaText}>
              Health App ({sensors.wearableBridge.source === 'healthkit' ? 'Apple Health' : 'Health Connect'}):{' '}
              {sensors.wearableBridge.available ? 'Connected' : 'Not available on this device'}
            </Text>
          ) : null}

          {sensors.error ? <Text style={styles.warnText}>{sensors.error}</Text> : null}
        </Card>

        <SectionHeading title="Live Sensor Readings" />
        <Card>
          <View style={styles.grid}>
            <MetricTile label="Body Position" value={sensors.deviceOrientation} />
            <MetricTile label="Movement" value={sensors.microMotionRms.toFixed(4)} />
            <MetricTile
              label="Vertical Tilt"
              value={sensors.latestFrame ? `${sensors.latestFrame.az.toFixed(2)} m/s²` : '—'}
            />
          </View>
          {sensors.lastSyncAt ? (
            <Text style={styles.syncText}>Last synced: {sensors.lastSyncAt}</Text>
          ) : null}
          {sensors.offlineQueueCount > 0 ? (
            <Text style={styles.warnText}>
              Waiting to sync offline: {sensors.offlineQueueCount} batch(es)
            </Text>
          ) : null}
          {telemetryQuery.data ? (
            <Text style={styles.metaText}>
              Synced Batches: {telemetryQuery.data.outbox_dispatched} · Connected Devices:{' '}
              {devicesQuery.data?.devices?.length ?? telemetryQuery.data.devices_count} · Saved Readings:{' '}
              {latestFeaturesQuery.data?.streams?.length ?? 0} · Supported Sources:{' '}
              {Object.keys(capabilitiesQuery.data?.capabilities ?? {}).length}
            </Text>
          ) : null}
        </Card>

        {serverRec ? (
          <>
            <SectionHeading title="What Your Sensors See" />
            <Card>
              <Text style={styles.metaText}>
                Active: {serverRec.available_modalities.join(', ') || 'None'}
              </Text>
              <Text style={styles.warnText}>
                Not Connected: {serverRec.missing_modalities.join(', ') || 'None'}
              </Text>
              {serverRec.is_simulated ? (
                <StatusPill label="TEST SIGNAL" tone="warning" />
              ) : null}
              {serverRec.limitations.map((lim, i) => (
                <Text key={i} style={styles.limText}>
                  • {lim}
                </Text>
              ))}
            </Card>
          </>
        ) : null}
      </View>
    </Screen>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.m },
  backText: { fontFamily: fontFamily.medium, fontSize: 13, color: moduleColors.health, fontWeight: '600' },
  liveCard: { borderColor: 'rgba(45, 212, 191, 0.35)' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.s },
  cardTitle: { ...typography.sectionHeading, color: colors.textPrimary },
  metaText: { ...typography.body, color: colors.textSecondary, marginTop: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.m },
  btnRow: { flexDirection: 'row', gap: spacing.s, marginTop: spacing.m },
  warnText: { ...typography.body, color: colors.statusWarning, marginTop: spacing.s },
  limText: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
  grid: { flexDirection: 'row', gap: spacing.s },
  tile: { flex: 1, backgroundColor: colors.bgElevated, borderRadius: radii.card, padding: spacing.s },
  tileLabel: { fontSize: 11, color: colors.textMuted },
  tileValue: { fontFamily: fontFamily.mono, fontSize: 13, color: colors.textPrimary, marginTop: 2 },
  syncText: { fontFamily: fontFamily.mono, fontSize: 11, color: moduleColors.health, marginTop: spacing.s },
});
