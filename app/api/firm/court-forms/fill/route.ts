import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser, createServerSupabase } from '@/lib/supabase/server';
import { fillCourtForm } from '@/lib/court-forms-fill';
import { getCourtForm } from '@/lib/court-forms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/firm/court-forms/fill
 *
 * Body: { form_id: string, case_id: string, attorney?: {...} }
 *
 * Pulls the case from the user's firm, assembles the case data
 * record the registry expects, and returns the filled PDF as a
 * download. Firm members only.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  let body: {
    form_id?: string;
    case_id?: string;
    attorney?: Record<string, unknown>;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const formId = String(body.form_id ?? '').trim();
  const caseId = String(body.case_id ?? '').trim();
  if (!formId || !caseId) {
    return NextResponse.json({ error: 'form_id and case_id are required' }, { status: 400 });
  }
  const form = getCourtForm(formId);
  if (!form) {
    return NextResponse.json({ error: `unknown form_id: ${formId}` }, { status: 404 });
  }

  const supabase = createServerSupabase();
  const { data: caseRow } = await supabase
    .from('cases')
    .select(
      'id, title, subject_name, case_type, posture, jurisdiction, description, firm_id',
    )
    .eq('id', caseId)
    .maybeSingle();
  if (!caseRow) return NextResponse.json({ error: 'case not found' }, { status: 404 });

  // Membership check is implicit via RLS: the user-scoped client
  // would not have returned the row otherwise.

  const c = caseRow as {
    id: string;
    title: string;
    subject_name: string;
    case_type: string;
    posture: string;
    jurisdiction: { state?: string; country?: string; city?: string } | null;
    description: string | null;
  };

  // Assemble the data record the registry's dot-paths resolve against.
  const data: Record<string, unknown> = {
    case: {
      id: c.id,
      title: c.title,
      number: '',
      case_type: c.case_type,
      cause: c.case_type,
      filed_at: new Date().toISOString(),
    },
    plaintiff: {
      name: c.posture === 'claimant' || c.posture === 'plaintiff' ? c.subject_name : '',
      address: '',
      party_type: 'Individual',
    },
    defendant: {
      name: c.posture === 'respondent' || c.posture === 'defendant' ? c.subject_name : '',
      address: '',
    },
    petitioner: {
      name: c.posture === 'claimant' ? c.subject_name : '',
    },
    respondent: {
      name: c.posture === 'respondent' ? c.subject_name : '',
    },
    court: {
      name: form.state === 'US' ? 'United States District Court' : `Superior Court of ${form.state}`,
      county: c.jurisdiction?.city ?? '',
      district: form.state === 'US' ? '' : '',
      branch: '',
      address: { street: '', cityZip: '' },
    },
    attorney: body.attorney ?? {
      full_label: user.email ?? '',
      name: user.email ?? '',
      email: user.email ?? '',
      bar_number: '',
      address: '',
      represents: c.posture,
    },
    flags: { is_civil: 'Yes' },
  };

  const filled = await fillCourtForm(formId, data);
  if (!filled.ok) {
    return NextResponse.json({ error: filled.error }, { status: 422 });
  }

  // The Uint8Array from pdf-lib has the right shape for a Response
  // body but TS wants ArrayBuffer / BodyInit; cast accordingly.
  return new NextResponse(filled.bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${form.id}-filled.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
