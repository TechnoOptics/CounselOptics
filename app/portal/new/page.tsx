import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getWorkspacePersona } from '@/lib/persona';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { CreateIntakeForm } from '@/app/counsel/intake/create-intake-form';
import { PageHeader, SectionTitle } from '@/components/counsel/ui';
import { RequestTypeTiles } from '@/components/portal/RequestTypeTiles';
import { listEmployeeRequestTypes, resolveRequestType } from '@/lib/request-types';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New request · Portal' };

export default async function PortalNewRequestPage({
  searchParams,
}: {
  /**
   * `?type=` is set by the Hub tiles and by the full grid below. It
   * carries the request type's label, which is also what gets stored on
   * the intake. An unrecognised or absent value resolves to null and
   * the form falls back to its own default, so a hand-typed or stale
   * URL still opens a working form.
   */
  searchParams?: { type?: string };
}) {
  const persona = await getWorkspacePersona();
  if (persona.kind !== 'employee') redirect('/portal');
  // Filing is a gated capability - a view-only role can't reach this.
  if (!persona.entitlements.includes('requests.create')) {
    redirect('/portal');
  }

  const submittedBy =
    persona.employee.displayName || persona.employee.email;

  const requestTypes = await listEmployeeRequestTypes(
    createAdminSupabase(),
    persona.firm.id,
  );
  const chosen = resolveRequestType(requestTypes, searchParams?.type);

  return (
    // Choosing is a browsing task and wants the width; filling in is a
    // reading task and does not. So the page runs wide while the menu
    // is up and narrows to the form's own measure once a type is
    // picked. Both strings are literal - Tailwind cannot see one that
    // is assembled at runtime.
    <div
      className={
        chosen
          ? 'mx-auto max-w-2xl space-y-6 animate-fade-up'
          : 'mx-auto max-w-5xl space-y-6 animate-fade-up'
      }
    >
      <div>
        <div className="mb-4">
          <Link
            href="/portal"
            className="inline-block text-sm text-cream-100/60 hover:text-cream-100"
          >
            &larr; <T>Back to my requests</T>
          </Link>
        </div>
        <PageHeader
          size="lg"
          eyebrow={<span data-no-translate>{persona.firm.name}</span>}
          title={<T>File a request to legal</T>}
          subtitle={
            chosen ? (
              <T>
                Tell legal what you need and submit. You can track it from My
                requests.
              </T>
            ) : (
              <T>
                Pick the kind of request below, or fill in the form directly.
                You can track everything from My requests.
              </T>
            )
          }
        />
      </div>

      {/*
        The full menu, shown only when the employee arrived without a
        type. Once a type is chosen the grid steps out of the way: it
        would otherwise sit above a form somebody has started typing
        into, and every tile is a navigation that would discard it.
        Changing your mind goes back through "Choose a different type",
        which is a deliberate act on an empty form.
      */}
      {chosen ? (
        <p className="text-[13px] text-cream-100/60">
          <T>Filing a</T>{' '}
          <span className="font-semibold text-cream-100" data-no-translate>
            {chosen.label}
          </span>
          {'. '}
          <Link
            href="/portal/new"
            className="text-gold-300 underline-offset-2 hover:text-gold-200 hover:underline"
          >
            <T>Choose a different type</T>
          </Link>
        </p>
      ) : (
        requestTypes.length > 0 && (
          <section className="space-y-3">
            <SectionTitle><T>What do you need?</T></SectionTitle>
            <RequestTypeTiles types={requestTypes} />
          </section>
        )
      )}

      <div className="max-w-2xl">
        <CreateIntakeForm
          firmId={persona.firm.id}
          defaultSubmittedBy={submittedBy}
          employeeMode
          redirectBase="/portal"
          initialRequestType={chosen?.label}
        />
      </div>
    </div>
  );
}
