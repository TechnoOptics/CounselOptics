/**
 * Create a Teams (Microsoft 365) or Zoom meeting using a firm's
 * already-connected integration. Connect lives in /counsel/calendar
 * (OAuth, formerly the standalone /counsel/meetings page); this is
 * the missing "actually schedule one" half.
 *
 * Tokens are AES-GCM encrypted in firm_integrations (see
 * lib/integration-tokens.ts). Access tokens are short-lived (~1h) so
 * we transparently refresh with the stored refresh_token and persist
 * the rotation. Service-role only - firm_integrations is RLS-locked.
 */
import { createAdminSupabase } from './supabase/admin';
import {
  decryptToken,
  encryptTokenForDb,
  isIntegrationEncryptionConfigured,
} from './integration-tokens';
import { getProviderConfig } from './integration-oauth';

export type MeetingResult =
  | { ok: true; provider: 'microsoft' | 'zoom'; joinUrl: string }
  | { ok: false; error: string };

// Rows written before the storage fix put the encrypted envelope into
// the bytea column as the JSON text {"type":"Buffer","data":[...]} -
// supabase-js serialized the Node Buffer. The real envelope bytes are
// intact inside `data`, so unwrap that shape transparently. Correctly
// written rows are `\x<hex>` whose first byte is the 0x01 version, not
// `{`, so they pass straight through.
function unwrapLegacyBufferJson(buf: Buffer): Buffer {
  if (buf.length > 17 && buf[0] === 0x7b /* '{' */) {
    const s = buf.toString('utf8');
    if (s.startsWith('{"type":"Buffer"')) {
      try {
        const o = JSON.parse(s) as { data?: unknown };
        if (Array.isArray(o.data)) return Buffer.from(o.data as number[]);
      } catch {
        /* fall through - treat as raw bytes */
      }
    }
  }
  return buf;
}

// PostgREST returns bytea as `\x<hex>`; older drivers as base64.
function byteaToBuffer(v: unknown): Buffer | null {
  if (!v) return null;
  if (Buffer.isBuffer(v)) return unwrapLegacyBufferJson(v);
  if (v instanceof Uint8Array) return unwrapLegacyBufferJson(Buffer.from(v));
  if (
    typeof v === 'object' &&
    v !== null &&
    (v as { type?: string }).type === 'Buffer' &&
    Array.isArray((v as { data?: unknown }).data)
  ) {
    return Buffer.from((v as { data: number[] }).data);
  }
  if (typeof v === 'string') {
    if (v.startsWith('\\x')) {
      return unwrapLegacyBufferJson(Buffer.from(v.slice(2), 'hex'));
    }
    try {
      return unwrapLegacyBufferJson(Buffer.from(v, 'base64'));
    } catch {
      return null;
    }
  }
  return null;
}

type Provider = 'microsoft' | 'zoom';

