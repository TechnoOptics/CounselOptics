'use server';

import { getRealCurrentUser } from '@/lib/supabase/server';
import { getWorkspacePersona } from '@/lib/persona';
import { getPortalTemplateAction } from '@/lib/firm-templates';
import { qrSvg } from '@/lib/qr-svg';
import {
  mintMarkHandoff,
  type MintMarkHandoffResult,
} from '@/lib/mark-handoff';
import {
  collectMarkForOwner,
  createMarkHandoff,
} from '@/lib/mark-handoff-queries';

/**
 * The two things the employee's desk asks the server for while it is offering
 * a phone handoff.
 *
 * Every 'use server' export is a public HTTP endpoint, callable by anyone with
 * any arguments in any order, and this file is written on that assumption.
 * Neither export takes a firm id or a user id: both resolve the caller's own
 * identity from the session and pass it to the query layer, so there is no
 * argument here that could be swapped for somebody else's. The one id that IS
 * an argument in each is looked up under that resolved identity rather than
 * trusted, which is the difference between a filter and a check.
 *
 * The decisions are lib/mark-handoff.ts, which takes its lookup, its insert
 * and its encoder as functions and is therefore unit tested down every
 * refusal. This file is the adapter that supplies the real three.
 */

/** What every refusal here says. The employee still has the pad in front of
 *  them, so this is an inconvenience and the wording says so. */
const NOT_SIGNED_IN = 'Please sign in again, then reopen this form.';

async function employeeSession(): Promise<
  { ok: true; firmId: string; userId: string } | { ok: false; error: string }
> {
  const user = await getRealCurrentUser();
  if (!user) return { ok: false, error: NOT_SIGNED_IN };
  const persona = await getWorkspacePersona();
  // The Hub's own persona chokepoint, asked again here. The page this is
  // called from is gated, but a public endpoint is not reached only from its
  // page.
  if (persona.kind !== 'employee') return { ok: false, error: NOT_SIGNED_IN };
  return { ok: true, firmId: persona.firm.id, userId: user.id };
}

/**
 * Mint a one-time handoff for this employee and return it as inline SVG.
 *
 * The QR carries the handoff token and nothing else. It is not a way to reach
 * this session from another device: what it authorises is a single PNG upload
 * to a single row, and the phone that scans it can read nothing at all. See
 * the header of lib/mark-handoff.ts for why that asymmetry is the whole safety
 * argument for offering this to somebody who is already signed in.
 */
export async function mintPhoneMarkAction(
  templateId: string,
): Promise<MintMarkHandoffResult> {
  const session = await employeeSession();
  if (!session.ok) return { ok: false, error: session.error };

  return mintMarkHandoff(templateId, {
    // Same default as every other outbound link in the codebase. A phone
    // camera needs something absolute it can actually open.
    origin: process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://advottic.com',

    // Scoped to the session's firm, and it authorizes the caller against that
    // firm in its own right. The template id is the caller's; the firm is not.
    loadTemplate: async (id) => {
      const res = await getPortalTemplateAction(session.firmId, id);
      if (!res.ok || !res.template) return null;
      return {
        id: res.template.id,
        name: res.template.name,
        signatureMethods: res.template.signatureMethods,
      };
    },

    // Closed over the resolved identity, so the pure module above never sees
    // an id it could be tricked with.
    createHandoff: (id) =>
      createMarkHandoff({
        firmId: session.firmId,
        userId: session.userId,
        templateId: id,
      }),

    // Encoded on our own server and inlined. A hosted QR image service would
    // hand a live credential to a third party.
    encode: qrSvg,
  });
}

/**
 * Has the phone drawn yet, and if so, here it is.
 *
 * One call rather than a poll and then a fetch: the collection IS the poll, so
 * there is no window in which the desk knows a mark exists and has not got it.
 * The row is found only under this session's own user and firm, and the image
 * is handed over once. A second call after a successful one returns nothing,
 * which is what the desk wants anyway.
 */
export async function collectPhoneMarkAction(
  handoffId: string,
): Promise<{ mark: string | null; error?: string }> {
  const session = await employeeSession();
  if (!session.ok) return { mark: null, error: session.error };

  const id = typeof handoffId === 'string' ? handoffId.trim() : '';
  if (!id) return { mark: null };

  const found = await collectMarkForOwner({
    handoffId: id,
    userId: session.userId,
    firmId: session.firmId,
  });
  return { mark: found?.mark ?? null };
}
