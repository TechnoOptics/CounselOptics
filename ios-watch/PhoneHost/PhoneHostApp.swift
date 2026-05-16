import SwiftUI

// Minimal iOS host for the embedded-companion reference build. Its
// only job is to give PhoneWatchBridge an app lifecycle to live in
// and to embed the watch app, so watchos-companion-build.yml proves
// both sides of the WCSession bridge + the pairing compile. The real
// app is the Capacitor shell; the bridge plugs into it as described
// in PhoneWatchBridge.swift.
@main
struct PhoneHostApp: App {
    @StateObject private var bridge = PhoneWatchBridge.shared

    init() {
        // In the real app the WebView supplies the case id -> open
        // advottic.com/cases/<id>. Here we just prove the hook wires.
        PhoneWatchBridge.shared.onOpenCase = { id in
            print("Open on iPhone requested for case \(id)")
        }
    }

    var body: some Scene {
        WindowGroup {
            VStack(spacing: 8) {
                Text("Advottic")
                    .font(.title2.bold())
                Text("Watch bridge host (reference build)")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .padding()
        }
    }
}
