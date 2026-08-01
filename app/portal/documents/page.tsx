import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { getWorkspacePersona } from '@/lib/persona';
import { ExternalLink } from '@/components/ExternalLink';
import { visibleIntakeIds } from '@/lib/portal-scope';
import { PageHeader, EmptyState } from '@/components/counsel/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Documents · Hub' };

type Att = { name: string; path: string; size?: number; type?: string };

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
  const docs: Array<{
    name: string;
    url: string | null;
    requestId: string;
    requestName: string;
    size?: number;
  }> = [];
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

    const urlByPath = new Map<string, string>();
    if (entries.length > 0) {
      try {
        const { data: signed } = await admin.storage
          .from('firm-documents')
          .createSignedUrls(
            entries.map((e) => e.att.path),
            60 * 30,
          );
        for (const s of signed ?? []) {
          if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
        }
      } catch {
        /* leave urls null - the row still renders without a link */
      }
    }

    for (const e of entries) {
      docs.push({
        name: e.att.name || 'Document',
        url: urlByPath.get(e.att.path) ?? null,
        requestId: e.requestId,
        requestName: e.requestName,
        size: e.att.size,
      });
    }
  }

  // Search across name + the request ("folder") it belongs to. Server-rendered
  // via ?q= so filtered views are shareable; each document row already names
  // its request folder and links into it.
  const query = (searchParams?.q ?? '').trim().toLowerCase();
  const shown = query
    ? docs.filter((d) => `${d.name} ${d.requestName}`.toLowerCase().includes(query))
    : docs;

  return (
    <div className="space-y-7 animate-fade-up">
      <PageHeader
        eyebrow={persona.firm.name}
        title="Documents"
        subtitle={
          <>
            Everything you&rsquo;ve attached to a request. To add a document,
            attach it when you file or message legal on a request.
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
        <ul className="space-y-2">
          {shown.map((d, i) => (
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
                    href={`/portal/${d.requestId}`}
                    className="underline hover:text-cream-100"
                  >
                    {d.requestName}
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
      )}
    </div>
  );
}
