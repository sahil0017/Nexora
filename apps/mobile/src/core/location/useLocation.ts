import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import { computeBearingDeg, haversineDistM, type GeoPoint, type TracePoint } from '../api/move';
import { usePrivacyPermissions } from '../permissions/usePrivacyPermissions';

export type UseLocationOptions = {
  watch?: boolean;
  traceEnabled?: boolean;
  distanceIntervalM?: number;
  timeIntervalMs?: number;
};

type State = {
  point?: GeoPoint;
  error?: string;
  loading: boolean;
  speedMps?: number;
  speedKmph?: number;
  headingDeg?: number;
  accuracyM?: number;
  isWatching: boolean;
};

const MAX_TRACE_POINTS = 400;
const MIN_TRACE_STEP_M = 4;

/**
 * Current device location + optional continuous real-time GPS watch & breadcrumb trace stream
 * via Expo Location (native) or Web Geolocation. Never invents coordinates.
 */
export function useLocation(options: UseLocationOptions = {}) {
  const {
    watch = false,
    traceEnabled = false,
    distanceIntervalM = 5,
    timeIntervalMs = 2500,
  } = options;

  const [state, setState] = useState<State>({ loading: true, isWatching: false });
  const [tracePoints, setTracePoints] = useState<TracePoint[]>([]);
  const [tracedDistanceM, setTracedDistanceM] = useState(0);
  const lastRecordedRef = useRef<TracePoint | null>(null);
  const gpsAllowed = usePrivacyPermissions(s => s.permissions.gpsLocation);

  const recordSample = useCallback(
    (
      coords: {
        latitude: number;
        longitude: number;
        speed?: number | null;
        heading?: number | null;
        accuracy?: number | null;
      },
      shouldAppendTrace: boolean,
    ) => {
      const nextPt: GeoPoint = { latitude: coords.latitude, longitude: coords.longitude };
      const rawSpeed = typeof coords.speed === 'number' && coords.speed >= 0 ? coords.speed : undefined;
      const rawHeading =
        typeof coords.heading === 'number' && !Number.isNaN(coords.heading) && coords.heading >= 0
          ? Math.round(coords.heading)
          : undefined;
      const accuracyM =
        typeof coords.accuracy === 'number' && !Number.isNaN(coords.accuracy) && coords.accuracy >= 0
          ? Math.round(coords.accuracy)
          : undefined;

      const prev = lastRecordedRef.current;
      const computedHeading =
        rawHeading ?? (prev && haversineDistM(prev, nextPt) >= 3 ? computeBearingDeg(prev, nextPt) : undefined);

      setState(s => ({
        ...s,
        loading: false,
        error: undefined,
        point: nextPt,
        speedMps: rawSpeed,
        speedKmph: typeof rawSpeed === 'number' ? Math.round(rawSpeed * 3.6) : s.speedKmph,
        headingDeg: computedHeading ?? s.headingDeg,
        accuracyM: accuracyM ?? s.accuracyM,
      }));

      if (!shouldAppendTrace) return;

      const stepDist = prev ? haversineDistM(prev, nextPt) : 0;
      if (prev && stepDist < MIN_TRACE_STEP_M) return;

      const sample: TracePoint = {
        latitude: nextPt.latitude,
        longitude: nextPt.longitude,
        speed_mps: rawSpeed,
        heading_degrees: computedHeading,
        accuracy_meters: accuracyM,
        recorded_at: new Date().toISOString(),
      };
      lastRecordedRef.current = sample;
      if (stepDist > 0) {
        setTracedDistanceM(d => d + stepDist);
      }
      setTracePoints(cur => {
        const next = [...cur, sample];
        return next.length > MAX_TRACE_POINTS ? next.slice(next.length - MAX_TRACE_POINTS) : next;
      });
    },
    [],
  );

  const clearTrace = useCallback(() => {
    lastRecordedRef.current = null;
    setTracePoints([]);
    setTracedDistanceM(0);
  }, []);

  const refresh = useCallback(async () => {
    if (!gpsAllowed) {
      setState({
        loading: false,
        isWatching: false,
        error: 'Location access disabled in Privacy & Permissions',
      });
      return;
    }
    setState(s => ({ ...s, loading: true, error: undefined }));
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.geolocation) {
        await new Promise<void>(resolve => {
          navigator.geolocation.getCurrentPosition(
            pos => {
              recordSample(pos.coords, traceEnabled);
              resolve();
            },
            err => {
              setState(s => ({ ...s, loading: false, error: err.message }));
              resolve();
            },
            { enableHighAccuracy: watch || traceEnabled, timeout: 10_000, maximumAge: 60_000 },
          );
        });
        return;
      }

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setState(s => ({ ...s, loading: false, error: 'Location permission denied' }));
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: watch || traceEnabled ? Location.Accuracy.High : Location.Accuracy.Balanced,
      });
      recordSample(pos.coords, traceEnabled);
    } catch (err: any) {
      setState(s => ({ ...s, loading: false, error: err?.message ?? 'Unable to fetch location' }));
    }
  }, [gpsAllowed, recordSample, traceEnabled, watch]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!watch || !gpsAllowed) {
      setState(s => (s.isWatching ? { ...s, isWatching: false } : s));
      return;
    }

    let cancelled = false;
    let nativeSub: Location.LocationSubscription | null = null;
    let webWatchId: number | null = null;

    const startWatch = async () => {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.geolocation) {
        setState(s => ({ ...s, isWatching: true }));
        webWatchId = navigator.geolocation.watchPosition(
          pos => {
            if (!cancelled) recordSample(pos.coords, traceEnabled);
          },
          err => {
            if (!cancelled) setState(s => ({ ...s, error: err.message }));
          },
          { enableHighAccuracy: true, maximumAge: 3000, timeout: 10_000 },
        );
        return;
      }

      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted' || cancelled) {
          if (!cancelled) setState(s => ({ ...s, isWatching: false, error: 'Location permission denied' }));
          return;
        }
        setState(s => ({ ...s, isWatching: true }));
        nativeSub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            distanceInterval: distanceIntervalM,
            timeInterval: timeIntervalMs,
          },
          pos => {
            if (!cancelled) recordSample(pos.coords, traceEnabled);
          },
        );
      } catch (err: any) {
        if (!cancelled) {
          setState(s => ({ ...s, isWatching: false, error: err?.message ?? 'GPS watch unavailable' }));
        }
      }
    };

    startWatch();

    return () => {
      cancelled = true;
      setState(s => ({ ...s, isWatching: false }));
      if (nativeSub) {
        nativeSub.remove();
      }
      if (
        webWatchId !== null &&
        Platform.OS === 'web' &&
        typeof navigator !== 'undefined' &&
        navigator.geolocation
      ) {
        navigator.geolocation.clearWatch(webWatchId);
      }
    };
  }, [watch, gpsAllowed, traceEnabled, distanceIntervalM, timeIntervalMs, recordSample]);

  return {
    ...state,
    tracePoints,
    tracedDistanceM,
    clearTrace,
    refresh,
  };
}
