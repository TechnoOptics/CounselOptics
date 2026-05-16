# Advottic Apple Watch - build it on a Mac

This is a **standalone watchOS app**, separate from the iOS app
(which is a Capacitor webview a watch can't run, and whose Xcode
project is regenerated on every CI build). You build and sign this
on a Mac with Xcode. Phase 1 is a glanceable placeholder; the
phone -> watch live data bridge is a later phase (see "Roadmap").

Honest note: this was authored without a Mac and is **not CI
verified** (unlike the rest of the app). It is intentionally tiny
and standard. If Xcode objects to anything, use the Manual path
below - it cannot go wrong because Xcode itself generates the
project shell.

---

## What you need on the Mac

- Xcode 16 or newer (the same Mac you use for the iOS TestFlight
  builds is fine).
- An Apple ID added in Xcode that is a member of the **Techno
  Optics LLC** team (Team ID `FNU92FR9C9`) - the same team the
  iPhone app uses. Automatic signing will handle provisioning.
- Bundle identifier is `com.advottic.watch` (distinct from the
  iPhone app's `com.advottic.app`).

---

## Path A - XcodeGen (recommended, one command, deterministic)

```bash
brew install xcodegen          # once
cd watchos/AdvotticWatch
xcodegen generate              # creates AdvotticWatch.xcodeproj
open AdvotticWatch.xcodeproj
```

In Xcode:
1. Pick the **AdvotticWatch** scheme and a watch destination
   (an "Apple Watch Series ... (watchOS Simulator)" needs no
   device, or a real paired Apple Watch).
2. Target ▸ Signing & Capabilities: confirm Team = Techno Optics
   LLC. If it shows a team error, just select the team from the
   dropdown (signing is set to Automatic).
3. Cmd+R to build and run. You should see the "Advottic / Open
   Advottic on your iPhone..." placeholder on the watch.

## Path B - Manual (no XcodeGen, cannot fail to open)

1. Xcode ▸ File ▸ New ▸ Project ▸ **watchOS** ▸ **App**.
2. Product Name: `AdvotticWatch`; Team: Techno Optics LLC;
   Bundle Identifier: `com.advottic.watch`; Interface: SwiftUI;
   uncheck "Include Tests". Save it anywhere (e.g. a Desktop
   folder - it does not need to live in this repo).
3. In the new project, delete the template `ContentView.swift`
   and the `...App.swift` file Xcode generated.
4. Drag these files from `watchos/AdvotticWatch/Sources/` into the
   project (check "Copy items if needed"):
   - `AdvotticWatchApp.swift`
   - `ContentView.swift`
5. Cmd+R. Same placeholder appears.

(Path B's own generated Info.plist is fine; the Info.plist in
`Sources/` is only needed by Path A.)

---

## Distribution (later, when you want testers on it)

A standalone watch app is its **own App Store Connect app record /
TestFlight track** - same pattern as the iPhone app's internal
testing, just a separate listing. Set that up only when Phase 2
(real data) is in.

## Roadmap (parallels the Android Wear app)

- **Phase 1 (this):** standalone glanceable placeholder.
- **Phase 2:** a native iOS bridge (the iOS counterpart of the
  Android `AdvotticWatch` Capacitor plugin) pushes open-case count
  + latest update + an "open on iPhone" hand-off to the watch via
  WatchConnectivity; the watch renders it + a complication.
- **Phase 3:** quick voice note from the watch, saved through the
  existing API on the phone.

Phase 2+ is the harder part: the iPhone app is a Capacitor webview,
so feeding the watch live data needs native code added to the iOS
shell - and that shell is regenerated every CI build, so it has to
be injected by the iOS workflow (the same technique already used
for the entitlements / AppDelegate patches). That is a real chunk
of work; Phase 1 deliberately stands alone so the watch app is
useful and buildable today.
