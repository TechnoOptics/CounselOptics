# Zinpro One ↔ Advottic — production go-live pack

For the Zinpro app team. The joint test validated every integration path;
this document is everything needed to switch from testing to production use
by real employees: final checklist, operational agreements, security
practices, employee rollout guidance, and how change is managed after
launch.

Base URL (production, the same one tested): `https://advottic.com`

---

## 1. Go-live checklist

### Advottic side — complete

- [x] Firm workspace **Zinpro** live (Counsel workspace for the legal team,
      Client Hub for employees).
- [x] Employee domains registered: `zinpro.com`, `zinpro.app` — any employee
      on these domains is auto-provisioned on their first ticket. No
      per-employee setup needed, ever.
- [x] Production API token issued: firm-bound, scopes `read + write`
      (prefix `adv_OY8UrEJc…`), delivered via password-manager share.
- [x] Webhook configured to `https://api.zinpro.app/webhooks/advottic`
      with HMAC signing secret (delivered in the same share).
- [x] Confirmation popup + 5 intake questions configured (served live by
      `GET /api/partner/v1/config`).
- [x] Legal-team notifications live: bell + email to firm admins on every
      new ticket and employee reply; employees emailed on legal replies,
      matter conversion, and closure.
- [x] Stale-request reminders: 24 h nudge to the legal team, plus a
      `ticket.reminder` webhook to you.

### Zinpro side — confirm before launch

- [ ] Token + secret stored in your production secret manager (not in code,
      config files, or CI variables in plain text).
- [ ] `GET /config` rendered live on every "New legal request" form open
      (flat shape: `firmName`, `acknowledgment`, `questions[]`, `webhook`).
- [ ] Webhook verification in production mode: raw-body HMAC, constant-time
      compare, 5-minute replay window, fast 2xx.
- [ ] 75-second polling active as the webhook backup for open tickets.
- [ ] `externalId` sent on every create; 200 replays treated as the same
      ticket.
- [ ] Client-side validation of required/select answers before submit.
- [ ] Remove any test-mode flags, `[TEST]` prefixes, or sandbox toggles.

### Joint — final gate

- [ ] Joint test call completed with all six steps green.
- [ ] All `[TEST]` tickets closed/deleted by the legal team.
- [ ] Go-live date agreed and employee comms scheduled (see §5).

---

## 2. Production limits and behavior

| Item | Value | Notes |
|---|---|---|
| Rate limits | 60 ticket creates / 240 messages per rolling 5 min, per firm | Applies to the whole company's traffic through the token; on `429`, back off and retry with jitter |
| Webhook delivery | Best-effort, 10 s timeout, no automatic retry in v1 | Your 75 s poll is the guaranteed path; treat webhooks as latency reduction |
| Ticket statuses | `in_progress → conflict_check_passed/flagged → engaged → converted` (with `caseId`) or `rejected` | Render unknown future statuses gracefully (fallback label) |
| Attachments | Not in the partner API (v1) | Employees exchange files in their Advottic Hub; deep-link them there. Pre-signed upload URLs are on the roadmap |
| Config changes | Apply immediately | The legal team can edit the popup text and questions at any time — always render from `GET /config`, never cache longer than a day |
| Employee lifecycle | Deactivated employees are refused by the API | Offboarding an employee in Advottic (or a domain change) takes effect on their next call |

## 3. Security agreements

- **Storage:** both secrets live only in each side's secret manager. Never
  in repos, tickets, chat, or logs. Mask the token in your request logging
  (log the prefix `adv_OY8UrEJc` at most).
- **Rotation:** either side may request rotation at any time; we coordinate
  a same-hour swap (new value shared → you deploy → old value revoked).
  Recommended cadence: rotate both at least every 12 months, and
  immediately on any suspicion of exposure or when a person with access to
  either value leaves.
- **Revocation:** we can revoke the token or rotate the webhook secret
  instantly from the Advottic dashboard — this is the kill switch if your
  side is ever compromised. Your kill switch: stop calling and drop the
  webhook route.
