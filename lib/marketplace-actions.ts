'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';

/**
 * Marketplace lead submission. The consumer (signed in or not)
 * fills out the /find-counsel form, this action creates the
 * firm_leads row and notifies firms whose jurisdictions +
 * practice areas match.
 *
 * Anonymous leads are allowed - the user might not have an
 * account yet. They get a copy of their lead via email and can
 * claim it later when they sign up.
 */
export async function submitFirmLeadAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; leadId?: string; matchedFirms?: number }> {
  const contactEmail = String(formData.get('contactEmail') ?? '').trim().toLowerCase();
  const contactName = String(formData.get('contactName') ?? '').trim();
  const contactPhone = String(formData.get('contactPhone') ?? '').trim() || null;
  const state = String(formData.get('state') ?? '').trim().toUpperCase();
  const summary = String(formData.get('summary') ?? '').trim();
  const budget = String(formData.get('budget') ?? '').trim() || null;
  const urgencyRaw = String(formData.get('urgency') ?? 'normal').trim();
  const urgency = ['low', 'normal', 'high', 'emergency'].includes(urgencyRaw)
    ? urgencyRaw
    : 'normal';
  let practiceAreas: string[] = [];
  try {
    const raw = String(formData.get('practiceAreas') ?? '[]');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) practiceAreas = parsed.map(String);
  } catch {
    /* fall through */
  }

  if (!contactEmail || !/.+@.+\..+/.test(contactEmail)) {
    return { ok: false, error: 'A valid email is required.' };
  }
  if (!contactName) return { ok: false, error: 'Please tell us your name.' };
  if (!state) return { ok: false, error: 'Please pick your state.' };
  if (!summary || summary.length < 20) {
    return {
      ok: false,
      error: 'Please add a brief summary (at least 20 characters).',
    };
  }
  if (practiceAreas.length === 0) {
    return { ok: false, error: 'Pick at least one matter area.' };
  }

  const admin = createAdminSupabase();
  if (!admin) {
    return { ok: false, error: 'Server is not fully configured.' };
  }

  const user = await getCurrentUser().catch(() => null);

  const { data: leadRow, error: leadErr } = await admin
    .from('firm_leads')
    .insert({
      user_id: user?.id ?? null,
      contact_email: contactEmail,
      contact_name: contactName,
      contact_phone: contactPhone,
      jurisdiction_country: 'US',
      jurisdiction_state: state,
      practice_areas: practiceAreas,
      summary,
      budget,
      urgency,
      status: 'open',
    })
    .select('id')
    .single();
  if (leadErr || !leadRow) {
    return { ok: false, error: leadErr?.message ?? 'Insert failed.' };
  }
  const leadId = (leadRow as { id: string }).id;

  // Find matching firms: those whose jurisdictions array contains the
  // state AND whose practice_areas overlap with the requested areas.
  // Firms can also opt-in to be a "general" match by listing
  // practice_areas containing the literal string 'all'.
  const { data: firmsRaw } = await admin
    .from('firms')
    .select('id, name, jurisdictions, practice_areas')
    .or(
      `jurisdictions.cs.{${state}},jurisdictions.cs.{US-${state}}`,
    );
  const firms = ((firmsRaw ?? []) as Array<{
    id: string;
    name: string;
    jurisdictions: string[] | null;
    practice_areas: string[] | null;
  }>).filter((f) => {
    const fa = (f.practice_areas ?? []).map((s) => s.toLowerCase());
    if (fa.includes('all')) return true;
    return practiceAreas.some((p) =>
      fa.includes(p.toLowerCase()),
    );
  });

  // For each matched firm, notify its owner + admins.
  if (firms.length > 0) {
    const { createNotification } = await import('./notifications');
    for (const f of firms) {
      const { data: members } = await admin
        .from('firm_members')
        .select('user_id, role')
        .eq('firm_id', f.id)
        .in('role', ['owner', 'admin', 'attorney']);
      const memberIds = ((members ?? []) as Array<{
        user_id: string;
        role: string;
      }>).map((m) => m.user_id);
      for (const uid of memberIds) {
        await createNotification({
          userId: uid,
          type: 'system',
          title: `New lead in ${state}: ${practiceAreas.slice(0, 2).join(', ')}`,
          body: summary.slice(0, 200) + (summary.length > 200 ? '...' : ''),
          link: `/counsel/leads/${leadId}`,
        });
      }
    }
    await admin
      .from('firm_leads')
      .update({ status: 'matched' })
      .eq('id', leadId);
  }

  revalidatePath('/find-counsel');
  return { ok: true, leadId, matchedFirms: firms.length };
}
