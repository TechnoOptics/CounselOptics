import { notFound, redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { FIRM_MANAGE_ROLES } from '@/lib/firm-authz';
import { getFormForType, getRequestTypeById } from '@/lib/form-queries';
import { BuilderClient } from './builder-client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Intake form · Counsel' };

/**
 * The builder for one request type's form.
 *
 * Order of checks matters and mirrors `gateOnType` in lib/form-actions.ts: the
 * caller's own workspace and role first, then the request type, then a
 * comparison of the type's firm against the caller's. The type id arrives in
 * the URL where anyone can edit it, so a type belonging to another firm has to
 * come back as not-found rather than as a page that renders someone else's
 * questions.
 *
 * `getFormForType` is scoped by firm as well, which makes that check twice.
 * That is on purpose: this page reads through the service-role client, so
 * nothing below it will catch a mistake here.
 */
export default async function IntakeFormBuilderPage({
  params,
}: {
  params: { typeId: string };
}) {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  if (!FIRM_MANAGE_ROLES.includes(ctx.membership.role)) redirect('/counsel');

  const admin = createAdminSupabase();
  if (!admin) redirect('/counsel');

  const type = await getRequestTypeById(admin, params.typeId);
  if (!type || type.firmId !== ctx.firm.id) notFound();

  const state = await getFormForType(admin, ctx.firm.id, type.id);
  if (!state) notFound();

  return (
    <BuilderClient
      type={{ id: type.id, key: type.key, label: type.label, mode: type.mode }}
      // Raw `draft_payload` jsonb, uncoerced. `FormRenderer` and the builder's
      // own reader both take `unknown`, and running it through
      // `readFormPayload` here would drop the question the author had not
      // finished writing when they last closed the tab.
      initialDraft={state.draft}
      draftUpdatedAt={state.draftUpdatedAt}
      publishedVersion={state.publishedVersion}
      published={state.published}
    />
  );
}
