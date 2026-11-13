import { PermissionsAndroid, Platform } from 'react-native';
import * as Location from 'expo-location';
import { create } from 'zustand';
import { financeApi } from '../api/finance';
import { healthApi, type ProvenancedFeature } from '../api/health';
import { digitalTwinApi, moveApi } from '../api/move';
import { voiceApi } from '../api/voice';
import { fetchDeviceCallLogs, syncIosContactsWithConsent } from '../native/callerIdBridge';
import { nativeHealthSensors } from '../native/healthSensorsBridge';
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

  setAutoSyncEnabled: enabled => set({ autoSyncEnabled: enabled }),

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
          (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
        const pt = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        await digitalTwinApi.sendPrivacyTelemetry([
          {
            latitude: pt.latitude,
            longitude: pt.longitude,
            speed_kph: pos.coords.speed != null && pos.coords.speed >= 0 ? pos.coords.speed * 3.6 : 0,
          },
        ]);
        const [segs, haz] = await Promise.all([
          moveApi.trafficSegments(pt, 3000),
          moveApi.nearbyHazards(pt),
        ]);
        const count = (segs.segments?.length ?? 0) + (haz.hazards?.length ?? 0);
        set(state => ({
          domains: {
            ...state.domains,
            mobility: {
              status: 'connected',
              lastSyncAt: nowIso(),
              summary: `${segs.segments?.length ?? 0} corridors · ${haz.hazards?.length ?? 0} road alerts synced`,
              recordsSynced: count,
            },
          },
        }));
        return;
      }

      if (domain === 'finance') {
        perms.setPermission('smsAlertIngestion', true);
        perms.setPermission('aiCfoTelemetry', true);
        const existing = await financeApi.channels();
        let channelsCount = existing.channels?.length ?? 0;
        if (channelsCount === 0) {
          const validChannelType = Platform.OS === 'android' ? 'android_sms' : 'ios_shortcut';
          await financeApi.createChannel({
            channel_type: validChannelType,
            provider_name: Platform.OS === 'android' ? 'Android Bank & UPI SMS' : 'iOS Bank Alert Shortcut',
          });
          await financeApi.createConsent({
            provider_type: 'account_aggregator',
            tsp_name: 'Sahamati / Finvu',
          });
          channelsCount = 1;
        }
        const [twin, accts, txns] = await Promise.all([
          financeApi.digitalTwin(),
          financeApi.accounts(),
          financeApi.transactions(10),
        ]);
        const acctCount = accts.count ?? accts.accounts?.length ?? 0;
        const txnCount = txns.count ?? txns.transactions?.length ?? 0;
        set(state => ({
          domains: {
            ...state.domains,
            finance: {
              status: 'connected',
              lastSyncAt: nowIso(),
              summary: `${channelsCount} channel(s) · ${acctCount} accts · ${txnCount} txns · Score ${twin.health_score}/100`,
              recordsSynced: channelsCount + acctCount + txnCount,
            },
          },
        }));
        return;
      }

      if (domain === 'health') {
        perms.setPermission('healthDeviceSensors', true);
        const bridge = nativeHealthSensors?.getHealthBridgeStatus
          ? await nativeHealthSensors.getHealthBridgeStatus()
          : null;
        const metrics = nativeHealthSensors?.fetchAuthorizedWearableMetrics
          ? await nativeHealthSensors.fetchAuthorizedWearableMetrics(24)
          : null;

        let ingested = 0;
        if (metrics && metrics.measurement_status === 'measured') {
          const features: Record<string, ProvenancedFeature> = {};
          if (metrics.hrv_rmssd_ms != null) {
            features.hrv_rmssd_ms = {
              name: 'hrv_rmssd_ms',
              value: metrics.hrv_rmssd_ms,
              unit: 'ms',
              provenance: {
                source_device: Platform.OS,
                signal_source: metrics.signal_source,
                sampling_rate_hz: 1,
                timestamp_accuracy_ms: 1000,
                placement_protocol: 'wearable_bridge',
                calibration_status: 'os_authorized',
                signal_quality_score: 0.9,
                measurement_status: 'measured',
                algorithm_version: 'health_bridge_v1',
              },
            };
          }
          if (Object.keys(features).length > 0) {
            await healthApi.ingestFeatures({
              hardware_tier: 'wearable_ppg_imu',
              sample_rate_hz: 1,
              is_simulated: false,
              device_timestamp_ms: Date.now(),
              monotonic_ms: Date.now(),
              sync_uncertainty_ms: 500,
              extracted_features: features,
            });
            ingested = Object.keys(features).length;
          }
        }
        const [sessions, streams] = await Promise.all([
          healthApi.listSleepSessions('default-user', 5),
          healthApi.listLatestFeatures('default-user', 5),
        ]);
        const total = sessions.sessions?.length ?? 0;
        const streamCount = streams.streams?.length ?? 0;
        const isLive = Boolean(bridge?.available || ingested > 0 || streamCount > 0 || total > 0);
        set(state => ({
          domains: {
            ...state.domains,
            health: {
              status: isLive ? 'connected' : 'needs_access',
              lastSyncAt: nowIso(),
              summary: bridge?.available
                ? `${bridge.source === 'healthkit' ? 'Apple Health' : 'Health Connect'} linked · ${streamCount} streams · ${total} nights`
                : streamCount > 0 || total > 0
                  ? `${streamCount} sensor streams · ${total} sleep nights synced`
                  : 'Install Health Connect / pair watch or start Live Sensors',
              recordsSynced: ingested + streamCount + total,
            },
          },
        }));
        return;
      }

      if (domain === 'voice') {
        let importedCount = 0;
        if (Platform.OS === 'android') {
          const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_CALL_LOG);
          if (granted === PermissionsAndroid.RESULTS.GRANTED) {
            perms.setPermission('deviceCallLogsRead', true);
            const res = await fetchDeviceCallLogs(50);
            if (res.logs.length > 0) {
              await voiceApi.importCallLogs({ logs: res.logs, source: 'android_call_log' });
              importedCount = res.logs.length;
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
        const ov = await voiceApi.overview();
        set(state => ({
          domains: {
            ...state.domains,
            voice: {
              status: 'connected',
              lastSyncAt: nowIso(),
              summary: `${ov.conversation_count} conversations · ${importedCount} device record(s) synced`,
              recordsSynced: ov.conversation_count + importedCount,
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
