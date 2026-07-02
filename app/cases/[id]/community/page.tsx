import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getCase } from '@/lib/storage';
import { getCurrentUser } from '@/lib/supabase/server';
import { storageUnavailable } from '@/lib/setup-status';
import {
  getCommunityCaseForCase,
  listCommunityCaseLinks,
  listWitnessSubmissions,
} from '@/lib/community-actions';
import { CommunityEditor } from './community-editor';
import { SubmissionsList } from './submissions-list';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Community Case',
  robots: { index: false, follow: false },
};

export default async function CommunityCaseAdminPage({
  params,
}: {
  params: { id: string };
}) {
  if (storageUnavailable()) redirect('/cases');
  const c = await getCase(params.id);
  if (!c) notFound();

  const user = await getCurrentUser();
  const isOwner = Boolean(user && c.ownerId === user.id);
  if (!isOwner) {
    // Community Case management is organizer-only (attorney collaborators
    // can view submissions once a page exists, but only the owner creates/
    // edits/publishes/closes it) - keep unauthorized visitors off this
    // page entirely rather than showing a disabled form.
    redirect(`/cases/${c.id}`);
  }

  const communityCase = await getCommunityCaseForCase(c.id);
  const [links, submissions] = communityCase
    ? await Promise.all([
        listCommunityCaseLinks(communityCase.id),
        listWitnessSubmissions(communityCase.id),
      ])
    : [[], []];

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      <div>
        <Link
          href={`/cases/${c.id}`}
          className="text-xs uppercase tracking-wide text-ink-500 dark:text-cream-100/55"
        >
          ← {c.title}
        </Link>
        <h1 className="font-display text-2xl sm:text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100 mt-2">
          Community Case
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 leading-relaxed">
          Publish a shareable page so the community can rally support and submit evidence to
          your attorney. Letters, addresses, and IDs submitted here are always private - only
          you and your attorney-role collaborators can see them.
        </p>
      </div>

      <CommunityEditor caseId={c.id} communityCase={communityCase} links={links} />

      {communityCase && (
        <SubmissionsList caseId={c.id} communityCaseId={communityCase.id} submissions={submissions} />
      )}
    </div>
  );
}
