/**
 * Calendar sync (#7). Pulls the firm's connected Microsoft 365
 * (Outlook) calendar events INTO the app calendar, so the counsel
 * calendar shows real Outlook events alongside in-app meetings,
 * deadlines, and reminders.
 *
 * This builds entirely on the EXISTING Microsoft integration:
 *   - OAuth connect flow (components/counsel/MeetingConnectors) already
 *     stores an encrypted delegated token in firm_integrations with the
 *     Calendars.ReadWrite scope.
 *   - lib/firm-meetings.getMicrosoftAccessToken refreshes + returns it.
 *
 * So no new credentials or OAuth app are required to turn this on: a
 * firm that has connected Microsoft 365 gets calendar read for free.
 * When Microsoft isn't configured (no MICROSOFT_CLIENT_ID) or not
 * connected for this firm, every function degrades to an empty list -
 * the calendar simply shows the in-app items.
 *
 * Google Workspace is intentionally left as a follow-up: it needs its
 * own OAuth app registration (GOOGLE_CLIENT_ID/SECRET) that doesn't
 * exist yet. The shape below (SyncedEvent) is provider-neutral so a
 * Google fetcher can slot in without touching callers.
 */

import { getMicrosoftAccessToken } from './firm-meetings';
import { isProviderConfigured, MICROSOFT_CONFIG } from './integration-oauth';

export type SyncedEvent = {
  /** Stable-ish id from the provider (for React keys / de-dupe). */
  id: string;
  /** Start time, epoch ms. */
  at: number;
  /** End time, epoch ms (falls back to start + 30m). */
  endAt: number;
  title: string;
  /** Free-text location or "Online" when it's a Teams/online meeting. */
  location: string | null;
  /** Join URL for online meetings, else null. */
  joinUrl: string | null;
  allDay: boolean;
  provider: 'microsoft';
};

/** True when calendar sync CAN run (Microsoft OAuth creds present). */
export function isCalendarSyncConfigured(): boolean {
  return isProviderConfigured(MICROSOFT_CONFIG);
}

type GraphEvent = {
  id?: string;
  subject?: string;
  isAllDay?: boolean;
  webLink?: string;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  location?: { displayName?: string };
  onlineMeeting?: { joinUrl?: string } | null;
  isOnlineMeeting?: boolean;
};

/**
 * Fetch the connected Microsoft account's calendar events within a
 * window. Best-effort: any failure (not connected, token dead, Graph
 * error) returns [] so the calendar page never breaks on sync.
 */
export async function fetchMicrosoftCalendarEvents(
  firmId: string,
  windowStartMs: number,
  windowEndMs: number,
): Promise<SyncedEvent[]> {
  if (!isCalendarSyncConfigured()) return [];
  let token: string | null = null;
  try {
    token = await getMicrosoftAccessToken(firmId);
  } catch {
    return [];
  }
  if (!token) return [];

  // Graph interprets these as UTC because of the Prefer header below.
  const startIso = new Date(windowStartMs).toISOString();
  const endIso = new Date(windowEndMs).toISOString();
  const params = new URLSearchParams({
    startDateTime: startIso,
    endDateTime: endIso,
    $select: 'id,subject,start,end,location,onlineMeeting,isOnlineMeeting,isAllDay,webLink',
    $orderby: 'start/dateTime',
    $top: '100',
  });
  const url = `https://graph.microsoft.com/v1.0/me/calendarView?${params.toString()}`;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Prefer: 'outlook.timezone="UTC"',
      },
      // Never cache a personal calendar read.
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const j = (await res.json()) as { value?: GraphEvent[] };
    const events = j.value ?? [];
    const out: SyncedEvent[] = [];
    for (const e of events) {
      const startMs = parseGraphDate(e.start?.dateTime);
      if (startMs == null) continue;
      const endMs = parseGraphDate(e.end?.dateTime) ?? startMs + 30 * 60_000;
      const online = Boolean(e.isOnlineMeeting || e.onlineMeeting?.joinUrl);
      out.push({
        id: e.id || `${startMs}-${e.subject ?? ''}`,
        at: startMs,
        endAt: endMs,
        title: (e.subject || '(no subject)').slice(0, 200),
        location: e.location?.displayName?.trim() || (online ? 'Online' : null),
        joinUrl: e.onlineMeeting?.joinUrl || (online ? e.webLink ?? null : null),
        allDay: Boolean(e.isAllDay),
        provider: 'microsoft',
      });
    }
    return out;
  } catch {
    return [];
  }
}

// Graph returns naive datetimes like "2026-07-03T14:00:00.0000000"
// which, with the Prefer: UTC header, represent UTC. Append 'Z' when
// there's no timezone designator so Date.parse treats it as UTC rather
// than local.
function parseGraphDate(s: string | undefined): number | null {
  if (!s) return null;
  const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s);
  const ms = Date.parse(hasTz ? s : `${s}Z`);
  return Number.isNaN(ms) ? null : ms;
}
