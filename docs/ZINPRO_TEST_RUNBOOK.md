# Zinpro One ↔ Advottic — joint integration test runbook

For the Zinpro app team, ready to run. Everything on the Advottic side is
**already configured and live** as of 2026-07-26. This document contains the
full current state, the credentials you will receive, how to verify our
webhook signatures, and a step-by-step joint test with expected results at
every step.

---

## 1. What is already configured (Advottic side — done)

| Item | Value |
|---|---|
| Base URL | `https://advottic.com` |
| Legal workspace (firm) | **Zinpro** |
| Registered employee domains | `zinpro.com`, `zinpro.app` (plus `technooptics.com` for internal testing) |
| API token | Minted: name "Zinpro One integration", prefix `adv_OY8UrEJc…`, scopes `read, write`, firm-bound |
| Webhook endpoint (yours) | `https://api.zinpro.app/webhooks/advottic` |
| Webhook signing secret | Minted (`whsec_…`) — delivered with the token |
| Reminder window | 24 h (legal team is nudged about unanswered requests) |
| Demo employee account | `contact@technooptics.com` — active employee of firm Zinpro (also firm owner: in the Advottic UI, use the profile menu's **View as → Employee** to see the employee Hub) |
| Alternate pure-employee account | `amuchai@zinpro.com` — active employee only; signs straight into the employee Hub |

### Confirmation popup (shown to the employee the moment a request files)

> Thanks — your request has reached the legal team. We usually respond within
> 2 business days; urgent matters are triaged first.

The legal team can edit this any time; your app should always fetch it live
(see §3) rather than hard-coding it.

### Intake questions (render these on your "New legal request" form, in order)

| # | id | Question | Type | Required |
|---|---|---|---|---|
| 1 | `business-unit` | Which business unit or team is this for? | text | **yes** |
| 2 | `hard-deadline` | Is there a hard deadline? If so, when and why? | text | no |
| 3 | `signed-already` | Has anything already been signed or agreed to? | yes / no | **yes** |
| 4 | `deal-value` | Approximate deal value, if applicable | text | no |
| 5 | `confidentiality` | Confidentiality level | choice: `Standard`, `Sensitive`, `Highly confidential` | **yes** |

Answers are validated server-side against this exact set (unknown ids are
dropped; select answers must match an option; missing required answers reject
the ticket with a 400). Always render from the live config, not this table.

---

## 2. Credentials you will receive

Two secrets arrive via password-manager share (never plain email/chat):

1. **API token** — `adv_…` (48+ chars). Send as `Authorization: Bearer adv_…`
   on every call. Firm-bound and revocable on our side.
2. **Webhook signing secret** — `whsec_…`. Used only to verify inbound
   webhook deliveries (§4). Never send it to us in requests.

Paste both into the HQ Integration Center with base URL
`https://advottic.com`. They apply immediately; no restart.

---

## 3. Pre-flight checks (run these before the joint call)

### 3.1 Token works and config loads

```bash
curl -s https://advottic.com/api/partner/v1/config \
  -H "Authorization: Bearer $ADVOTTIC_PARTNER_TOKEN"
```

**Expect** `200` with:

```json
{
  "config": {
    "ackMessage": "Thanks — your request has reached the legal team. ...",
    "questions": [ { "id": "business-unit", "...": "..." }, "… 5 total" ]
  }
}
```

- `401` → token wrong/revoked.
- `403 This token is not firm-scoped…` → you were handed a personal token by
  mistake; ask for a re-issue.

### 3.2 Webhook endpoint reachable

Confirm `https://api.zinpro.app/webhooks/advottic` accepts a POST from the
public internet and returns 2xx quickly (we time out deliveries at 10 s;
verify the signature, enqueue, return immediately).

---

## 4. Verifying our webhook signatures

Every delivery is a `POST` with:

```
Content-Type:         application/json
X-Advottic-Event:     ticket.created | ticket.employee_replied | ticket.legal_replied | ticket.status_changed | ticket.reminder
X-Advottic-Timestamp: 1785000000            (unix seconds)
X-Advottic-Signature: 3f1a…e9               (hex)
```

The signature is **hex HMAC-SHA256 over `"{timestamp}.{rawBody}"`** keyed
with `whsec_…`. Verify against the *raw* request bytes (before any JSON
parsing), compare constant-time, and reject if `|now − timestamp| > 300 s`.

```ts
import crypto from 'crypto';

function verify(rawBody: string, headers: Record<string, string>, secret: string): boolean {
  const ts = headers['x-advottic-timestamp'];
  const sig = headers['x-advottic-signature'];
  if (!ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}
```

### Payload shape (all events)

```json
{
  "event": "ticket.legal_replied",
  "at": "2026-07-26T12:00:00.000Z",
  "ticket": {
    "id": "…",
    "externalId": "ZIN-4821",
    "employeeEmail": "jane@zinpro.com",
    "subject": "NDA needed for Acme pilot",
    "status": "in_progress",
    "caseId": null
  },
  "message": { "author": "…", "text": "…" }
}
```

- `ticket.legal_replied` / `ticket.employee_replied` include `message`.
- `ticket.status_changed` includes `previousStatus`; when the request is
  converted to a matter, `status` becomes `converted` and `caseId` is set —
  that is your "matter opened" banner trigger.
- Deliveries are best-effort. Keep your 60–120 s poll of
  `GET /tickets/{id}` as the backup; treat webhooks as an accelerator.

---

## 5. The joint test (≈15 minutes, both teams on a call)

Use `contact@technooptics.com` as the employee throughout (swap in
`amuchai@zinpro.com` anywhere for a pure-employee account with no counsel
access). Prefix all test subjects with `[TEST]` so legal can spot and clean
them up.

### Step 1 — File a request from Zinpro One

Your app should first `GET /config`, render the popup + 5 questions, then:

```bash
curl -s -X POST https://advottic.com/api/partner/v1/tickets \
  -H "Authorization: Bearer $ADVOTTIC_PARTNER_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "employee": { "email": "contact@technooptics.com", "name": "Techno Optics", "department": "Operations" },
    "subject": "[TEST] Vendor NDA for integration smoke test",
    "description": "Joint test of the Zinpro One integration. Safe to close.",
    "category": "NDA review",
    "priority": "normal",
    "externalId": "ZIN-SMOKE-1",
    "answers": {
      "business-unit": "Platform engineering",
      "signed-already": "no",
      "confidentiality": "Standard"
    }
  }'
```

**Expect, in order:**
- `201` with the full ticket JSON (rerun the same command → `200`, same
  ticket — idempotency by `externalId`).
- Your endpoint receives a signed `ticket.created` webhook.
- The employee sees the confirmation popup (your app shows `ackMessage`).
- **Advottic side (we confirm on the call):** the request appears in
  Counsel → Request inbox with the three answers displayed; the
  notification bell rings; firm admins receive the "new request" email.

### Step 2 — Legal replies

An Advottic lawyer replies in the request thread from the Counsel inbox.

**Expect:** a signed `ticket.legal_replied` webhook (with `message`); your
app shows the reply in the thread and sends its push notification; Advottic
also emails the employee directly ("Legal replied…", calm wording, link to
their Hub portal).

### Step 3 — Employee replies from Zinpro One

```bash
curl -s -X POST https://advottic.com/api/partner/v1/tickets/$TICKET_ID/messages \
  -H "Authorization: Bearer $ADVOTTIC_PARTNER_TOKEN" -H "Content-Type: application/json" \
  -d '{ "employeeEmail": "contact@technooptics.com", "text": "Thanks — attaching context in the Hub. Can we finish by Friday?" }'
```

**Expect:** `200`; the message lands in the same thread; the legal bell
rings again; your endpoint receives `ticket.employee_replied`.

### Step 4 — Convert to a matter

A lawyer converts the request to a full matter in Counsel.

**Expect:** `ticket.status_changed` with `status: "converted"` and a
non-null `caseId` within seconds (poll catches it within ~75 s regardless);
your app shows the "matter opened" banner with the reference.

### Step 5 — Employee portal experience (the payoff demo)

Sign in at advottic.com as `contact@technooptics.com` (email → 8-digit
sign-in code) and switch to the employee view via the profile menu
(**View as → Employee**) — or sign in as `amuchai@zinpro.com`, which lands
directly in the employee Hub. Either way you'll see the very ticket filed
from Zinpro One, plus the full self-service toolset:

- **Forms → Mutual Non-Disclosure Agreement** — fill the fields, type a
  signature, **Preview PDF** (in-app viewer), then Download / Print /
  "Share securely" (encrypted link + separate key email).
- **Check a document** — paste text or upload PDF/Word/photo; it is scored
  against the firm's policies.

### Step 6 — Reminder (optional, passive)

Leave a second `[TEST]` ticket unanswered; after 24 h the legal team gets
one nudge (bell + email) and your endpoint receives `ticket.reminder`. Skip
on the call; verify next day.

**Cleanup:** legal closes/deletes the `[TEST]` items.

---

## 6. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `401 Invalid or revoked API token` | Wrong/rotated token | Re-check the password-manager entry; ask us to re-issue |
| `403 …not firm-scoped` | Personal token used | Use the firm integration token |
| `403 …outside the company's registered domains` | Employee email not on zinpro.com/zinpro.app | We add the domain, or fix the email |
| `400` on ticket create | Missing required answer / bad select option | Re-fetch `/config`; validate before submit |
| `429` | Rate limit (60 tickets / 240 messages per 5 min per firm) | Back off and retry |
| No webhooks arriving | URL/secret mismatch, or your endpoint slow (>10 s) | Verify both sides match exactly; return 2xx fast; polling still covers you |
| Signature verification fails | Verifying parsed/re-serialized JSON instead of raw bytes | HMAC the raw body exactly as received |
| Employee gets no emails | Their address only — check spam; deliveries are from `invites@advottic.com` (displayed as the firm) | We can check send logs |

## 7. Operational notes

- **Rotation:** either side can request a token re-issue or secret rotation
  at any time; coordinate so both sides swap simultaneously. Revocation on
  our side is instant.
- **Statuses:** `in_progress → conflict_check_passed/flagged → engaged →
  converted` (caseId set) or `rejected`.
- **No document bytes** flow through the partner API in v1 — attachments
  are exchanged in Advottic itself (employees have the Hub portal).
- Reference docs: `ZINPRO_INTEGRATION.md` (full API), your
  `ADVOTTIC-TEAM-SETUP.md` (verified accurate against our implementation).
