import SwiftUI

// Phase 2 glance. Renders the case summary the paired iPhone pushes
// over WCSession (WatchSessionManager), with a standalone-safe
// placeholder until the first sync - conceptually in lockstep with
// the Wear OS app. "Open on iPhone" is the iOS analog of Wear's
// "Open on phone" hand-off; shown only when there is a latest case.
struct ContentView: View {
    @EnvironmentObject private var session: WatchSessionManager

    var body: some View {
        let s = session.summary
        ScrollView {
            VStack(spacing: 6) {
                Text("Advottic")
                    .font(.headline)
                    .multilineTextAlignment(.center)

                if s.hasData {
                    Text(
                        s.openCount == 1
                            ? "1 open case"
                            : "\(s.openCount) open cases"
                    )
                    .font(.body)
                    .multilineTextAlignment(.center)
                    .padding(.top, 2)

                    if !s.latestTitle.isEmpty {
                        Text("Latest: \(s.latestTitle)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }

                    if !s.latestCaseId.isEmpty {
                        Button {
                            session.requestOpenOnPhone()
                        } label: {
                            Text("Open on iPhone")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .padding(.top, 6)
                    }
                } else {
                    Text(
                        "Open Advottic on your iPhone to see case updates here."
                    )
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.top, 2)
                }
            }
            .padding(.horizontal, 8)
        }
    }
}

#Preview {
    ContentView().environmentObject(WatchSessionManager())
}