- **Blast radius:** the token is scoped to the Zinpro firm only, and to the
  partner endpoints only. It cannot read other firms, billing, or admin
  surfaces.
- **Verification discipline:** keep rejecting unsigned, stale (>5 min), or
  tampered webhook deliveries in production, and alert (don't silently
  drop) on repeated signature failures — that pattern means a secret
  mismatch or an attack.

## 4. Operations after go-live

### Monitoring each side owns

| Advottic watches | Zinpro watches |
|---|---|
| Partner API error rates and latency | Ticket-create success rate from the app |
| Webhook delivery failures to your endpoint | Webhook signature-failure count (alert on repeats) |
| Reminder job execution | Poll failures / stale threads |
| Legal-team responsiveness (reminders surface this) | Push-notification delivery to employees |

### Incident contacts

- **Advottic:** contact@technooptics.com (platform admin). Include the
  ticket `id`/`externalId`, timestamp, and the response body — never the
  token.
- **Zinpro:** _(add your on-call/integration contact here before
  circulating)._
- First triage steps live in the troubleshooting table of
  `ADVOTTIC-TEST-RUNBOOK.md` — it covers every failure mode we know of
  (401/403/429, domain rejections, shape errors, signature mismatches).

### Change management

- We version the partner API by path (`/api/partner/v1/…`). Breaking
  changes only land in a `/v2`, with both running in parallel and advance
  notice; `v1` additions (new fields, new event types) are non-breaking —
  ignore unknown fields and events you don't handle.
- Roadmap items on our side, in likely order: webhook delivery retries,
  pre-signed attachment uploads, richer event payloads. We'll propose
  contract updates through the same docs exchange before building.

## 5. Employee rollout (recommended)

1. **Soft launch (week 1):** enable the "Legal" entry in Zinpro One for a
   pilot group (one department). The legal team already gets notified of
   everything, so no process change on their side.
2. **Comms:** one short employee announcement: *"You can now file legal
   requests straight from Zinpro One — NDAs, contract reviews, questions.
   Legal usually replies within 2 business days, and you'll get a
   notification the moment they do."* (Mirrors the configured popup, so
   expectations match.)
3. **Full rollout (week 2+):** enable for everyone on `zinpro.com` /
   `zinpro.app`. No provisioning step — first ticket creates the account.
4. **The upsell moment:** when an employee opens advottic.com (any link in
   our emails), they land in the **Zinpro Client Hub** with every ticket
   they ever filed from the app, plus self-service: fillable firm forms
   (the NDA is live), the policy document checker, secure encrypted
   sharing, documents, calendar, and trainings.
5. **SSO (recommended, not blocking):** connecting Microsoft Entra ID via
   SAML (Counsel → Settings → SSO & provisioning) lets employees open the
   Hub with their work login, no sign-in code. SCIM sync is available on
   the same page. Can be done any time after go-live — send us your IdP
   metadata when ready and we'll configure it together.

## 6. What the legal team will do differently

Nothing new to learn — partner tickets are ordinary intake requests in the
Counsel workspace (triage, conflict check, document requests, thread
replies, convert-to-matter). Two knobs they own from
Counsel → Settings → Partner app integration:

- **Confirmation message** — the response-time promise employees see; edit
  any time, applies to the next form open in your app.
- **Intake questions** — add/remove/reorder up to 12; your form re-renders
  them automatically. (Keep ids stable for questions you report on.)
- **Reminder window** — currently 24 h; `0` disables reminders.

## 7. Go/no-go summary

Go-live requires exactly three things, in order:

1. Joint test: all six steps pass (scheduled — slots proposed in
   `ADVOTTIC-JOINT-TEST-REPLY.md`).
2. Zinpro checklist in §1 all checked, test artifacts cleaned up.
3. Employee comms sent and the Legal entry enabled in the app.

Everything else in this document is the operating agreement we run under
from that moment. Welcome aboard — let's ship it.
