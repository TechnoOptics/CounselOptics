import Foundation
import WatchConnectivity

// Apple Watch Phase 2 - watch side of the phone->watch bridge.
//
// The iOS analog of the Android Wear Data Layer path: the paired
// iPhone pushes a tiny case summary (open-case count + latest title +
// latest case id) via WCSession. We prefer `applicationContext`
// because it is coalesced and replays the LATEST state to the watch
// even if the watch app was not running - exactly the "glance"
// semantics SummaryStore gives us on Android. `didReceiveMessage` is
// also handled for a live foreground push.
//
// Standalone-safe: with no paired phone / before first sync, the
// published summary stays `hasData == false` and the UI shows the
// placeholder, so the watch is never blank or crashy. Persisted to
// UserDefaults so a relaunch shows the last glance instantly
// (mirrors Android SummaryStore / SharedPreferences).
//
// "Open on iPhone" is a fire-and-forget WCSession message; the
// iOS-side bridge opens advottic.com/cases/<id> in the already
// signed-in app. Best-effort: unreachable phone just no-ops.
//
// Compiles under watchos-build.yml (WatchConnectivity needs no
// pairing to build); runtime pairing is exercised on device, the
// same bar as the Android listener service.

struct CaseSummary: Equatable {
    var openCount: Int
    var latestTitle: String
    var latestCaseId: String
    var hasData: Bool

    static let empty = CaseSummary(
        openCount: 0, latestTitle: "", latestCaseId: "", hasData: false
    )
}

final class WatchSessionManager: NSObject, ObservableObject, WCSessionDelegate {
    @Published private(set) var summary: CaseSummary = .empty

    private let defaults = UserDefaults.standard
    private let kOpen = "openCount"
    private let kTitle = "latestTitle"
    private let kId = "latestCaseId"
    private let kHas = "hasData"

    override init() {
        super.init()
        loadPersisted()
        if WCSession.isSupported() {
            let s = WCSession.default
            s.delegate = self
            s.activate()
        }
    }

    // MARK: - Persistence (last glance survives relaunch)

    private func loadPersisted() {
        guard defaults.bool(forKey: kHas) else { return }
        summary = CaseSummary(
            openCount: defaults.integer(forKey: kOpen),
            latestTitle: defaults.string(forKey: kTitle) ?? "",
            latestCaseId: defaults.string(forKey: kId) ?? "",
            hasData: true
        )
    }

    private func persist(_ s: CaseSummary) {
        defaults.set(s.openCount, forKey: kOpen)
        defaults.set(s.latestTitle, forKey: kTitle)
        defaults.set(s.latestCaseId, forKey: kId)
        defaults.set(true, forKey: kHas)
    }

    private func apply(_ payload: [String: Any]) {
        // Ignore a payload that carries none of our keys, so an
        // unrelated message can't blank the glance.
        guard payload[kOpen] != nil || payload[kTitle] != nil
            || payload[kId] != nil
        else { return }
        let next = CaseSummary(
            openCount: payload[kOpen] as? Int ?? summary.openCount,
            latestTitle: payload[kTitle] as? String ?? summary.latestTitle,
            latestCaseId: payload[kId] as? String ?? summary.latestCaseId,
            hasData: true
        )
        DispatchQueue.main.async {
            self.summary = next
            self.persist(next)
        }
    }

    // MARK: - Open on iPhone (fire-and-forget)

    func requestOpenOnPhone() {
        guard !summary.latestCaseId.isEmpty, WCSession.isSupported()
        else { return }
        let s = WCSession.default
        let msg = ["open": summary.latestCaseId]
        if s.isReachable {
            s.sendMessage(msg, replyHandler: nil, errorHandler: nil)
        } else {
            // Queue it so the phone opens it on next wake.
            s.transferUserInfo(msg)
        }
    }

    // MARK: - WCSessionDelegate

    func session(
        _ session: WCSession,
        activationDidCompleteWith state: WCSessionActivationState,
        error: Error?
    ) {
        // On activation, pick up the last application context the
        // phone set even if it was sent while the watch was asleep.
        if !session.receivedApplicationContext.isEmpty {
            apply(session.receivedApplicationContext)
        }
    }

    func session(
        _ session: WCSession,
        didReceiveApplicationContext applicationContext: [String: Any]
    ) {
        apply(applicationContext)
    }

    func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any]
    ) {
        apply(message)
    }
}
