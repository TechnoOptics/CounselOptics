# Advottic - store listing copy (June 2026 refresh)

Tagline direction: **Your legal corner** (replaces "Build your case").
No em-dashes anywhere (house style).

## Google Play

**App name** (<=30): `Advottic - Your legal corner`

**Short description** (<=80):
`Your calm corner for any legal matter: tools, AI help, and one-press safety.`

**Full description** (<=4000):
```
Advottic is your calm corner for anything legal. Whether you have a hearing tomorrow, you are trying to understand a letter you just got, or you simply want to feel safer, Advottic helps you stay organized, know your rights, and protect yourself - on your own or alongside an attorney.

ORGANIZE ANY LEGAL MATTER
- Gather screenshots, photos, dates, and documents on one clean timeline
- Exhibits are auto-numbered and dates are pulled straight from your files
- Export a court-ready PDF packet you can hand to a judge or a lawyer in minutes

MEET BELLA, YOUR AI ASSISTANT
- Bella reads your documents and explains them in plain English
- Ask questions about your situation and get clear, calm answers
- Get risk and bias call-outs and a readiness score before you file

SAFE ALERT (SAFE WITNESS)
- Feel unsafe? Press and hold to start a geo-tagged recording
- After a short countdown you can cancel, Advottic alerts the contacts you chose with your live location on a map
- Live tracking keeps updating your location every 30 seconds
- One tap to call 911, the nearest hospital, or police - always your choice
- A tamper-evident evidence hash keeps your recording trustworthy, even if your phone is taken

FREE 50-STATE LEGAL TOOLS
- Statute-of-limitations checker: how long you have to sue, in every state
- Court-deadline calculator
- Security-deposit deduction checker
- Free templates and plain-English legal guides

ON YOUR WRIST
- A companion Wear OS watch app puts your cases, voice notes, and Safe Alert one tap away

PRIVATE BY DESIGN
- Your data is encrypted and yours; you decide what is shared and with whom
- Advottic is a self-help tool, not a law firm, and does not give legal advice

Whether it is just you, your evidence, and a date on the calendar, or you are working hand in hand with your attorney, Advottic keeps everything calm, organized, and ready for the moment it matters.
```

## Apple App Store (apply AFTER current review clears)

**Name** (<=30): `Advottic` (unchanged)

**Subtitle** (<=30): `Legal help & safety, made calm`

**Promotional text** (<=170):
`Now with Safe Alert: one-press personal safety with live location, plus 50-state legal tools and Bella, your in-app AI assistant. Your calm corner for anything legal.`

**Description** (<=4000): same as the Play full description above.

## Apple App Review notes - Guideline 4.2 (Minimum Functionality)

Append this to the App Review Information "Notes" in App Store Connect
(editable while the version is Waiting for Review). It points the
reviewer at the native, device-only capabilities so the app reads as
more than a website wrapper. These are gated to the app in code
(lib/platform.ts + components/AppOnly + AppExclusiveFeatures); on the
web they show a "get the app" prompt instead.

```
Advottic is more than our website - several features run only in the app, on the device's own hardware. To see them after signing in (email appreview@advottic.com, code 478213), open Profile:

- Face ID / Touch ID sign-in (Settings > Biometric sign-in) - native biometric unlock, not available in a browser.
- One-tap Safe Alert with live GPS (Action Center > Safe Witness, or the watch) - press-and-hold sends a trusted contact your location and keeps streaming it with continuous background GPS, which a website cannot do.
- Instant push notifications for hearing reminders, deadlines, and Safe Witness updates.
- Camera exhibit capture - photograph documents straight into a case, auto-dated from the photo.
- On-device voice notes & dictation (speech recognition).
- Wear OS companion (Android) - fire Safe Alert and capture voice notes from the wrist.

The Profile screen's "The Advottic app" section lists these and confirms they are active on the device.
```

## Screenshots

New set in `store-assets/android-screenshots/` (1080x1920) and
`store-assets/ios-screenshots/` (1284x2778):
- 01-home, 02-sol-checker, 03-templates, 04-deadline-calculator,
  05-deposit-checker, 06-guides
- 07-safe-alert  (NEW: the Safe Witness "Activate / call 911" screen)
