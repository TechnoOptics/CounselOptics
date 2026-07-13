-- Per-matter text normalization rules, applied to every AI-generated surface
-- (approach argument, legal review, timeline narrative) before it is persisted.
-- Lets a matter enforce naming conventions permanently, e.g. always render the
-- subject as "STH", never "SH", so a re-run can never reintroduce the wrong
-- form. Shape: jsonb array of { "from": "...", "to": "..." } (whole-token,
-- word-boundary replacements applied in lib/text-normalize.ts).
--
-- Idempotent.

alter table public.cases
  add column if not exists text_normalizations jsonb not null default '[]'::jsonb;

-- Seed the Zinpro v. Hohag matter with the SH -> STH rule.
update public.cases
set text_normalizations = '[{"from":"SH","to":"STH"}]'::jsonb
where id = 'b3b2510f-6a35-4928-9adc-ee02704bf8b4'
  and not (text_normalizations @> '[{"from":"SH","to":"STH"}]'::jsonb);
