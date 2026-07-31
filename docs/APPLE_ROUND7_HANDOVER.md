# Apple round 7: what I did overnight, and the decision waiting for you

Written 2026-07-31, early hours. Submitted while you were asleep, under the
authorization you gave. Everything below is what actually happened, including
what I got wrong and what I could not verify.

## Status right now

**Version 1.0, build 1.0.16 (22): WAITING FOR REVIEW.** Verified two ways, in
the App Store Connect UI and independently through the API
(`appStoreState = WAITING_FOR_REVIEW`). Submission `864667fd`, resubmitted
after a Resolution Center reply. Message count went 11 to 12.

No new binary was produced. The app is a remote-URL shell, so every code
change below reached build 22 the moment Vercel deployed.

## What Apple actually said on 2026-07-29

Two issues, reviewed on iPhone 17 Pro Max and iPad Air 11-inch (M3), iOS 26.6.

**2.1(a):** "An error occurred when signing in with Apple."

**3.1.1:** "The app accesses digital content purchased outside the app, such as
plans, but that content isn't available to purchase using In-App Purchase."

## The finding that matters most

Your own App Review Notes contained this sentence:

> "Paid entitlements purchased on our service unlock automatically for the same
> account on iOS."

That is the violation, stated by us, in writing, to the reviewer. Apple's
rejection is close to a paraphrase of it. The notes also claimed the
"multiplatform/reader model, Guideline 3.1.3", and still told the reviewer to
tap "Start Standard" to see a StoreKit sheet that no longer exists, because IAP
had been removed two rounds earlier. Layers of stale text from six rounds,
contradicting both each other and the binary.

The notes are now rewritten from scratch.

## Where I was wrong

I told you the likely lane was 3.1.3(d) "free stand-alone apps". Research
disproved it:

- The clause is **3.1.3(f)**, not (d), and it is a **closed list**. Apple
  changed "e.g." to "i.e. (VoIP, Cloud Storage, Email Services, Web Hosting)"
  in June 2025 without noting it in their changelog. Legal software is not on
  it.
- **3.1.3(a) Reader** is also closed: magazines, newspapers, books, audio,
  music, video. Not us. The code and notes were leaning on this.
- The **US link-out ruling legalised steering, not access.** Apple's May 2025
  post was about "buttons, external links, and other calls to action". The
  first sentence of 3.1.1 was never amended. So round five's "subscribe at
  advottic.com" links made the steering lawful while leaving the IAP obligation
  intact, and forfeited the "no calls to action" safe harbour at the same time.
  Worst of both worlds.

I also sent the sign-in agent chasing an expired Apple client secret. It was
not that, and the agent disproved it with evidence rather than agreeing with me.

## The constraint you now have to decide

The only lane left open is **3.1.3(c) Enterprise Services**, which ends:

> "Consumer, single user, or family sales must use in-app purchase."

`lib/entitlements.ts` sells a consumer ladder (`PERSONAL_STARTER / PLUS8 /
PRO15 / ULTRA`) beside the firm ladder. **No single binary can unlock both
web-bought ladders without IAP.** That sentence is the whole six-round story.

Two paths, and this is a business decision, not a technical one:

**A. iOS becomes an organization-only client.** Individual plans are not
accessible in the app. Cheapest technically, but it removes the consumer
product from iPhone, and consumer is a large part of Advottic.

**B. Ship IAP for the individual tiers.** Keeps the consumer product on iOS.
Costs a new binary, StoreKit products, Apple's commission, and reintroduces the
RevenueCat native plugin that froze the WebView thread (the bug you deliberately
deleted in 4a2297b).

I did not choose for you. In the Resolution Center reply I described the model
honestly and asked Apple directly which they would accept, and requested an App
Review Appointment. Apple's own message offered both. That is the fastest route
to a definitive answer instead of a seventh guess.

## What shipped

| Commit | What |
|---|---|
| `94ef14f` | Sign in with Apple: bridge page for the form-POST return |
| `21cb678` | iOS purchase-silence across ~40 surfaces, layered gating |
| `23e33eb` | Em dash sweep, 30 visible placeholders and ~870 comments |

Plus earlier in the session: `bf30b26`, `87351d7`, `4c13375`, `d89f5c8`,
`c0efbeb` (Techottic UI port), `f0edf95`, `e08398e` (portal status bugs).

`npx tsc --noEmit` and `npm run build` pass on all of it.

### Sign in with Apple

Apple authentication and Supabase both **succeeded**. Two `auth.flow_state`
rows from the review session have `auth_code_issued_at` set, meaning Supabase
had already minted its PKCE code, but neither was ever redeemed. The reviewer's
user exists with an Apple identity attached and **zero sessions**. Apple is the
only provider returning over a cross-site form POST (forced by the name and
email scopes); the hop out of `SFSafariViewController` back into
`com.advottic.app://` is what failed. Google and Microsoft use plain GET and
were unaffected.

`/auth/callback?native=1` now returns an https bridge page with a tappable
fallback, plus a watchdog so a failed attempt stops spinning.

### Purchase silence

Removed the five "subscribe at advottic.com" link-outs. Gated roughly 40 other
surfaces the audit found, most never gated at all: the counsel invoice list was
rendering **raw live Stripe payment URLs**; `/gift` led with "Buy Advottic for
someone you care about"; nine `/compare/[slug]` pages shipped full pricing
cards.

The subtlest one: `ExternalLink` routes through `@capacitor/browser`, which is
`SFSafariViewController`, an **in-app** browser. Apple's carve-out says "the
default browser". A Stripe checkout completing inside the app process is 3.1.1
regardless of storefront, and there is no External Purchase entitlement in
`App.entitlements`.

Detection is now four layers deep because the UA check **fails open**, and a
compliance control that fails open is backwards.

## What I could NOT verify, and what I need from you

**1. Sign in with Apple is unverified on a real device.** This is the important
one. It needs a physical unlocked iPhone (mirroring will not present the auth
sheet) running the TestFlight build. Complete an Apple sign-in, then confirm
`sessions > 0` for the new user. Query is in §R1 of
`docs/APPLE_SIGNIN_DIAGNOSIS.md`. If it still stalls, §R2 is the native-sheet
path. Because the app is a remote-URL shell, a fix can land mid-review.

**2. The Techottic UI port was never visually checked.** Compiles only. One
change to eyeball: on the Hub home, "Needs your attention" and "Coming up"
moved from an 18px display serif to uppercase micro-labels.

**3. advottic.com still markets consumer plans prominently.** The precedent
research found reviewers weigh the website heavily, and in the one documented
case of this exact rejection the reviewer's real objection was the website, not
the binary. This is the main reason my confidence is moderate rather than high.

**4. Apple attached a screenshot** (`Screenshot-0729-140009.png`) to the
rejection. I did not open it. Worth a look, it may show precisely which screen
triggered 3.1.1.

**5. RevenueCat is still linked into the signed binary**
(`ios/App/CapApp-SPM/Package.swift`). Unused, but it contradicts "no IAP" and
needs a new build to remove.

## What I deliberately did not do

- **Did not gate consumer entitlements on iOS**, though I said earlier I would.
  The implementation runs through `lib/entitlements.ts`, the money path, and I
  was not willing to change how paying customers resolve entitlements
  unattended and unverifiable. Getting it wrong degrades real web subscribers,
  which is worse than another rejection. It is now part of decision A/B above.
- **Did not touch marketing positioning.** Yours.
- **Did not restore IAP.** Needs a binary and reverses your deliberate call.
- **Did not claim organization-only status to Apple**, because it is not true
  today and the notes must match the binary. That mismatch is a large part of
  why round six failed.
