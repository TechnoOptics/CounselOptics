import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createServerSupabase, isSupabaseConfigured } from '@/lib/supabase/server';
import {
  COMMUNITY_CASE_LINK_PLATFORM_LABEL,
  type PublicCommunityCase,
  type PublicCommunityCaseImage,
  type PublicCommunityCaseLink,
} from '@/lib/community-types';

export const dynamic = 'force-dynamic';

async function getPublicPage(slug: string) {
  if (!isSupabaseConfigured()) return null;
  const supabase = createServerSupabase();
  const [{ data: pageRows }, { data: linkRows }, { data: imageRows }] = await Promise.all([
    supabase.rpc('get_public_community_case', { _slug: slug }),
    supabase.rpc('get_public_community_case_links', { _slug: slug }),
    supabase.rpc('get_public_community_case_images', { _slug: slug }),
  ]);
  const page = (pageRows as Array<Record<string, unknown>> | null)?.[0];
  if (!page) return null;
  const communityCase: PublicCommunityCase = {
    caseNumber: page.case_number as string,
    slug: page.slug as string,
    displayName: page.display_name as string,
    publicSummary: (page.public_summary as string) ?? null,
    bondAmountCents: (page.bond_amount_cents as number) ?? null,
    hearingDisplayOverride: (page.hearing_display_override as string) ?? null,
    bannerImagePath: (page.banner_image_path as string) ?? null,
    status: page.status as PublicCommunityCase['status'],
    letterCount: (page.letter_count as number) ?? 0,
    evidenceCount: (page.evidence_count as number) ?? 0,
    publishedAt: (page.published_at as string) ?? null,
    closedAt: (page.closed_at as string) ?? null,
  };
  const links: PublicCommunityCaseLink[] = ((linkRows as Array<Record<string, unknown>>) ?? []).map(
    (row) => ({
      platform: row.platform as PublicCommunityCaseLink['platform'],
      label: (row.label as string) ?? null,
      url: (row.url as string) ?? null,
      handle: (row.handle as string) ?? null,
      sortOrder: (row.sort_order as number) ?? 0,
    }),
  );
  let bannerUrl: string | null = null;
  if (communityCase.bannerImagePath) {
    const { data } = supabase.storage
      .from('community-public')
      .getPublicUrl(communityCase.bannerImagePath);
    bannerUrl = data?.publicUrl ?? null;
  }
  const galleryImages: Array<PublicCommunityCaseImage & { url: string }> = (
    (imageRows as Array<Record<string, unknown>>) ?? []
  ).map((row) => {
    const storagePath = row.storage_path as string;
    const { data } = supabase.storage.from('community-public').getPublicUrl(storagePath);
    return {
      storagePath,
      caption: (row.caption as string) ?? null,
      sortOrder: (row.sort_order as number) ?? 0,
      url: data?.publicUrl ?? '',
    };
  });
  return { communityCase, links, bannerUrl, galleryImages };
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const data = await getPublicPage(params.slug);
  if (!data) return { title: 'Community Case · Not found' };
  // noindex by default (see the plan's rationale: the subject is a real
  // person in active legal/immigration proceedings, and broad
  // discoverability serves a hostile audience, not the organizer's
  // intended one - direct/social sharing). There is no organizer opt-in
  // toggle yet in v1; when one ships, this should read
  // community_cases.search_indexable instead of hardcoding false.
  return {
    title: `${data.communityCase.displayName} · Community Case`,
    description: data.communityCase.publicSummary ?? undefined,
    robots: { index: false, follow: false },
  };
}

