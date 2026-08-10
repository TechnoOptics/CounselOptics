'use client';

import {
  NO_METHOD_ENABLED_ERROR,
  SIGNATURE_METHODS,
  SIGNATURE_METHOD_DESCRIPTIONS,
  SIGNATURE_METHOD_LABELS,
  type SignatureMethod,
} from '@/lib/signature-methods';

/**
 * Which ways a firm will let this template be signed.
 *
 * Self-contained on purpose. It takes the current selection and an onChange
 * and owns nothing else: no form, no save, no server action, no knowledge of
 * where the value came from or where it is going. Mounting it is one element
 * and one piece of state, so the surface that edits templates can place it in
 * a tab without this file knowing that tab exists.
 *
 * WHAT null MEANS HERE is what it means in the column and in
 * lib/signature-methods.ts: no restriction, so all four are offered. The
 * component shows that as four ticked boxes rather than as four empty ones,
 * because "we have not restricted this" and "we have forbidden everything"
 * must not look the same to somebody deciding what their firm will accept.
 *
 * THE PICKER IS NOT THE ENFORCEMENT and does not pretend to be. It refuses to
 * turn the last method off, which spares a firm a save that would fail, and
 * that is the whole of its authority. The refusal that protects an executed
 * instrument is in lib/signature-write.ts, on the server, because this
 * component runs in a browser the firm's counterparty also controls.
 */

export type SignatureMethodToggle =
  | { ok: true; methods: SignatureMethod[] | null }
  | { ok: false; error: string };

/**
 * Turn one method on or off, or say why not.
 *
 * Exported beside the component so the rule can be exercised without a DOM,
 * and so a caller that builds its own control still gets the same answer. Two
 * normalisations ride along, both of which keep a stored value comparable
 * with a freshly chosen one:
 *
 *   - the result is always in canonical order, whatever order the firm clicked
 *   - all four selected collapses to null, because that is the same
 *     restriction and storing it two ways would make every reader know that
 */
export function toggleSignatureMethod(
  current: SignatureMethod[] | null,
  method: SignatureMethod,
): SignatureMethodToggle {
  const enabled = new Set<SignatureMethod>(current ?? SIGNATURE_METHODS);
  if (enabled.has(method)) {
    if (enabled.size <= 1) return { ok: false, error: NO_METHOD_ENABLED_ERROR };
    enabled.delete(method);
  } else {
    enabled.add(method);
  }
  const next = SIGNATURE_METHODS.filter((m) => enabled.has(m));
  return {
    ok: true,
    methods: next.length === SIGNATURE_METHODS.length ? null : next,
  };
}

export function SignatureMethodPicker({
  value,
  onChange,
  disabled,
}: {
  /** The template's stored selection. Null means all four are allowed. */
  value: SignatureMethod[] | null;
  /** Called with the new selection, or null when nothing is restricted. */
  onChange: (next: SignatureMethod[] | null) => void;
  disabled?: boolean;
}) {
  const enabled = new Set<SignatureMethod>(value ?? SIGNATURE_METHODS);
  const onlyOneLeft = enabled.size <= 1;

  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <legend className="text-[13px] font-semibold text-foreground">
        How this template may be signed
      </legend>
      <p className="text-[12.5px] leading-relaxed text-muted">
        Signers are offered only the methods you leave enabled here. Changing
        this affects documents sent from now on; anything already out for
        signature keeps the methods it was sent with.
      </p>
      {/* What this setting does and does not buy, said plainly.
          A drawn mark, a typed name and an uploaded image all reach us as the
          same image file, so for those three we record what the signer says
          they did and cannot check it. "Sign on your phone" is different: the
          handoff is a one-time code tied to the device that scans it, so that
          one we can and do refuse.
          This paragraph used to claim all four were enforced. They are not,
          and a firm choosing what it will accept on an instrument it intends
          to rely on is owed the real answer rather than the reassuring one. */}
      <p className="text-[12.5px] leading-relaxed text-muted">
        One caveat worth knowing. Turning off &ldquo;Sign on your phone&rdquo;
        is enforced: the handoff is a one-time code tied to the device that
        scans it, and a signature without one is refused. The other three all
        reach us as the same image file, so we record which the signer says
        they used and note on the record that it is their account of it rather
        than something we verified. Treat those three as guidance to the
        signer, not as a control.
      </p>

      <ul className="space-y-2">
        {SIGNATURE_METHODS.map((method) => {
          const on = enabled.has(method);
          return (
            <li key={method}>
              <label className="flex items-start gap-3 rounded-lg ring-1 ring-edge px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={on}
                  // The last enabled method stays clickable rather than being
                  // greyed out, so the firm reads the sentence explaining why
                  // instead of a control that has quietly stopped responding.
                  onChange={() => {
                    const next = toggleSignatureMethod(value, method);
                    if (next.ok) onChange(next.methods);
                  }}
                  className="mt-1"
                />
                <span>
                  <span className="block text-[13px] font-medium text-foreground">
                    {SIGNATURE_METHOD_LABELS[method]}
                  </span>
                  <span className="block text-[12px] leading-relaxed text-muted">
                    {SIGNATURE_METHOD_DESCRIPTIONS[method]}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {onlyOneLeft && (
        <p className="rounded-lg ring-1 ring-edge bg-surface-2 px-3 py-2 text-[12.5px] leading-relaxed text-foreground">
          {NO_METHOD_ENABLED_ERROR}
        </p>
      )}
    </fieldset>
  );
}
