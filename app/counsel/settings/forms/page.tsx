import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { FIRM_MANAGE_ROLES } from '@/lib/firm-authz';
import { getFormForType, listRequestTypes, type FormState } from '@/lib/form-queries';
import { PageHeader, EmptyState } from '@/components/counsel/ui';
import { IntakeIcon } from '@/components/counsel/icons';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Intake forms · Counsel' };

/**
 * The register of request types and the state of each one's form.
 *
 * This page reads through the service-role client, so the gate below is the
 * only authorization on it. The role set is `FIRM_MANAGE_ROLES`, the same one
 * every action in lib/form-actions.ts checks, so a reader who can open this
 * page is a reader who can act on what it lists.
 *
 * `listRequestTypes` returns hidden types too, deliberately: this is the only
 * surface from which a hidden type can be brought back.
 */
export default async function IntakeFormsIndexPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  if (!FIRM_MANAGE_ROLES.includes(ctx.membership.role)) redirect('/counsel');

  const admin = createAdminSupabase();
  if (!admin) redirect('/counsel');

  const types = await listRequestTypes(admin, ctx.firm.id);
  const states = await Promise.all(
    types.map((t) => getFormForType(admin, ctx.firm.id, t.id)),
  );

  return (
    <div className="space-y-8 animate-fade-up">
      <PageHeader
        eyebrow={<T>Firm settings</T>}
        title={<T>Intake forms</T>}
        subtitle={
          <T>
            Choose what your colleagues are asked when they bring legal a request. Each
            request type carries its own form, and each form is published as a numbered
            version, so a request keeps the questions it was filed with.
          </T>
        }
      />

      {types.length === 0 ? (
        <EmptyState
          icon={<IntakeIcon />}
          title={<T>No request types yet</T>}
          sub={
            <T>
              A request type is what an employee picks before they answer anything. Once
              your firm has one, its form is built here.
            </T>
          }
        />
      ) : (
        <ul className="card divide-y divide-ink-100 dark:divide-forest-700/40">
          {types.map((type, i) => (
            <li key={type.id}>
              <Link
                href={`/counsel/settings/forms/${type.id}`}
                className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 px-5 py-4 transition-colors hover:bg-cream-50 dark:hover:bg-forest-800/50"
              >
                <div className="min-w-0">
                  <p className="font-display text-lg font-medium text-forest-900 dark:text-cream-100">
                    {type.label}
                    {type.hidden && (
                      <span className="ml-2 align-middle text-[11px] font-normal uppercase tracking-[0.14em] text-ink-500 dark:text-cream-100/50">
                        <T>Hidden</T>
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 font-mono text-[12px] text-ink-500 dark:text-cream-100/50">
                    {type.key} &middot;{' '}
                    {type.mode === 'client' ? <T>Client facing</T> : <T>In house</T>}
                  </p>
                </div>
                <FormStateLine state={states[i]} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The four states a form can be in, said plainly. "Draft" is gold because it
 * is the only one asking the reader to do something; the rest are facts.
 */
function FormStateLine({ state }: { state: FormState | null }) {
  const hasDraft = state?.draft != null;
  const version = state?.publishedVersion ?? null;

  if (version === null) {
    return (
      <span
        className={`shrink-0 text-[13px] ${
          hasDraft
            ? 'text-gold-700 dark:text-gold-300'
            : 'text-ink-500 dark:text-cream-100/50'
        }`}
      >
        {hasDraft ? <T>Draft, never published</T> : <T>No form yet</T>}
      </span>
    );
  }

  return (
    <span className="shrink-0 text-[13px] text-ink-600 dark:text-cream-100/70">
      <T>Published</T> <span className="tabular-nums">v{version}</span>
      {hasDraft && (
        <span className="text-gold-700 dark:text-gold-300">
          {' '}
          &middot; <T>unpublished changes</T>
        </span>
      )}
    </span>
  );
}
