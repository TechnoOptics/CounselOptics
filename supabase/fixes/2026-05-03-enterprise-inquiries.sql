-- 2026-05-03: enterprise_inquiries table for /enterprise inquiry form.
--
-- Public form on /enterprise asks firms / in-house counsel /
-- legal aid / government for their basic details + sector + team
-- size. Submission is via a server action that uses the service-
-- role client (bypassing RLS) because the form is intentionally
-- open to unauthenticated visitors.
--
-- Admin team triages from /admin/enterprise-inquiries (TODO: build
-- the dashboard surface). After signing a deal, admin updates the
-- corresponding subscription row with the agreed custom price and
-- cadence so auto-payment can run.

CREATE TABLE IF NOT EXISTS public.enterprise_inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_name text NOT NULL,
  contact_name text NOT NULL,
  contact_role text,
  email text NOT NULL,
  sector text NOT NULL CHECK (sector IN ('firm', 'inhouse-corp', 'inhouse-other', 'legal-aid', 'government', 'other')),
  team_size text CHECK (team_size IS NULL OR team_size IN ('1-3', '4-10', '11-50', '51-200', '200+')),
  message text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'demo-scheduled', 'pilot', 'signed', 'closed-lost', 'archived')),
  admin_notes text,
  assigned_admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index for the admin dashboard's "new inquiries first" feed.
CREATE INDEX IF NOT EXISTS idx_enterprise_inquiries_status_created
  ON public.enterprise_inquiries (status, created_at DESC);

-- updated_at auto-bump trigger so admin notes / status changes
-- reflect a real "last touched" timestamp without each caller
-- having to set it manually.
CREATE OR REPLACE FUNCTION public.touch_enterprise_inquiries_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enterprise_inquiries_updated_at ON public.enterprise_inquiries;
CREATE TRIGGER trg_enterprise_inquiries_updated_at
  BEFORE UPDATE ON public.enterprise_inquiries
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_enterprise_inquiries_updated_at();

-- RLS: enable, deny everything by default.
ALTER TABLE public.enterprise_inquiries ENABLE ROW LEVEL SECURITY;

-- The form INSERTs via the service-role client (which bypasses RLS
-- entirely), so we don't need an INSERT policy. We only need a
-- read+update path for admins, so the dashboard can pull the queue.

-- Admin SELECT: profiles.is_admin = true gates the read.
CREATE POLICY enterprise_inquiries_admin_select
  ON public.enterprise_inquiries
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.is_admin = true
    )
  );

-- Admin UPDATE: same gate. Lets the admin dashboard change status,
-- write notes, and assign a reviewer.
CREATE POLICY enterprise_inquiries_admin_update
  ON public.enterprise_inquiries
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.is_admin = true
    )
  );

-- Admin DELETE: rare (we'd usually 'archived' the row instead) but
-- allowed for compliance-driven cleanup, e.g. a "delete my data"
-- request from a former contact.
CREATE POLICY enterprise_inquiries_admin_delete
  ON public.enterprise_inquiries
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.is_admin = true
    )
  );
