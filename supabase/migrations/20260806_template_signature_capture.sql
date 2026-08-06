-- A real signature on an employee's filled template.
--
-- The employee form has offered a text input labelled "Signature (type your
-- full legal name)" while the outside signer flow has offered draw, type and
-- upload for months. Two signing experiences of very different quality inside
-- one product, and the weaker one is the firm's own staff. These columns carry
-- the drawn or uploaded mark and the record of the act.
--
-- Nothing here says the typed name was invalid. A typed name adopted with
-- intent to sign is a valid electronic signature (15 USC 7006(5), UETA 2(8)),
-- and signature_mode = 'typed' stays first class rather than degraded. What
-- was genuinely missing was not the squiggle, it was the record around it: no
-- intent affirmation, no capture time, no IP, no user agent, and no binding
-- between the signature and the exact words signed.
--
-- Why the mark is a storage path and not bytes in the row. A PNG of a
-- signature is tens to hundreds of kilobytes. firm_template_submissions is
-- read whole (select '*') by the employee's list, the firm's review queue and
-- every release, so inlining the image would put that payload on every one of
-- those reads for the sake of the one surface that draws it. The bytes live in
-- the existing private firm-signatures bucket, at
-- templates/{firm_id}/{submission_id}/{revision}.png, reached only by the
-- service-role client, exactly as the outside signer's mark already is.
--
-- Why signed_document_sha256 exists. UETA section 12 and 15 USC 7001(d) ask
-- for a record capable of accurate retention and reproduction. This column
-- records a SHA-256 of the exact document_text the mark was affirmed against,
-- so "signed by someone who saw those words" is checkable rather than merely
-- asserted. It is also the hinge for the re-sign decision: when counsel edits
-- the wording the stored hash stops matching, which is what turns "the
-- employee must re-sign" from a procedure someone can forget into something
-- the release path can enforce. That release-side clause is deliberately NOT
-- in this change; it belongs with the re-sign work.
--
-- Trust model is unchanged: RLS stays ON with no policies on this table, so
-- nothing reaches these columns except the service-role client behind server
-- actions that authorize the caller in code.
--
-- Every column is nullable and nothing is backfilled. Submissions filed before
-- this shipped carry a typed name and no mark, and they must stay releasable.

alter table public.firm_template_submissions
  -- Path in the private firm-signatures bucket. Null means no drawn or
  -- uploaded mark, which for a typed signature is the normal case.
  add column if not exists signature_image_path text,
  -- How the employee produced the mark. 'typed' is a font-rendered cursive
  -- name and is a valid signature, not a lesser one.
  add column if not exists signature_mode text,
  -- When the mark itself was made.
  add column if not exists signature_captured_at timestamptz,
  -- When the employee affirmed they intend the mark to be their signature.
  -- This is the definitional element of an electronic signature, so it is
  -- recorded separately from the moment the pixels were drawn.
  add column if not exists signature_intent_at timestamptz,
  -- Attribution facts. The employee is already authenticated in the portal,
  -- which is a stronger attribution basis than the outside signer's emailed
  -- token; these put the fact on the record rather than leaving it merely true.
  add column if not exists signature_ip text,
  add column if not exists signature_user_agent text,
  -- SHA-256 of the document_text the mark was affirmed against.
  add column if not exists signed_document_sha256 text;

-- Written as a separate statement so re-running the file is safe: a bare
-- `add column ... check (...)` would fail on the second run even with
-- `if not exists` on the column.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'firm_template_submissions_signature_mode_check'
  ) then
    alter table public.firm_template_submissions
      add constraint firm_template_submissions_signature_mode_check
      check (signature_mode is null or signature_mode in ('typed', 'drawn', 'uploaded'));
  end if;
end $$;
