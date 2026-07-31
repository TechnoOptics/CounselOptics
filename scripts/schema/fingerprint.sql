-- Deterministic schema fingerprint of the `public` schema.
--
-- Emits ONE short text line per schema object (table, constraint, index,
-- policy, trigger, function), globally sorted. Each object's IDENTITY (name,
-- owning table) is kept in plaintext so a diff pinpoints exactly what drifted,
-- while its DEFINITION is folded into an md5 so the baseline stays compact and
-- immune to cosmetic formatting. A table's line also carries an md5 of all its
-- columns (name:type:nullable:default), so an added/dropped/retyped column or a
-- changed default flips that table's line.
--
-- A line diff against the committed baseline (supabase/schema-fingerprint.txt)
-- surfaces any drift between the live database and what git records.
--
-- Run in CI with: psql "$SUPABASE_DB_URL" -X -q -t -A -f scripts/schema/fingerprint.sql
-- (-t no header/footer, -A unaligned -> one bare field per line, exactly the
-- format the committed baseline is stored in). Regenerate the baseline the same
-- way after an intentional schema change; see scripts/schema/README.md.
--
-- Ordering and hashing are server-side, so the baseline (generated against the
-- live DB) and the CI dump (same live DB) match unless the schema truly changed.
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
)
select replace(replace(line, chr(13), ' '), chr(10), ' ') as line
from (
  select line from tbls
  union all select line from cons
  union all select line from idx
  union all select line from pol
  union all select line from trg
  union all select line from fns
) all_lines
order by 1;
