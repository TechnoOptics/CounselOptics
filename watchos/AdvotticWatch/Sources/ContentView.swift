import SwiftUI

// Phase-1 glance. Mirrors the Wear OS Phase-1 placeholder so the two
// watch platforms stay conceptually in lockstep. Phase 2 replaces
// the body with the synced payload (open-case count, latest update)
// plus a "Open on iPhone" hand-off button.
struct ContentView: View {
    var body: some View {
        VStack(spacing: 6) {
            Text("Advottic")
                .font(.headline)
                .multilineTextAlignment(.center)
            Text("Open Advottic on your iPhone to see case updates here.")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 8)
    }
}

#Preview {
    ContentView()
}
