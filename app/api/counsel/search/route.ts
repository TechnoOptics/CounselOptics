import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase/server';
import { getActiveFirmContext, listFirmCases } from '@/lib/firm-storage';
import { storageUnavailable } from '@/lib/setup-status';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The matters behind the counsel top bar's search box.
 *
 * Authorization is not re-implemented here and does not need to be. The
 * firm comes from getActiveFirmContext, which resolves the CALLER's own
 * membership from their session, and listFirmCases reads through the
 * user-scoped client, so RLS scopes the rows to a firm member a second
 * time. A caller with no firm gets an empty list rather than an error,
 * because the search box is chrome and a 500 in the chrome is worse
 * than a search that finds nothing.
 *
 * Every failure returns `{ matters: [] }`. The palette then falls back
 * to the firm's own navigation, which needs no request at all.
 */
export async function GET() {
  if (storageUnavailable() || !isSupabaseConfigured()) {
    return NextResponse.json({ matters: [] });
  }
  try {
    const active = await getActiveFirmContext();
    if (!active) return NextResponse.json({ matters: [] });
    const cases = await listFirmCases(active.firm.id);
    return NextResponse.json(
      {
        matters: cases.map((c) => ({
          id: c.id,
          title: c.title,
          subjectName: c.subjectName,
          status: c.status,
        })),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json({ matters: [] });
  }
}
