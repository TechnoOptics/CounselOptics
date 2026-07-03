-- 2026-07-02: Community Case gallery images.
--
-- The organizer can already set a single banner image
-- (community_cases.banner_image_path). This adds a proper gallery of
-- additional photos, following the exact same pattern as
-- community_case_links: organizer-only RLS select policy, public reads
-- go through a SECURITY DEFINER RPC that only returns published/closed
-- pages, and the images themselves live in the same public
-- `community-public` storage bucket the banner already uses (these are
-- photos the organizer explicitly chose to publish, same trust level as
-- the banner - unlike witness_submissions' private bucket).

create table if not exists public.community_case_images (
  id uuid primary key default gen_random_uuid(),
  community_case_id uuid not null references public.community_cases(id) on delete cascade,
  storage_path text not null,
  caption text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists community_case_images_case_idx
  on public.community_case_images (community_case_id, sort_order);

alter table public.community_case_images enable row level security;

drop policy if exists "community_case_images_select" on public.community_case_images;
create policy "community_case_images_select"
  on public.community_case_images for select
  using (private.is_case_owner_or_attorney(
    (select case_id from public.community_cases where id = community_case_id)
  ));

drop policy if exists "community_case_images_insert" on public.community_case_images;
create policy "community_case_images_insert"
  on public.community_case_images for insert
  with check (private.is_case_owner(
    (select case_id from public.community_cases where id = community_case_id)
  ));

drop policy if exists "community_case_images_delete" on public.community_case_images;
create policy "community_case_images_delete"
  on public.community_case_images for delete
  using (private.is_case_owner(
    (select case_id from public.community_cases where id = community_case_id)
  ));

create or replace function public.get_public_community_case_images(_slug text)
returns table (
  storage_path text,
  caption text,
  sort_order int
)
language sql
security definer
stable
set search_path = public
as $$
  select i.storage_path, i.caption, i.sort_order
  from public.community_case_images i
  join public.community_cases cc on cc.id = i.community_case_id
  where cc.slug = _slug and cc.status in ('published', 'closed')
  order by i.sort_order asc;
$$;

revoke execute on function public.get_public_community_case_images(text) from public;
grant execute on function public.get_public_community_case_images(text) to anon, authenticated;
