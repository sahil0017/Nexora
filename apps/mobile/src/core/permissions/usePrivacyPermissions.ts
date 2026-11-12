import { PermissionsAndroid, Platform } from 'react-native';
import { create } from 'zustand';
import * as Location from 'expo-location';
import { requestAndroidScreeningRole } from '../native/callerIdBridge';

export type PermissionKey =
  | 'gpsLocation'
  | 'smsAlertIngestion'
  | 'emailVaultForwarding'
  | 'clipboardAutoScan'
  | 'aiCfoTelemetry'
  | 'edgePiiMasking'
  | 'voiceMicCapture'
  | 'voiceConversationMemory'
  | 'deviceCallLogsRead'
  | 'deviceCallScreening';

export type PermissionDescriptor = {
  key: PermissionKey;
  domain: 'Mobility' | 'Finance' | 'Copilot' | 'Security' | 'Voice';
  title: string;
  description: string;
  dataHandled: string;
  recommended: boolean;
};

export const PERMISSION_CATALOG: PermissionDescriptor[] = [
  {
    key: 'gpsLocation',
    domain: 'Mobility',
    title: 'Device Location (GPS)',
    description: 'Reads live coordinates for corridor traffic, nearby road hazards, ETA tracking & local routing.',
    dataHandled: 'Foreground latitude, longitude, speed & heading only while active.',
    recommended: true,
  },
  {
    key: 'smsAlertIngestion',
    domain: 'Finance',
    title: 'Bank & UPI Alert Parsing',
    description: 'Parses SMS, UPI & card alert text you share to extract merchant, amount & balance without bank logins.',
    dataHandled: 'Alert text is scrubbed on-device before leaving your phone.',
    recommended: true,
  },
  {
    key: 'emailVaultForwarding',
    domain: 'Finance',
    title: 'Private Statement Email Alias',
    description: 'Allows creating private forwarding aliases for salary slips, credit card & broker statements.',
    dataHandled: 'Alias metadata & extracted line items encrypted at rest.',
    recommended: true,
  },
  {
    key: 'clipboardAutoScan',
    domain: 'Finance',
    title: 'On-Demand Clipboard Read',
    description: 'Allows reading copied bank alerts from your clipboard strictly when you tap Paste / Import.',
    dataHandled: 'Never polled in background; reads only on explicit tap.',
    recommended: false,
  },
  {
    key: 'aiCfoTelemetry',
    domain: 'Copilot',
    title: 'Wealth & Tax Context Sharing',
    description: 'Shares anonymized financial ratios & balances with Wealth Advisor after masking sensitive details.',
    dataHandled: 'No raw A/c numbers, PAN, Aadhaar, or unmasked UPI IDs.',
    recommended: true,
  },
  {
    key: 'edgePiiMasking',
    domain: 'Security',
    title: 'On-Device Privacy Masking',
    description: 'Masks PAN, Aadhaar, account numbers & UPI IDs locally and encrypts payloads on-device.',
    dataHandled: 'Processed locally before syncing.',
    recommended: true,
  },
  {
    key: 'voiceMicCapture',
    domain: 'Voice',
    title: 'Voice Capture & Recording Import',
    description: 'Allows capturing meetings, calls, or imported audio recordings into encrypted Voice Intelligence storage.',
    dataHandled: 'Original audio sealed with SHA-256 & HMAC; explicit consent required per capture.',
    recommended: true,
  },
  {
    key: 'voiceConversationMemory',
    domain: 'Voice',
    title: 'Conversational Knowledge & Memory Graph',
    description: 'Extracts commitments, entities, and cross-conversation memory with source-grounded citations.',
    dataHandled: 'PII scrubbed before model inference; human corrections logged immutably.',
    recommended: true,
  },
  {
    key: 'deviceCallLogsRead',
    domain: 'Voice',
    title: 'Device Historic Call Logs',
    description:
      'Reads your device call history (number, contact name, direction, duration & timestamp) strictly when you tap Sync Device CallLog.',
    dataHandled: 'Phone numbers are SHA-256 hashed and masked; raw numbers are never stored in plain text.',
    recommended: false,
  },
  {
    key: 'deviceCallScreening',
    domain: 'Voice',
    title: 'Live Caller ID & Call Screening',
    description:
      'Allows Android CallScreeningService and iOS Call Directory Extension to identify callers and warn on spam.',
    dataHandled: 'Uses your local Caller Intelligence DB first (₹0 cost); unknown numbers prompt post-call.',
    recommended: true,
  },
];

