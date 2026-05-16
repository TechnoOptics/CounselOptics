import SwiftUI

// Advottic Apple Watch - Phase 2 (standalone watchOS app + paired
// data bridge).
//
// Single-target SwiftUI watchOS app. Owns one WatchSessionManager
// (WCSession receiver) for the app's lifetime and injects it into the
// view tree. The phone half (an iOS-side WCSession sender + the
// embedded-companion wiring) lands as the next verified increment;
// until then the watch shows the standalone-safe placeholder, exactly
// like the Wear OS app before its phone bridge.
@main
struct AdvotticWatchApp: App {
    @StateObject private var session = WatchSessionManager()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(session)
        }
    }
}
