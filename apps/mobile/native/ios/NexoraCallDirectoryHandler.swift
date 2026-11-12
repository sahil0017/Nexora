import Foundation
import CallKit

/// ₹0-cost iOS CXCallDirectoryProvider extension.
/// Reads numeric caller identification & spam-block lists written to the shared
/// App Group (`group.com.nexora.voice.callerid`) by Nexora's React Native bridge
/// and supplies system lock-screen Caller ID without external paid APIs.
final class NexoraCallDirectoryHandler: CXCallDirectoryProvider {
    static let appGroupId = "group.ai.nexora.movesmart.callerid"
    static let entriesKey = "nexora_call_directory_entries"

    override func beginRequest(with context: CXCallDirectoryExtensionContext) {
        let defaults = UserDefaults(suiteName: Self.appGroupId)
        guard
            let data = defaults?.data(forKey: Self.entriesKey),
            let items = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else {
            context.completeRequest()
            return
        }

        // CallKit requires phone numbers sorted in strictly ascending CXCallDirectoryPhoneNumber order.
        let sorted = items.sorted {
            (($0["numeric_e164"] as? NSNumber)?.int64Value ?? 0) < (($1["numeric_e164"] as? NSNumber)?.int64Value ?? 0)
        }

        for item in sorted {
            guard let num = (item["numeric_e164"] as? NSNumber)?.int64Value, num > 0 else { continue }
            let spamRisk = (item["spam_risk"] as? String) ?? "low"
            if spamRisk == "high" {
                context.addBlockingEntry(withNextSequentialPhoneNumber: num)
            }
            if let label = item["label"] as? String, !label.isEmpty {
                context.addIdentificationEntry(withNextSequentialPhoneNumber: num, label: label)
            }
        }
        context.completeRequest()
    }
}
