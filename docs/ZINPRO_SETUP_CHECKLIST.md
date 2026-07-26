# Advottic setup for the Zinpro One integration

**Audience: the Advottic firm admin (legal team side).** Zinpro One has
implemented the partner contract (see ADVOTTIC-INTEGRATION-CONTRACT.md) and is
ready on its side. This checklist is everything Advottic needs to configure,
plus the two secrets to hand back to the Zinpro team. Estimated time: 15 minutes.

---

## 1. Register the company email domains

Counsel -> Settings -> Access -> internal domains.

| Domain | Who | Required |
|---|---|---|
| `zinpro.com` | Employees filing from the Zinpro One app | Yes |
| `zinpro.app` | HQ staff accounts, if they will ever file requests | Optional |

The partner API refuses to provision anyone outside these domains, so this
must be done before the first ticket.

## 2. Mint the integration token

Profile -> API tokens -> create token.

- Scope: **firm** plus **write**
- It is shown once and looks like `adv_...`
- Hand it to the Zinpro team over a secret channel (password manager share or
  similar). Never email or chat it in plain text.

## 3. Configure the partner panel

Counsel -> Settings -> **Partner app integration**:

1. **Confirmation message after filing.** The employee sees this the moment
   their request files. State your response-time promise, for example:
   "Thanks - your request has reached the legal team. We usually respond
   within 2 business days; urgent matters are triaged first."
   The app fetches this live; edit it any time and the app shows the new text.

2. **Intake questions** (up to 12; free text, choice list, or yes/no; each
   optionally required). Note: the Zinpro form already asks for these as fixed
   fields, so do NOT duplicate them as questions:
   - Subject
   - Description / context
   - Category (contract review, NDA, IP or trademark, HR, incident, other)
   - Priority (low / normal / high / urgent)
   Good candidate questions: business unit, hard deadline, has anything been
   signed, deal value, confidentiality.

3. **Event webhook.**
   - URL: `https://api.zinpro.app/webhooks/advottic`
   - Reveal the signing secret (`whsec_...`) and hand it to the Zinpro team
     with the token from step 2.
   - Zinpro verifies the HMAC-SHA256 signature over the raw body with the
     epoch-seconds timestamp, exactly per the contract, and rejects stale or
     tampered deliveries. Rotating the secret is fine; coordinate so Zinpro
     updates its copy at the same time.

4. **Reminder window.** Hours before an unanswered request nudges the team
   again. Default 24; set 0 to turn reminders off.

## 4. SSO (recommended)

Counsel -> Settings -> SSO & provisioning. Zinpro uses **Microsoft Entra ID**;
connect it via SAML so employees can open advottic.com with their work email
and find every ticket they filed from the app already in their Hub portal.
SCIM sync is available on the same page if wanted.

---

## What to hand back to the Zinpro team

| Item | Example shape | From step |
|---|---|---|
| API token | `adv_...` | 2 |
| Webhook signing secret | `whsec_...` | 3.3 |
| Confirmation that domains are registered | - | 1 |

Zinpro pastes the token and secret into its HQ Integration Center (they apply
immediately, no restart), with base URL `https://advottic.com`.

---

## Joint smoke test (10 minutes, both teams on a call)

1. Zinpro files a test request from the app. Expect: it appears in the
   Advottic Intake inbox with the question answers; the legal bell rings and
   the firm admins get the email; the employee sees your confirmation message
   as a popup.
2. A lawyer replies in the intake thread. Expect: Zinpro receives the
   `ticket.legal_replied` webhook, the employee gets a push notification, and
   the reply appears in the app's thread; Advottic also emails the employee.
3. The employee replies from the app. Expect: the message lands in the same
   intake thread and rings the legal bell.
4. Convert the test request to a matter. Expect: the app shows the
   "matter opened" banner with the case reference within about a minute
   (webhook, with a 75-second poll as backup).
5. Close or delete the test matter.

If any step fails, check: token scope is firm + write, the employee email is
on a registered domain, and the webhook URL and secret match exactly.
