import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import * as Calendar from 'expo-calendar';
import * as Location from 'expo-location';
import { create } from 'zustand';
import { financeApi } from '../api/finance';
import { healthApi, type ProvenancedFeature } from '../api/health';
import { digitalTwinApi, moveApi } from '../api/move';
import { voiceApi } from '../api/voice';
import { fetchDeviceCallLogs, syncIosContactsWithConsent } from '../native/callerIdBridge';
import {
  isNativeHealthSensorsAvailable,
  nativeHealthSensors,
  type WearableBridgeStatus,
  type WearableHealthMetrics,
} from '../native/healthSensorsBridge';
import { usePrivacyPermissions } from '../permissions/usePrivacyPermissions';

export type IntegrationDomain = 'mobility' | 'finance' | 'health' | 'voice';
export type IntegrationStatus = 'idle' | 'syncing' | 'connected' | 'needs_access' | 'error';

export type DomainIntegrationState = {
  status: IntegrationStatus;
  lastSyncAt: string | null;
  summary: string;
  recordsSynced: number;
};

type IntegrationsStore = {
  autoSyncEnabled: boolean;
  hasAutoSyncedOnLaunch: boolean;
  syncingAll: boolean;
  domains: Record<IntegrationDomain, DomainIntegrationState>;
  setAutoSyncEnabled: (enabled: boolean) => void;
  syncDomain: (domain: IntegrationDomain) => Promise<void>;
  syncAll: () => Promise<void>;
  runAutoSyncOnLaunch: () => Promise<void>;
};

const INITIAL_DOMAIN: DomainIntegrationState = {
  status: 'idle',
  lastSyncAt: null,
  summary: 'Ready to connect',
  recordsSynced: 0,
};

