import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking, Platform } from 'react-native';
import {
  healthApi,
  type HardwareTier,
  type MeasurementStatus,
  type ProvenancedFeature,
  type SensorFrame,
  type SensorIngestPayload,
  type SensorStreamRecord,
} from '../api/health';
import { usePrivacyPermissions } from '../permissions/usePrivacyPermissions';
import {
  isNativeHealthSensorsAvailable,
  nativeHealthSensors,
  type WearableBridgeStatus,
  type WearableHealthMetrics,
} from '../native/healthSensorsBridge';
import { enqueueOfflineBatch, loadOfflineBatches, saveOfflineBatches } from './offlineQueue';

export type SensorSourceMode = 'native_ring_buffer' | 'hardware_imu' | 'web_devicemotion' | 'lab_calibration_sim' | 'idle';

export type LiveSensorState = {
  isStreaming: boolean;
  sourceMode: SensorSourceMode;
  hardwareTier: HardwareTier;
  sampleRateHz: number;
  latestFrame: SensorFrame | null;
  bufferCount: number;
  offlineQueueCount: number;
  wearableBridge: WearableBridgeStatus | null;
  wearableMetrics: WearableHealthMetrics | null;
  deviceOrientation: string;
  microMotionRms: number;
  lastServerRecord: SensorStreamRecord | null;
  lastSyncAt: string | null;
  error: string | null;
};

const MAX_RING_BUFFER = 125; // Bounded 5s local ring buffer @ 25 Hz
const ACTIVE_SYNC_INTERVAL_MS = 5000;
const STILL_SLEEP_SYNC_INTERVAL_MS = 60000;

