import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { stripComments } from './support/strip-comments';

/*
 * A control that destroys something has to ask first.
 *
 * WHAT COUNTS AS DESTROYING SOMETHING, for this list: it removes a person's
 * access, it deletes a stored file, it takes a second authentication factor
 * off an account, or it reaches another person and takes something back from
 * them. What does NOT count, and is deliberately absent below: anything the
 * same control puts back in one click. A confirm on those teaches people to
 * dismiss confirms, which costs more than it buys.
 *
 * HOW THIS IS CHECKED. Asserting the file merely contains `<ConfirmDialog`
 * would pass for a file that renders one dialog and leaves the destructive
 * button wired straight through, which is the exact regression worth
 * catching. So instead this walks every `onClick={...}` attribute value with
 * brace matching and asserts the destructive call is not REACHABLE from any
 * of them: the action must be reached from the dialog's own handler.
 *
 * Reachable, not merely present. Looking only at the literal text of the
 * handler missed one level of indirection, which is how most of these files
 * are already written: changing app/profile/safe-contact-form.tsx from
 * `onClick={() => setRemoving(c)}` to `onClick={() => void removeContact(c.id)}`
 * deleted a personal-safety contact on one tap, with the ConfirmDialog still
 * rendered and orphaned, and this file green. So every identifier a handler
 * names is resolved to its local declaration and followed.
 *
 * WHAT IT CANNOT TELL YOU: that the dialog renders, that its copy is right, or
 * that the confirm button is reachable. It proves the destructive call is not
 * one tap away, and nothing more.
 */

const root = fileURLToPath(new URL('..', import.meta.url));


/**
 * Every `onClick={ ... }` attribute value in the source, brace-matched so a
 * handler containing its own object or template braces is captured whole.
 */
function onClickHandlers(src: string): string[] {
  const out: string[] = [];
  const marker = 'onClick={';
  let at = src.indexOf(marker);
  while (at !== -1) {
    let depth = 1;
    let i = at + marker.length;
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') depth -= 1;
      i += 1;
    }
    out.push(src.slice(at + marker.length, i - 1));
    at = src.indexOf(marker, i);
  }
  return out;
}

/**
 * Local function declarations in the module, by name, so a handler that just
 * names one can be followed into it.
 */
function localBodies(src: string): Map<string, string> {
  const out = new Map<string, string>();
  const decl =
    /(?:async\s+)?function\s+(\w+)\s*\(|const\s+(\w+)\s*=\s*(?:async\s*)?\(/g;
  for (const m of src.matchAll(decl)) {
    const name = m[1] ?? m[2];
    const from = (m.index ?? 0) + m[0].length;
    const open = src.indexOf('{', from);
    if (open === -1) continue;
    let depth = 1;
    let i = open + 1;
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') depth -= 1;
      i += 1;
    }
    if (!out.has(name)) out.set(name, src.slice(open, i));
  }
  return out;
}

/** Everything a handler can reach, following local calls up to three deep. */
function reachableFrom(handler: string, bodies: Map<string, string>): string {
  const seen = new Set<string>();
  let text = handler;
  for (let depth = 0; depth < 3; depth += 1) {
    const names = [...text.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
    const fresh = names.filter((n) => !seen.has(n) && bodies.has(n));
    if (fresh.length === 0) break;
    for (const n of fresh) {
      seen.add(n);
      text += '\n' + bodies.get(n);
    }
  }
  return text;
}

/** file -> the destructive call that must not be reachable from an onClick. */
const GUARDED: Array<{ file: string; call: string; what: string }> = [
  { file: 'app/profile/mfa-settings.tsx', call: 'mfa.unenroll', what: 'removes the account second factor' },
  { file: 'components/counsel/ScimSettings.tsx', call: 'revokeScimTokenAction', what: 'kills a live provisioning token' },
  { file: 'app/cases/[id]/collaborators-panel.tsx', call: 'removeCollaboratorAction', what: 'revokes a person case access' },
  { file: 'app/counsel/cases/[id]/matter-invite-form.tsx', call: 'removeMatterCollaboratorAction', what: 'revokes a person matter access' },
  { file: 'components/intake/IntakeWorkPanel.tsx', call: 'removeIntakeParticipantAction', what: 'revokes intake access' },
  { file: 'components/intake/IntakeWorkPanel.tsx', call: 'revokeIntakeUploadRequestAction', what: 'kills a link already sent out' },
  { file: 'app/portal/forms/submissions/[id]/withdraw-button.tsx', call: 'withdrawTemplateSubmissionAction', what: 'pulls a document back from review' },
  { file: 'app/counsel/cases/[id]/evidence/evidence-intake.tsx', call: 'deleteFirmCaseEventAction', what: 'deletes evidence and its file' },
  { file: 'app/counsel/cases/[id]/case-images-panel.tsx', call: 'deleteCaseImageAction', what: 'deletes a stored image' },
  { file: 'app/cases/[id]/community/community-editor.tsx', call: 'removeCommunityGalleryImageAction', what: 'deletes a published photo' },
  { file: 'app/profile/safe-contact-form.tsx', call: 'deleteSafeWitnessContactAction', what: 'drops a personal-safety contact' },
];

describe('destructive controls are not one tap from the thing they destroy', () => {
  for (const { file, call, what } of GUARDED) {
    it(`${file}: ${call} (${what})`, () => {
      const src = stripComments(readFileSync(join(root, file), 'utf8'));

      // The call still has to be here at all: a guard that passes because the
      // feature was deleted is telling you nothing.
      expect(src, `${file} no longer calls ${call}`).toContain(call);

      const handlers = onClickHandlers(src);
      // And there has to be something to look at. A file whose controls stop
      // being spelled `onClick={` would sweep an empty list.
      expect(handlers.length, `${file} has no onClick handlers to examine`).toBeGreaterThan(0);

      const bodies = localBodies(src);
      const inline = handlers.filter((h) => reachableFrom(h, bodies).includes(call));
      expect(
        inline,
        `${call} is reachable from an onClick in ${file}. It ${what}, so it must be reached from a confirmation, not from the button.`,
      ).toEqual([]);

      expect(src, `${file} should render a ConfirmDialog`).toMatch(/<ConfirmDialog\b/);
    });
  }
});
