import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export type DailyCheckIn = {
  dateKey: string;
  sleepHours: number;
  energyLevel: 1 | 2 | 3 | 4 | 5;
  stressLevel: 1 | 2 | 3 | 4 | 5;
  waterGlasses: number;
  updatedAt: string;
};

export type VitalsSnapshot = {
  steps?: number | null;
  heartRateBpm?: number | null;
  hrvMs?: number | null;
  sleepHours?: number | null;
  spo2Pct?: number | null;
  sleepIndex?: number | null;
};

export type ReadinessBreakdown = {
  score: number;
  band: 'Peak' | 'Good' | 'Moderate' | 'Low';
  headline: string;
  actions: Array<{
    id: string;
    icon: string;
    title: string;
    detail: string;
    tone: 'success' | 'info' | 'warning';
  }>;
};

const STORAGE_KEY = 'nexora_daily_wellness_v1';

export function todayDateKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function defaultCheckIn(): DailyCheckIn {
  return {
    dateKey: todayDateKey(),
    sleepHours: 7,
    energyLevel: 3,
    stressLevel: 2,
    waterGlasses: 2,
    updatedAt: new Date().toISOString(),
  };
}

let memoryFallback: DailyCheckIn | null = null;

export async function loadTodayCheckIn(): Promise<DailyCheckIn> {
  try {
    let raw: string | null = null;
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      raw = localStorage.getItem(STORAGE_KEY);
    } else {
      raw = await SecureStore.getItemAsync(STORAGE_KEY);
    }
    if (!raw) return memoryFallback && memoryFallback.dateKey === todayDateKey() ? memoryFallback : defaultCheckIn();
    const parsed = JSON.parse(raw) as DailyCheckIn;
    if (parsed.dateKey !== todayDateKey()) {
      return defaultCheckIn();
    }
    memoryFallback = parsed;
    return parsed;
  } catch {
    return memoryFallback && memoryFallback.dateKey === todayDateKey() ? memoryFallback : defaultCheckIn();
  }
}

export async function saveTodayCheckIn(next: DailyCheckIn): Promise<void> {
  memoryFallback = next;
  try {
    const serialized = JSON.stringify(next);
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, serialized);
    } else {
      await SecureStore.setItemAsync(STORAGE_KEY, serialized);
    }
  } catch {
    // Non-fatal storage error
  }
}

export function computeReadiness(checkIn: DailyCheckIn, vitals: VitalsSnapshot): ReadinessBreakdown {
  const sleepHrs = vitals.sleepHours ?? checkIn.sleepHours;
  const steps = vitals.steps ?? 0;

  // Weighted consumer readiness score (0-100)
  const sleepPts = Math.min(35, Math.max(8, (sleepHrs / 8) * 35));
  const energyPts = (checkIn.energyLevel / 5) * 25;
  const calmPts = ((6 - checkIn.stressLevel) / 5) * 20;
  const hydrationPts = Math.min(10, (checkIn.waterGlasses / 8) * 10);
  const activityPts = steps > 0 ? Math.min(10, (steps / 8000) * 10) : 5;

  let hrvBonus = 0;
  if (vitals.hrvMs != null && vitals.hrvMs > 0) {
    hrvBonus = vitals.hrvMs >= 45 ? 4 : vitals.hrvMs < 25 ? -5 : 0;
  }

  const score = Math.round(Math.min(100, Math.max(15, sleepPts + energyPts + calmPts + hydrationPts + activityPts + hrvBonus)));

  const band: ReadinessBreakdown['band'] =
    score >= 80 ? 'Peak' : score >= 65 ? 'Good' : score >= 48 ? 'Moderate' : 'Low';

  const headline =
    band === 'Peak'
      ? 'Great recovery — ideal day for deep work or a harder workout.'
      : band === 'Good'
        ? 'Steady energy — keep a balanced pace and hit your step goal.'
        : band === 'Moderate'
          ? 'Mild fatigue detected — prioritize hydration and a 15-min walk.'
          : 'Low recovery — protect tonight’s sleep and avoid late-evening strain.';

  const actions: ReadinessBreakdown['actions'] = [];

  if (sleepHrs < 7) {
    actions.push({
      id: 'sleep',
      icon: '🌙',
      title: `Sleep Debt (${sleepHrs.toFixed(1)}h logged)`,
      detail: 'Aim for lights-out 45 min earlier tonight and avoid caffeine after 2 PM.',
      tone: 'warning',
    });
  } else {
    actions.push({
      id: 'sleep',
      icon: '🌙',
      title: `Solid Sleep (${sleepHrs.toFixed(1)}h)`,
      detail: 'Keep a consistent wake window to lock in circadian energy.',
      tone: 'success',
    });
  }

  if (checkIn.stressLevel >= 4) {
    actions.push({
      id: 'stress',
      icon: '🫁',
      title: 'High Stress Load',
      detail: 'Take a 3-minute physiological sigh break before your next meeting or commute.',
      tone: 'warning',
    });
  }

  if (checkIn.waterGlasses < 6) {
    actions.push({
      id: 'water',
      icon: '💧',
      title: `Hydration (${checkIn.waterGlasses}/8 glasses)`,
      detail: `Drink ${8 - checkIn.waterGlasses} more glass(es) of water today to support focus & recovery.`,
      tone: 'info',
    });
  }

  if (steps > 0 && steps < 6000) {
    actions.push({
      id: 'steps',
      icon: '🚶',
      title: `Movement (${steps.toLocaleString()} / 8,000 steps)`,
      detail: 'A 15-minute post-meal walk will add ~1,500 steps and steady blood glucose.',
      tone: 'info',
    });
  } else if (steps >= 8000) {
    actions.push({
      id: 'steps',
      icon: '🏅',
      title: `Daily Step Goal Hit (${steps.toLocaleString()})`,
      detail: 'Great cardiovascular consistency today.',
      tone: 'success',
    });
  }

  return { score, band, headline, actions };
}