function formatBondAmount(cents: number | null): string | null {
  if (cents === null) return null;
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export default async function CommunityCasePublicPage({
  params,
}: {
  params: { slug: string };
}) {
  const data = await getPublicPage(params.slug);
  if (!data) notFound();
  const { communityCase: cc, links, bannerUrl, galleryImages } = data;
  const isClosed = cc.status === 'closed';

  return (
    <div className="min-h-screen bg-gradient-to-b from-cream-50 to-white dark:from-forest-950 dark:to-forest-900">
      <header className="border-b border-ink-200 dark:border-forest-700/40 bg-white/95 dark:bg-forest-950/95 backdrop-blur-md sticky top-0 z-30">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <Link href="/" className="text-sm font-semibold text-forest-900 dark:text-cream-100">
            Advottic
          </Link>
          <p className="text-[11px] text-ink-500 dark:text-cream-100/55 font-mono uppercase tracking-wider">
            {cc.caseNumber}
          </p>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-8">
        {bannerUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={bannerUrl}
            alt=""
            className="w-full max-h-80 object-cover rounded-2xl border border-ink-200 dark:border-forest-700/40"
          />
        )}

        <div>
          {isClosed && (
            <p className="eyebrow mb-2 text-amber-700 dark:text-amber-300">This page is closed</p>
          )}
          <h1 className="font-display text-3xl sm:text-4xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            {cc.displayName}
          </h1>
          {cc.publicSummary && (
            <p className="text-base text-ink-700 dark:text-cream-100/80 mt-3 leading-relaxed whitespace-pre-wrap">
              {cc.publicSummary}
            </p>
          )}
        </div>

        {galleryImages.length > 0 && (
          <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
            {galleryImages.map((img, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={img.url}
                alt={img.caption ?? ''}
                title={img.caption ?? undefined}
                className="h-28 w-28 flex-none object-cover rounded-xl border border-ink-200 dark:border-forest-700/40"
              />
            ))}
          </div>
        )}

        {(cc.bondAmountCents !== null || cc.hearingDisplayOverride) && (
          <div className="card p-5 sm:p-6 grid grid-cols-2 gap-6">
            {cc.bondAmountCents !== null && (
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] font-semibold text-ink-500 dark:text-cream-100/55">
                  Bond amount
                </p>
                <p className="font-display text-xl text-forest-900 dark:text-cream-100 mt-1">
                  {formatBondAmount(cc.bondAmountCents)}
                </p>
              </div>
            )}
            {cc.hearingDisplayOverride && (
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] font-semibold text-ink-500 dark:text-cream-100/55">
                  Hearing
                </p>
                <p className="font-display text-xl text-forest-900 dark:text-cream-100 mt-1">
                  {cc.hearingDisplayOverride}
                </p>
              </div>
            )}
          </div>
        )}

        {links.length > 0 && (
          <div>
            <p className="eyebrow mb-3">How you can help</p>
            <div className="flex flex-wrap gap-3">
              {links.map((link, i) => (
                <a
                  key={i}
                  href={link.url ?? undefined}
                  target={link.url ? '_blank' : undefined}
                  rel={link.url ? 'noopener noreferrer' : undefined}
                  className="btn-secondary"
                >
                  {link.label || COMMUNITY_CASE_LINK_PLATFORM_LABEL[link.platform]}
                  {link.handle ? ` · ${link.handle}` : ''}
                </a>
              ))}
            </div>
            <p className="text-xs text-ink-500 dark:text-cream-100/55 mt-3 leading-relaxed">
              These links go directly to the organizer&apos;s own accounts. Advottic never
              processes or holds any funds.
            </p>
          </div>
        )}

        <div className="card p-5 sm:p-6">
          <p className="eyebrow mb-2">Community support</p>
          <p className="text-sm text-ink-700 dark:text-cream-100/80">
            {cc.letterCount} {cc.letterCount === 1 ? 'letter has' : 'letters have'} been written
            and {cc.evidenceCount} {cc.evidenceCount === 1 ? 'item has' : 'items have'} been
            shared privately with the organizer and their attorney.
          </p>
          {!isClosed && (
            <div className="flex flex-wrap gap-3 mt-4">
              <Link href={`/community/${cc.slug}/witness/letter`} className="btn-primary inline-flex">
                Write a Letter of Support
              </Link>
              <Link href={`/community/${cc.slug}/witness/evidence`} className="btn-secondary inline-flex">
                Share evidence or a testimonial
              </Link>
            </div>
          )}
          <p className="text-xs text-ink-500 dark:text-cream-100/55 mt-3 leading-relaxed">
            Submissions are never shown publicly - only the organizer and their attorney can
            view them.
          </p>
        </div>
      </main>
    </div>
  );
}
