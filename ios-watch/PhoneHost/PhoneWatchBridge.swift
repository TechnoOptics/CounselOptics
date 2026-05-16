import Foundation
import WatchConnectivity

// Apple Watch Phase 2 - iOS (phone) side of the bridge.
//
// The iOS analog of the Android AdvotticWatchPlugin: it pushes the
// case summary the web app already computes (open-case count, latest
// title, latest case id) to the paired watch, and handles the
// watch's "Open on iPhone" request.
//
// Transport mirrors the watch side (WatchSessionManager):
//   - updateApplicationContext for the summary: coalesced, replays
//     the LATEST state to the watch even if it was asleep - the
//     "glance" semantics, same as Android's SummaryStore push.
//   - incoming sendMessage / transferUserInfo carrying ["open": id]
//     is the watch asking the phone to open advottic.com/cases/<id>.
//
// Capacitor integration (the deferred Mac-in-the-loop step, NOT done
// here so this reference stays dependency-free): a thin
// `@objc(AdvotticWatchPlugin) class AdvotticWatchPlugin: CAPPlugin`
// whose `@objc func sync(_ call: CAPPluginCall)` reads openCount /
// latestTitle / latestCaseId and calls `PhoneWatchBridge.shared
// .pushSummary(...)` - the exact shape components/WatchSync.tsx
// already calls on Android. `onOpenCase` then routes the id into the
// WebView (load https://advottic.com/cases/<id>) so the hand-off
// lands in the already-signed-in session, exactly like Wear 3a.
//
// Compiles under watchos-companion-build.yml embedded in the host;
// runtime pairing is exercised on device, the same bar as Android.

final class PhoneWatchBridge: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = PhoneWatchBridge()

    /// Set by the host/Capacitor layer: invoked with the case id the
    /// watch wants opened on the phone. The real app navigates the
    /// WebView to advottic.com/cases/<id>.
    var onOpenCase: ((String) -> Void)?

    @Published private(set) var lastPushedSummary: [String: Any] = [:]

    private override init() {
        super.init()
        activate()
    }

    func activate() {
        guard WCSession.isSupported() else { return }
        let s = WCSession.default
        s.delegate = self
        s.activate()
    }

    // MARK: - Phone -> watch

    /// Push the latest glance. Safe to call often; WatchConnectivity
    /// coalesces application-context updates.
    func pushSummary(
        openCount: Int,
        latestTitle: String,
        latestCaseId: String
    ) {
        guard WCSession.isSupported() else { return }
        let ctx: [String: Any] = [
            "openCount": openCount,
            "latestTitle": latestTitle,
            "latestCaseId": latestCaseId,
        ]
        lastPushedSummary = ctx
        // updateApplicationContext throws only if the session is not
        // activated yet; a best-effort glance must never raise.
        try? WCSession.default.updateApplicationContext(ctx)
    }

    // MARK: - Watch -> phone ("Open on iPhone")

    private func handleOpen(_ payload: [String: Any]) {
        guard let id = payload["open"] as? String, !id.isEmpty else {
            return
        }
        DispatchQueue.main.async { [weak self] in
            self?.onOpenCase?(id)
        }
    }

    // MARK: - WCSessionDelegate

    func session(
        _ session: WCSession,
        activationDidCompleteWith state: WCSessionActivationState,
        error: Error?
    ) {}

    // iOS-only delegate methods: a phone can pair with multiple
    // watches, so the session can go inactive / deactivate and must
    // be re-activated for the next watch.
    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }

    func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any]
    ) {
        handleOpen(message)
    }

    func session(
        _ session: WCSession,
        didReceiveUserInfo userInfo: [String: Any]
    ) {
        handleOpen(userInfo)
    }
}
