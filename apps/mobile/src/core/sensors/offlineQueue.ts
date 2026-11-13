// Bounded offline queue for local-first physiological feature batches.
import type { SensorIngestPayload } from '../api/health';

const QUEUE_STORAGE_KEY = 'nexora_health_offline_feature_queue_v1';
const MAX_QUEUED_BATCHES = 200;

let memoryFallbackQueue: SensorIngestPayload[] = [];

type AsyncStorageLike = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, val: string) => Promise<void>;
};

function getAsyncStorage(): AsyncStorageLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-async-storage/async-storage');
    const inst = mod?.default ?? mod;
    if (inst && typeof inst.getItem === 'function' && typeof inst.setItem === 'function') {
      return inst as AsyncStorageLike;
    }
  } catch {
    // AsyncStorage optional when running in minimal Expo Go / web
  }
  return null;
}

export async function loadOfflineBatches(): Promise<SensorIngestPayload[]> {
  try {
    const asyncStore = getAsyncStorage();
    if (asyncStore) {
      const raw = await asyncStore.getItem(QUEUE_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as SensorIngestPayload[]) : [];
    }
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && globalThis.localStorage) {
      const raw = globalThis.localStorage.getItem(QUEUE_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as SensorIngestPayload[]) : [];
    }
  } catch {
    // Fall back to bounded memory queue
  }
  return [...memoryFallbackQueue];
}

export async function saveOfflineBatches(items: SensorIngestPayload[]): Promise<void> {
  const bounded = items.slice(-MAX_QUEUED_BATCHES);
  memoryFallbackQueue = bounded;
  try {
    const raw = JSON.stringify(bounded);
    const asyncStore = getAsyncStorage();
    if (asyncStore) {
      await asyncStore.setItem(QUEUE_STORAGE_KEY, raw);
      return;
    }
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && globalThis.localStorage) {
      globalThis.localStorage.setItem(QUEUE_STORAGE_KEY, raw);
    }
  } catch {
    // Keep memoryFallbackQueue as fallback
  }
}

export async function enqueueOfflineBatch(batch: SensorIngestPayload): Promise<number> {
  const current = await loadOfflineBatches();
  if (batch.idempotency_key && current.some((b) => b.idempotency_key === batch.idempotency_key)) {
    return current.length;
  }
  const next = [...current, batch].slice(-MAX_QUEUED_BATCHES);
  await saveOfflineBatches(next);
  return next.length;
}
