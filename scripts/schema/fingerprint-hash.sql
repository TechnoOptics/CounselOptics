-- Authoritative schema-drift signal: a single sha256 over the deterministic
-- fingerprint of the `public` schema.
--
-- This returns the SAME per-object lines as fingerprint.sql (KEEP THE TWO IN
-- SYNC), aggregated (sorted, newline-joined, trailing newline) and hashed
-- server-side. The CI drift gate compares this value against the committed
-- baseline supabase/schema-fingerprint.sha256. Because the hash is computed
-- entirely inside Postgres both when the baseline is generated and in CI, the
-- comparison is immune to psql client formatting / locale; it differs only
-- when the schema itself differs.
--
-- Regenerate the baseline after an intentional schema change:
--   psql "$SUPABASE_DB_URL" -X -q -t -A -f scripts/schema/fingerprint-hash.sql \
--     | tr -d '[:space:]' > supabase/schema-fingerprint.sha256
-- (see scripts/schema/README.md)
with tbls as (
  select 'table | ' || t.relname
       || ' | rls=' || t.relrowsecurity
       || ' | cols_md5=' || md5(coalesce((
            select string_agg(
                     c.column_name || ':' || c.data_type || ':' || c.is_nullable
                       || ':' || coalesce(c.column_default, ''),
                     '|' order by c.column_name)
            from information_schema.columns c
            where c.table_schema = 'public' and c.table_name = t.relname
          ), '')) as line
  from pg_class t
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public' and t.relkind = 'r'
),
cons as (
  select 'constraint | ' || rel.relname || ' | ' || con.conname
       || ' | md5=' || md5(pg_get_constraintdef(con.oid)) as line
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace n on n.oid = rel.relnamespace
  where n.nspname = 'public'
),
idx as (
  select 'index | ' || i.tablename || ' | ' || i.indexname
       || ' | md5=' || md5(i.indexdef) as line
  from pg_indexes i
  where i.schemaname = 'public'
),
pol as (
  select 'policy | ' || p.tablename || ' | ' || p.policyname
       || ' | md5=' || md5(
            p.cmd || '|' || array_to_string(p.roles, ',')
            || '|' || coalesce(p.qual, '') || '|' || coalesce(p.with_check, '')
          ) as line
  from pg_policies p
  where p.schemaname = 'public'
),
trg as (
  select 'trigger | ' || c.relname || ' | ' || t.tgname
       || ' | md5=' || md5(pg_get_triggerdef(t.oid)) as line
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal
),
fns as (
  select 'function | ' || p.proname
       || '(' || pg_get_function_identity_arguments(p.oid) || ')'
       || ' | secdef=' || p.prosecdef
       || ' | md5=' || md5(pg_get_functiondef(p.oid)) as line
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind in ('f', 'p')
),
-- Who may EXECUTE a function, and who may touch a table or a column.
--
-- Added after a live check found credit_firm_token_pool, a SECURITY DEFINER
-- function, executable by `authenticated`: any signed in user could credit a
-- firm's token pool over PostgREST. Its three siblings were service_role
-- only, so it was an oversight, and nothing caught it because the block
-- above hashes a function's DEFINITION and not its ACL. A drift gate blind
-- to the grant cannot see the difference between a private function and a
-- public one.
--
-- Table and column ACLs are here for the same reason: RLS cannot express a
-- column-level constraint, so the only mechanism that stops a collaborator
-- rewriting their own `role` is a column GRANT. That is load-bearing and it
-- was equally invisible.
privs as (
  select 'execute | ' || p.proname
       || '(' || pg_get_function_identity_arguments(p.oid) || ')'
       || ' | ' || coalesce(array_to_string(p.proacl::text[], ','), 'default')
         as line
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind in ('f', 'p')
  union all
  select 'grant | ' || c.relname
       || ' | ' || coalesce(array_to_string(c.relacl::text[], ','), 'default')
         as line
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
  union all
  select 'grant | ' || c.relname || '.' || a.attname
       || ' | ' || array_to_string(a.attacl::text[], ',') as line
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and a.attacl is not null
),
lines as (
  select replace(replace(line, chr(13), ' '), chr(10), ' ') as line
  from (
    select line from tbls
    union all select line from cons
    union all select line from idx
    union all select line from pol
    union all select line from trg
    union all select line from fns
    union all select line from privs
  ) all_lines
)
select encode(
         sha256(convert_to(string_agg(line, chr(10) order by line) || chr(10), 'UTF8')),
         'hex'
       ) as fingerprint_sha256
from lines;
