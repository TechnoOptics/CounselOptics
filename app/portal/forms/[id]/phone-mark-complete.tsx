'use client';

import { formatSignedOn } from '@/lib/firm-template-placeholders';
import { T } from '@/components/i18n/LocaleProvider';

/**
 * The signature that came back from the phone, shown and closed.
 *
 * This REPLACES the pad rather than sitting under it, and that is the whole
 * point of the component existing. What shipped before left the canvas mounted
 * with the phone's drawing painted onto it, so the section still behaved like
 * a pad: one stray drag and the picture on the desk was no longer the picture
 * the server holds a fingerprint for. The submission would then either carry
 * bytes the employee could not see or fail the attestation outright.
 *
 * A canvas that is not rendered cannot be drawn on. That is the only form of
 * uneditable here that does not depend on a handler firing correctly.
 *
 * The way out is a button and not an absence. Somebody who signed with the
 * wrong finger needs a route that is not "abandon the form", and leaving the
 * pad live was the previous, unlabelled version of that route.
 */
export function PhoneMarkComplete({
  dataUrl,
  markAt,
  onSignAgain,
}: {
  /** The phone's own PNG. The desk shows these bytes, and sends these bytes. */
  dataUrl: string;
  /**
   * When the phone signed, as the SERVER recorded it, or null.
   *
   * Null prints no time at all. The alternative is this browser's clock, and a
   * browser and a server rendering one instant in local time have already
   * produced different times and different calendar DAYS on an executed
   * instrument here, which is what decides a notice period or a cure window.
   * See lib/firm-template-placeholders.ts and tests/signature-datetime.test.ts.
   */
  markAt: string | null;
  onSignAgain: () => void;
}) {
  // The one formatter, pinned to UTC. Not a second one, and not a local-time
  // shortcut: see the note on markAt above.
  const signedOn = markAt ? formatSignedOn(new Date(markAt)) : '';

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-edge bg-surface-2 p-4">
        {/* The plate is a surface token, and the MARK is what adapts.
            The pad draws in #0f2d24 onto transparency, so a plate pinned light
            in both themes was the first instinct here and it is wrong twice
            over: `bg-white` and `bg-cream-50` are both redefined to a dark
            green under `.dark` in app/globals.css, so neither is actually
            light, and the signature would have come out as deep forest ink on
            a deep forest ground. Invisible, on the one element on this panel
            that has to be seen.
            `brightness-0` flattens the ink to black and `invert` lifts it to
            white, so the mark reads in dark mode without a hue shift and the
            transparent background stays transparent. */}
        <div className="rounded-md border border-edge bg-surface p-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- a data URL
              held in memory for this session, never a file the optimiser
              could fetch, resize or cache. */}
          <img
            src={dataUrl}
            alt="Your signature, drawn on your phone"
            className="mx-auto block h-24 w-auto max-w-full object-contain dark:brightness-0 dark:invert sm:h-28"
            data-no-translate
          />
        </div>
        <p className="mt-3 text-[13px] font-medium text-foreground">
          <T>Signed on a mobile device</T>
        </p>
        {signedOn && (
          <p className="mt-1 text-[12.5px] text-muted" data-no-translate>
            {signedOn}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={onSignAgain}
          className="rounded-lg border border-edge px-3 py-1.5 text-[13px] font-medium text-foreground hover:bg-surface-2"
        >
          Sign again
        </button>
        <span className="text-[12px] leading-relaxed text-muted">
          <T>This clears this signature so you can sign a new one.</T>
        </span>
      </div>
    </div>
  );
}
