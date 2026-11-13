import { Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as ScreenCapture from 'expo-screen-capture';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

const KEY_BIOMETRIC_ENABLED = 'nexora.sec.biometric_lock';
const KEY_SCREENSHOT_PROTECT = 'nexora.sec.screenshot_protect';

export async function secureSet(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') return;
  await SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function secureGet(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  return SecureStore.getItemAsync(key);
}

export async function secureDelete(key: string): Promise<void> {
  if (Platform.OS === 'web') return;
  await SecureStore.deleteItemAsync(key);
}

export async function isBiometricSupported(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const [hasHw, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return hasHw && enrolled;
  } catch {
    return false;
  }
}

export async function authenticateBiometric(promptMessage = 'Unlock NEXORA'): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  try {
    const supported = await isBiometricSupported();
    if (!supported) return true;
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage,
      fallbackLabel: 'Use Device Passcode',
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
    });
    return res.success;
  } catch {
    return false;
  }
}

type AppSecurityState = {
  hydrated: boolean;
  biometricSupported: boolean;
  biometricLockEnabled: boolean;
  screenshotProtectionEnabled: boolean;
  isLocked: boolean;
  hydrate: () => Promise<void>;
  setBiometricLockEnabled: (enabled: boolean) => Promise<boolean>;
  setScreenshotProtectionEnabled: (enabled: boolean) => Promise<void>;
  lockIfEnabled: () => void;
  unlockWithBiometrics: () => Promise<boolean>;
};

export const useAppSecurity = create<AppSecurityState>((set, get) => ({
  hydrated: false,
  biometricSupported: false,
  biometricLockEnabled: false,
  screenshotProtectionEnabled: true,
  isLocked: false,

  hydrate: async () => {
    const [supported, bioRaw, screenRaw] = await Promise.all([
      isBiometricSupported(),
      secureGet(KEY_BIOMETRIC_ENABLED).catch(() => null),
      secureGet(KEY_SCREENSHOT_PROTECT).catch(() => null),
    ]);
    const bioEnabled = bioRaw === '1' && supported;
    const screenEnabled = screenRaw !== '0';
    if (Platform.OS !== 'web') {
      if (screenEnabled) {
        await ScreenCapture.preventScreenCaptureAsync().catch(() => {});
      } else {
        await ScreenCapture.allowScreenCaptureAsync().catch(() => {});
      }
    }
    set({
      hydrated: true,
      biometricSupported: supported,
      biometricLockEnabled: bioEnabled,
      screenshotProtectionEnabled: screenEnabled,
      isLocked: bioEnabled,
    });
  },

  setBiometricLockEnabled: async enabled => {
    if (enabled) {
      const ok = await authenticateBiometric('Enable Biometric Lock for NEXORA');
      if (!ok) return false;
    }
    await secureSet(KEY_BIOMETRIC_ENABLED, enabled ? '1' : '0').catch(() => {});
    set({ biometricLockEnabled: enabled, isLocked: false });
    return true;
  },

  setScreenshotProtectionEnabled: async enabled => {
    await secureSet(KEY_SCREENSHOT_PROTECT, enabled ? '1' : '0').catch(() => {});
    if (Platform.OS !== 'web') {
      if (enabled) {
        await ScreenCapture.preventScreenCaptureAsync().catch(() => {});
      } else {
        await ScreenCapture.allowScreenCaptureAsync().catch(() => {});
      }
    }
    set({ screenshotProtectionEnabled: enabled });
  },

  lockIfEnabled: () => {
    if (get().biometricLockEnabled) {
      set({ isLocked: true });
    }
  },

  unlockWithBiometrics: async () => {
    const ok = await authenticateBiometric('Unlock NEXORA Intelligence Vault');
    if (ok) {
      set({ isLocked: false });
    }
    return ok;
  },
}));
