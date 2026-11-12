import Foundation
import CallKit
import Contacts
import React

/// React Native NativeModule bridge syncing Nexora's local Caller Intelligence
/// database into the iOS CXCallDirectoryProvider extension App Group, requesting
/// iOS Contacts access (`CNContactStore`), and observing live call sessions via
/// `CXCallObserver` (Apple iOS restricts historic Recents across all third-party apps).
@objc(NexoraCallerIdModule)
final class NexoraCallerIdBridge: RCTEventEmitter, CXCallObserverDelegate {

    private static let extensionBundleId = "ai.nexora.movesmart.NexoraCallDirectory"
    private let contactStore = CNContactStore()
    private var callObserver: CXCallObserver?
    private var activeCalls: [UUID: (startedAt: Date, isOutgoing: Bool, hasConnected: Bool)] = [:]
    private var hasListeners = false

    override init() {
        super.init()
    }

    @objc
    override static func requiresMainQueueSetup() -> Bool { false }

    override func supportedEvents() -> [String]! {
        ["onIosCallObserved"]
    }

    override func startObserving() {
        hasListeners = true
    }

    override func stopObserving() {
        hasListeners = false
    }

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

    @objc(requestContactsAndRead:rejecter:)
    func requestContactsAndRead(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        let authStatus = CNContactStore.authorizationStatus(for: .contacts)
        if authStatus == .denied || authStatus == .restricted {
            resolve([
                "granted": false,
                "status": "denied",
                "contacts": [],
                "count": 0
            ])
            return
        }

        contactStore.requestAccess(for: .contacts) { [weak self] granted, err in
            guard let self = self else { return }
            if !granted {
                resolve([
                    "granted": false,
                    "status": "denied",
                    "error": err?.localizedDescription ?? "Contacts access denied",
                    "contacts": [],
                    "count": 0
                ])
                return
            }

            DispatchQueue.global(qos: .userInitiated).async {
                let keys: [CNKeyDescriptor] = [
                    CNContactGivenNameKey as CNKeyDescriptor,
                    CNContactFamilyNameKey as CNKeyDescriptor,
                    CNContactOrganizationNameKey as CNKeyDescriptor,
                    CNContactPhoneNumbersKey as CNKeyDescriptor
                ]
                let req = CNContactFetchRequest(keysToFetch: keys)
                var results: [[String: Any]] = []
                var directoryItems: [[String: Any]] = []

                do {
                    try self.contactStore.enumerateContacts(with: req) { contact, stop in
                        if results.count >= 500 {
                            stop.pointee = true
                            return
                        }
                        let fullName = [contact.givenName, contact.familyName]
                            .map { $0.trimmingCharacters(in: .whitespaces) }
                            .filter { !$0.isEmpty }
                            .joined(separator: " ")
                        let displayName = fullName.isEmpty ? contact.organizationName : fullName
                        guard !displayName.isEmpty else { return }

                        for phoneValue in contact.phoneNumbers {
                            let raw = phoneValue.value.stringValue
                            let digitsOnly = raw.filter { $0.isWholeNumber }
                            guard digitsOnly.count >= 7 else { continue }

                            results.append([
                                "phone_number": raw,
                                "display_name": displayName,
                                "organization": contact.organizationName
                            ])
                            if let numericE164 = Int64(digitsOnly) {
                                directoryItems.append([
                                    "numeric_e164": numericE164,
                                    "label": displayName,
                                    "spam_risk": "low"
                                ])
                            }
                        }
                    }

                    if let defaults = UserDefaults(suiteName: NexoraCallDirectoryHandler.appGroupId),
                       let data = try? JSONSerialization.data(withJSONObject: directoryItems) {
                        defaults.set(data, forKey: NexoraCallDirectoryHandler.entriesKey)
                        defaults.synchronize()
                        CXCallDirectoryManager.sharedInstance.reloadExtension(withIdentifier: Self.extensionBundleId) { _ in }
                    }

                    resolve([
                        "granted": true,
                        "status": "granted",
                        "contacts": results,
                        "count": results.count
                    ])
                } catch {
                    reject("CONTACTS_ERR", error.localizedDescription, error)
                }
            }
        }
    }

    @objc(startCallObserver:rejecter:)
    func startCallObserver(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if self.callObserver == nil {
                let observer = CXCallObserver()
                observer.setDelegate(self, queue: DispatchQueue.main)
                self.callObserver = observer
            }
            resolve(["observing": true])
        }
    }

    @objc(stopCallObserver:rejecter:)
    func stopCallObserver(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async { [weak self] in
            self?.callObserver?.setDelegate(nil, queue: nil)
            self?.callObserver = nil
            self?.activeCalls.removeAll()
            resolve(["observing": false])
        }
    }

    func callObserver(_ callObserver: CXCallObserver, callChanged call: CXCall) {
        if !call.hasEnded {
            var existing = activeCalls[call.uuid] ?? (startedAt: Date(), isOutgoing: call.isOutgoing, hasConnected: call.hasConnected)
            if call.hasConnected {
                existing.hasConnected = true
            }
            activeCalls[call.uuid] = existing
            return
        }

        let tracked = activeCalls.removeValue(forKey: call.uuid)
        let startedAt = tracked?.startedAt ?? Date()
        let durationSec = max(0, Int(Date().timeIntervalSince(startedAt)))
        let wasConnected = tracked?.hasConnected == true || call.hasConnected
        let direction: String
        if call.isOutgoing {
            direction = "outbound"
        } else if wasConnected {
            direction = "inbound"
        } else {
            direction = "missed"
        }

        guard hasListeners else { return }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime]
        sendEvent(withName: "onIosCallObserved", body: [
            "device_call_id": call.uuid.uuidString,
            "phone_number": "unknown-ios-callkit",
            "contact_name": "",
            "direction": direction,
            "duration_sec": durationSec,
            "started_at": iso.string(from: startedAt),
            "source": "ios_call_observer"
        ])
    }
}
