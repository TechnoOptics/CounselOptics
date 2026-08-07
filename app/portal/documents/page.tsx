import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { getWorkspacePersona } from '@/lib/persona';
import { ExternalLink } from '@/components/ExternalLink';
import { visibleIntakeIds } from '@/lib/portal-scope';
import { groupByCategory } from '@/lib/document-category';
import { selectSigningArtifact } from '@/lib/signing-artifact';
import { displayTicket } from '@/lib/ticket-numbers';
import { PageHeader, EmptyState } from '@/components/counsel/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Documents · Hub' };

type Att = { name: string; path: string; size?: number; type?: string };

/**
 * One row on this page, from either of its two sources.
 *
 * The second source is the point of this change. This page read only intake
 * attachments, so a document the employee filed, legal approved and the other
 * side signed appeared here nowhere at all: the employee dropped out of their
 * own process at the exact moment it completed.
 *
 * `category` is what the record says the document was filed under, read off
 * the row rather than derived a second time. An attachment has none and
 * groups under Unfiled.
 */
type Doc = {
  name: string;
  url: string | null;
  /** Where this document came from, and the label for the link to it. */
  href: string;
  context: string;
  category: string | null;
  size?: number;
};

export default async function HubDocumentsPage({
  searchParams,
}: {
  searchParams?: { q?: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=/portal/documents');
  const persona = await getWorkspacePersona();
  if (persona.kind !== 'employee') redirect('/portal');

  const admin = createAdminSupabase();
  const docs: Doc[] = [];
  if (admin) {
    // Yours and the ones you were invited onto - see lib/portal-scope.ts.
    const visible = await visibleIntakeIds(admin, user.id, persona.firm.id);
    const { data } = visible.length
      ? await admin
          .from('firm_matter_intakes')
          .select('id, client_name, intake_answers')
          .eq('firm_id', persona.firm.id)
          .in('id', visible)
          .order('created_at', { ascending: false })
          .limit(100)
      : { data: [] };
    // Flatten every attachment across every request first, then sign
    // all paths in ONE storage call. The old per-attachment await made
    // this page's latency scale linearly with the employee's document
    // count (an N+1 round-trip per file).
    const entries: Array<{ att: Att; requestId: string; requestName: string }> =
      [];
    for (const r of (data ?? []) as Array<{
      id: string;
      client_name: string;
      intake_answers: Record<string, unknown> | null;
    }>) {
      const atts = (r.intake_answers ?? {}).attachments;
      if (!Array.isArray(atts)) continue;
      for (const a of atts as Att[]) {
        if (!a?.path) continue;
        entries.push({ att: a, requestId: r.id, requestName: r.client_name });
      }
    }

    // The second source: documents this employee filed that have been signed.
    //
    // Every column named below arrives with 20260807_flow_join.sql, which the
    // owner has not applied. PostgREST refuses the whole statement when a
    // projection names a column the table does not have, so an error is
    // exactly what a firm without the migration gets, and it has to leave
    // this page looking the way it looks today rather than emptying it.
    const executed: Array<{
      path: string;
      name: string;
      category: string | null;
      href: string;
      context: string;
    }> = [];
    const { data: subs, error: subsError } = await admin
      .from('firm_template_submissions')
      .select('id, template_name, category, ticket_number, signing_request_id')
      .eq('firm_id', persona.firm.id)
      .eq('submitted_by', user.id)
      .order('submitted_at', { ascending: false })
      .limit(200);
    const filed = subsError
      ? []
      : ((subs ?? []) as Array<{
          id: string;
          template_name: string;
          category: string | null;
          ticket_number: string | null;
          signing_request_id: string | null;
        }>).filter((r) => Boolean(r.signing_request_id));
    if (filed.length > 0) {
      const { data: reqs } = await admin
        .from('firm_signing_requests')
        .select('id, status, signed_file_path')
        .in(
          'id',
          filed.map((r) => String(r.signing_request_id)),
        );
      const byRequest = new Map(
        ((reqs ?? []) as Array<{
          id: string;
          status: string | null;
          signed_file_path: string | null;
        }>).map((r) => [r.id, r]),
      );
      for (const row of filed) {
        const request = byRequest.get(String(row.signing_request_id));
        if (!request) continue;
        // The same rule the counsel surfaces use, reused rather than
        // restated: an executed copy is honoured only on a completed
        // request, because a signed_file_path on a request that is not
        // completed belongs to an earlier state of it and offering it would
        // assert an execution its own status denies. Passing no original is
        // what makes this the executed copy or nothing, which is what this
        // page wants: it lists finished documents.
        const artifact = selectSigningArtifact({
          status: request.status,
          signedFilePath: request.signed_file_path,
          originalFilePath: null,
        });
        if (artifact?.kind !== 'executed') continue;
        executed.push({
          path: artifact.path,
          name: row.template_name,
          category: row.category,
          href: `/portal/forms/submissions/${row.id}`,
          context: displayTicket({ ticketNumber: row.ticket_number, id: row.id }),
        });
      }
    }

    // One signed-URL batch across both sources. Both live in the same bucket,
    // and a round trip per file is the N+1 this page already removed once.
    const urlByPath = new Map<string, string>();
    const paths = [
      ...entries.map((e) => e.att.path),
      ...executed.map((e) => e.path),
    ];
    if (paths.length > 0) {
      try {
        const { data: signed } = await admin.storage
          .from('firm-documents')
          .createSignedUrls(paths, 60 * 30);
        for (const s of signed ?? []) {
          if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
        }
      } catch {
        /* leave urls null - the row still renders without a link */
      }
    }

    for (const e of executed) {
      docs.push({
        name: e.name,
        url: urlByPath.get(e.path) ?? null,
        href: e.href,
        context: e.context,
        category: e.category,
      });
    }
    for (const e of entries) {
      docs.push({
        name: e.att.name || 'Document',
        url: urlByPath.get(e.att.path) ?? null,
        href: `/portal/${e.requestId}`,
        context: e.requestName,
        category: null,
        size: e.att.size,
      });
    }
  }

  // Search across the name and whatever the document belongs to, which is a
  // request for an attachment and the filed document's own reference for a
  // signed copy. Server-rendered via ?q= so filtered views are shareable;
  // each row already names its source and links into it.
  const query = (searchParams?.q ?? '').trim().toLowerCase();
  const shown = query
    ? docs.filter((d) => `${d.name} ${d.context}`.toLowerCase().includes(query))
    : docs;
  // Grouped under what each document was filed as, Unfiled last. The same
  // helper the legal team's queues use, so the two sides of the product never
  // disagree about what counts as one category.
  const groups = groupByCategory(shown, (d) => d.category);

  return (
    <div className="space-y-7 animate-fade-up">
      <PageHeader
        eyebrow={persona.firm.name}
        title="Documents"
        subtitle={
          <>
            Documents you&rsquo;ve attached to a request, and the ones you filed
            that have been signed. To add a document, attach it when you file or
            message legal on a request.
          </>
        }
      />
      <form action="/portal/documents" method="get" className="max-w-xl">
        <div className="search-pill-gold search-pill-gold-dark relative rounded-full">
          <span aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-cream-100/40">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="m20 20-3.6-3.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search your documents or requests…"
            className="w-full rounded-full bg-transparent py-2.5 pl-11 pr-4 text-[14px] text-cream-100 outline-none placeholder:text-cream-100/40"
            data-no-translate
          />
        </div>
      </form>

      {shown.length === 0 && query ? (
        <EmptyState title={<>Nothing matches “{query}”.</>} />
      ) : docs.length === 0 ? (
        <EmptyState
          title="No documents yet"
          sub={
            <>
              Attach files on the{' '}
              <Link
                href="/portal/new"
                className="underline text-gold-300 hover:text-gold-200"
              >
                new request
              </Link>{' '}
              form and they&rsquo;ll appear here.
            </>
          }
        />
      ) : (
        <div className="space-y-7">
          {groups.map((group) => (
            <section key={group.category} className="space-y-2">
              {/* The firm's own words for what this is, so it is marked as
                  data the translator leaves alone. */}
              <p className="eyebrow" data-no-translate>
                {group.category}
              </p>
              <ul className="space-y-2">
                {group.rows.map((d, i) => (
                  <li
                    key={i}
                    className="popup-panel p-4 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-cream-100 truncate">
                        {d.name}
                      </p>
                      <p className="text-[12px] text-cream-100/55 mt-0.5 truncate">
                        on{' '}
                        <Link
                          href={d.href}
                          className="underline hover:text-cream-100"
                        >
                          {d.context}
                        </Link>
                        {typeof d.size === 'number' &&
                          ` · ${(d.size / 1024).toFixed(0)} KB`}
                      </p>
                    </div>
                    {d.url ? (
                      <ExternalLink
                        href={d.url}
                        className="shrink-0 btn text-[12px] ring-1 ring-gold-500/40 text-gold-200 hover:bg-gold-500/10"
                      >
                        Download
                      </ExternalLink>
                    ) : (
                      <span className="shrink-0 text-[11px] text-cream-100/60">
                        unavailable
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
