import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { getWorkspacePersona } from '@/lib/persona';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Documents · Hub' };

type Att = { name: string; path: string; size?: number; type?: string };

export default async function HubDocumentsPage() {
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
    const { data } = await admin
      .from('firm_matter_intakes')
      .select('id, client_name, intake_answers')
      .eq('firm_id', persona.firm.id)
      .eq('created_by', user.id)
      .order('created_at', { ascending: false })
      .limit(100);
    for (const r of (data ?? []) as Array<{
      id: string;
      client_name: string;
      intake_answers: Record<string, unknown> | null;
    }>) {
      const atts = (r.intake_answers ?? {}).attachments;
      if (!Array.isArray(atts)) continue;
      for (const a of atts as Att[]) {
        if (!a?.path) continue;
        let url: string | null = null;
        try {
          const { data: signed } = await admin.storage
            .from('firm-documents')
            .createSignedUrl(a.path, 60 * 30);
          url = signed?.signedUrl ?? null;
        } catch {
          url = null;
        }
        docs.push({
          name: a.name || 'Document',
          url,
          requestId: r.id,
          requestName: r.client_name,
          size: a.size,
        });
      }
    }
  }

  return (
    <div className="space-y-7 animate-fade-up">
      <header>
        <p className="eyebrow mb-1">{persona.firm.name}</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-cream-100">
          Documents
        </h1>
        <p className="text-sm text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
          Everything you&rsquo;ve attached to a request. To add a
          document, attach it when you file or message legal on a
          request.
        </p>
      </header>
      {docs.length === 0 ? (
        <div className="popup-panel p-6 text-[13px] text-cream-100/60 italic">
          No documents yet. Attach files on the{' '}
          <Link
            href="/portal/new"
            className="underline text-gold-300 hover:text-gold-200 not-italic"
          >
            new request
          </Link>{' '}
          form and they&rsquo;ll appear here.
        </div>
      ) : (
        <ul className="space-y-2">
          {docs.map((d, i) => (
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
                <a
                  href={d.url}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 btn text-[12px] ring-1 ring-gold-500/40 text-gold-200 hover:bg-gold-500/10"
                >
                  Download
                </a>
              ) : (
                <span className="shrink-0 text-[11px] text-cream-100/40">
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
