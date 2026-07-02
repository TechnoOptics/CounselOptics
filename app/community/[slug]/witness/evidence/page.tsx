import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createServerSupabase, isSupabaseConfigured } from '@/lib/supabase/server';
import { EvidenceForm } from './evidence-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Share evidence or a testimonial',
  robots: { index: false, follow: false },
};

async function getPageSummary(slug: string) {
  if (!isSupabaseConfigured()) return null;
  const supabase = createServerSupabase();
  const { data } = await supabase.rpc('get_public_community_case', { _slug: slug });
  const page = (data as Array<Record<string, unknown>> | null)?.[0];
  if (!page) return null;
  return {
    displayName: page.display_name as string,
    status: page.status as string,
  };
}

export default async function CommunityEvidencePage({
  params,
}: {
  params: { slug: string };
}) {
  const page = await getPageSummary(params.slug);
  if (!page) notFound();

  if (page.status !== 'published') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream-50 dark:bg-forest-950 px-4">
        <div className="max-w-lg w-full card p-8 text-center">
          <h1 className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            This page is not currently accepting submissions.
          </h1>
          <Link href={`/community/${params.slug}`} className="btn-secondary mt-5 inline-flex">
            Back to the case page
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-cream-50 to-white dark:from-forest-950 dark:to-forest-900">
      <header className="border-b border-ink-200 dark:border-forest-700/40 bg-white/95 dark:bg-forest-950/95 backdrop-blur-md sticky top-0 z-30">
        <div className="mx-auto max-w-2xl px-4 sm:px-6 py-3">
          <Link href={`/community/${params.slug}`} className="text-sm font-semibold text-forest-900 dark:text-cream-100">
            ← {page.displayName}
          </Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-6">
        <div>
          <p className="eyebrow mb-2">Share evidence or a testimonial</p>
          <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            Help the organizer and their attorney
          </h1>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 leading-relaxed">
            Upload a photo, document, or short note about what you witnessed or know about this
            case. This is private - it goes only to the organizer and their attorney, never shown
            publicly. You do not need an Advottic account.
          </p>
        </div>

        <EvidenceForm slug={params.slug} />
      </main>
    </div>
  );
}