export type PermissionMap = Record<PermissionKey, boolean>;

export type OsLocationStatus = 'unknown' | 'granted' | 'denied' | 'undetermined';

interface PrivacyPermissionsState {
  permissions: PermissionMap;
  consentConfigured: boolean;
  lastUpdatedAt: string | null;
  osLocationStatus: OsLocationStatus;
  osCallLogStatus: OsLocationStatus;
  osCallScreeningStatus: OsLocationStatus;
  setPermission: (key: PermissionKey, value: boolean) => void;
  applyRecommended: () => void;
  revokeOptional: () => void;
  markReviewed: () => void;
  syncOsPermissions: () => Promise<OsLocationStatus>;
  requestOsLocation: () => Promise<OsLocationStatus>;
  requestOsCallLogs: () => Promise<OsLocationStatus>;
  requestOsCallScreening: () => Promise<OsLocationStatus>;
}

const STORAGE_KEY = 'nexora_privacy_permissions_v1';

const DEFAULT_PERMISSIONS: PermissionMap = {
  gpsLocation: false,
  smsAlertIngestion: false,
  emailVaultForwarding: false,
  clipboardAutoScan: false,
  aiCfoTelemetry: false,
  edgePiiMasking: true,
  voiceMicCapture: false,
  voiceConversationMemory: false,
  deviceCallLogsRead: false,
  deviceCallScreening: false,
};

function loadPersisted(): {
  permissions: PermissionMap;
  consentConfigured: boolean;
  lastUpdatedAt: string | null;
} {
  try {
    if (Platform.OS === 'web' && typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
      const raw = globalThis.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          permissions: { ...DEFAULT_PERMISSIONS, ...(parsed.permissions || {}) },
          consentConfigured: Boolean(parsed.consentConfigured),
          lastUpdatedAt: typeof parsed.lastUpdatedAt === 'string' ? parsed.lastUpdatedAt : null,
        };
      }
    }
  } catch {
    // Ignore malformed storage
  }
  return {
    permissions: { ...DEFAULT_PERMISSIONS },
    consentConfigured: false,
    lastUpdatedAt: null,
  };
}

function persistState(data: {
  permissions: PermissionMap;
  consentConfigured: boolean;
  lastUpdatedAt: string | null;
}) {
  try {
    if (Platform.OS === 'web' && typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
      globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }
  } catch {
    // Storage unavailable in private mode
  }
}

const initial = loadPersisted();

