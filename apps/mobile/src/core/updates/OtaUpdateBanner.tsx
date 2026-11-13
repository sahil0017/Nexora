import React, { useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Updates from 'expo-updates';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fontFamily, radii, spacing } from '../../app/theme/tokens';

/**
 * Listens to Expo OTA update state (`useUpdates`) and checks on launch +
 * foreground resume so the user gets an in-app banner to restart in one tap.
 */
export function OtaUpdateBanner() {
  const insets = useSafeAreaInsets();
  const { isUpdateAvailable, isUpdatePending } = Updates.useUpdates();
  const [fetchedNew, setFetchedNew] = useState(false);
  const lastCheckRef = useRef(0);

  useEffect(() => {
    if (Platform.OS === 'web' || __DEV__ || !Updates.isEnabled) return;
    let active = true;

    const checkAndFetch = async () => {
      const now = Date.now();
      if (now - lastCheckRef.current < 15_000) return;
      lastCheckRef.current = now;
      try {
        const check = await Updates.checkForUpdateAsync();
        if (!check.isAvailable) return;
        const fetched = await Updates.fetchUpdateAsync();
        if (active && fetched.isNew) {
          setFetchedNew(true);
        }
      } catch {
        // Ignore transient network errors when checking OTA updates
      }
    };

    void checkAndFetch();
    const sub = AppState.addEventListener('change', next => {
      if (next === 'active') {
        void checkAndFetch();
      }
    });

    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web' || __DEV__ || !Updates.isEnabled) return;
    if (isUpdateAvailable && !isUpdatePending) {
      void Updates.fetchUpdateAsync()
        .then(res => {
          if (res.isNew) setFetchedNew(true);
        })
        .catch(() => {});
    }
  }, [isUpdateAvailable, isUpdatePending]);

  if (!isUpdatePending && !fetchedNew) return null;

  return (
    <View style={[styles.banner, { top: Math.max(insets.top, 8) + 6 }]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>NEXORA Update Ready</Text>
        <Text style={styles.sub}>Tap Restart to apply the latest fixes.</Text>
      </View>
      <TouchableOpacity
        onPress={() => void Updates.reloadAsync()}
        style={styles.btn}
        activeOpacity={0.85}>
        <Text style={styles.btnText}>Restart</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: spacing.m,
    right: spacing.m,
    zIndex: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    backgroundColor: '#0E1C2B',
    borderWidth: 1,
    borderColor: colors.accentBright,
    borderRadius: radii.card,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
  title: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  sub: {
    fontFamily: fontFamily.sans,
    fontSize: 11.5,
    color: colors.textSecondary,
  },
  btn: {
    backgroundColor: colors.accentBright,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.button,
  },
  btnText: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    fontWeight: '700',
    color: '#04120B',
  },
});
