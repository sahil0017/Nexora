import { NativeModules, Platform } from 'react-native';

type NativeCallerModule = {
  syncCallerDirectory?: (entriesJson: string) => Promise<any>;
  requestCallScreeningRole?: () => Promise<{ supported?: boolean; granted?: boolean; reason?: string }>;
  getExtensionStatus?: () => Promise<{ enabled?: boolean; status_code?: number }>;
  getPendingUnknownCaller?: () => Promise<string | null>;
  readDeviceCallLogs?: (limit: number) => Promise<DeviceCallLogRow[]>;
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
export async function putAudioToPresignedUrl(
  uploadUrl: string,
  body: Blob | string,
  requiredHeaders: Record<string, string> = {},
): Promise<{ ok: boolean; etag?: string; status: number }> {
  const res = await fetch(uploadUrl, {
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
        ? 'iOS restricts third-party CallLog history queries; export or paste call logs CSV/JSON to import dynamically.'
        : 'Native CallLog bridge requires Android prebuild; paste or upload CSV/JSON call logs to import dynamically.',
  };
}
