# Law-firm mode (`/counsel`)

The firm-side perspective of Advottic. A signed-in user sees their
consumer-side experience by default, but if they are a member of any
firm, a "Switch to firm view" toggle in the user menu flips them into
the firm-side product, branded with the firm's logo + accent color.

## Naming

The product surface is called **Advottic Counsel**, served at:

- v1: `advottic.com/counsel/*`
- v2 (after DNS): `counsel.advottic.com`

The path-based v1 means we do not need any DNS changes to start; the
subdomain swap is two lines of `middleware.ts` once `counsel.advottic.com`
is added in Vercel domain config.

## Data model

```
firms
  id, slug (unique), name, logo_url, accent_color, jurisdictions[],
  practice_areas[], created_by, created_at, updated_at

firm_members
  id, firm_id, user_id, role (owner|admin|attorney|paralegal|staff),
  display_name, joined_at

firm_invitations
  id, firm_id, email, role, invited_by, token, expires_at, accepted_at

firm_clients
  id, firm_id, user_id, primary_attorney_id, invited_by, status, joined_at
  -- Lets a firm "manage" a consumer-side user without conflating it
     with firm membership. The user is still a normal Advottic user;
     this row just authorizes the firm to see their shared cases.

firm_documents
  id, firm_id, name, mime_type, file_path, version, parent_document_id,
  uploaded_by, uploaded_at, tags[], case_id?, client_id?
  -- Versioned document vault. parent_document_id chains revisions.

firm_signing_requests
  id, firm_id, document_id, requested_by, status (draft|sent|partial|
  completed|canceled), sent_at, completed_at

firm_signatures
  id, signing_request_id, signer_user_id?, signer_email,
  signed_at, ip_address, user_agent, signature_image_path,
  audit_hash
  -- Audit row per signer per request. audit_hash chains to enable
     tamper detection in v2's full UETA-compliant build.

firm_channels
  id, firm_id, name, kind (channel|dm|group_dm), created_by, created_at

firm_channel_members
  id, channel_id, user_id, joined_at, last_read_at

firm_messages
  id, channel_id, user_id, body, attachments[], created_at, edited_at

cases (existing, gets a new column)
  + firm_id (nullable) -- when set, all firm_members of firm_id see it
```

All tables ship with row-level security policies tied to
`firm_members.user_id = auth.uid()`. A firm member can only see /
write rows scoped to their firm. The service-role key (admin
operations only) bypasses RLS, exactly as it does on the
consumer side.

## Brand theming

Each firm picks a single **accent color** during onboarding. On
`/counsel/*` pages, the layout reads `firm.accent_color` and writes
it as `--firm-accent: <hex>` on `<html>`. Tailwind utilities like
`bg-firm-accent`, `text-firm-accent`, `ring-firm-accent` are wired
via the `tailwind.config.ts` extension. The firm's logo (uploaded
to Supabase storage) replaces the Advottic wordmark in the
`/counsel/*` header.

Outside `/counsel/*`, theming reverts to brand defaults (forest +
gold). A user who switches to firm view sees the firm-themed
header; switching back to consumer view restores the Advottic
brand.

## Switching perspectives

The `profiles` table gets an `active_firm_id` column. The user
menu shows:

- "Switch to firm view" if `active_firm_id IS NULL` and the user
  is in at least one firm
- "Switch to personal view" + the firm name if `active_firm_id`
  is set
- A submenu listing other firms the user belongs to, in case they
  are at multiple firms

Setting `active_firm_id` is a server action; the next route hit
checks the column server-side and renders the right shell.

## Phases shipped in this commit

- **v1 foundation**: schema + RLS, route group, onboarding wizard,
  dashboard skeleton, perspective toggle, theming.
- **v2 cases + clients**: firm-side case dashboard reusing
  existing `cases` schema with `firm_id` filter, client invite
  flow that creates a consumer-side account + firm_clients link.
- **v3 document vault**: upload, versioning, tags, search,
  signed-URL serving from a private Supabase bucket.
- **v3 e-sign in PREVIEW MODE**: PDF upload, drag-and-drop
  signature placement, `/sign/[token]` page that signs in-app
  (link never leaves Advottic), basic audit row. Output PDFs are
  watermarked **"DRAFT - FOR REVIEW ONLY - NOT LEGALLY BINDING"**
  pending v3.5 below.
- **v4 chat (polled)**: channels + DMs, refresh-every-3s read
  path. Real-time WebSocket upgrade is a planned follow-on.
- **v4 meetings stubs**: Microsoft 365 + Zoom buttons say
  "Connect (coming soon)". Manual meeting capture works.
- **v5 firm Bella**: signed-in Bella's system prompt receives
  firm context (jurisdictions, practice areas) so issue-spotting
  is firm-relevant. No Westlaw / LexisNexis API integration -
  Claude's training data is used directly with appropriate
  hedging. Add paid case-law APIs later if firms request them.

## Phases NOT shipped (operator action required)

These were called out in the kickoff but consciously deferred:

- **Legally-binding e-signature.** Requires a thorough audit
  trail (signed identity attestation, IP geolocation, OS
  fingerprint, hash chain across signers, archival of the
  unsigned + signed PDF, retention policy). Two real options:
  build it carefully ourselves (a week of focused work), or
  integrate a third-party provider (Dropbox Sign, BoldSign,
  OpenSign self-hosted). The user explicitly asked for "stays in
  the app, no link leaves" - that pushes us toward building it
  ourselves. Plan a dedicated session.
- **Real-time chat.** Supabase Realtime channels + presence +
  read receipts. ~1 day of focused work as a follow-on.
- **MS 365 calendar.** Requires registering an Azure AD app +
  Microsoft Graph API integration with permission `Calendars.ReadWrite`.
  OAuth flow + token refresh + meeting CRUD. ~half-day after the
  Azure registration is done.
- **Zoom.** Requires a Zoom Marketplace app. OAuth + meeting
  create endpoint. ~half-day after the Marketplace registration.
- **Westlaw / LexisNexis case-law access.** Paid vendor APIs
  (~$200-500/seat/month). Hold until firms ask for it.
- **Firm-level Stripe billing.** Firms pay separately from
  consumers; product / price objects + admin seat counting +
  pro-ration. Plan a dedicated billing session.

## RLS philosophy

Every firm-scoped table has policies of the form:

```sql
CREATE POLICY firms_member_select ON firms
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM firm_members fm
      WHERE fm.firm_id = firms.id AND fm.user_id = auth.uid()
    )
  );
```

Insert policies require the user to be an `owner` or `admin` of
the firm. Update / delete on critical rows (firm settings,
member roles) require `owner`.

Cross-firm leakage is impossible at the database level: even if
the application code has a bug, a query for `firm_id = X` from a
user who is not in firm X returns zero rows.

## Subdomain promotion (when ready)

When `counsel.advottic.com` is wired up in DNS + Vercel:

1. Add the domain in Vercel project settings, point CNAME at
   `cname.vercel-dns.com`.
2. In `middleware.ts`, detect the host and rewrite:
   ```ts
   if (host.startsWith('counsel.')) {
     return NextResponse.rewrite(new URL(`/counsel${pathname}`, req.url));
   }
   ```
3. Update marketing copy to reference the subdomain.

The path-based version keeps working forever as a fallback.
