import { NativeModules, Platform } from 'react-native';
import type { SensorFrame } from '../api/health';

export type WearableBridgeStatus = {
  source: 'healthkit' | 'health_connect';
  available: boolean;
  background_delivery_supported: boolean;
};

export type WearableHealthMetrics = {
  signal_source: 'healthkit' | 'health_connect';
  authorized: boolean;
  heart_rate_bpm?: number | null;
  hrv_rmssd_ms?: number | null;
  respiratory_rate_bpm?: number | null;
  measurement_status: 'measured' | 'unavailable';
  missing_reason?: string | null;
};

type NativeHealthSensorsInterface = {
  startCollection: (rateHz: number) => Promise<{ status: string; rate_hz: number }>;
  stopCollection: () => Promise<{ status: string }>;
  drainFeatureBatch: () => Promise<{
    sample_count: number;
    device_orientation: string;
    actigraphy_rms: number;
    device_timestamp_ms?: number;
    monotonic_ms?: number;
  }>;
  exportRawWaveformChunk: (clearAfterExport: boolean) => Promise<SensorFrame[]>;
  getHealthBridgeStatus?: () => Promise<WearableBridgeStatus>;
  fetchAuthorizedWearableMetrics?: (hoursBack: number) => Promise<WearableHealthMetrics>;
};

const nativeMod: NativeHealthSensorsInterface | undefined =
  Platform.OS !== 'web' ? (NativeModules.NexoraHealthSensors as NativeHealthSensorsInterface | undefined) : undefined;

export function isNativeHealthSensorsAvailable(): boolean {
  return Boolean(nativeMod && typeof nativeMod.startCollection === 'function');
}

export const nativeHealthSensors = nativeMod;
