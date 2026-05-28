import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/cases/new-evidence
 *
 * Returns the signed-in user's existing vault items + contracts so
 * the <EvidencePicker /> on the new-case form can show them as a
 * multi-select chip list. Both lists are time-ordered with the
 * newest first - that's what the user is most likely thinking about
 * when they open a case.
 *
 * Vault items come from public.user_receipts. Contracts come from
 * public.user_contracts. We surface a uniform { id, title, kind,
 * created_at, size_label } shape so the client doesn't have to
 * branch on source.
 */
export async function GET() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) {
    return NextResponse.json(
      { vault: [], contracts: [] },
      { status: 401 },
    );
  }
  const admin = createAdminSupabase();
  if (!admin) {
    return NextResponse.json(
      { vault: [], contracts: [] },
      { status: 503 },
    );
  }

  const [vaultResp, contractsResp] = await Promise.all([
    admin
      .from('user_receipts')
      .select('id, label, category, mime_type, file_size, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(200),
    admin
      .from('user_contracts')
      .select(
        'id, name, contract_type, custom_type, mime_type, file_size, created_at',
      )
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(200),
  ]);

  function sizeLabel(bytes: number | null | undefined): string | null {
    if (!bytes || bytes <= 0) return null;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const vault = (vaultResp.data ?? []).map((r) => {
    const row = r as {
      id: string;
      label: string | null;
      category: string | null;
      mime_type: string | null;
      file_size: number | null;
      created_at: string;
    };
    return {
      id: row.id,
      source: 'vault' as const,
      title: row.label?.trim() || 'Untitled receipt',
      kind: row.category ?? row.mime_type ?? null,
      created_at: row.created_at,
      size_label: sizeLabel(row.file_size),
    };
  });
  const contracts = (contractsResp.data ?? []).map((r) => {
    const row = r as {
      id: string;
      name: string | null;
      contract_type: string | null;
      custom_type: string | null;
      mime_type: string | null;
      file_size: number | null;
      created_at: string;
    };
    return {
      id: row.id,
      source: 'contract' as const,
      title: row.name?.trim() || 'Untitled contract',
      kind: row.custom_type?.trim() || row.contract_type || row.mime_type || null,
      created_at: row.created_at,
      size_label: sizeLabel(row.file_size),
    };
  });

  return NextResponse.json({ vault, contracts });
}
