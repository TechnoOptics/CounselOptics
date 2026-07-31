import Link from 'next/link';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { LocaleTime } from '@/components/LocaleTime';
import { adminGetCase } from '@/lib/storage';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { getCurrentUser } from '@/lib/supabase/server';
import { logSecurityEvent } from '@/lib/security-audit';
import { STATUS_LABEL, SUBJECT_TYPE_LABEL } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: { absolute: 'Case · Advottic HQ' } };

/**
 * The HQ read view of one case.
 *
 * /admin/cases listed every case in the system and linked each row to
 * /cases/[id], which reads through the user-scoped client. `public.cases`
 * grants SELECT to the owner, to collaborators, and to firm members, and to
 * nobody else, so every case an operator did not personally own opened as a
 * 404. The table showed you the row and then refused to open it.
 *
 * The fix is a separate privileged read rather than an RLS change: no
 * policy on `public.cases` was touched. This route is admin-only (the HQ
 * layout redirects anyone else) and writes an audit row on every view, so
 * reading a stranger's legal matter leaves a trace. It is deliberately
 * read-only and shows the case record itself, not its evidence.
 */
export default async function AdminCaseDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const c = await adminGetCase(params.id);
  if (!c) notFound();

  const viewer = await getCurrentUser();
  const h = headers();
  await logSecurityEvent({
    kind: 'admin_case_view',
    severity: 'info',
    userId: viewer?.id ?? null,
    ip: (h.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null,
    userAgent: h.get('user-agent'),
    url: `/admin/cases/${params.id}`,
    details: { caseId: params.id, ownerId: c.ownerId },
  });

  const admin = createAdminSupabase();
  let exhibitCount: number | null = null;
  if (admin) {
    const { count, error } = await admin
      .from('exhibits')
      .select('id', { count: 'exact', head: true })
      .eq('case_id', params.id);
    exhibitCount = error ? null : (count ?? 0);
  }

  const facts: Array<{ label: string; value: string }> = [
    { label: 'Status', value: STATUS_LABEL[c.status] },
    { label: 'Case type', value: c.caseType },
    {
      label: 'Jurisdiction',
      value: [c.jurisdiction?.city, c.jurisdiction?.state, c.jurisdiction?.country]
        .filter((p) => (p ?? '').trim().length > 0)
        .join(', '),
    },
    { label: 'Posture', value: c.posture },
    {
      label: SUBJECT_TYPE_LABEL[c.subjectType],
      value: c.subjectName,
    },
    {
      label: 'Evidence items',
      value: exhibitCount === null ? 'Could not read' : String(exhibitCount),
    },
  ];

  return (
    <div className="space-y-6 animate-fade-up">
      <p className="text-sm">
        <Link
          href="/admin/cases"
          className="text-cream-100/60 hover:text-cream-100"
        >
          &larr; All cases
        </Link>
      </p>

      <header className="space-y-1">
        <p className="eyebrow">Consumer</p>
        <h2 className="font-display text-2xl text-cream-100 tracking-[-0.01em] break-words">
          {c.title}
        </h2>
        <p className="text-[12.5px] text-cream-100/60">
          Owned by{' '}
          <span className="text-cream-100/85">
            {c.ownerDisplayName || c.ownerEmail || c.ownerId}
          </span>
          {c.ownerDisplayName && c.ownerEmail ? ` (${c.ownerEmail})` : ''} ·
          created <LocaleTime iso={c.createdAt} /> · updated{' '}
          <LocaleTime iso={c.updatedAt} />
        </p>
      </header>

      <div className="card p-4 ring-1 ring-amber-700/40 bg-amber-950/20 text-[12px] text-amber-100/85 leading-snug">
        This is privileged client data, opened with an operator key rather
        than your own access. The view has been recorded in the security
        audit log with your account, the case id, and the time.
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {facts.map((f) => (
          <article
            key={f.label}
            className="card p-4 ring-1 ring-white/10 bg-white/[0.03]"
          >
            <p className="eyebrow text-cream-100/50">{f.label}</p>
            <p className="text-[13px] text-cream-100 mt-1 break-words">
              {f.value || 'Not set'}
            </p>
          </article>
        ))}
      </section>

      {(c.hearingAt || c.hearingLocation) && (
        <section className="card p-4 ring-1 ring-white/10 bg-white/[0.03] space-y-1">
          <p className="text-[12px] font-semibold text-cream-100">Hearing</p>
          <p className="text-[12.5px] text-cream-100/75">
            {c.hearingAt ? <LocaleTime iso={c.hearingAt} mode="datetime" /> : 'No date set'}
            {c.hearingLocation ? ` · ${c.hearingLocation}` : ''}
          </p>
          {c.hearingNotes && (
            <p className="text-[12px] text-cream-100/60 whitespace-pre-wrap">
              {c.hearingNotes}
            </p>
          )}
        </section>
      )}

      <section className="space-y-2">
        <h3 className="font-display text-lg text-cream-100">Description</h3>
        <p className="card p-4 ring-1 ring-white/10 bg-white/[0.03] text-[12.5px] text-cream-100/75 leading-relaxed whitespace-pre-wrap">
          {c.description?.trim() || 'No description on this case.'}
        </p>
      </section>

      <p className="text-[11px] text-cream-100/40 font-mono break-all">
        {c.id}
      </p>
    </div>
  );
}