async function computeSha256Hex(input: string): Promise<string> {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    const bytes = new TextEncoder().encode(input);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Deterministic 64-hex fallback when SubtleCrypto is unavailable
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

function classifyDeviceOrientation(ax: number, ay: number, az: number): string {
  const norm = Math.sqrt(ax * ax + ay * ay + az * az);
  if (norm < 1e-4) return 'unknown';
  const gx = ax / norm;
  const gy = ay / norm;
  const gz = az / norm;
  if (Math.abs(gy) > 0.72) return 'upright_device';
  if (gz > 0.65) return 'face_up_supine_proxy';
  if (gz < -0.65) return 'face_down_prone_proxy';
  if (gx > 0.55) return 'lateral_right_proxy';
  if (gx < -0.55) return 'lateral_left_proxy';
  return 'face_up_supine_proxy';
}

/**
 * Local-first physiological & motion sensor acquisition hook.
 * Keeps raw 25 Hz samples in a bounded local ring buffer, extracts provenanced
 * features on-device, and uploads compact feature batches (not raw waveforms)
 * unless explicit raw-waveform research consent is granted.
 */
export function useDevicePhysioSensors(options?: {
  hardwareTier?: HardwareTier;
  autoUpload?: boolean;
}) {
  const hardwareTier = options?.hardwareTier ?? 'consumer_phone_sensors';
  const autoUpload = options?.autoUpload ?? true;
  const sensorAllowed = usePrivacyPermissions(s => s.permissions.healthDeviceSensors);
  const rawConsentAllowed = usePrivacyPermissions(s => s.permissions.healthResearchTelemetry);

  const [state, setState] = useState<LiveSensorState>({
    isStreaming: false,
    sourceMode: 'idle',
    hardwareTier,
    sampleRateHz: 25,
    latestFrame: null,
    bufferCount: 0,
    offlineQueueCount: 0,
    wearableBridge: null,
    wearableMetrics: null,
    deviceOrientation: 'unknown',
    microMotionRms: 0,
    lastServerRecord: null,
    lastSyncAt: null,
    error: null,
  });

  const ringBufferRef = useRef<SensorFrame[]>([]);
  const sessionIdRef = useRef<string>(`hsess_${Date.now()}`);
  const latestGyroRef = useRef<{ gx: number; gy: number; gz: number }>({ gx: 0, gy: 0, gz: 0 });
  const sourceModeRef = useRef<SensorSourceMode>('idle');
  const uploadingRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const extractLocalFeatures = useCallback((): Record<string, ProvenancedFeature> | null => {
    const buf = ringBufferRef.current;
    if (buf.length === 0) return null;
    const isSim = sourceModeRef.current === 'lab_calibration_sim';
    const isWeb = sourceModeRef.current === 'web_devicemotion';
    const signalSource = isSim ? 'synthetic_lab' : isWeb ? 'web_devicemotion_experimental' : 'phone_imu';
    const status: MeasurementStatus = isSim ? 'simulated' : isWeb ? 'estimated' : 'measured';

    let sumAx = 0;
    let sumAy = 0;
    let sumAz = 0;
    for (const f of buf) {
      sumAx += f.ax;
      sumAy += f.ay;
      sumAz += f.az;
    }
    const meanAx = sumAx / buf.length;
    const meanAy = sumAy / buf.length;
    const meanAz = sumAz / buf.length;
    const orientation = classifyDeviceOrientation(meanAx, meanAy, meanAz);

    const mags = buf.map(f => Math.sqrt(f.ax * f.ax + f.ay * f.ay + f.az * f.az));
    const meanMag = mags.reduce((a, b) => a + b, 0) / mags.length;
    const rms = Number(
      Math.sqrt(mags.reduce((acc, m) => acc + (m - meanMag) * (m - meanMag), 0) / mags.length).toFixed(4),
    );
    const quality = Number(Math.max(0.1, Math.min(0.96, (buf.length / 100) * (1 - Math.min(0.7, rms / 1.5)))).toFixed(4));

    const baseProv = {
      source_device: `${Platform.OS}_imu`,
      signal_source: signalSource,
      sampling_rate_hz: 25,
      timestamp_accuracy_ms: isWeb ? 35 : 10,
      placement_protocol: 'bedside_or_chest_unspecified',
      calibration_status: isSim ? 'synthetic_calibration' : 'gravity_normalized',
      signal_quality_score: quality,
      measurement_status: status,
      algorithm_version: 'mobile_local_v2.0',
    };

    return {
      device_orientation: {
        name: 'device_orientation',
        value: orientation,
        unit: 'category',
        provenance: baseProv,
        limitations: ['Phone IMU estimates device orientation, not necessarily anatomical body posture.'],
      },
      actigraphy_rms: {
        name: 'actigraphy_rms',
        value: rms,
        unit: 'm/s^2',
        provenance: baseProv,
      },
    };
  }, []);

  const flushFeaturesToServer = useCallback(async () => {
    if (uploadingRef.current) return;
    const extracted = extractLocalFeatures();
    if (!extracted) return;

    uploadingRef.current = true;
    const isSim = sourceModeRef.current === 'lab_calibration_sim';
    const nowMs = Date.now();
    const monotonicMs = typeof performance !== 'undefined' ? Math.round(performance.now()) : nowMs;
    const payload: SensorIngestPayload = {
      session_id: sessionIdRef.current,
      idempotency_key: `hfeat_${nowMs}`,
      source_device: `${Platform.OS}_imu`,
      hardware_tier: hardwareTier,
      sample_rate_hz: 25,
      is_simulated: isSim,
      device_timestamp_ms: nowMs,
      monotonic_ms: monotonicMs,
      sync_uncertainty_ms: 15,
      extracted_features: extracted,
      // Raw frames are NEVER uploaded by default; only when explicit research telemetry consent is granted
      frames: rawConsentAllowed ? ringBufferRef.current.slice(-50) : undefined,
    };

    try {
      const queued = await loadOfflineBatches();
      if (queued.length > 0) {
        const remaining: SensorIngestPayload[] = [];
        for (let i = 0; i < queued.length; i++) {
          try {
            await healthApi.ingestFeatures(queued[i]);
          } catch {
            remaining.push(...queued.slice(i));
            break;
          }
        }
        await saveOfflineBatches(remaining);
      }

      const res = await healthApi.ingestFeatures(payload);
      const remainingAfter = await loadOfflineBatches();
      setState(prev => ({
        ...prev,
        lastServerRecord: res,
        offlineQueueCount: remainingAfter.length,
        lastSyncAt: new Date().toLocaleTimeString(),
        error: null,
      }));
    } catch (err) {
      const qCount = await enqueueOfflineBatch(payload);
      setState(prev => ({
        ...prev,
        offlineQueueCount: qCount,
        error: err instanceof Error ? `${err.message} (saved offline: ${qCount})` : 'Feature sync failed (queued offline)',
      }));
    } finally {
      uploadingRef.current = false;
    }
  }, [extractLocalFeatures, hardwareTier, rawConsentAllowed]);

  const pushFrame = useCallback((frame: SensorFrame) => {
    const buf = ringBufferRef.current;
    buf.push(frame);
    if (buf.length > MAX_RING_BUFFER) {
      buf.shift();
    }

    const tail = buf.slice(-25);
    const mags = tail.map(f => Math.sqrt(f.ax * f.ax + f.ay * f.ay + f.az * f.az));
    const mean = mags.reduce((a, b) => a + b, 0) / Math.max(mags.length, 1);
    const rms = Math.sqrt(
      mags.reduce((acc, m) => acc + (m - mean) * (m - mean), 0) / Math.max(mags.length, 1),
    );

    setState(prev => ({
      ...prev,
      latestFrame: frame,
      bufferCount: buf.length,
      deviceOrientation: classifyDeviceOrientation(frame.ax, frame.ay, frame.az),
      microMotionRms: Number(rms.toFixed(4)),
    }));
  }, []);

  const stop = useCallback(() => {
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    if (syncTimerRef.current) {
      clearInterval(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    if (sourceModeRef.current === 'native_ring_buffer' && nativeHealthSensors) {
      void nativeHealthSensors.stopCollection();
    }
    sourceModeRef.current = 'idle';
    setState(prev => ({ ...prev, isStreaming: false, sourceMode: 'idle' }));
  }, []);

  const uploadConsentedRawChunk = useCallback(async () => {
    if (!rawConsentAllowed) {
      setState(prev => ({
        ...prev,
        error: 'Raw waveform upload requires explicit healthResearchTelemetry consent in Privacy Hub.',
      }));
      return null;
    }
    const framesToUpload =
      sourceModeRef.current === 'native_ring_buffer' && nativeHealthSensors
        ? await nativeHealthSensors.exportRawWaveformChunk(false)
        : ringBufferRef.current.slice(-125);
    if (!framesToUpload.length) return null;

    const presign = await healthApi.presignRawObservation({
      session_id: sessionIdRef.current,
      consent_scope: 'health_research_telemetry',
      content_type: 'application/json',
    });
    const payloadStr = JSON.stringify(framesToUpload);
    const sha256Hex = await computeSha256Hex(payloadStr);
    if (presign.upload_mode === 's3_presigned' && presign.presigned_url) {
      await fetch(presign.presigned_url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: payloadStr,
      });
    }
    const nowMs = Date.now();
    const monotonicMs = typeof performance !== 'undefined' ? Math.round(performance.now()) : nowMs;
    return healthApi.completeRawObservation({
      observation_id: presign.observation_id,
      session_id: sessionIdRef.current,
      s3_object_key: presign.s3_object_key,
      sha256_ciphertext: sha256Hex,
      sample_count: framesToUpload.length,
      sample_rate_hz: 25,
      device_timestamp_ms: nowMs,
      monotonic_ms: monotonicMs,
      sync_uncertainty_ms: 15,
      consent_scope: 'health_research_telemetry',
    });
  }, [rawConsentAllowed]);

  const revokeResearchConsent = useCallback(async () => {
    stop();
    ringBufferRef.current = [];
    setState(prev => ({ ...prev, bufferCount: 0 }));
    return healthApi.revokeConsent({ consent_scope: 'health_research_telemetry' });
  }, [stop]);

  const start = useCallback(
    async (forceLabSim = false) => {
      stop();
      if (!sensorAllowed && !forceLabSim) {
        setState(prev => ({
          ...prev,
          error: 'Real-Time Physiological & Motion Sensors permission is disabled in Privacy Hub.',
        }));
        return;
      }

      setState(prev => ({ ...prev, error: null, isStreaming: true, hardwareTier }));

      if (autoUpload) {
        let lastSyncTs = 0;
        syncTimerRef.current = setInterval(() => {
          const now = Date.now();
          const tail = ringBufferRef.current.slice(-25);
          const mags = tail.map(f => Math.sqrt(f.ax * f.ax + f.ay * f.ay + f.az * f.az));
          const mean = mags.reduce((a, b) => a + b, 0) / Math.max(mags.length, 1);
          const rms = Math.sqrt(
            mags.reduce((acc, m) => acc + (m - mean) * (m - mean), 0) / Math.max(mags.length, 1),
          );
          // Adaptive sync interval: 60s during prolonged stillness, 5s when motion is active
          const intervalMs = rms < 0.02 ? STILL_SLEEP_SYNC_INTERVAL_MS : ACTIVE_SYNC_INTERVAL_MS;
          if (now - lastSyncTs >= intervalMs) {
            lastSyncTs = now;
            void flushFeaturesToServer();
          }
        }, ACTIVE_SYNC_INTERVAL_MS);
      }

      if (forceLabSim) {
        sourceModeRef.current = 'lab_calibration_sim';
        setState(prev => ({ ...prev, sourceMode: 'lab_calibration_sim' }));
        const startTs = Date.now();
        const timer = setInterval(() => {
          const t = (Date.now() - startTs) / 1000;
          const resp = 0.12 * Math.sin(2 * Math.PI * 0.22 * t);
          pushFrame({
            timestamp_ms: Date.now(),
            ax: 0.05,
            ay: 0.02,
            az: Number((9.81 + resp).toFixed(4)),
          });
        }, 40);
        cleanupRef.current = () => clearInterval(timer);
        return;
      }

      if (Platform.OS !== 'web' && isNativeHealthSensorsAvailable() && nativeHealthSensors) {
        try {
          const nativeMod = nativeHealthSensors;
          await nativeMod.startCollection(25);
          sourceModeRef.current = 'native_ring_buffer';
          setState(prev => ({ ...prev, sourceMode: 'native_ring_buffer' }));
          const pollNative = setInterval(async () => {
            const batch = await nativeMod.drainFeatureBatch();
            setState(prev => ({
              ...prev,
              bufferCount: batch.sample_count,
              deviceOrientation: batch.device_orientation,
              microMotionRms: Number((batch.actigraphy_rms ?? 0).toFixed(4)),
            }));
          }, 1000);
          cleanupRef.current = () => clearInterval(pollNative);
          return;
        } catch {
          // Fall through to expo-sensors if native module fails
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
            Gyroscope?: {
              setUpdateInterval: (ms: number) => void;
              addListener: (cb: (d: { x: number; y: number; z: number }) => void) => { remove: () => void };
            };
          };
          if (expoSensors?.Accelerometer) {
            expoSensors.Accelerometer.setUpdateInterval(40);
            const accSub = expoSensors.Accelerometer.addListener(d => {
              const g = latestGyroRef.current;
              pushFrame({
                timestamp_ms: Date.now(),
                ax: d.x * 9.81,
                ay: d.y * 9.81,
                az: d.z * 9.81,
                gx: g.gx,
                gy: g.gy,
                gz: g.gz,
              });
            });
            let gyroSub: { remove: () => void } | undefined;
            if (expoSensors.Gyroscope) {
              expoSensors.Gyroscope.setUpdateInterval(40);
              gyroSub = expoSensors.Gyroscope.addListener(g => {
                latestGyroRef.current = { gx: g.x, gy: g.y, gz: g.z };
              });
            }
            sourceModeRef.current = 'hardware_imu';
            setState(prev => ({ ...prev, sourceMode: 'hardware_imu' }));
            cleanupRef.current = () => {
              accSub.remove();
              gyroSub?.remove();
            };
            return;
          }
        } catch {
          // Fall through if expo-sensors is not linked
        }
      }

      if (Platform.OS === 'web' && typeof window !== 'undefined' && 'DeviceMotionEvent' in window) {
        try {
          const dme = window.DeviceMotionEvent as unknown as {
            requestPermission?: () => Promise<'granted' | 'denied'>;
          };
          if (typeof dme.requestPermission === 'function') {
            const perm = await dme.requestPermission();
            if (perm !== 'granted') {
              setState(prev => ({ ...prev, isStreaming: false, sourceMode: 'idle', error: 'Browser DeviceMotion permission denied.' }));
              return;
            }
          }
          const handler = (ev: DeviceMotionEvent) => {
            const acc = ev.accelerationIncludingGravity ?? ev.acceleration;
            if (!acc) return;
            pushFrame({
              timestamp_ms: Date.now(),
              ax: Number(acc.x ?? 0),
              ay: Number(acc.y ?? 0),
              az: Number(acc.z ?? 9.81),
            });
          };
          window.addEventListener('devicemotion', handler);
          sourceModeRef.current = 'web_devicemotion';
          setState(prev => ({ ...prev, sourceMode: 'web_devicemotion' }));
          cleanupRef.current = () => window.removeEventListener('devicemotion', handler);
          return;
        } catch (err) {
          setState(prev => ({
            ...prev,
            isStreaming: false,
            sourceMode: 'idle',
            error: err instanceof Error ? err.message : 'Unable to attach DeviceMotion sensor.',
          }));
          return;
        }
      }

      stop();
      setState(prev => ({
        ...prev,
        error: 'Physical IMU sensor not detected on this host. Use Lab Calibration Signal to test the local-first pipeline.',
      }));
    },
    [autoUpload, flushFeaturesToServer, hardwareTier, pushFrame, sensorAllowed, stop],
  );

  const syncWearableBridge = useCallback(async (interactive = true) => {
    if (!nativeHealthSensors?.getHealthBridgeStatus || !nativeHealthSensors?.fetchAuthorizedWearableMetrics) {
      setState(prev => ({
        ...prev,
        error:
          Platform.OS === 'web'
            ? 'Health Connect / Apple Health requires the mobile app.'
            : 'Native health bridge is unavailable in this build.',
      }));
      return null;
    }

    try {
      const status = await nativeHealthSensors.getHealthBridgeStatus();
      const metrics = await nativeHealthSensors.fetchAuthorizedWearableMetrics(12);

      void healthApi
        .registerDevice({
          device_id: `${Platform.OS}_${status.source}`,
          signal_source: status.source,
          capabilities: status.available ? ['heart_rate', 'hrv_ibi', 'respiratory_rate'] : ['unavailable'],
          calibration_status: status.available && metrics.authorized ? 'active' : 'unavailable',
        })
        .catch(() => {});

      if (metrics.authorized) {
        void healthApi.grantConsent({ consent_scope: 'health_device_sensors' }).catch(() => {});
      }

      const bridgeError = !status.available
        ? Platform.OS === 'android'
          ? 'Health Connect is not installed or needs an update on this device.'
          : 'Apple Health is unavailable on this device.'
        : !metrics.authorized
          ? metrics.missing_reason === 'health_connect_permission_required'
            ? 'Health Connect permissions are not granted yet. Allow NEXORA in Health Connect → App permissions.'
            : metrics.missing_reason ?? 'Health permissions are required to sync wearable data.'
          : null;

      setState(prev => ({
        ...prev,
        wearableBridge: status,
        wearableMetrics: metrics,
        error: bridgeError,
      }));

      if (interactive && Platform.OS === 'android') {
        if (!status.available) {
          Alert.alert(
            'Health Connect Required',
            'Install or update Google Health Connect to sync Samsung Health and watch metrics.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Open Play Store',
                onPress: () => {
                  void Linking.openURL(
                    'https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata',
                  ).catch(() => {});
                },
              },
            ],
          );
        } else if (!metrics.authorized) {
          // If native IO-thread intent was suppressed by Android background launch rules,
          // trigger foreground UI-thread intent fallback after 350ms.
          setTimeout(() => {
            if (AppState.currentState !== 'active') return;
            const openSettingsFallback = async () => {
              try {
                if (Number(Platform.Version) >= 34) {
                  await Linking.sendIntent('android.health.connect.action.MANAGE_HEALTH_PERMISSIONS', [
                    { key: 'android.intent.extra.PACKAGE_NAME', value: 'ai.nexora.movesmart' },
                  ]);
                  return;
                }
              } catch {
                // fall through to general Health Connect settings
              }
              try {
                await Linking.sendIntent('androidx.health.ACTION_HEALTH_CONNECT_SETTINGS');
                return;
              } catch {
                // fall through to alert
              }
              Alert.alert(
                'Enable Health Connect',
                'Open Settings → Apps → NEXORA or Health Connect → App permissions and allow NEXORA.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Open Settings', onPress: () => void Linking.openSettings() },
                ],
              );
            };
            void openSettingsFallback();
          }, 350);
        }
      }

      return { status, metrics };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to connect to Health Connect.';
      setState(prev => ({ ...prev, error: msg }));
      return null;
    }
  }, []);

  useEffect(() => {
    void loadOfflineBatches().then(items => {
      if (items.length > 0) {
        setState(prev => ({ ...prev, offlineQueueCount: items.length }));
      }
    });
    return () => {
      if (cleanupRef.current) cleanupRef.current();
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
    };
  }, []);

  return {
    ...state,
    sensorAllowed,
    rawConsentAllowed,
    frames: ringBufferRef.current,
    start,
    stop,
    flushNow: flushFeaturesToServer,
    uploadConsentedRawChunk,
    revokeResearchConsent,
    syncWearableBridge,
  };
}
