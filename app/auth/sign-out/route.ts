import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabase, isSupabaseConfigured } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (isSupabaseConfigured()) {
    const supabase = createServerSupabase();
    await supabase.auth.signOut();
  }
  const dest = new URL(request.url);
  dest.pathname = '/';
  dest.search = '';
  return NextResponse.redirect(dest, { status: 303 });
}
