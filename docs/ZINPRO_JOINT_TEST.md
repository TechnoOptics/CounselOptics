# Zinpro One - ready for the joint test

To the Advottic team, in reply to your ZINPRO_TEST_RUNBOOK.md. Everything on
the Zinpro side is implemented, deployed, and verified against your runbook,
including the live response shapes we saw in it (the `config` wrapper with
`ackMessage`, and bare ticket JSON on create). We are ready to schedule the
15-minute call.

---

## 1. The one thing we still need from you

Send the two secrets via password-manager share, as your runbook specifies:

1. **API token** `adv_OY8UrEJc...` (the firm-bound integration token you minted)
2. **Webhook signing secret** `whsec_...`

The moment they arrive we paste them into our HQ Integration Center with base
URL `https://advottic.com`. They apply immediately, no restart, and we can
start the call the same hour.

## 2. Our webhook endpoint, confirmed

| Item | Value |
|---|---|
| URL | `https://api.zinpro.app/webhooks/advottic` |
| Reachability | Public internet, POST, answers well under your 10 s timeout (verify, enqueue, 2xx) |
| Headers read | `X-Advottic-Signature` and `X-Advottic-Timestamp` (generic `X-Signature` / `X-Timestamp` also accepted) |
| Verification | Hex HMAC-SHA256 over `"{timestamp}.{rawBody}"`, computed on the raw request bytes before any JSON parsing, compared constant-time |
| Replay window | 5 minutes (unix seconds or milliseconds both accepted) |

## 3. What each event does in Zinpro One

- `ticket.legal_replied` - the reply lands in the request thread and the
  employee gets a push notification with the lawyer's message; they can reply
  inline straight from the notification.
- `ticket.status_changed` - the status pipeline updates in the app; when
  `status` becomes `converted` with a `caseId`, the employee sees the
  "matter opened" banner with the reference.
- `ticket.created`, `ticket.employee_replied`, `ticket.reminder` - accepted
  and acknowledged with 2xx (created and employee_replied originate from our
  own calls, so the app state is already correct).
- Backup: while a request is open in the app we poll
  `GET /tickets/{id}` every 75 seconds, inside your 60-120 s guidance, so a
  missed delivery never strands a thread.

## 4. App behavior you will see on the call

- The "New legal request" form is rendered live from
  `GET /api/partner/v1/config`: your confirmation popup text (`ackMessage`)
  and all 5 intake questions in order, with required/select validation done
  client-side before submit. Nothing is hard-coded; edits your legal team
  makes show up on the next form open.
- Ticket create sends `externalId` (our `ZIN-...` reference) and we treat a
  200 replay as the same ticket, matching your idempotency.
- Employee replies go out via
  `POST /api/partner/v1/tickets/{id}/messages` with `employeeEmail`.

## 5. Joint test, step by step (mirrors your section 5)

We will file with `contact@technooptics.com` and prefix subjects `[TEST]`.

1. **We file from the app.** You confirm: request in Counsel inbox with the
   three answers, bell, firm-admin email. We confirm: 201 + ack popup shown,
   signed `ticket.created` received.
2. **Your lawyer replies in Counsel.** We confirm: `ticket.legal_replied`
   verified, reply visible in the thread, push notification with inline
   reply on the device.
3. **We reply from the notification itself** (no app open needed). You
   confirm: message in the thread, legal bell rings, we both see
   `ticket.employee_replied`.
4. **Your lawyer converts to a matter.** We confirm: `status_changed` with
   `converted` + `caseId`, matter banner in the app within seconds.
5. **Employee portal demo** per your runbook (View as Employee, Forms > NDA,
   Check a document).
6. **Reminder** left passive: we file a second `[TEST]` ticket, leave it
   unanswered, and both check the 24 h nudge the next day.

Cleanup after: your legal team closes/deletes the `[TEST]` items.

## 6. Pre-flight we run before the call

- `GET /config` with the token: expect 200 with the popup + 5 questions.
- One signed test POST to our endpoint: expect 2xx; a tampered body must 401.

If either fails we resolve it async before booking the call, using the
troubleshooting table in your runbook.

Ping us with a couple of time slots once the password-manager share is sent.
