import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import type { GeoPoint } from '../api/move';

type State = { point?: GeoPoint; error?: string; loading: boolean };

/** Current device location via Expo Location (or Web Geolocation). Never invents coordinates. */
export function useLocation() {
  const [state, setState] = useState<State>({ loading: true });

  const refresh = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: undefined }));
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.geolocation) {
        await new Promise<void>(resolve => {
          navigator.geolocation.getCurrentPosition(
            pos => {
              setState({
                loading: false,
                point: { latitude: pos.coords.latitude, longitude: pos.coords.longitude },
              });
              resolve();
            },
            err => {
              setState({ loading: false, error: err.message });
              resolve();
            },
            { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
          );
        });
        return;
      }

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setState({ loading: false, error: 'Location permission denied' });
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setState({
        loading: false,
        point: { latitude: pos.coords.latitude, longitude: pos.coords.longitude },
      });
    } catch (err: any) {
      setState({ loading: false, error: err?.message ?? 'Unable to fetch location' });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { ...state, refresh };
}
