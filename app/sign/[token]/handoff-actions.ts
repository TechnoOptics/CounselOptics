'use server';

import { createAdminSupabase } from '@/lib/supabase/admin';
import { createHandoff } from '@/lib/signing-handoff-queries';
import { qrSvg } from '@/lib/qr-svg';
import {
  mintSigningHandoff,
  type MintHandoffResult,
  type MintSignatureRow,
} from '@/lib/signing-handoff-mint';
import type { DesktopDisclosureConsentInput } from '@/lib/signing-handoff';

/**
 * The two things the laptop asks the server for while it is offering a
 * mobile handoff.
 *
 * Every 'use server' export is a public HTTP endpoint, so both of these
 * are directly callable by anyone, with any arguments, in any order.
 * Neither treats an argument as proof of anything except the durable
 * signer token, which is the credential the client legitimately holds
 * and the only thing here that identifies the signer. There is no
 * signature id in either signature, because an id supplied by a caller
 * would let one signer mint a code against another signer's row.
 *
 * The decisions themselves are lib/signing-handoff-mint.ts, which takes
 * its lookup, its insert and its encoder as arguments and is therefore
 * unit tested down every refusal. This file is the adapter that supplies
 * the real three.
 */

/**
 * Mint a one-time handoff and return it as an inline SVG QR code.
 *
 * `consent` is the electronic-records disclosure the signer affirmed on
 * this page a moment ago. It is carried onto the handoff row so that a
 * signature finished on the phone records the same disclosure a
 * signature finished here would, and the mint refuses without it.
 */
export async function mintSigningHandoffAction(
  signerToken: string,
  consent: DesktopDisclosureConsentInput,
): Promise<MintHandoffResult> {
  return mintSigningHandoff(signerToken, consent, {
    // Absolute, so a phone camera has something it can actually open.
    // Same default as every other outbound link in the codebase.
    origin: process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://advottic.com',

    loadSignature: async (token): Promise<MintSignatureRow | null> => {
      const admin = createAdminSupabase();
      if (!admin) return null;
      const { data } = await admin
        .from('firm_signatures')
        .select('id, signed_at, access_code_hash, access_code_verified_at, response')
        .eq('token', token)
        .maybeSingle();
      if (!data) return null;
      const row = data as {
        id: string;
        signed_at: string | null;
        access_code_hash: string | null;
        access_code_verified_at: string | null;
        response: 'rejected' | 'changes_requested' | null;
      };
      return {
        id: row.id,
        signedAt: row.signed_at,
        accessCodeHash: row.access_code_hash,
        accessCodeVerifiedAt: row.access_code_verified_at,
        response: row.response,
      };
    },

    createHandoff,

    // Encoded here, on our own server, and inlined. A hosted QR image
    // service would mean handing a live signing credential to a third
    // party, which is the one thing this feature must not do.
    encode: qrSvg,
  });
}

/**
 * Has this signature been completed elsewhere?
 *
 * The laptop asks while a code is on screen, so that a ceremony
 * finished on the phone closes the laptop's pad instead of leaving a
 * stale QR next to a signature that already exists.
 *
 * A poll rather than a realtime subscription. This page is
 * unauthenticated, so a browser client would be anonymous, and
 * firm_signatures is neither readable by that role nor in the
 * supabase_realtime publication, so a channel here would subscribe
 * successfully and then silently never fire. A poll that works is
 * better than a subscription that looks like it does.
 *
 * It answers only for a caller who already holds the durable signing
 * link, and only with what that link's own page already shows.
 */
export async function signingCompletedAction(
  signerToken: string,
): Promise<{ signed: boolean }> {
  const token = typeof signerToken === 'string' ? signerToken.trim() : '';
  if (!token) return { signed: false };

  const admin = createAdminSupabase();
  if (!admin) return { signed: false };

  const { data } = await admin
    .from('firm_signatures')
    .select('signed_at')
    .eq('token', token)
    .maybeSingle();

  return {
    signed: Boolean((data as { signed_at: string | null } | null)?.signed_at),
  };
}
