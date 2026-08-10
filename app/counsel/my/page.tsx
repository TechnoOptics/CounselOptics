import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getActiveFirmContext } from '@/lib/firm-storage';
import { getCurrentUser } from '@/lib/supabase/server';
import { getFirmSurfaceSettings } from '@/lib/firm-settings';
import { FIRM_ROLE_LABEL } from '@/lib/firm-types';
import {
  canReadMatterMaterial,
  getMyCounselFigures,
} from '@/lib/counsel-reports-data';
import { buildMyTiles } from '@/lib/counsel-reports';
import { PageHeader } from '@/components/counsel/ui';
import { MonoRef, relativeTime, shortRef } from '@/components/counsel/patterns';
import { CardEmpty, ReportCard, StatTile } from '@/components/counsel/reports';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { absolute: 'My work · Advottic Counsel' },
  description: 'What is in your name at this firm, and what people have said back.',
  robots: { index: false, follow: false },
};

/**
 * /counsel/my - one person's own work.
 *
 * Everything here is scoped to the signed-in member, and every figure comes
 * from a `count: 'exact'` query narrowed by their own user id, so nothing on
 * this page is a share of a page of rows.
 *
 * NO HEADER ACTIONS, deliberately. There is nothing here to export that
 * /counsel/reports does not already give the firm, and a second Export
 * writing a subset of the same figures is how two spreadsheets come to
 * disagree.
 *
 * THE SUBTITLE IS AN IDENTITY, NOT A DESCRIPTION. The reference product
 * subtitles this screen with who the reader is; the page above it subtitles
 * with what the screen is for. Both are firm data, so both are marked
 * `data-no-translate`.
 *
 * SAFE FOR EVERY ROLE, with one figure withheld. `cases` refuses a `staff`
 * member under the applied 20260731_staff_role_read_scope migration and the
 * refusal is silent, so "My open matters" is absent for that role rather than
 * shown as a zero. Requests, signing, approvals and time entries are
 * member-wide reads and stay.
 *
 * WHAT THIS PAGE DOES NOT CLAIM TO HAVE. The reference screen's second panel
 * is the reader's own recent satisfaction ratings. Advottic has no rating of a
 * person anywhere: `close_surveys` is the consumer case-close survey, is
 * select-own under RLS, and has no firm or attorney on it at all. So the panel
 * here is the honest neighbour of that idea and is labelled as what it
 * actually is - the last things colleagues and clients said back on the
 * requests in this person's name - rather than borrowed language for a score
 * that does not exist.
 */
export default async function CounselMyPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=/counsel/my');

  const surfaces = await getFirmSurfaceSettings(ctx.firm.id);
  const matterMaterial = canReadMatterMaterial(ctx.membership.role);
  const f = await getMyCounselFigures({
    firmId: ctx.firm.id,
    userId: user.id,
    role: ctx.membership.role,
    hideTimeBilling: surfaces.hideTimeBilling,
  });

  const tiles = buildMyTiles(
    {
      myOpenMatters: f.myOpenMatters,
      myOpenRequests: f.myOpenRequests,
      myRequestsNeedingAttention: f.myRequestsNeedingAttention,
      firmOpenRequests: f.firmOpenRequests,
      mySignaturesOut: f.mySignaturesOut,
      myApprovalDecisionsInWindow: f.myApprovalDecisionsInWindow,
      myTimeEntriesInWindow: f.myTimeEntriesInWindow,
    },
    {
      canReadMatterMaterial: matterMaterial,
      hideTimeBilling: surfaces.hideTimeBilling,
    },
  );

  const who =
    ctx.membership.displayName ?? ctx.membership.email ?? 'This account';

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        size="lg"
        eyebrow={<T>Counsel</T>}
        title={<T>My work</T>}
        subtitle={
          <span data-no-translate>
            {who} · {ctx.firm.name} ·{' '}
            {FIRM_ROLE_LABEL[ctx.membership.role].toLowerCase()}
          </span>
        }
      />

      <section
        className={`grid grid-cols-2 gap-3 md:grid-cols-3 ${
          tiles.length >= 6 ? 'xl:grid-cols-6' : 'xl:grid-cols-5'
        }`}
      >
        {tiles.map((t) => (
          <StatTile
            key={t.id}
            label={t.label}
            display={t.display}
            hint={t.caption}
            tone={t.tone}
            href={t.href}
          />
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <ReportCard title="My open queue" qualifier="Longest waiting first">
          {f.myQueue.length === 0 ? (
            <CardEmpty>
              <T>Nothing is assigned to you and still open.</T>
            </CardEmpty>
          ) : (
            <ul className="-my-1 divide-y divide-edge">
              {f.myQueue.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/counsel/intake/${r.id}`}
                    className="flex items-center gap-2 py-2 transition-colors hover:bg-surface-2"
                  >
                    <MonoRef title={r.id}>{shortRef(r.id)}</MonoRef>
                    <span
                      className="min-w-0 flex-1 truncate text-[13px] text-foreground"
                      data-no-translate
                    >
                      {r.clientName}
                    </span>
                    <span
                      className="shrink-0 text-[11.5px] tabular-nums text-muted"
                      data-no-translate
                    >
                      {relativeTime(r.createdAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </ReportCard>

        <ReportCard title="Replies on my requests" qualifier="Most recent first">
          {f.myRepliesFailed ? (
            // Not "nobody has replied": that would be a claim about the firm
            // made on the strength of a read that did not happen.
            <CardEmpty>
              <T>Replies could not be loaded just now.</T>
            </CardEmpty>
          ) : f.myReplies.length === 0 ? (
            <CardEmpty>
              <T>Nobody has replied on a request in your name yet.</T>
            </CardEmpty>
          ) : (
            <ul className="-my-1 divide-y divide-edge">
              {f.myReplies.map((m) => (
                <li key={m.id}>
                  <Link
                    href={`/counsel/intake/${m.intakeId}`}
                    className="block py-2 transition-colors hover:bg-surface-2"
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span
                        className="truncate text-[12.5px] font-medium text-foreground"
                        data-no-translate
                      >
                        {m.authorName}
                      </span>
                      <span
                        className="shrink-0 text-[11.5px] tabular-nums text-muted"
                        data-no-translate
                      >
                        {relativeTime(m.createdAt)}
                      </span>
                    </span>
                    <span
                      className="mt-0.5 line-clamp-2 block text-[12.5px] text-muted"
                      data-no-translate
                    >
                      {m.body}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </ReportCard>
      </section>
    </div>
  );
}
