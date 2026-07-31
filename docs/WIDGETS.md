# Home-screen widgets (iOS + Android)

The Advottic apps ship a home-screen widget that shows the signed-in
user's **open cases**, their **next hearing** (as a countdown), and the
**top recent action** on a case.

iOS families: `systemSmall` (headline glance), `systemMedium` (headline
+ the next 3 upcoming hearings), and the iOS 16+ **lock-screen
accessories** (`accessoryInline`, `accessoryCircular`,
`accessoryRectangular`). Android: a resizable home-screen widget
(2×1 and up).

## How it works

The apps are remote-URL Capacitor WebViews, so the case data lives in
JS and the native widget process can't share the WebView's auth session.
Instead the web app pushes a tiny glance snapshot into shared native
storage, and each platform's widget renders that snapshot:

```
app/cases/page.tsx  ──(props)──▶  <WidgetSync/>  ──Capacitor──▶  WidgetBridge (native)
                                                                     │
                        Android: SharedPreferences ("advottic_widget")│  iOS: App Group UserDefaults
                                                                     ▼
                        CasesWidgetProvider (RemoteViews)   AdvotticWidget (WidgetKit / SwiftUI)
```

- The snapshot is the **same** data already computed for the Wear OS
  glance (open count, latest case, upcoming hearings, recent actions),
  so there is no new query or endpoint.
- `WidgetSync` is a no-op on the web and when the `WidgetBridge` plugin
  isn't present, so it never affects the browser experience.
- After the app writes the snapshot it refreshes the widget
  (`AppWidgetManager` on Android, `WidgetCenter.reloadAllTimelines()` on
  iOS), so the widget updates whenever the user opens the cases list.

## Android: fully wired, no manual steps

Everything is in the repo and picked up by `npx cap sync android` + a
normal build:

- `WidgetBridgePlugin.java`: writes the snapshot to SharedPreferences,
  registered in `MainActivity.java`.
- `CasesWidgetProvider.java`: renders `res/layout/widget_cases.xml`.
- `res/xml/widget_cases_info.xml` + the `<receiver>` in
  `AndroidManifest.xml`.

Build the app, then long-press the home screen → **Widgets** → Advottic
→ "Open cases". Open the app's cases list once so the first snapshot
syncs.

## iOS: one-time Xcode + Apple Developer setup

WidgetKit **requires an app-extension target and an App Group**, which
can only be created in Xcode / the Apple Developer portal. All the
source is already in `ios/App/`; wire it up once:

1. **Register the App Group** (developer.apple.com → Identifiers → App
   Groups): create `group.com.advottic.app`. Add it to the app's App ID.

2. **Main app target → Signing & Capabilities → + App Groups**, check
   `group.com.advottic.app`. Xcode points the target's *Code Signing
   Entitlements* at `App/App.entitlements` (already in the repo).

3. **Add the ObjC bridge**: the app target needs a bridging header so
   `WidgetBridgePlugin.m` compiles. If Xcode prompts to create one when
   you add `WidgetBridgePlugin.swift/.m`, accept it. (`WidgetBridgePlugin`
   registers via the standard Capacitor `CAP_PLUGIN` macro.)

4. **Add the Widget Extension target**: File → New → Target →
   **Widget Extension**, name it `AdvotticWidget` (bundle id
   `com.advottic.app.AdvotticWidget`), uncheck "Include Configuration
   Intent". Then:
   - Delete the stub files Xcode generates and **add the existing files**
     from `ios/App/AdvotticWidget/` (`AdvotticWidget.swift`,
     `AdvotticWidgetBundle.swift`, `Info.plist`,
     `AdvotticWidget.entitlements`) to the new target.
   - Set the extension's *Info.plist File* build setting to that
     `Info.plist`, and *Code Signing Entitlements* to
     `AdvotticWidget.entitlements`.
   - **Extension target → Signing & Capabilities → + App Groups**, check
     the same `group.com.advottic.app`.
   - Set the extension's deployment target to iOS 14.0 (matches the app).

5. Build & run. Add the widget from the home screen (long-press →
   **+** → Advottic → "Open cases"). Open the app's cases list once to
   push the first snapshot.

### Keeping keys in sync

The App Group id and the `adv_*` UserDefaults keys are duplicated in two
Swift files on purpose (the app target and the extension target don't
share code):

- `ios/App/App/WidgetBridgePlugin.swift` (writer)
- `ios/App/AdvotticWidget/AdvotticWidget.swift` (reader)

If you add a field, update both.

## Data source

`components/WidgetSync.tsx` receives its props from `app/cases/page.tsx`
(the same block that feeds `WatchSync`). To widen what the widget shows,
extend that computation and add the field to `WidgetSync`, the two
native bridges, and the two renderers.
