# Moving the project to a new machine (Windows or Mac)

This repo is a remote-URL Capacitor app: the web app deploys to advottic.com
via Vercel, and the iOS/Android shells load that live site. The code lives in
GitHub (`TechnoOptics/CounselOptics`), so a fresh `git clone` brings almost
everything. The only things that do NOT travel with git are listed below and
must be hand-carried once.

## What git does NOT track (carry these by hand)

These are gitignored (secrets, signing keys) or were left untracked. A clone
will not include them:

| File / folder | Why it matters |
| --- | --- |
| `.env.local` | Runtime secrets (Supabase, Stripe, RevenueCat, Maps, etc.). Without it `npm run dev` / `build` fail. Template: `.env.local.example` (tracked). |
| `android/app/advottic-release.keystore` | **Irreplaceable.** The Play Store upload-signing key. Lose it and you can never publish another Android update. Back it up separately. |
| `android/keystore.properties` | Keystore passwords + alias for release signing. |
| `scripts/android-screenshots.mjs`, `scripts/ipad-screenshots.mjs`, `scripts/safe-screenshots.mjs`, `scripts/upload-apk-tus.mjs` | Untracked dev/store tooling. |
| `store-assets/` | Generated App Store / Play screenshots (regenerable via the screenshot scripts, but handy to keep). |
| `.local/` | Local notes (e.g. `launch-copy.md`). |

There is no `GoogleService-Info.plist` / `google-services.json` in this project,
so nothing Firebase-related to move.

### One-shot bundle of the above

From the OLD machine, package everything git skips into one file:

```bash
tar -czf ~/advottic-migrate.tgz \
  .env.local \
  android/app/advottic-release.keystore \
  android/keystore.properties \
  scripts/android-screenshots.mjs scripts/ipad-screenshots.mjs \
  scripts/safe-screenshots.mjs scripts/upload-apk-tus.mjs \
  store-assets .local
```

Transfer it over a trusted channel (AirDrop / USB, not a public cloud link)
because it contains secrets + the signing key. Delete it from both machines
once restored.

## Set up the new machine

### 1. Toolchain (Mac)

```bash
# Install Xcode from the App Store first (gives git + the iOS build tools).
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node@22 gh watchman          # Node 22 matches CI (.github/workflows)
brew link --overwrite node@22
# Optional, only for local Android builds:
brew install --cask android-studio temurin@17
```

### 2. Clone

```bash
gh auth login
gh repo clone TechnoOptics/CounselOptics
cd CounselOptics
```

### 3. Restore the non-git files

```bash
tar xzf ~/advottic-migrate.tgz -C .
```

### 4. Install + verify

```bash
npm install
npx tsc --noEmit        # should exit clean
npm run dev             # http://localhost:3000
npm run build           # confirm a production build
```

If env vars do not load, make sure your shell profile is not exporting an empty
`ANTHROPIC_API_KEY` (an empty value blocks Next.js from loading `.env.local`).

### 5. Native builds (now possible locally on a Mac)

```bash
# iOS - generated fresh, never committed:
npx cap add ios && npx cap sync ios && npx cap open ios   # build/run in Xcode

# Android - uses the restored keystore + keystore.properties:
cd android && ./gradlew assembleRelease
```

The GitHub Actions CI for both platforms keeps working unchanged from any
machine; all its secrets (App Store Connect `.p8`, Android keystore base64,
etc.) live in GitHub repo secrets, not on the dev machine.

## Do not forget

- **Back up `android/app/advottic-release.keystore`** to a password manager or
  encrypted store, separate from the laptop. It is the one file you cannot
  regenerate.
- `.env.local` and `*.keystore` are already gitignored. Never commit them.
- The default branch is `main`; it has the full current state.
