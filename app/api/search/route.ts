import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase/server';
import { listCases } from '@/lib/storage';
import { storageUnavailable } from '@/lib/setup-status';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  if (storageUnavailable()) {
    return NextResponse.json({ cases: [] });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ cases: [] });
  }
  try {
    const cases = await listCases();
    const trimmed = cases.map((c) => ({
      id: c.id,
      title: c.title,
      subjectName: c.subjectName,
      subjectType: c.subjectType,
      status: c.status,
      caseType: c.caseType,
    }));
    return NextResponse.json({ cases: trimmed }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ cases: [] });
  }
}
