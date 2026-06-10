# iOS TestFlight: ship v1.0.13 to public beta

This run can only complete on a **macOS machine** with Xcode installed
because Windows cannot build or notarize iOS binaries. Everything below
matches `android` build code 16 / `versionName` 1.0.13 so the two
stores stay in lockstep.

## What ships

The Capacitor wrapper is a remote-URL shell - the binary always loads
`https://advottic.com` in a WebView. So every web surface shipped in
rounds 5-9 (`/templates`, `/tools/*`, `/open-data`, `/people/abel-muchai`,
`/compare/legalzoom`, `/compare/rocket-lawyer`) is **already available to
existing iOS users without an update**. This release is for:

1. Promoting the public TestFlight link so anyone can self-enroll.
2. Updating the "What's New" copy that testers see in TestFlight.
3. Keeping both stores' version codes in lockstep with the Android
   build (Apple + Google both reject re-used version numbers).

## On the Mac, run these commands

```bash
# 1. Pull the latest commit from this branch.
git pull origin main

# 2. Sync Capacitor for iOS.
npx cap sync ios

# 3. Open the iOS project in Xcode.
npx cap open ios
```

## In Xcode

1. Select the **App** target.
2. **General → Identity**:
   - Version: `1.0.13`
   - Build: `16`
3. **Signing & Capabilities**: confirm "Automatically manage signing"
   is on, the team is **Techno Optics LLC**, and the bundle ID is
   `com.advottic.app`.
4. **Product → Archive**.
   - If Archive is greyed out: set the active scheme's destination to
     **Any iOS Device (arm64)** at the top of the Xcode window.
5. When the Archives window opens, click **Distribute App** →
   **App Store Connect** → **Upload**. Use **Automatic** signing.
   The upload takes 2-5 minutes.

## In App Store Connect (after upload)

1. Navigate to **Apps → Advottic → TestFlight**.
2. Wait for the new build (build 16) to finish processing
   (~5-30 min). You will get an email when it is ready.
3. Click the build, then under **Test Information** add this
   "What to Test" copy:

   > **What's new in 1.0.13** (build 16)
   >
   > New consumer surfaces are now live in the app:
   > - Free legal templates library (advottic.com/templates)
   > - Statute of limitations checker (advottic.com/tools/statute-of-limitations)
   > - Court deadline calculator (advottic.com/tools/court-deadline-calculator)
   > - Security deposit deduction checker (advottic.com/tools/security-deposit-deduction-checker)
   > - Founder profile page (advottic.com/people/abel-muchai)
   > - LegalZoom + Rocket Lawyer comparison pages
   >
   > Please tap into each of the above and confirm the page
   > renders cleanly inside the app shell. Report any
   > rendering, scrolling, or biometric-auth issues.

4. **Export Compliance**: should auto-skip because
   `ITSAppUsesNonExemptEncryption=false` is baked into the
   Info.plist (1.0.8 fix).

## Open the public TestFlight link

To make TestFlight publicly self-serve (so anyone with the link can
join, not just internal invite-only):

1. Still in **TestFlight**, click **Public Link** in the left sidebar.
2. If a public link already exists, copy it - that is the URL to
   share. It looks like `https://testflight.apple.com/join/XXXXXXXX`.
3. If no public link exists yet:
   - Click **Enable Public Link**
   - Limit testers (we recommend 5000) - the cap is the upper bound;
     you can change it later
   - Click **Enable**
   - Copy the URL that appears
4. Confirm **Submit For Beta App Review** is initiated for build 16
   (only required the first time a new external group sees a build;
   subsequent builds in the same group skip review). Apple Beta App
   Review takes 24-48 hours.

## Verify after public link is live

```bash
# From any browser, open the public link.
open https://testflight.apple.com/join/XXXXXXXX

# Expect: "Join the Beta" landing page with the Advottic icon
# and the "What to Test" copy from above.
```

If the page shows "This beta is full" or "This beta isn't accepting
new testers", check the tester cap in App Store Connect.

## Common failures

| Symptom | Fix |
| --- | --- |
| Xcode "Archive" is greyed out | Set destination to "Any iOS Device (arm64)" |
| App Store Connect rejects build | Build number was re-used. Bump build to 17. |
| TestFlight shows "Missing Compliance" | Already fixed in 1.0.8. If it returns, re-add `ITSAppUsesNonExemptEncryption=false` to Info.plist. |
| Beta App Review takes longer than 48h | Open https://developer.apple.com/contact/ → "Beta App Review" expedite request |
| Public link 404s | Wait 5-10 min after enabling, then retry. Public link CDN caches aggressively. |

## After the Mac steps are done

Reply to the team with the public TestFlight URL. Update the
`/install` landing page on advottic.com to point to it.

---

Reference: see `app/build.gradle` v1.0.13 comment for the matching
Android version code.
