import SwiftUI

// Advottic Apple Watch - Phase 1 (standalone watchOS app).
//
// Single-target SwiftUI watchOS app. Phase 1 shows a standalone-safe
// glanceable placeholder so the watch is coherent even with no paired
// data yet. Phase 2 adds a WatchConnectivity receiver fed by a
// phone-side native bridge (the iOS equivalent of the Android
// AdvotticWatch Capacitor plugin) carrying open-case count + latest
// update + an "open on phone" hand-off.
@main
struct AdvotticWatchApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
