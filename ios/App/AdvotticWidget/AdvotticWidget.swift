import WidgetKit
import SwiftUI

// MARK: - Shared storage

private enum WidgetStore {
    static let appGroup = "group.com.advottic.app"
    // Keys kept in sync with WidgetBridgePlugin.swift.
    static let kOpenCount = "adv_openCount"
    static let kLatestTitle = "adv_latestTitle"
    static let kNextHearingAt = "adv_nextHearingAt"
    static let kNextHearingTitle = "adv_nextHearingTitle"
    static let kActionsJson = "adv_actionsJson"
    static let kSyncedAt = "adv_syncedAt"
}

// MARK: - Model

struct CasesSnapshot {
    let hasData: Bool
    let openCount: Int
    let latestTitle: String
    let nextHearingAt: Double     // epoch millis, 0 = none
    let nextHearingTitle: String
    let topAction: String

    static func load() -> CasesSnapshot {
        guard let d = UserDefaults(suiteName: WidgetStore.appGroup),
              d.double(forKey: WidgetStore.kSyncedAt) > 0 else {
            return CasesSnapshot(hasData: false, openCount: 0, latestTitle: "",
                                 nextHearingAt: 0, nextHearingTitle: "", topAction: "")
        }
        return CasesSnapshot(
            hasData: true,
            openCount: d.integer(forKey: WidgetStore.kOpenCount),
            latestTitle: d.string(forKey: WidgetStore.kLatestTitle) ?? "",
            nextHearingAt: d.double(forKey: WidgetStore.kNextHearingAt),
            nextHearingTitle: d.string(forKey: WidgetStore.kNextHearingTitle) ?? "",
            topAction: Self.firstAction(d.string(forKey: WidgetStore.kActionsJson) ?? "[]")
        )
    }

    private static func firstAction(_ json: String) -> String {
        guard let data = json.data(using: .utf8),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]],
              let first = arr.first else { return "" }
        let text = first["text"] as? String ?? ""
        let urgent = first["urgent"] as? Bool ?? false
        return (urgent ? "⚠ " : "") + text
    }
}

// MARK: - Timeline

struct CasesEntry: TimelineEntry {
    let date: Date
    let snapshot: CasesSnapshot
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> CasesEntry {
        CasesEntry(date: Date(), snapshot: CasesSnapshot(
            hasData: true, openCount: 4, latestTitle: "Smith v. Acme",
            nextHearingAt: Date().addingTimeInterval(3600 * 26).timeIntervalSince1970 * 1000,
            nextHearingTitle: "Smith v. Acme", topAction: "Prep: Smith v. Acme"))
    }

    func getSnapshot(in context: Context, completion: @escaping (CasesEntry) -> Void) {
        completion(CasesEntry(date: Date(), snapshot: CasesSnapshot.load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<CasesEntry>) -> Void) {
        let entry = CasesEntry(date: Date(), snapshot: CasesSnapshot.load())
        // The app pushes updates via WidgetCenter.reloadAllTimelines(),
        // so a distant refresh is just a safety net (e.g. countdown ages).
        let next = Calendar.current.date(byAdding: .hour, value: 1, to: Date()) ?? Date().addingTimeInterval(3600)
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

// MARK: - Colors

private extension Color {
    static let advForest = Color(red: 0x0F/255, green: 0x2D/255, blue: 0x24/255)
    static let advCream = Color(red: 0xFB/255, green: 0xF7/255, blue: 0xE9/255)
    static let advGold = Color(red: 0xD5/255, green: 0xBB/255, blue: 0x7E/255)
}

// MARK: - View

struct AdvotticWidgetEntryView: View {
    var entry: CasesEntry

    private func relativeWhen(_ epochMs: Double) -> String {
        let delta = epochMs / 1000 - Date().timeIntervalSince1970
        if delta <= 0 { return "now" }
        let mins = Int(delta / 60)
        if mins < 60 { return "in \(mins)m" }
        let hours = mins / 60
        if hours < 24 { return "in \(hours)h" }
        return "in \(hours / 24)d"
    }

    var body: some View {
        let s = entry.snapshot
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .lastTextBaseline, spacing: 8) {
                Text(s.hasData ? "\(s.openCount)" : "—")
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                    .foregroundColor(.advCream)
                Text(s.openCount == 1 ? "OPEN CASE" : "OPEN CASES")
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(1.0)
                    .foregroundColor(.advGold)
                Spacer()
                Text("ADVOTTIC")
                    .font(.system(size: 9, weight: .semibold))
                    .tracking(1.5)
                    .foregroundColor(.advCream.opacity(0.35))
            }

            if s.hasData {
                Text(s.latestTitle.isEmpty ? "No open cases" : s.latestTitle)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.advCream)
                    .lineLimit(1)
                Text(s.nextHearingAt > 0
                     ? "Next hearing \(relativeWhen(s.nextHearingAt))"
                     : "No upcoming hearings")
                    .font(.system(size: 12))
                    .foregroundColor(.advCream.opacity(0.72))
                    .lineLimit(1)
                if !s.topAction.isEmpty {
                    Text(s.topAction)
                        .font(.system(size: 11.5))
                        .foregroundColor(.advCream.opacity(0.55))
                        .lineLimit(1)
                }
            } else {
                Text("Open Advottic to sync")
                    .font(.system(size: 13))
                    .foregroundColor(.advCream.opacity(0.72))
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color.advForest)
        // Tapping the widget deep-links to the cases list.
        .widgetURL(URL(string: "https://advottic.com/cases"))
    }
}

// MARK: - Widget

struct AdvotticWidget: Widget {
    let kind = "AdvotticCasesWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            if #available(iOS 17.0, *) {
                // iOS 17+ requires a container background for the widget.
                AdvotticWidgetEntryView(entry: entry)
                    .containerBackground(Color.advForest, for: .widget)
            } else {
                AdvotticWidgetEntryView(entry: entry)
            }
        }
        .configurationDisplayName("Open cases")
        .description("Your open cases, next hearing, and recent activity at a glance.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
