# Trial Lapse Retention Posture

**Owner:** Security Official · **Review:** annual, and on any change to the trial lifecycle · Maps to SOC 2 C1.1 / CC3 · ISO 27001 A.5.34 · HIPAA §164.316(b)(2). Companion to [Data Retention & Disposal](data-retention-and-disposal.md) and [Risk Register](risk-register.md) R15.

Written 2026-08-06, alongside the HQ trial lifecycle feature. This document states a decision and its reasoning. It makes no certified compliance claim, and none should be read into it. See [the compliance README](../README.md) on that point.

## 1. The posture

When an organization's trial ends, or when HQ suspends it, the organization moves from `active` to `export_only`:

- Its people can still sign in. Counsel and Hub both redirect to `/counsel/access-ended`.
- Owners and administrators can download everything the organization holds, from that page, at any time and with no time limit on the offer.
- Writes are refused at the action layer, not only in the interface.
- **Nothing is removed on a timer.** No scheduled job exists anywhere in this feature. Access is decided by comparing the stored end date against the clock on each request, so an extension takes effect on the next page load and a lapse never depends on a job having run.

An organization that lapses keeps its data until it asks us to remove it. Removal is a request we act on, never something that happens on its own.

Turning access off is reversible. The other direction is not, and that asymmetry is the whole basis of the decision below.

## 2. What was considered and rejected

The original request was to remove an organization's data 30 days after its trial ended. That was raised as dangerous in this product specifically, and was not adopted. The reasons are recorded here because the next person to read the risk register will not have had the conversation.

Advottic holds active legal matters, evidence, signed documents and PHI, under the compliance program in this folder. Against that content, a 30 day timer runs into four separate problems.

**Litigation hold.** Matters in this product are live disputes. Removing a matter that is under hold is spoliation of evidence. The consequence lands on the customer as sanctions, and on Advottic as a claim, and neither is recoverable by apologising.

**Retention law.** HIPAA requires certain records be kept for six years (§164.316(b)(2)), and state bar rules commonly require a client file be retained for five to seven years after the matter closes. A 30 day timer contradicts both, and it would contradict them for the customer, whose obligation it is.

**Third parties.** The data is not only the firm's. It belongs partly to the firm's clients, and partly to people who signed documents held in it. None of them agreed to the trial terms, and none of them chose the lapse. Removing a signed agreement removes their evidence as well as the firm's.

**The trigger is commercial, not a data decision.** A trial ending is a billing event. It says nothing about whether the underlying records are still needed, still under hold, or still owed to somebody.

**Resolved:** nothing is removed automatically. The export stays available, the organization is told plainly that its access has ended, and removal happens only on request.

## 3. What this posture costs, stated honestly

Indefinite retention is not free, and this is the side of the trade that a reader should be able to see.

- It sits against the storage limitation principle (GDPR Art. 5(1)(e)) and against data minimisation generally. The justification is the legal retention obligations above, which apply to the same records, but the tension is real and is not resolved by this document.
- Lapsed organizations accumulate. There is no ceiling and no review point in the code, so the volume grows without anyone deciding it should.
- An erasure request against a lapsed organization is handled by the same manual path as any other, and inherits the same gaps recorded in [Data Retention & Disposal](data-retention-and-disposal.md) §3.

The mitigation is that the decision is deliberate and written down, not that the cost is zero. A future scheduled review of long-lapsed organizations, with notice to the organization and a hold check before anything is acted on, would reduce it. That is not built.

## 4. Where the trail is, and one open question next to it

Every HQ action on an organization's trial (grant, extend, reset, suspend, restore, seat change) writes a row to `public.firm_trial_events`, defined in `supabase/migrations/20260801_firm_trials.sql`. That table is written by `applyTrialAction` in `lib/firm-trials.ts` through the service-role client, and it records the actor twice, as a user id and as a denormalised email, so the answer survives the admin's account being removed. RLS is on with no policy, so the table is closed to every ordinary caller.

**That trail does not run through `lib/security-audit.ts`, and does not depend on it.** It is a separate table with its own insert.

One part of the trial feature does depend on that path, and should be named rather than left implied. When a non-admin calls an HQ trial lever directly, `lib/firm-trial-actions.ts` records the refusal by calling `logSecurityEvent`, which writes to `security_events`. There is an open finding against that writer:

> `lib/security-audit.ts` and the committed DDL in `supabase/fixes/2026-05-05-security-pulse.sql` disagree on column names (`ip` / `url` / `details` in the code against `ip_address` / `metadata` in the DDL) and on the severity vocabulary (`info` / `warning` / `critical` against `low` / `medium` / `high` / `critical`). The writer's failures are swallowed by design, so if the committed schema is what is live, these writes have been failing silently and nothing would have reported it.

This is being investigated separately and is **not resolved here**. One query against the live table settles it, and this document should not be read as having answered it either way. Its consequence for this feature is bounded and specific: a refused attempt on an HQ trial lever may be leaving only the `console.warn` line in `lib/firm-trial-actions.ts` rather than a durable row. Successful trial actions are unaffected, because they write to `firm_trial_events`.

Until that question is closed, no claim in this folder about audit controls should be treated as settled.

## 5. What has not been verified

The migration `supabase/migrations/20260801_firm_trials.sql` is **not applied**. No organization has ever had a trial, no action has written an audit row, and the enforcement layers have never refused a real request. The logic that decides access is pure and unit tested; the parts that touch a database and a signed-in user are not verified by observation.

**Applying the migration and regenerating `supabase/schema-fingerprint.sha256` in the same change is the owner's step.** It has not been done and must not be assumed.

**Deploy order is load-bearing, and runs backwards from the usual.** The trial columns must exist **before** this code deploys. Both the counsel and the Hub layouts gate on a read of those columns, and that read fails closed while they are missing, which renders the error boundary for every user of both surfaces. Migration first, code second, not the other way round.

Once the migration lands, work through this:

1. Apply `supabase/migrations/20260801_firm_trials.sql` and regenerate the schema fingerprint in the same change.
2. Grant a trial to a test organization from HQ, and confirm both the row on `firms` and the event on `firm_trial_events`.
3. Set the end date into the past, and confirm counsel and Hub both redirect to `/counsel/access-ended`.
4. Confirm an owner sees the export there, and a paralegal sees the explanation instead.
5. Call a firm write action directly while `export_only`, and confirm it refuses. This is the half a browser cannot test.
6. Extend, and confirm access returns on the next page load with no job having run.
7. Suspend, extend, and confirm the organization stays closed. Suspension outranks the dates.
8. Set a seat limit below the current member count, and confirm nobody is ejected and the next add is refused.
