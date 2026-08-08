'use server';

import {
  createFirmTemplateAction,
  listFirmTemplatesAction,
  type FirmTemplate,
} from './firm-templates';
import { findSeedTemplate } from './seed-templates';
import { findTemplateNameClash } from './template-name-match';

/**
 * Install a standard template into a firm's own template list.
 *
 * This is a thin wrapper over createFirmTemplateAction ON PURPOSE. That
 * function holds the authorization gate (requireAuthor), the field
 * sanitization, and the delivery-mode column fallback that keeps a firm
 * working before the migration is applied. A second insert path here would be
 * a second place for all three to be got wrong, and the delivery mode is the
 * one that matters most: this template is worthless as a 'share', because the
 * whole point is that the other company signs it.
 *
 * Every 'use server' export is a public HTTP endpoint. This one reaches the
 * gate through the call below rather than by being hidden behind a button.
 */
export async function installSeedTemplateAction(
  firmId: string,
  slug: string,
): Promise<{ ok: boolean; error?: string; warning?: string; template?: FirmTemplate }> {
  const seed = findSeedTemplate(slug);
  if (!seed) return { ok: false, error: 'That standard template is not available.' };

  // Refuse a second copy of the same document. Two templates called "Mutual
  // Nondisclosure Agreement" in an employee's Forms list is a person picking
  // the wrong one, and only one of them carries the firm's later edits.
  // listFirmTemplatesAction runs the same authorization gate, so an
  // unauthorized caller stops here rather than at the insert.
  //
  // THE COMPARISON USED TO BE A TRIMMED LOWERCASE EQUALITY, and that is how a
  // firm ended up holding "Mutual Nondisclosure Agreement" and "Mutual
  // Non-Disclosure Agreement" side by side: one hyphen apart, and the check
  // passed. findTemplateNameClash reduces both to what the name actually is,
  // punctuation and spacing removed, so the two are one template again.
  const existing = await listFirmTemplatesAction(firmId);
  if (existing.error) return { ok: false, error: existing.error };
  const clash = findTemplateNameClash(
    seed.name,
    (existing.templates ?? []).filter((t) => t.status !== 'archived').map((t) => t.name),
  );
  if (clash?.kind === 'same') {
    return {
      ok: false,
      error: `You already have a template called "${clash.name}". Edit that one, or archive it first.`,
    };
  }

  const created = await createFirmTemplateAction(firmId, {
    name: seed.name,
    description: seed.description,
    category: seed.category,
    body: seed.body,
    fields: seed.fields,
    // Installed as a draft. A standard document arrives with party names and
    // an address that belong to whoever supplied it, and publishing it
    // straight into every employee's Hub would put it in front of people
    // before the legal team has read a line of it.
    status: 'draft',
    requiresApproval: seed.requiresApproval,
    deliveryMode: seed.deliveryMode,
  });

  // A near-identical name is a legitimate thing to have: a short-form NDA
  // beside a full one is two real templates. It is not a legitimate thing to
  // acquire by accident, so it is said out loud at the moment it happens
  // rather than left for an employee to discover in the Forms list.
  if (created.ok && clash?.kind === 'near') {
    return {
      ...created,
      warning: `This was added, but you already have a template called "${clash.name}". Two templates with names this close are easy to confuse, so it is worth renaming one of them.`,
    };
  }
  return created;
}
