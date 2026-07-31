# Play Store Data Safety form: Advottic v1.0

The Data Safety form lives in Play Console under
**App content -> Data safety**. Google rejects apps with mismatched answers,
so every "yes" below has a code path that backs it up. Cross-reference with
`/privacy` (the public privacy policy) before submitting - both pages must
agree.

---

## Section 1: Data collection and security

### Does your app collect or share any of the required user data types?

**Yes** - the app collects user data.

### Is all of the user data collected by your app encrypted in transit?

**Yes** - HTTPS/TLS for every request. Vercel + Supabase enforce this.

### Do you provide a way for users to request that their data is deleted?

**Yes** - in-app: Profile -> "Delete my account" -> typed confirmation -> POST
`/api/account/delete`, which removes the auth.users row, all profile data,
all cases, all exhibits, all uploaded files in Storage. Users can also
download a JSON export of all their data via Profile -> "Download my data".

(Stripe billing history is retained as required by US tax law - this is
disclosed in the in-app delete confirmation and on the privacy page.)

---

## Section 2: Data types collected

For each row: collected? shared? processed ephemerally? optional? required?

### Personal info

| Type | Collected | Shared | Reason | Optional |
|---|---|---|---|---|
| Name | Yes | No | Account management, app functionality | Yes |
| Email address | Yes | No | Account management, app functionality | No |
| User IDs | Yes | No | Account management | No |
| Address | No | - | - | - |
| Phone number | No | - | - | - |
| Race / ethnicity, sexual orientation, religion, etc. | No | - | - | - |
| Other personal info | Yes - profile fields (display name, role, organization), all optional | No | App functionality | Yes |

### Financial info

| Type | Collected | Shared | Reason | Optional |
|---|---|---|---|---|
| Payment info | No - Stripe handles all card data; we never see it | - | - | - |
| Purchase history | Yes - subscription state mirrored from Stripe | No | App functionality (gating paid features) | No (only if user purchases) |
| Other financial info | No | - | - | - |

*Note: Stripe is the payment processor. Stripe collects card numbers / CVV /
billing addresses inside their own checkout iframe. Advottic never receives
that data; we only see subscription status, customer ID, and last-4 of card.*

### Health and fitness

All **No**. Advottic does not collect health data.

### Messages

| Type | Collected | Shared | Reason | Optional |
|---|---|---|---|---|
| Emails | No | - | - | - |
| SMS / MMS | No | - | - | - |
| Other in-app messages | Yes - Bella chat conversations are persisted server-side per user for context continuity | No | App functionality (so the assistant remembers) | Yes (the user can clear the conversation any time) |

### Photos and videos

| Type | Collected | Shared | Reason | Optional |
|---|---|---|---|---|
| Photos | Yes - exhibits the user uploads to a case | No | App functionality (case file packet) | Yes |
| Videos | Yes - same as photos, larger file types accepted | No | Same | Yes |

### Audio files

| Type | Collected | Shared | Reason | Optional |
|---|---|---|---|---|
| Voice / sound recordings | Yes - voice memos uploaded as exhibits | No | App functionality | Yes |
| Music files | No | - | - | - |
| Other audio files | No | - | - | - |

### Files and docs

| Type | Collected | Shared | Reason | Optional |
|---|---|---|---|---|
| Files and docs | Yes - PDFs, screenshots, scanned docs uploaded as exhibits | No | App functionality | Yes |

### Calendar

All **No**. Hearing dates are stored on the user's case file, not on the
device's calendar.

### Contacts

All **No**.

### App activity

| Type | Collected | Shared | Reason | Optional |
|---|---|---|---|---|
| App interactions | Yes - case open / edit / export events for the activity log | No | App functionality (audit trail), Analytics | No |
| In-app search history | No - searches are not persisted | - | - | - |
| Installed apps | No | - | - | - |
| Other user-generated content | Yes - case notes, exhibit descriptions, profile bio | No | App functionality | Yes |
| Other actions | Yes - sign-in / sign-out events for security audit | No | Security | No |

### Web browsing

All **No**. We do not track external browsing.

### App info and performance

| Type | Collected | Shared | Reason | Optional |
|---|---|---|---|---|
| Crash logs | Yes - sent to Advottic's own crash_reports table for debugging | No | App functionality, Analytics | No |
| Diagnostics | Yes - request timing, error rate (server-side only) | No | Analytics | No |
| Other app performance data | No | - | - | - |

*Note: crash + diagnostic data is collected on Advottic's own infrastructure,
not Google Crashlytics or Firebase. We do not send it to third parties.*

### Device or other IDs

| Type | Collected | Shared | Reason | Optional |
|---|---|---|---|---|
| Device or other IDs | No | - | - | - |

---

## Section 3: Data usage and handling

### Is the data collected ephemeral?

**No** - case data, exhibits, and user content persist by design (it's a case
file). Crash logs persist for 30 days then are pruned.

### Are the data types you collect optional or required?

Mixed - see per-row table above. Email + user ID are required for account
creation; everything else (case content, exhibits, profile bio) is optional.

### Have you described what your app collects, why, and shared it with users
in a privacy policy?

**Yes** - https://advottic.com/privacy. The privacy policy is also linked from
the consent modal that gates first sign-in, so users see it before any data
is recorded.

---

## Section 4: Security practices

### Is data encrypted in transit between the user's device and your servers?

**Yes** - HTTPS only (HSTS preload eligible). Mixed content blocked at the
manifest level (`allowMixedContent: false`).

### Do you provide a way for users to request that their data is deleted?

**Yes** - Profile -> Delete my account.

### Is the app committed to following the Google Play Families Policy?

**Not applicable** - Advottic is not directed at children. Sign-up requires a
working email and acceptance of Terms that include arbitration; under-13 users
are excluded by Terms.

---

## Section 5: Third-party data sharing

The following third parties receive a subset of user data, all under written
contracts:

| Vendor | What they receive | Why |
|---|---|---|
| Supabase (database + auth + storage) | All persisted user data | Hosts the app's database |
| Vercel | Server-side request metadata | Hosts the app's runtime |
| Anthropic | Bella chat messages + Advottic Review case content | LLM inference for the assistant + reviews |
| Stripe | Email + Stripe customer ID | Subscription billing |
| Resend | Email address + transactional content | Magic-link sign-in + receipt emails |

All vendors are bound by their own DPAs. None receive data for advertising or
profiling.

---

## Quick checklist before clicking Submit

- [ ] Privacy policy URL works and matches the answers above
- [ ] Account-deletion flow tested end-to-end with a fresh account
- [ ] Data export downloads valid JSON
- [ ] No collected data category contradicts what /privacy says
- [ ] Encryption-in-transit toggle is YES
- [ ] App not flagged as targeting children
- [ ] Listed every third-party sub-processor
