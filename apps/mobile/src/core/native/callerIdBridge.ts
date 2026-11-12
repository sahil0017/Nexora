import { Linking, NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { API_BASE_URL } from '../config';

type NativeCallerModule = {
  syncCallerDirectory?: (entriesJson: string) => Promise<any>;
  requestCallScreeningRole?: () => Promise<{ supported?: boolean; granted?: boolean; reason?: string }>;
  getExtensionStatus?: () => Promise<{ enabled?: boolean; status_code?: number }>;
  getPendingUnknownCaller?: () => Promise<string | null>;
  readDeviceCallLogs?: (limit: number) => Promise<DeviceCallLogRow[]>;
  requestContactsAndRead?: () => Promise<{
    granted?: boolean;
    status?: string;
    contacts?: Array<{ phone_number: string; display_name: string; organization?: string }>;
    count?: number;
    error?: string;
  }>;
  startCallObserver?: () => Promise<{ observing?: boolean }>;
  stopCallObserver?: () => Promise<{ observing?: boolean }>;
};

export type DeviceCallLogRow = {
  device_call_id?: string;
  phone_number: string;
  contact_name?: string;
  direction: string;
  duration_sec: number;
  started_at: string;
  sim_slot?: string;
  source?: string;
  transcript_text?: string;
};

const nativeModule: NativeCallerModule | undefined = (NativeModules as Record<string, any>)?.NexoraCallerIdModule;

export type NativeCallerCapabilities = {
  platform: string;
  cost: string;
  nativeBridgeLinked: boolean;
  androidCallScreeningAvailable: boolean;
  iosCallDirectoryAvailable: boolean;
  summary: string;
};

export function getNativeCallerCapabilities(): NativeCallerCapabilities {
  const isAndroid = Platform.OS === 'android';
  const isIOS = Platform.OS === 'ios';
  const bridgeLinked = Boolean(nativeModule?.syncCallerDirectory);
  return {
    platform: Platform.OS,
    cost: '₹0 (Native OS APIs + Local Caller Intelligence DB)',
    nativeBridgeLinked: bridgeLinked,
    androidCallScreeningAvailable: isAndroid,
    iosCallDirectoryAvailable: isIOS,
    summary: isAndroid
      ? 'Android CallScreeningService dynamically screens incoming handles against your local + Nexora caller database.'
      : isIOS
        ? 'iOS CXCallDirectoryProvider preloads identified contacts & high-risk spam entries to lock-screen Caller ID.'
        : 'Web runtime uses Nexora server Caller Intelligence DB; Android/iOS native prebuild enables OS screening.',
  };
}

export async function syncOsCallerDirectory(entries: Array<Record<string, any>>): Promise<{
  synced: boolean;
  mode: string;
  count: number;
}> {
  const payload = JSON.stringify(entries);
  if (nativeModule?.syncCallerDirectory) {
    await nativeModule.syncCallerDirectory(payload);
    return {
      synced: true,
      mode: Platform.OS === 'ios' ? 'ios_call_directory_extension' : 'android_call_screening_prefs',
      count: entries.length,
    };
  }
  return {
    synced: false,
    mode: 'js_fallback_prebuild_required',
    count: entries.length,
  };
}

export async function requestAndroidScreeningRole(): Promise<{
  supported: boolean;
  granted: boolean;
  note: string;
}> {
  if (Platform.OS !== 'android') {
    return {
      supported: false,
      granted: false,
      note: 'CallScreeningService role applies to Android 10+ devices only.',
    };
  }
  if (nativeModule?.requestCallScreeningRole) {
    const res = await nativeModule.requestCallScreeningRole();
    return {
      supported: Boolean(res?.supported),
      granted: Boolean(res?.granted),
      note: res?.reason || (res?.granted ? 'Nexora active as Call Screening app' : 'Role prompt opened'),
    };
  }
  return {
    supported: true,
    granted: false,
    note: 'Include native/android NexoraCallScreeningService in Expo prebuild to grant ROLE_CALL_SCREENING.',
  };
}

/**
 * Upload raw audio bytes directly to the backend-issued presigned URL (AWS S3 SigV4
 * or signed dev fallback) without routing multi-MB blobs through the JSON API server.
 */
export function resolveVoiceStorageUrl(rawUrl: string): string {
  if (!rawUrl || /^https?:\/\//i.test(rawUrl)) {
    return rawUrl;
  }
  const serverOrigin = API_BASE_URL.replace(/\/api\/v1\/?$/, '');
  return `${serverOrigin}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
}

export async function putAudioToPresignedUrl(
  uploadUrl: string,
  body: Blob | string,
  requiredHeaders: Record<string, string> = {},
): Promise<{ ok: boolean; etag?: string; status: number }> {
  const targetUrl = resolveVoiceStorageUrl(uploadUrl);
  const res = await fetch(targetUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': requiredHeaders['Content-Type'] || 'audio/wav',
      ...requiredHeaders,
    },
    body: body as any,
  });
  const etag = res.headers.get('ETag') || res.headers.get('etag') || undefined;
  return { ok: res.ok, etag, status: res.status };
}

export async function fetchDeviceCallLogs(limit = 200): Promise<{
  supported: boolean;
  logs: DeviceCallLogRow[];
  note: string;
}> {
  if (Platform.OS === 'android' && nativeModule?.readDeviceCallLogs) {
    const logs = await nativeModule.readDeviceCallLogs(limit);
    return {
      supported: true,
      logs: Array.isArray(logs) ? logs : [],
      note: `Read ${Array.isArray(logs) ? logs.length : 0} call(s) from Android CallLog provider.`,
    };
  }
  return {
    supported: false,
    logs: [],
    note:
      Platform.OS === 'ios'
        ? 'Apple iOS blocks direct OS reading of historic Call History (Recents). Use Sync iOS Contacts + CallKit Observer for live calls & caller ID, or paste CSV/JSON above for past logs.'
        : 'Expo Go cannot read Android READ_CALL_LOG natively (custom EAS Dev/Prod Android build required). Install the Android preview APK or paste CSV/JSON above.',
  };
}

export async function syncIosContactsWithConsent(): Promise<{
  supported: boolean;
  granted: boolean;
  contacts: Array<{ phone_number: string; display_name: string; organization?: string }>;
  note: string;
}> {
  if (Platform.OS !== 'ios' || !nativeModule?.requestContactsAndRead) {
    return {
      supported: Platform.OS === 'ios',
      granted: false,
      contacts: [],
      note:
        Platform.OS === 'ios'
          ? 'Custom EAS iOS native build required for CNContactStore permission prompt.'
          : 'iOS Contacts sync runs on iOS devices; Android uses READ_CALL_LOG & READ_CONTACTS.',
    };
  }
  const res = await nativeModule.requestContactsAndRead();
  if (!res?.granted) {
    return {
      supported: true,
      granted: false,
      contacts: [],
      note: res?.error || 'iOS Contacts permission was denied in Settings.',
    };
  }
  const contacts = Array.isArray(res.contacts) ? res.contacts : [];
  return {
    supported: true,
    granted: true,
    contacts,
    note: `Synced ${contacts.length} iOS contact(s) into Nexora Caller Directory & CallKit.`,
  };
}

export function subscribeIosCallObserver(onObservedCall: (log: DeviceCallLogRow) => void): () => void {
  if (Platform.OS !== 'ios' || !nativeModule?.startCallObserver) {
    return () => {};
  }
  const emitter = new NativeEventEmitter(nativeModule as any);
  const sub = emitter.addListener('onIosCallObserved', (evt: any) => {
    if (evt) {
      onObservedCall(evt as DeviceCallLogRow);
    }
  });
  void nativeModule.startCallObserver().catch(() => {});
  return () => {
    sub.remove();
    void nativeModule?.stopCallObserver?.().catch(() => {});
  };
}

export async function openRecordingDownload(
  rawUrl: string,
  filename?: string,
): Promise<{ opened: boolean; resolvedUrl: string }> {
  const resolvedUrl = resolveVoiceStorageUrl(rawUrl);
  if (!resolvedUrl) {
    return { opened: false, resolvedUrl: '' };
  }
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const anchor = document.createElement('a');
    anchor.href = resolvedUrl;
    if (filename) {
      anchor.download = filename;
    }
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    document.body?.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return { opened: true, resolvedUrl };
  }
  const canOpen = await Linking.canOpenURL(resolvedUrl).catch(() => true);
  if (canOpen) {
    await Linking.openURL(resolvedUrl);
    return { opened: true, resolvedUrl };
  }
  return { opened: false, resolvedUrl };
}
