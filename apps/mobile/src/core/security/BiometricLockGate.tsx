import React, { useEffect, useRef } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { colors, fontFamily, spacing, typography } from '../../app/theme/tokens';
import { PrimaryButton } from '../design-system/components';
import { useAppSecurity } from './appSecurity';

export function BiometricLockGate({ children }: { children: React.ReactNode }) {
  const { hydrated, isLocked, biometricLockEnabled, hydrate, lockIfEnabled, unlockWithBiometrics } =
    useAppSecurity();
  const appStateRef = useRef(AppState.currentState);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', nextState => {
      if (appStateRef.current?.match(/inactive|background/) && nextState === 'active') {
        lockIfEnabled();
      }
      appStateRef.current = nextState;
    });
    return () => sub.remove();
  }, [lockIfEnabled]);

  useEffect(() => {
    if (hydrated && isLocked && biometricLockEnabled) {
      void unlockWithBiometrics();
    }
  }, [hydrated, isLocked, biometricLockEnabled, unlockWithBiometrics]);

  if (!isLocked) {
    return <>{children}</>;
  }

  return (
    <View style={styles.lockScreen}>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>HARDWARE SECURITY LOCK</Text>
      </View>
      <Text style={styles.title}>NEXORA Vault Locked</Text>
      <Text style={styles.subtitle}>
        Authenticate with Face ID, Touch ID, or device biometrics to access Wealth, Health, Mobility, and Voice data.
      </Text>
      <View style={styles.btnWrap}>
        <PrimaryButton title="Unlock with Biometrics" onPress={() => void unlockWithBiometrics()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  lockScreen: {
    flex: 1,
    backgroundColor: '#070B14',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.m,
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.45)',
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
  },
  badgeText: {
    fontFamily: fontFamily.mono,
    fontSize: 10.5,
    color: colors.accentBright,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  title: {
    fontFamily: fontFamily.medium,
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 320,
  },
  btnWrap: {
    width: '100%',
    maxWidth: 260,
    marginTop: spacing.s,
  },
});
