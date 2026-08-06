import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The PDF renderer, as the second way out of the building.
 *
 * lib/template-release.ts is the only code that MAILS an employee's filled
 * template, but it was never the only way one could leave: the branded PDF
 * route handed a finished, letterheaded document to any signed-in caller who
 * posted some text at it, and a file in an employee's hands is a file they can
 * forward. The employee page hiding its Download button did nothing about
 * that, because a hidden control is not a gate.
 *
 * The rule itself is a pure function and is tested against every role in
 * tests/template-approval.test.ts. What this file pins is that the route
 * actually asks it, and that neither branch of the route takes document
 * content from the caller when the caller is an employee. Those are structural
 * facts about a Next route handler that would otherwise need the whole
 * Supabase and pdf-lib stack mocked to observe.
 */

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const ROUTE = read('../app/api/counsel/draft-template/pdf/route.ts');
const FILL = read('../app/portal/forms/[id]/form-fill-client.tsx');

describe('the branded PDF route', () => {
  it('asks the approval gate before rendering a named template', () => {
    expect(ROUTE).toMatch(/canRenderFilledTemplate\(/);
    expect(ROUTE).toMatch(/requiresApproval:\s*template\.requiresApproval/);
    // The role is resolved from the caller's own membership, never taken from
    // the request body.
    expect(ROUTE).toMatch(/role:\s*await callerFirmRole\(firmId\)/);
  });

  it('builds the employee document from the firm template, not from the request', () => {
    // The renderTemplate branch must never read body.document: if it did, a
    // caller could post a gated template's text under an ungated template's
    // id and the gate would pass on the wrong document.
    const branch = ROUTE.slice(
      ROUTE.indexOf('async function renderTemplate'),
      ROUTE.indexOf('async function renderFreeText'),
    );
    expect(branch.length).toBeGreaterThan(0);
    // No property read of `document` off anything, and no `document` on the
    // parameter type either, however the read is spelled or cast.
    expect(branch).not.toMatch(/\.document\b/);
    expect(branch).not.toMatch(/document\s*\?\s*:/);
    expect(branch).toMatch(/mergeTemplateDocument\(/);
    expect(branch).toMatch(/body:\s*template\.body/);
  });

  it('refuses free-text rendering to anyone who is not a firm member', () => {
    // Being signed in used to be the whole check. The counsel studios draft
    // their own text, which is theirs to draft; nobody else may.
    const branch = ROUTE.slice(ROUTE.indexOf('async function renderFreeText'));
    expect(branch).toMatch(/getActiveFirmContext\(\)/);
    expect(branch).toMatch(/if \(!ctx\) return \{ error:/);
  });
});

describe('the employee fill page', () => {
  it('sends the template identity and its values, never a finished document', () => {
    const build = FILL.slice(FILL.indexOf('const buildPdf'), FILL.indexOf('const sendForReview'));
    expect(build).toMatch(/templateId: template\.id/);
    expect(build).not.toMatch(/document:\s*merged/);
  });

  it('offers no PDF preview for a template that needs review', () => {
    // The preview dialog carries Print, Download, and Open in a new tab, so
    // opening it for a gated template is a send.
    expect(FILL).toMatch(/\{!needsApproval && \(\s*<button/);
  });
});