async function refreshToken(
  provider: Provider,
  refreshTokenPlain: string,
): Promise<{ access: string; refresh?: string; expiresInSec: number } | null> {
  const cfg = getProviderConfig(provider);
  if (!cfg) return null;
  const clientId = process.env[cfg.clientIdEnv]?.trim();
  const clientSecret = process.env[cfg.clientSecretEnv]?.trim();
  if (!clientId || !clientSecret) return null;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshTokenPlain,
  });
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (provider === 'microsoft') {
    body.set('client_id', clientId);
    body.set('client_secret', clientSecret);
    body.set('scope', cfg.scopes.join(' '));
  } else {
    // Zoom: HTTP Basic client auth.
    headers.Authorization = `Basic ${Buffer.from(
      `${clientId}:${clientSecret}`,
    ).toString('base64')}`;
  }
  try {
    const res = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers,
      body: body.toString(),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!j.access_token) return null;
    return {
      access: j.access_token,
      refresh: j.refresh_token,
      expiresInSec: j.expires_in ?? 3600,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve a usable access token for the firm. When `preferred` is
 * given the caller explicitly chose Teams or Zoom, so use exactly
 * that one (and say so clearly if it isn't connected). With no
 * preference, fall back to Microsoft (Teams) then Zoom. Refreshes +
 * persists if expired.
 */
async function getActiveIntegration(
  firmId: string,
  preferred?: Provider,
): Promise<{ provider: Provider; accessToken: string } | { error: string }> {
  if (!isIntegrationEncryptionConfigured()) {
    return { error: 'Integration encryption is not configured on the server.' };
  }
  const admin = createAdminSupabase();
  if (!admin) return { error: 'Server not configured.' };
  const { data } = await admin
    .from('firm_integrations')
    .select(
      'provider, access_token_encrypted, refresh_token_encrypted, expires_at',
    )
    .eq('firm_id', firmId)
    .is('revoked_at', null);
  const rows = (data ?? []) as Array<{
    provider: string;
    access_token_encrypted: unknown;
    refresh_token_encrypted: unknown;
    expires_at: string | null;
  }>;
  if (rows.length === 0) {
    return {
      error:
        'No meeting account is connected. Connect Microsoft 365 or Zoom in Meetings first.',
    };
  }
  let row;
  if (preferred) {
    row = rows.find((r) => r.provider === preferred);
    if (!row) {
      const label = preferred === 'microsoft' ? 'Microsoft 365 (Teams)' : 'Zoom';
      return {
        error: `${label} isn't connected for this firm. Connect it in Meetings, or pick the other provider.`,
      };
    }
  } else {
    // No explicit choice: Teams first - it produces a richer event.
    row =
      rows.find((r) => r.provider === 'microsoft') ??
      rows.find((r) => r.provider === 'zoom');
  }
  if (!row) {
    return { error: 'No supported meeting provider is connected.' };
  }
  const provider = row.provider as Provider;
  const accessBuf = byteaToBuffer(row.access_token_encrypted);
  if (!accessBuf) return { error: 'Stored token is unreadable - reconnect.' };

  let accessToken: string;
  try {
    accessToken = decryptToken(accessBuf);
  } catch {
    return { error: 'Could not decrypt the token - reconnect the account.' };
  }

  const expMs = row.expires_at ? Date.parse(row.expires_at) : 0;
  const stale = !expMs || expMs - Date.now() < 90_000;
  if (stale) {
    const refreshBuf = byteaToBuffer(row.refresh_token_encrypted);
    if (refreshBuf) {
      try {
        const refreshed = await refreshToken(
          provider,
          decryptToken(refreshBuf),
        );
        if (refreshed) {
          accessToken = refreshed.access;
          const patch: Record<string, unknown> = {
            access_token_encrypted: encryptTokenForDb(refreshed.access),
            expires_at: new Date(
              Date.now() + refreshed.expiresInSec * 1000,
            ).toISOString(),
          };
          if (refreshed.refresh) {
            patch.refresh_token_encrypted = encryptTokenForDb(
              refreshed.refresh,
            );
          }
          await admin
            .from('firm_integrations')
            .update(patch)
            .eq('firm_id', firmId)
            .eq('provider', provider);
        }
      } catch {
        /* fall through with the (possibly stale) token; the API
           call will surface a clear error if it really is dead */
      }
    }
  }
  return { provider, accessToken };
}

/**
 * Resolve a usable Microsoft Graph access token for the firm's
 * connected Microsoft 365 account (refreshing if stale), or null when
 * Microsoft isn't connected / configured. Used by the calendar sync
 * (#7) to read the connected account's Outlook events into the app's
 * calendar. Returns only the token so callers never touch the
 * encrypted-token plumbing.
 */
export async function getMicrosoftAccessToken(
  firmId: string,
): Promise<string | null> {
  const r = await getActiveIntegration(firmId, 'microsoft');
  return 'accessToken' in r ? r.accessToken : null;
}

async function createProviderMeeting(
  provider: Provider,
  accessToken: string,
  opts: {
    topic: string;
    startISO: string;
    durationMin: number;
    attendees: string[];
  },
): Promise<{ joinUrl: string } | { error: string }> {
  const endISO = new Date(
    Date.parse(opts.startISO) + opts.durationMin * 60_000,
  ).toISOString();
  try {
    if (provider === 'microsoft') {
      const res = await fetch(
        'https://graph.microsoft.com/v1.0/me/events',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          // Deliberately NO `attendees`: Microsoft Graph auto-emails a
          // generic Outlook invite (from the organizer mailbox, e.g.
          // "Techno Optics") the moment an event is created with
          // attendees - there is no suppress flag on /me/events. We
          // want a single, firm-branded invite, so the event is just
          // the organizer's Teams block and Advottic sends the one
          // branded email (with the join link + add-to-calendar) to
          // everyone instead.
          body: JSON.stringify({
            subject: opts.topic,
            start: { dateTime: opts.startISO, timeZone: 'UTC' },
            end: { dateTime: endISO, timeZone: 'UTC' },
            isOnlineMeeting: true,
            onlineMeetingProvider: 'teamsForBusiness',
          }),
        },
      );
      if (!res.ok) {
        return {
          error: `Microsoft rejected the request (${res.status}). Reconnect in Meetings if this persists.`,
        };
      }
      const j = (await res.json()) as {
        onlineMeeting?: { joinUrl?: string };
        webLink?: string;
      };
      const joinUrl = j.onlineMeeting?.joinUrl || j.webLink;
      if (!joinUrl) return { error: 'No Teams link came back.' };
      return { joinUrl };
    }
    // Zoom
    const res = await fetch(
      'https://api.zoom.us/v2/users/me/meetings',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          topic: opts.topic,
          type: 2,
          start_time: opts.startISO,
          duration: opts.durationMin,
          settings: { join_before_host: true, waiting_room: true },
        }),
      },
    );
    if (!res.ok) {
      return {
        error: `Zoom rejected the request (${res.status}). Reconnect in Meetings if this persists.`,
      };
    }
    const j = (await res.json()) as { join_url?: string };
    if (!j.join_url) return { error: 'No Zoom link came back.' };
    return { joinUrl: j.join_url };
  } catch {
    return { error: 'Could not reach the meeting provider.' };
  }
}

export async function scheduleFirmMeeting(
  firmId: string,
  opts: {
    topic: string;
    startISO: string;
    durationMin: number;
    attendees: string[];
    /** Explicit provider choice; omit to auto-pick Teams then Zoom. */
    provider?: Provider;
  },
): Promise<MeetingResult> {
  const integ = await getActiveIntegration(firmId, opts.provider);
  if ('error' in integ) return { ok: false, error: integ.error };
  const made = await createProviderMeeting(
    integ.provider,
    integ.accessToken,
    opts,
  );
  if ('error' in made) return { ok: false, error: made.error };
  return { ok: true, provider: integ.provider, joinUrl: made.joinUrl };
}
