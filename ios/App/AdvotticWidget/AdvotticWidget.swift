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
    static let kUpcomingJson = "adv_upcomingJson"
    static let kActionsJson = "adv_actionsJson"
    static let kSyncedAt = "adv_syncedAt"
}

// MARK: - Model

struct Hearing: Identifiable {
    let id = UUID()
    let at: Double     // epoch millis
    let title: String
}

struct CasesSnapshot {
    let hasData: Bool
    let openCount: Int
    let latestTitle: String
    let nextHearingAt: Double     // epoch millis, 0 = none
    let nextHearingTitle: String
    let upcoming: [Hearing]
    let topAction: String

    static func load() -> CasesSnapshot {
        guard let d = UserDefaults(suiteName: WidgetStore.appGroup),
              d.double(forKey: WidgetStore.kSyncedAt) > 0 else {
            return CasesSnapshot(hasData: false, openCount: 0, latestTitle: "",
                                 nextHearingAt: 0, nextHearingTitle: "",
                                 upcoming: [], topAction: "")
        }
        return CasesSnapshot(
            hasData: true,
            openCount: d.integer(forKey: WidgetStore.kOpenCount),
            latestTitle: d.string(forKey: WidgetStore.kLatestTitle) ?? "",
            nextHearingAt: d.double(forKey: WidgetStore.kNextHearingAt),
            nextHearingTitle: d.string(forKey: WidgetStore.kNextHearingTitle) ?? "",
            upcoming: Self.parseUpcoming(d.string(forKey: WidgetStore.kUpcomingJson) ?? "[]"),
            topAction: Self.firstAction(d.string(forKey: WidgetStore.kActionsJson) ?? "[]")
        )
    }

    private static func parseUpcoming(_ json: String) -> [Hearing] {
        guard let data = json.data(using: .utf8),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            return []
        }
        return arr.compactMap { o in
            // `at` arrives as a JS number (Double); title is a String.
            let at = (o["at"] as? Double) ?? (o["at"] as? NSNumber)?.doubleValue ?? 0
            let title = o["title"] as? String ?? ""
            guard at > 0 else { return nil }
            return Hearing(at: at, title: title)
        }
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

// Shared relative-time helper: "now", "in 20m", "in 3h", "in 2d".
func relativeWhen(_ epochMs: Double) -> String {
    let delta = epochMs / 1000 - Date().timeIntervalSince1970
    if delta <= 0 { return "now" }
    let mins = Int(delta / 60)
    if mins < 60 { return "in \(mins)m" }
    let hours = mins / 60
    if hours < 24 { return "in \(hours)h" }
    return "in \(hours / 24)d"
}

// MARK: - Timeline

struct CasesEntry: TimelineEntry {
    let date: Date
    let snapshot: CasesSnapshot
}

struct Provider: TimelineProvider {
    private var sample: CasesSnapshot {
        let base = Date().timeIntervalSince1970 * 1000
        return CasesSnapshot(
            hasData: true, openCount: 4, latestTitle: "Smith v. Acme",
            nextHearingAt: base + 3600 * 26 * 1000, nextHearingTitle: "Smith v. Acme",
            upcoming: [
                Hearing(at: base + 3600 * 26 * 1000, title: "Smith v. Acme"),
                Hearing(at: base + 3600 * 74 * 1000, title: "Doe Estate"),
            ],
            topAction: "Prep: Smith v. Acme")
    }

    func placeholder(in context: Context) -> CasesEntry {
        CasesEntry(date: Date(), snapshot: sample)
    }

