import Foundation
import CallKit

/// React Native NativeModule bridge syncing Nexora's local Caller Intelligence
/// database into the iOS CXCallDirectoryProvider extension App Group & reloading it.
@objc(NexoraCallerIdModule)
final class NexoraCallerIdBridge: NSObject {

    private static let extensionBundleId = "com.nexora.app.NexoraCallDirectory"

    @objc
    static func requiresMainQueueSetup() -> Bool { false }

    @objc(syncCallerDirectory:resolver:rejecter:)
    func syncCallerDirectory(
        _ entriesJson: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard let defaults = UserDefaults(suiteName: NexoraCallDirectoryHandler.appGroupId) else {
            reject("APP_GROUP_ERR", "App Group container unavailable", nil)
            return
        }
        defaults.set(entriesJson.data(using: .utf8), forKey: NexoraCallDirectoryHandler.entriesKey)
        defaults.synchronize()

        CXCallDirectoryManager.sharedInstance.reloadExtension(withIdentifier: Self.extensionBundleId) { error in
            if let err = error {
                // Non-fatal in simulator or when user hasn't toggled Settings > Phone > Call Blocking yet
                resolve(["synced_to_app_group": true, "reloaded": false, "note": err.localizedDescription])
            } else {
                resolve(["synced_to_app_group": true, "reloaded": true])
            }
        }
    }

    @objc(getExtensionStatus:rejecter:)
    func getExtensionStatus(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        CXCallDirectoryManager.sharedInstance.getEnabledStatusForExtension(withIdentifier: Self.extensionBundleId) { status, err in
            resolve([
                "enabled": status == .enabled,
                "status_code": status.rawValue,
                "error": err?.localizedDescription ?? ""
            ])
        }
    }
}