export const usePrivacyPermissions = create<PrivacyPermissionsState>((set, get) => ({
  permissions: initial.permissions,
  consentConfigured: initial.consentConfigured,
  lastUpdatedAt: initial.lastUpdatedAt,
  osLocationStatus: 'unknown',
  osCallLogStatus: 'unknown',
  osCallScreeningStatus: 'unknown',

  setPermission: (key, value) => {
    const next = { ...get().permissions, [key]: value };
    const now = new Date().toISOString();
    const payload = { permissions: next, consentConfigured: true, lastUpdatedAt: now };
    persistState(payload);
    set(payload);
  },

  applyRecommended: () => {
    const next: PermissionMap = {
      gpsLocation: true,
      smsAlertIngestion: true,
      emailVaultForwarding: true,
      clipboardAutoScan: false,
      aiCfoTelemetry: true,
      edgePiiMasking: true,
      voiceMicCapture: true,
      voiceConversationMemory: true,
      deviceCallLogsRead: false,
      deviceCallScreening: true,
    };
    const now = new Date().toISOString();
    const payload = { permissions: next, consentConfigured: true, lastUpdatedAt: now };
    persistState(payload);
    set(payload);
  },

  revokeOptional: () => {
    const next: PermissionMap = {
      gpsLocation: false,
      smsAlertIngestion: false,
      emailVaultForwarding: false,
      clipboardAutoScan: false,
      aiCfoTelemetry: false,
      edgePiiMasking: true,
      voiceMicCapture: false,
      voiceConversationMemory: false,
      deviceCallLogsRead: false,
      deviceCallScreening: false,
    };
    const now = new Date().toISOString();
    const payload = { permissions: next, consentConfigured: true, lastUpdatedAt: now };
    persistState(payload);
    set(payload);
  },

  markReviewed: () => {
    const now = new Date().toISOString();
    const payload = {
      permissions: get().permissions,
      consentConfigured: true,
      lastUpdatedAt: now,
    };
    persistState(payload);
    set(payload);
  },

  syncOsPermissions: async () => {
    try {
      if (Platform.OS === 'web') {
        const permsApi = (globalThis as any)?.navigator?.permissions;
        if (permsApi?.query) {
          const res = await permsApi.query({ name: 'geolocation' });
          const mapped: OsLocationStatus =
            res.state === 'granted' ? 'granted' : res.state === 'denied' ? 'denied' : 'undetermined';
          set({ osLocationStatus: mapped });
          return mapped;
        }
        return get().osLocationStatus;
      }
      const { status } = await Location.getForegroundPermissionsAsync();
      const mapped: OsLocationStatus =
        status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
      if (Platform.OS === 'android') {
        const hasCallLog = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_CALL_LOG);
        const hasPhoneState = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE);
        set({
          osLocationStatus: mapped,
          osCallLogStatus: hasCallLog ? 'granted' : 'undetermined',
          osCallScreeningStatus: hasPhoneState ? 'granted' : 'undetermined',
        });
      } else {
        set({ osLocationStatus: mapped });
      }
      return mapped;
    } catch {
      return get().osLocationStatus;
    }
  },

  requestOsLocation: async () => {
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.geolocation) {
        const result = await new Promise<OsLocationStatus>(resolve => {
          navigator.geolocation.getCurrentPosition(
            () => resolve('granted'),
            err => resolve(err.code === 1 ? 'denied' : 'undetermined'),
            { timeout: 8000 },
          );
        });
        set({ osLocationStatus: result });
        if (result === 'granted') {
          get().setPermission('gpsLocation', true);
        } else if (result === 'denied') {
          get().setPermission('gpsLocation', false);
        }
        return result;
      }
      const { status } = await Location.requestForegroundPermissionsAsync();
      const mapped: OsLocationStatus =
        status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
      set({ osLocationStatus: mapped });
      if (mapped === 'granted') {
        get().setPermission('gpsLocation', true);
      } else if (mapped === 'denied') {
        get().setPermission('gpsLocation', false);
      }
      return mapped;
    } catch {
      return 'denied';
    }
  },

  requestOsCallLogs: async () => {
    try {
      if (Platform.OS === 'android') {
        const res = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.READ_CALL_LOG,
          PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
        ]);
        const granted = res[PermissionsAndroid.PERMISSIONS.READ_CALL_LOG] === PermissionsAndroid.RESULTS.GRANTED;
        const status: OsLocationStatus = granted ? 'granted' : 'denied';
        set({ osCallLogStatus: status });
        get().setPermission('deviceCallLogsRead', granted);
        return status;
      }
      // On iOS / Web, app-level consent enables CSV/JSON call log import
      set({ osCallLogStatus: 'granted' });
      get().setPermission('deviceCallLogsRead', true);
      return 'granted';
    } catch {
      set({ osCallLogStatus: 'denied' });
      get().setPermission('deviceCallLogsRead', false);
      return 'denied';
    }
  },

  requestOsCallScreening: async () => {
    try {
      if (Platform.OS === 'android') {
        const phoneRes = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE);
        const roleRes = await requestAndroidScreeningRole();
        const granted = phoneRes === PermissionsAndroid.RESULTS.GRANTED || roleRes.granted;
        const status: OsLocationStatus = granted ? 'granted' : 'undetermined';
        set({ osCallScreeningStatus: status });
        get().setPermission('deviceCallScreening', granted);
        return status;
      }
      set({ osCallScreeningStatus: 'granted' });
      get().setPermission('deviceCallScreening', true);
      return 'granted';
    } catch {
      set({ osCallScreeningStatus: 'denied' });
      get().setPermission('deviceCallScreening', false);
      return 'denied';
    }
  },
}));