function nowIso(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

let mobilityWatchSub: Location.LocationSubscription | null = null;
let mobilityIngestedTotal = 0;

function stopMobilityWatch() {
  if (mobilityWatchSub) {
    mobilityWatchSub.remove();
    mobilityWatchSub = null;
  }
}

export const useRealtimeIntegrations = create<IntegrationsStore>((set, get) => ({
  autoSyncEnabled: true,
  hasAutoSyncedOnLaunch: false,
  syncingAll: false,
  domains: {
    mobility: { ...INITIAL_DOMAIN, summary: 'Live GPS, traffic corridors & road alerts' },
    finance: { ...INITIAL_DOMAIN, summary: 'Account Aggregator, UPI & bank alert sync' },
    health: { ...INITIAL_DOMAIN, summary: 'Phone motion & Apple Health / Health Connect' },
    voice: { ...INITIAL_DOMAIN, summary: 'Device call logs, contacts & caller ID' },
  },

  setAutoSyncEnabled: enabled => {
    if (!enabled) stopMobilityWatch();
    set({ autoSyncEnabled: enabled });
  },

  syncDomain: async domain => {
    set(state => ({
      domains: {
        ...state.domains,
        [domain]: { ...state.domains[domain], status: 'syncing' },
      },
    }));

    const perms = usePrivacyPermissions.getState();

    try {
      if (domain === 'mobility') {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== 'granted') {
          set(state => ({
            domains: {
              ...state.domains,
              mobility: {
                status: 'needs_access',
                lastSyncAt: nowIso(),
                summary: 'Location access needed for live traffic & hazards',
                recordsSynced: 0,
              },
            },
          }));
          return;
        }
        perms.setPermission('gpsLocation', true);
        const lastKnown = await Location.getLastKnownPositionAsync();
        const pos =
          lastKnown ??
          (await Promise.race([
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('GPS fix timed out — enable device Location')), 10000),
            ),
          ]));
        const pt = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        const telemetryRes = (await digitalTwinApi.sendPrivacyTelemetry([
          {
            latitude: pt.latitude,
            longitude: pt.longitude,
            speed_kph: pos.coords.speed != null && pos.coords.speed >= 0 ? pos.coords.speed * 3.6 : 0,
          },
        ])) as { input_samples?: number; published_count?: number; suppressed_count?: number };
        mobilityIngestedTotal += telemetryRes.input_samples ?? 1;
        const [segsRes, hazRes] = await Promise.allSettled([
          moveApi.trafficSegments(pt, 3000),
          moveApi.nearbyHazards(pt),
        ]);
        const segCount = segsRes.status === 'fulfilled' ? (segsRes.value.segments?.length ?? 0) : 0;
        const hazCount = hazRes.status === 'fulfilled' ? (hazRes.value.hazards?.length ?? 0) : 0;
        set(state => ({
          domains: {
            ...state.domains,
            mobility: {
              status: 'connected',
              lastSyncAt: nowIso(),
              summary: `${mobilityIngestedTotal} live GPS fix(es) · ${segCount} corridors · ${hazCount} alerts`,
              recordsSynced: mobilityIngestedTotal + segCount + hazCount,
            },
          },
        }));

        // Start continuous real-time GPS watcher when autoSyncEnabled is on
        if (get().autoSyncEnabled && !mobilityWatchSub && Platform.OS !== 'web') {
          try {
            mobilityWatchSub = await Location.watchPositionAsync(
              {
                accuracy: Location.Accuracy.Balanced,
                timeInterval: 20000,
                distanceInterval: 25,
              },
              async loc => {
                if (!get().autoSyncEnabled) {
                  stopMobilityWatch();
                  return;
                }
                try {
                  const livePt = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
                  const res = (await digitalTwinApi.sendPrivacyTelemetry([
                    {
                      latitude: livePt.latitude,
                      longitude: livePt.longitude,
                      speed_kph: loc.coords.speed != null && loc.coords.speed >= 0 ? loc.coords.speed * 3.6 : 0,
                    },
                  ])) as { input_samples?: number };
                  mobilityIngestedTotal += res.input_samples ?? 1;
                  const [sRes, hRes] = await Promise.allSettled([
                    moveApi.trafficSegments(livePt, 3000),
                    moveApi.nearbyHazards(livePt),
                  ]);
                  const sc = sRes.status === 'fulfilled' ? (sRes.value.segments?.length ?? 0) : 0;
                  const hc = hRes.status === 'fulfilled' ? (hRes.value.hazards?.length ?? 0) : 0;
                  set(state => ({
                    domains: {
                      ...state.domains,
                      mobility: {
                        status: 'connected',
                        lastSyncAt: nowIso(),
                        summary: `${mobilityIngestedTotal} live GPS fix(es) · ${sc} corridors · ${hc} alerts`,
                        recordsSynced: mobilityIngestedTotal + sc + hc,
                      },
                    },
                  }));
                } catch {
                  // Keep watcher alive across transient network blips
                }
              },
            );
          } catch {
            // Watcher optional if OS restricts background/continuous updates
          }
        }
        return;
      }

      if (domain === 'finance') {
        type NotifBridge = {
          isNotificationAccessEnabled?: () => Promise<boolean>;
          openNotificationAccessSettings?: () => Promise<boolean>;
          drainBankNotifications?: () => Promise<{
            enabled: boolean;
            messages: Array<{ sender: string; body: string; timestamp_ms: number }>;
          }>;
        };
        const notifBridge = NativeModules.NexoraCallerIdModule as NotifBridge | undefined;

        let notifGranted = Platform.OS !== 'android';
        let ingestedAlerts = 0;

        if (Platform.OS === 'android' && typeof notifBridge?.isNotificationAccessEnabled === 'function') {
          try {
            notifGranted = await notifBridge.isNotificationAccessEnabled();
          } catch {
            notifGranted = false;
          }
          if (!notifGranted) {
            perms.setPermission('smsAlertIngestion', false);
            try {
              await notifBridge.openNotificationAccessSettings?.();
            } catch {
              // Ignore if settings intent unavailable
            }
            set(state => ({
              domains: {
                ...state.domains,
                finance: {
                  status: 'needs_access',
                  lastSyncAt: nowIso(),
                  summary: 'Enable Notification Access for NEXORA to ingest bank & UPI alerts',
                  recordsSynced: 0,
                },
              },
            }));
            return;
          }

          if (typeof notifBridge.drainBankNotifications === 'function') {
            try {
              const drained = await notifBridge.drainBankNotifications();
              const alerts = (drained?.messages ?? [])
                .filter(m => Boolean(m.body?.trim()))
                .map(m => ({
                  source_channel: 'android_notification' as const,
                  raw_text: m.body,
                }));
              if (alerts.length > 0) {
                const synced = await financeApi.smartSyncBatch({ alerts });
                ingestedAlerts = synced.ingested_alerts ?? alerts.length;
              }
            } catch {
              // Keep channel/AA sync working even if notification drain fails
            }
          }
        }

        perms.setPermission('smsAlertIngestion', notifGranted);
        perms.setPermission('aiCfoTelemetry', true);

        const existing = await financeApi.channels();
        let channelsCount = existing.channels?.length ?? 0;
        if (channelsCount === 0) {
          const validChannelType = Platform.OS === 'android' ? 'android_sms' : 'ios_shortcut';
          await financeApi.createChannel({
            channel_type: validChannelType,
            provider_name: Platform.OS === 'android' ? 'Android Bank & UPI Alerts' : 'iOS Bank Alert Shortcut',
          });
          await financeApi.createConsent({
            provider_type: 'account_aggregator',
            tsp_name: 'Sahamati / Finvu',
          });
          channelsCount = 1;
        }

        const [twinRes, acctsRes, txnsRes] = await Promise.allSettled([
          financeApi.digitalTwin(),
          financeApi.accounts(),
          financeApi.transactions(10),
        ]);
        const score = twinRes.status === 'fulfilled' ? twinRes.value.health_score : '--';
        const acctCount =
          acctsRes.status === 'fulfilled' ? (acctsRes.value.count ?? acctsRes.value.accounts?.length ?? 0) : 0;
        const txnCount =
          txnsRes.status === 'fulfilled' ? (txnsRes.value.count ?? txnsRes.value.transactions?.length ?? 0) : 0;
        set(state => ({
          domains: {
            ...state.domains,
            finance: {
              status: 'connected',
              lastSyncAt: nowIso(),
              summary:
                ingestedAlerts > 0
                  ? `${ingestedAlerts} bank alert(s) ingested · ${acctCount} accts · ${txnCount} txns · Score ${score}/100`
                  : `${channelsCount} channel(s) · ${acctCount} accts · ${txnCount} txns · Score ${score}/100`,
              recordsSynced: channelsCount + ingestedAlerts + acctCount + txnCount,
            },
          },
        }));
        return;
      }

      if (domain === 'health') {
        perms.setPermission('healthDeviceSensors', true);
        let bridge: WearableBridgeStatus | null = null;
        if (nativeHealthSensors?.getHealthBridgeStatus) {
          try {
            bridge = await nativeHealthSensors.getHealthBridgeStatus();
          } catch {
            bridge = null;
          }
        }

        let metrics: WearableHealthMetrics | null = null;
        if (nativeHealthSensors?.fetchAuthorizedWearableMetrics) {
          try {
            metrics = await nativeHealthSensors.fetchAuthorizedWearableMetrics(24);
          } catch {
            metrics = null;
          }
        }

        let ingested = 0;
        let imuSamples = 0;
        const features: Record<string, ProvenancedFeature> = {};

        if (metrics && metrics.measurement_status === 'measured') {
          const wearableProv = {
            source_device: Platform.OS,
            signal_source: metrics.signal_source,
            sampling_rate_hz: 1,
            timestamp_accuracy_ms: 1000,
            placement_protocol: 'wearable_bridge',
            calibration_status: 'os_authorized',
            signal_quality_score: 0.9,
            measurement_status: 'measured' as const,
            algorithm_version: 'health_bridge_v1',
          };
          if (metrics.hrv_rmssd_ms != null) {
            features.hrv_rmssd_ms = {
              name: 'hrv_rmssd_ms',
              value: metrics.hrv_rmssd_ms,
              unit: 'ms',
              provenance: wearableProv,
            };
          }
          if (metrics.heart_rate_bpm != null) {
            features.heart_rate_bpm = {
              name: 'heart_rate_bpm',
              value: metrics.heart_rate_bpm,
              unit: 'bpm',
              provenance: wearableProv,
            };
          }
          if (metrics.respiratory_rate_bpm != null) {
            features.respiratory_rate_bpm = {
              name: 'respiratory_rate_bpm',
              value: metrics.respiratory_rate_bpm,
              unit: 'brpm',
              provenance: wearableProv,
            };
          }
          if (metrics.steps_count != null) {
            features.steps_count = {
              name: 'steps_count',
              value: metrics.steps_count,
              unit: 'steps',
              provenance: wearableProv,
            };
          }
          if (metrics.spo2_pct != null) {
            features.spo2_pct = {
              name: 'spo2_pct',
              value: metrics.spo2_pct,
              unit: '%',
              provenance: wearableProv,
            };
          }
          if (metrics.sleep_duration_hours != null && metrics.sleep_duration_hours > 0) {
            const totalMin = metrics.sleep_duration_hours * 60;
            const deepFrac = Math.min(1, Math.max(0, (metrics.sleep_deep_minutes ?? 0) / totalMin));
            try {
              await healthApi.createSleepSession({
                hardware_tier: 'wearable_ppg_imu',
                is_simulated: false,
                n3_fraction: Number(deepFrac.toFixed(3)),
                respiratory_rate_bpm: metrics.respiratory_rate_bpm ?? undefined,
                hrv_rmssd_ms: metrics.hrv_rmssd_ms ?? undefined,
                signal_quality_score: 0.9,
              });
            } catch {
              // Keep feature ingestion resilient if sleep session creation fails
            }
          }
        }

        // Capture a short real device IMU burst so phone motion/posture is ingested even without a wearable
        if (Platform.OS !== 'web' && isNativeHealthSensorsAvailable() && nativeHealthSensors) {
          try {
            await nativeHealthSensors.startCollection(25);
            await new Promise(resolve => setTimeout(resolve, 900));
            const batch = await nativeHealthSensors.drainFeatureBatch();
            await nativeHealthSensors.stopCollection().catch(() => {});
            imuSamples = batch?.sample_count ?? 0;
            if (imuSamples > 0) {
              features.actigraphy_rms = {
                name: 'actigraphy_rms',
                value: Number((batch.actigraphy_rms ?? 0).toFixed(4)),
                unit: 'm/s^2',
                provenance: {
                  source_device: Platform.OS,
                  signal_source: 'phone_imu',
                  sampling_rate_hz: 25,
                  timestamp_accuracy_ms: 40,
                  placement_protocol: batch.device_orientation || 'handheld',
                  calibration_status: 'factory',
                  signal_quality_score: 0.92,
                  measurement_status: 'measured',
                  algorithm_version: 'nexora_imu_v1',
                },
              };
            }
          } catch {
            // Fall through if native sensor ring buffer is unavailable
          }
        }

        if (Platform.OS !== 'web') {
          try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const expoSensors = require('expo-sensors') as {
              Accelerometer?: {
                setUpdateInterval: (ms: number) => void;
                addListener: (cb: (d: { x: number; y: number; z: number }) => void) => { remove: () => void };
              };
              LightSensor?: {
                setUpdateInterval: (ms: number) => void;
                addListener: (cb: (d: { illuminance: number }) => void) => { remove: () => void };
              };
              Pedometer?: {
                isAvailableAsync: () => Promise<boolean>;
                getStepCountAsync: (start: Date, end: Date) => Promise<{ steps: number }>;
              };
            };
            if (imuSamples === 0 && expoSensors?.Accelerometer) {
              const mags: number[] = [];
              expoSensors.Accelerometer.setUpdateInterval(50);
              const sub = expoSensors.Accelerometer.addListener(d => {
                mags.push(Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z) * 9.81);
              });
              await new Promise(resolve => setTimeout(resolve, 800));
              sub.remove();
              imuSamples = mags.length;
              if (mags.length > 0) {
                const mean = mags.reduce((a, b) => a + b, 0) / mags.length;
                const rms = Math.sqrt(mags.reduce((a, m) => a + (m - mean) ** 2, 0) / mags.length);
                features.actigraphy_rms = {
                  name: 'actigraphy_rms',
                  value: Number(rms.toFixed(4)),
                  unit: 'm/s^2',
                  provenance: {
                    source_device: Platform.OS,
                    signal_source: 'phone_imu',
                    sampling_rate_hz: 20,
                    timestamp_accuracy_ms: 50,
                    placement_protocol: 'handheld',
                    calibration_status: 'factory',
                    signal_quality_score: 0.88,
                    measurement_status: 'measured',
                    algorithm_version: 'expo_imu_v1',
                  },
                };
              }
            }
            if (expoSensors?.LightSensor) {
              let lux: number | null = null;
              expoSensors.LightSensor.setUpdateInterval(200);
              const lightSub = expoSensors.LightSensor.addListener(d => {
                lux = d.illuminance;
              });
              await new Promise(resolve => setTimeout(resolve, 350));
              lightSub.remove();
              if (lux != null) {
                features.ambient_lux = {
                  name: 'ambient_lux',
                  value: Number(Number(lux).toFixed(1)),
                  unit: 'lux',
                  provenance: {
                    source_device: Platform.OS,
                    signal_source: 'phone_light_sensor',
                    sampling_rate_hz: 5,
                    timestamp_accuracy_ms: 200,
                    placement_protocol: 'ambient',
                    calibration_status: 'factory',
                    signal_quality_score: 0.9,
                    measurement_status: 'measured',
                    algorithm_version: 'expo_light_v1',
                  },
                };
              }
            }
            if (!features.steps_count && expoSensors?.Pedometer) {
              const pedAvail = await expoSensors.Pedometer.isAvailableAsync().catch(() => false);
              if (pedAvail) {
                const end = new Date();
                const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
                const stepRes = await expoSensors.Pedometer.getStepCountAsync(start, end).catch(() => null);
                if (stepRes && stepRes.steps > 0) {
                  features.steps_count = {
                    name: 'steps_count',
                    value: stepRes.steps,
                    unit: 'steps',
                    provenance: {
                      source_device: Platform.OS,
                      signal_source: 'phone_pedometer',
                      sampling_rate_hz: 1,
                      timestamp_accuracy_ms: 1000,
                      placement_protocol: 'pocket_or_handheld',
                      calibration_status: 'os_authorized',
                      signal_quality_score: 0.9,
                      measurement_status: 'measured',
                      algorithm_version: 'expo_pedometer_v1',
                    },
                  };
                }
              }
            }
          } catch {
            // Ignore if expo-sensors is not linked
          }
        }

        if (Object.keys(features).length > 0) {
          await healthApi.ingestFeatures({
            hardware_tier: metrics?.measurement_status === 'measured' ? 'wearable_ppg_imu' : 'consumer_phone_sensors',
            sample_rate_hz: imuSamples > 0 ? 25 : 1,
            is_simulated: false,
            device_timestamp_ms: Date.now(),
            monotonic_ms: Date.now(),
            sync_uncertainty_ms: 50,
            extracted_features: features,
          });
          ingested = Object.keys(features).length;
        }

        const [sessionsRes, streamsRes] = await Promise.allSettled([
          healthApi.listSleepSessions('default-user', 5),
          healthApi.listLatestFeatures('default-user', 5),
        ]);
        const total = sessionsRes.status === 'fulfilled' ? (sessionsRes.value.sessions?.length ?? 0) : 0;
        const streamCount = streamsRes.status === 'fulfilled' ? (streamsRes.value.streams?.length ?? 0) : 0;
        const isLive = Boolean(bridge?.available || ingested > 0 || streamCount > 0 || total > 0 || imuSamples > 0);
        const bridgeLabel = bridge?.available
          ? `${bridge.source === 'healthkit' ? 'Apple Health' : 'Health Connect'} linked`
          : imuSamples > 0
            ? `Phone IMU (${imuSamples} samples)`
            : 'Sensors ready';
        set(state => ({
          domains: {
            ...state.domains,
            health: {
              status: isLive ? 'connected' : 'needs_access',
              lastSyncAt: nowIso(),
              summary: isLive
                ? `${bridgeLabel} · ${streamCount} streams · ${total} nights`
                : 'Install Health Connect / pair watch or start Live Sensors',
              recordsSynced: ingested + streamCount + total,
            },
          },
        }));
        return;
      }

      if (domain === 'voice') {
        let importedCount = 0;
        let deviceNote = '';
        if (Platform.OS === 'android') {
          const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_CALL_LOG);
          if (granted === PermissionsAndroid.RESULTS.GRANTED) {
            perms.setPermission('deviceCallLogsRead', true);
            const res = await fetchDeviceCallLogs(50);
            if (res.logs.length > 0) {
              await voiceApi.importCallLogs({ logs: res.logs, source: 'android_call_log' });
              importedCount = res.logs.length;
            } else if (!res.supported) {
              deviceNote = ' (native call-log bridge unavailable)';
            }
          } else {
            set(state => ({
              domains: {
                ...state.domains,
                voice: {
                  status: 'needs_access',
                  lastSyncAt: nowIso(),
                  summary: 'Grant Call Log access to auto-sync recent calls',
                  recordsSynced: 0,
                },
              },
            }));
            return;
          }
        } else if (Platform.OS === 'ios') {
          const res = await syncIosContactsWithConsent();
          if (res.granted && res.contacts.length > 0) {
            await voiceApi.syncDeviceContacts({ contacts: res.contacts });
            importedCount = res.contacts.length;
          }
        }
        let calendarEventsCount = 0;
        if (Platform.OS !== 'web') {
          try {
            const calPerm = await Calendar.requestCalendarPermissionsAsync();
            if (calPerm.status === 'granted') {
              const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
              const calIds = cals.map(c => c.id);
              if (calIds.length > 0) {
                const now = new Date();
                const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
                const events = await Calendar.getEventsAsync(calIds, now, tomorrow);
                calendarEventsCount = events.length;
              }
            }
          } catch {
            // Calendar optional
          }
        }
        const ov = await voiceApi.overview();
        set(state => ({
          domains: {
            ...state.domains,
            voice: {
              status: 'connected',
              lastSyncAt: nowIso(),
              summary: `${ov.conversation_count} conversations · ${importedCount} device call(s) · ${calendarEventsCount} calendar event(s)${deviceNote}`,
              recordsSynced: ov.conversation_count + importedCount + calendarEventsCount,
            },
          },
        }));
      }
    } catch (err: any) {
      set(state => ({
        domains: {
          ...state.domains,
          [domain]: {
            ...state.domains[domain],
            status: 'error',
            lastSyncAt: nowIso(),
            summary: err?.message ? String(err.message) : 'Sync failed — check connection',
          },
        },
      }));
    }
  },

  syncAll: async () => {
    set({ syncingAll: true });
    try {
      await Promise.allSettled([
        get().syncDomain('mobility'),
        get().syncDomain('finance'),
        get().syncDomain('health'),
        get().syncDomain('voice'),
      ]);
    } finally {
      set({ syncingAll: false });
    }
  },

  runAutoSyncOnLaunch: async () => {
    const state = get();
    if (!state.autoSyncEnabled || state.hasAutoSyncedOnLaunch) return;
    set({ hasAutoSyncedOnLaunch: true });
    const perms = usePrivacyPermissions.getState().permissions;
    const tasks: Promise<void>[] = [];
    if (perms.gpsLocation) tasks.push(get().syncDomain('mobility'));
    if (perms.smsAlertIngestion) tasks.push(get().syncDomain('finance'));
    if (perms.healthDeviceSensors) tasks.push(get().syncDomain('health'));
    if (perms.deviceCallLogsRead) tasks.push(get().syncDomain('voice'));
    await Promise.allSettled(tasks);
  },
}));
