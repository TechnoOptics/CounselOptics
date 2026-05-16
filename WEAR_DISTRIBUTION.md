# Advottic Wear OS - Play Console distribution

The watch app is a **standalone Wear OS app** with its own
`applicationId` (`com.advottic.watch`). Modern standalone Wear apps
are **not** embedded in the phone APK: it is a **separate Google Play
listing**, created and managed independently of the phone app
(`com.advottic.app`). It can be installed on a watch with no phone.

The watch reuses the **same upload keystore** as the phone (one
upload key may sign multiple apps), so no new key or secret is
needed: the existing `ANDROID_*` GitHub secrets already work.

---

## 1. Build the signed bundle (done for you, by CI)

Actions tab -> **"Wear OS release build"** -> Run workflow (main).

It produces a signed `wear-release.aab` and uploads it as the
`advottic-watch-aab` artifact on the run's Summary page. Download and
unzip to get the `.aab`.

Version is set in `android/wear/build.gradle`
(`versionCode` / `versionName`). Bump `versionCode` for every new
Play upload (Play rejects a re-used code). It is independent of the
phone app's code.

---

## 2. Create the Play Console listing (you, one time)

This is an account action, so it is yours to do:

1. Play Console -> **Create app**.
   - App name: **Advottic** (or "Advottic for Wear OS").
   - Default language, App, Free.
2. The new app's `applicationId` is bound on first upload to
   `com.advottic.watch` - upload the AAB before anything else so the
   package name locks in correctly.
3. **App content** (left nav) - complete each card:
   - Privacy policy: `https://advottic.com/privacy`
   - Data safety: mirror the phone app's answers. The watch stores
     only a small case-summary glance locally
     (`SummaryStore`/SharedPreferences); it makes no network calls of
     its own (the "Open on phone" / voice-note hand-off runs on the
     phone). No data is collected or shared by the watch itself.
   - Ads: No.
   - Content rating: complete the questionnaire (utility app).
   - Target audience: adults; not directed to children.
   - Government / financial / health: No.
4. **Store listing**:
   - Short + full description (utility companion: open-case glance,
     open-on-phone hand-off, glanceable Tile, wrist voice note).
   - Graphics you must supply (the module intentionally ships **no
     bundled branding binaries** yet - see note below):
     - App icon: 512 x 512 PNG.
     - Feature graphic: 1024 x 500 PNG.
     - At least 2 **Wear OS screenshots** (square or round watch
       frame). Take them from a Wear emulator running the
       `advottic-watch-aab` build.
5. **Wear OS form factor**: in *Dashboard* / *Advanced settings ->
   Form factors*, add **Wear OS** and complete its declaration. The
   app already declares standalone
   (`com.google.android.wearable.standalone = true` and the
   `android.hardware.type.watch` uses-feature in the wear manifest),
   so it qualifies as standalone in the review form.

---

## 3. Internal testing release (you)

1. **Testing -> Internal testing -> Create new release**.
2. Upload `wear-release.aab`.
3. Release name auto-fills from the version; add brief release notes.
4. **Save -> Review release -> Start rollout to Internal testing**.
5. **Testers** tab: reuse the same internal tester list / email list
   used for the phone app, or add the testers' Google accounts. Copy
   the **opt-in URL** and send it to testers; they opt in on that
   page, then install from the Play Store **on the watch** (or via
   the phone's Play Store remote-install to the paired watch).

First review of a brand-new listing can take longer than an update;
internal testing is the fastest track and usually clears quickly.

---

## Note on branding assets

Phase 1-3 deliberately shipped **zero bundled binary assets** (the
launcher uses the built-in Android icon) so the module stays
reviewable in plain text and CI. Before the public listing you will
want a branded watch icon + the Play graphics above. Those are
design assets for you to drop in; the code is ready for them.

## Not done automatically (your call)

- Creating the listing, uploading, and starting rollout are account
  / store-submission actions left to you.
- Promoting beyond Internal testing (Closed/Open/Production) is a
  separate, deliberate decision.
