import Foundation
import Capacitor
import WidgetKit

/**
 * Phone -> home-screen widget bridge (iOS).
 *
 * The Advottic iOS app is a Capacitor WebView, so the case data lives
 * in JS. This local plugin lets the web app hand the same glance
 * summary it already computes for the watch (open-case count, latest
 * update, upcoming hearings, recent actions) down to native, where it
 * is written to the App Group's UserDefaults that the WidgetKit
 * extension reads, then asks WidgetKit to reload its timelines.
 *
 * The App Group is what lets the main app and the widget extension
 * share storage; both targets must have the same
 * `group.com.advottic.app` App Group capability (see docs/WIDGETS.md).
 *
 * Registered via WidgetBridgePlugin.m (the CAP_PLUGIN macro), the same
 * way Capacitor discovers every Swift plugin. Best-effort: never
 * rejects so it can't disrupt the phone UX.
 */
@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin {

    static let appGroup = "group.com.advottic.app"
    // Keys the widget extension reads (kept in sync with AdvotticWidget).
    static let kOpenCount = "adv_openCount"
    static let kLatestTitle = "adv_latestTitle"
    static let kLatestCaseId = "adv_latestCaseId"
    static let kNextHearingAt = "adv_nextHearingAt"
    static let kNextHearingTitle = "adv_nextHearingTitle"
    static let kUpcomingJson = "adv_upcomingJson"
    static let kActionsJson = "adv_actionsJson"
    static let kSyncedAt = "adv_syncedAt"

    @objc func sync(_ call: CAPPluginCall) {
        let openCount = call.getInt("openCount") ?? 0
        let latestTitle = call.getString("latestTitle") ?? ""
        let latestCaseId = call.getString("latestCaseId") ?? ""
        // Epoch millis arrives as a JS number (Double).
        let nextHearingAt = call.getDouble("nextHearingAt") ?? 0
        let nextHearingTitle = call.getString("nextHearingTitle") ?? ""

        let upcoming = call.getArray("upcoming") ?? []
        let actions = call.getArray("actions") ?? []
        let upcomingJson = Self.jsonString(from: upcoming)
        let actionsJson = Self.jsonString(from: actions)

        guard let defaults = UserDefaults(suiteName: Self.appGroup) else {
            // App Group not configured on this build - no-op, never fail.
            call.resolve()
            return
        }
        defaults.set(openCount, forKey: Self.kOpenCount)
        defaults.set(latestTitle, forKey: Self.kLatestTitle)
        defaults.set(latestCaseId, forKey: Self.kLatestCaseId)
        defaults.set(nextHearingAt, forKey: Self.kNextHearingAt)
        defaults.set(nextHearingTitle, forKey: Self.kNextHearingTitle)
        defaults.set(upcomingJson, forKey: Self.kUpcomingJson)
        defaults.set(actionsJson, forKey: Self.kActionsJson)
        defaults.set(Date().timeIntervalSince1970 * 1000, forKey: Self.kSyncedAt)

        if #available(iOS 14.0, *) {
            WidgetCenter.shared.reloadAllTimelines()
        }
        call.resolve()
    }

    /// Serialize a JS array (of {…} dicts) to a JSON string, "[]" on failure.
    private static func jsonString(from array: [Any]) -> String {
        guard JSONSerialization.isValidJSONObject(array),
              let data = try? JSONSerialization.data(withJSONObject: array),
              let str = String(data: data, encoding: .utf8) else {
            return "[]"
        }
        return str
    }
}