    func getSnapshot(in context: Context, completion: @escaping (CasesEntry) -> Void) {
        // In the widget gallery show sample data; otherwise real.
        let snap = context.isPreview ? sample : CasesSnapshot.load()
        completion(CasesEntry(date: Date(), snapshot: snap))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<CasesEntry>) -> Void) {
        let entry = CasesEntry(date: Date(), snapshot: CasesSnapshot.load())
        // The app pushes updates via WidgetCenter.reloadAllTimelines(),
        // so a distant refresh is just a safety net (countdowns age).
        let next = Calendar.current.date(byAdding: .hour, value: 1, to: Date())
            ?? Date().addingTimeInterval(3600)
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

// MARK: - Colors

private extension Color {
    static let advForest = Color(red: 0x0F/255, green: 0x2D/255, blue: 0x24/255)
    static let advCream = Color(red: 0xFB/255, green: 0xF7/255, blue: 0xE9/255)
    static let advGold = Color(red: 0xD5/255, green: 0xBB/255, blue: 0x7E/255)
}

// MARK: - Home-screen views

/// systemSmall: the headline glance.
struct SmallView: View {
    let s: CasesSnapshot
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .lastTextBaseline, spacing: 8) {
                Text(s.hasData ? "\(s.openCount)" : "—")
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                    .foregroundColor(.advCream)
                Text(s.openCount == 1 ? "OPEN\nCASE" : "OPEN\nCASES")
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(0.8)
                    .foregroundColor(.advGold)
            }
            if s.hasData {
                Text(s.latestTitle.isEmpty ? "No open cases" : s.latestTitle)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.advCream)
                    .lineLimit(1)
                Text(s.nextHearingAt > 0 ? "Next hearing \(relativeWhen(s.nextHearingAt))"
                                         : "No upcoming hearings")
                    .font(.system(size: 11.5))
                    .foregroundColor(.advCream.opacity(0.72))
                    .lineLimit(2)
                if !s.topAction.isEmpty {
                    Text(s.topAction)
                        .font(.system(size: 11))
                        .foregroundColor(.advCream.opacity(0.55))
                        .lineLimit(1)
                }
            } else {
                Text("Open Advottic to sync")
                    .font(.system(size: 12))
                    .foregroundColor(.advCream.opacity(0.72))
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// systemMedium: headline + the next few hearings (the docket).
struct MediumView: View {
    let s: CasesSnapshot
    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text(s.hasData ? "\(s.openCount)" : "—")
                    .font(.system(size: 40, weight: .bold, design: .rounded))
                    .foregroundColor(.advCream)
                Text(s.openCount == 1 ? "OPEN CASE" : "OPEN CASES")
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(0.8)
                    .foregroundColor(.advGold)
                if !s.topAction.isEmpty {
                    Text(s.topAction)
                        .font(.system(size: 10.5))
                        .foregroundColor(.advCream.opacity(0.55))
                        .lineLimit(2)
                        .padding(.top, 4)
                }
                Spacer(minLength: 0)
            }
            .frame(width: 96, alignment: .leading)

            VStack(alignment: .leading, spacing: 6) {
                Text("UPCOMING HEARINGS")
                    .font(.system(size: 9, weight: .semibold))
                    .tracking(1.0)
                    .foregroundColor(.advCream.opacity(0.4))
                if s.upcoming.isEmpty {
                    Text(s.hasData ? "None scheduled" : "Open Advottic to sync")
                        .font(.system(size: 12))
                        .foregroundColor(.advCream.opacity(0.72))
                } else {
                    ForEach(s.upcoming.prefix(3)) { h in
                        HStack(spacing: 8) {
                            Text(relativeWhen(h.at))
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundColor(.advGold)
                                .frame(width: 46, alignment: .leading)
                            Text(h.title)
                                .font(.system(size: 12))
                                .foregroundColor(.advCream)
                                .lineLimit(1)
                        }
                    }
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

// MARK: - Lock-screen accessory views (iOS 16+)

@available(iOSApplicationExtension 16.0, *)
struct AccessoryInlineView: View {
    let s: CasesSnapshot
    var body: some View {
        if s.nextHearingAt > 0 {
            Text("\(s.openCount) open · hearing \(relativeWhen(s.nextHearingAt))")
        } else {
            Text("\(s.openCount) open cases")
        }
    }
}

@available(iOSApplicationExtension 16.0, *)
struct AccessoryCircularView: View {
    let s: CasesSnapshot
    var body: some View {
        VStack(spacing: 0) {
            Text("\(s.openCount)")
                .font(.system(size: 22, weight: .bold, design: .rounded))
            Text("open")
                .font(.system(size: 9))
        }
    }
}

@available(iOSApplicationExtension 16.0, *)
struct AccessoryRectangularView: View {
    let s: CasesSnapshot
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("\(s.openCount) open cases")
                .font(.system(size: 14, weight: .semibold))
            if s.nextHearingAt > 0 {
                Text("Next hearing \(relativeWhen(s.nextHearingAt))")
                    .font(.system(size: 12))
            } else if !s.latestTitle.isEmpty {
                Text(s.latestTitle).font(.system(size: 12)).lineLimit(1)
            }
        }
    }
}

// MARK: - Family router

struct AdvotticWidgetEntryView: View {
    @Environment(\.widgetFamily) private var family
    var entry: CasesEntry

    var body: some View {
        let s = entry.snapshot
        switch family {
        case .systemMedium:
            themed { MediumView(s: s) }
        case .systemSmall:
            themed { SmallView(s: s) }
        default:
            // Lock-screen accessories (iOS 16+). The scene tints these,
            // so no custom background.
            if #available(iOSApplicationExtension 16.0, *) {
                switch family {
                case .accessoryInline: AccessoryInlineView(s: s)
                case .accessoryCircular: AccessoryCircularView(s: s)
                case .accessoryRectangular: AccessoryRectangularView(s: s)
                default: SmallView(s: s)
                }
            } else {
                themed { SmallView(s: s) }
            }
        }
    }

    // Forest background for the home-screen families, with the iOS 17+
    // container-background API where required.
    @ViewBuilder private func themed<V: View>(@ViewBuilder _ content: () -> V) -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            content().containerBackground(Color.advForest, for: .widget)
        } else {
            content().background(Color.advForest)
        }
    }
}

// MARK: - Widget

struct AdvotticWidget: Widget {
    let kind = "AdvotticCasesWidget"

    private var families: [WidgetFamily] {
        var f: [WidgetFamily] = [.systemSmall, .systemMedium]
        if #available(iOSApplicationExtension 16.0, *) {
            f.append(contentsOf: [.accessoryInline, .accessoryCircular, .accessoryRectangular])
        }
        return f
    }

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            AdvotticWidgetEntryView(entry: entry)
                .widgetURL(URL(string: "https://advottic.com/cases"))
        }
        .configurationDisplayName("Open cases")
        .description("Your open cases, next hearing, and recent activity at a glance.")
        .supportedFamilies(families)
    }
}
