# Auth email - move off Supabase default SMTP onto Resend

## Why this matters

Supabase's free / default SMTP (`noreply@mail.app.supabase.io`) is
heavily rate-limited:

- **3 emails per hour, project-wide.** Once the project hits this
  ceiling, every subsequent magic-link request returns
  `over_email_send_rate_limit` for the rest of the hour.
- **1 magic-link request per minute, per email.** A user who clicks
  "Send magic link" twice in quick succession sees
  `For security purposes, you can only request this after N seconds`.
- **Default sender domain is shared with every other Supabase
  project on the free tier**, which means deliverability suffers
  (Gmail / Outlook spam filters are aggressive on it).

What testers experience: they request a magic link, the email
arrives (or doesn't), they click "Send magic link" again because
nothing happened, they hit the rate limit, they assume the app is
broken. Both happened in the auth logs we just inspected.

The fix is to wire Supabase Auth's SMTP to Resend. We already use
Resend for transactional emails (the verified `advottic.com`
domain, the rotated key), so this is just config. After the swap:

- ~100 emails/day on Resend free tier (~3,000/mo paid),
  comfortably above the per-minute throttle that hits testers.
- All sign-in emails come from `noreply@advottic.com` (or whatever
  sender you choose on the verified domain), with proper
  SPF / DKIM / DMARC alignment baked in by Resend.
- Identical UX in the app - no code changes, just dashboard config.

## What you do (5-10 min)

You'll need:

- Your Resend API key (the one in Vercel as `RESEND_API_KEY`)
- The verified domain (`advottic.com`)
- Admin access to the Supabase project at
  https://supabase.com/dashboard/project/hpmtlhpyvbreyfimftgt

### Steps

1. Open the Supabase dashboard, navigate to
   **Project Settings → Authentication → SMTP Settings**.

2. Toggle **"Enable Custom SMTP"** ON.

3. Fill in:

   | Field | Value |
   |---|---|
   | **Sender email** | `noreply@advottic.com` (or `auth@advottic.com`, your call) |
   | **Sender name** | `Advottic` |
   | **Host** | `smtp.resend.com` |
   | **Port** | `465` |
   | **Username** | `resend` (literal string) |
   | **Password** | the Resend API key (starts with `re_...`) |

4. Click **Save**. Supabase tests the connection and warns if the
   credentials don't work.

5. Open **Authentication → Email Templates** and customize the
   "Magic Link" template if you want. The default works fine for
   v1; later you may want to brand it. The variables Supabase
   exposes are documented inline.

6. Test: open `https://www.advottic.com/sign-in`, request a magic
   link with your own email, confirm it arrives from
   `noreply@advottic.com` and lands you in the app.

### Verifying it worked

After step 6, check the Supabase auth logs (dashboard → Logs →
Auth):

- Look for a `mail.send` event. The `mail_from` field should now
  read `noreply@advottic.com`, not
  `noreply@mail.app.supabase.io`. That confirms the SMTP swap
  took effect.

If you ever hit `over_email_send_rate_limit` again, that's a
Resend-side cap - check the Resend dashboard for usage and
upgrade the plan if needed.

## What I shipped on the code side, while you do the dashboard work

Even with custom SMTP wired up, the per-email throttle still
exists (60s between requests for the same address). I also
hardened the UX around the most common failure modes:

- **Clear countdown on the per-email throttle**: if a tester
  clicks "Send magic link" twice in quick succession, they now
  see `Just a moment - a magic link is already on its way to
  you@example.com. Check your inbox (and spam). You can request
  another in 26 seconds.` instead of a generic error.
- **Friendlier "already-used" message** on the auth callback when
  someone clicks a magic link a second time.
- **Session-survives-expired-link recovery**: if the user
  successfully signed in on the first click and then clicks the
  magic link again (e.g. from a different tab), they used to see
  an "expired" error. Now we detect their existing valid session
  and silently send them through.

None of these eliminate the rate-limit problem itself - that
needs the Resend SMTP swap. They just make the failure modes
read like normal product behavior instead of "broken app."
