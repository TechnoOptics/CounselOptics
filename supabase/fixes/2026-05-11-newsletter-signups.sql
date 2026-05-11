-- Newsletter signups table. Powers /api/newsletter/subscribe which
-- captures emails from /resources, /resources/[slug] article footers,
-- and any other marketing surface that mounts <NewsletterSignup>.
--
-- Idempotent: rerun safe via IF NOT EXISTS.

create table if not exists public.newsletter_signups (
  email text primary key,
  source text not null default 'unknown',
  subscribed_at timestamptz not null default now(),
  unsubscribed_at timestamptz,
  ip_address text,
  user_agent text
);

-- Index for analytics queries: signups by source over time.
create index if not exists newsletter_signups_source_subscribed_idx
  on public.newsletter_signups (source, subscribed_at desc);

-- Index for active (non-unsubscribed) recipient list pulls.
create index if not exists newsletter_signups_active_idx
  on public.newsletter_signups (subscribed_at desc)
  where unsubscribed_at is null;

-- RLS: only the service-role key writes; no client-side reads at all.
alter table public.newsletter_signups enable row level security;

-- No policies; default deny. Service role bypasses RLS.

-- Comment on the table for future maintainers.
comment on table public.newsletter_signups is
  'Email captures from /resources and article footers. Service-role write only.';
comment on column public.newsletter_signups.source is
  'Which marketing surface drove the signup (e.g. resources_hub, article_demand-letter). 64 char cap enforced by the API route.';
