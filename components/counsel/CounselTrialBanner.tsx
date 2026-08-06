'use client';

import { useEffect, useState } from 'react';
import { LocaleTime } from '@/components/LocaleTime';

/**
 * Firm trial notice, pinned to the very top of the counsel workspace.
 *
 * IT READS THE ORGANIZATION'S STORED `trial_ends_at`, AND NOTHING ELSE. It
 * used to compute a countdown as `30 - (now - firm.createdAt) / a day`: a
 * hardcoded window off the CREATION date with no reference to the real end
 * date. That produced two contradictory clocks in one product. HQ grants a
 * 90 day trial to an organization created 40 days ago and the enforcement
 * layer correctly allows 50 more days, while this banner announced that the
 * trial had ended. The reverse is the one that costs: an organization three
 * days from lapsing was told "your access continues" right up to the moment
 * the product closed, and the first true thing it was ever told was the
 * access-ended page, after the fact.
 *
 * So the banner now WARNS BEFORE THE END rather than reporting after it. From
 * WARN_WITHIN_DAYS out it names the date access ends and says the data can be
 * downloaded before then.
 *
 * COPY IS A CORRECTNESS REQUIREMENT HERE, in two directions. Nothing below
 * says or implies that anything will be deleted, because under this design
 * nothing is: the organization keeps its data and can download it, with no
 * time limit on the offer. And nothing says access continues, because for an
 * organization past its end date it does not.
 *
 * IT CANNOT SEE A SUSPENSION FOR ITSELF, so it is told about one. A
 * suspension closes an organization whatever its dates say, and suspension
 * outranks the dates everywhere else in this feature; a banner working from
 * the dates alone would tell a closed organization it "is on a free trial"
 * with an end date still ahead of it. That is the same category of confident
 * wrong claim as the creation-date clock above. The `accessEnded` prop
 * carries the gate's own answer for this request, and where the two disagree
 * the gate wins. The path this matters on is /counsel/accept-invite, the one
 * place a closed organization still renders this shell.
 *
 * A null `trialEndsAt` renders NOTHING. That covers a paying organization,
 * which has no trial end date at all, and it covers a date that could not be
 * read. Silence is the only safe answer to an unknown clock: the old code's
 * fallback was a confident "30 day free trial" claim built from a creation
 * date, which is exactly the failure being removed. This banner is cosmetic
 * and is not the gate; lib/firm-access.ts decides access.
 *
 * The user can dismiss it, but the dismissal is per-SESSION (sessionStorage),
 * so it reappears next visit. The firm asked that the notice stay seen.
 */

/**
 * How far ahead the notice starts naming the end date and the download.
 *
 * Two working weeks. Long enough to arrange an export, get a purchase
 * approved, or reach whoever signs; short enough that the warning still reads
 * as information rather than as background furniture for the whole trial.
 */
const WARN_WITHIN_DAYS = 14;

export function CounselTrialBanner({
  firmName,
  trialEndsAt,
  daysLeft,
  accessEnded = false,
  canExport = false,
  guest = false,
}: {
  firmName: string;
  /**
   * The organization's stored trial end date as an ISO string, or null when
   * it has no trial or the date could not be read. Null renders nothing.
   */
  trialEndsAt: string | null;
  /**
   * Whole days from the server's clock to that date, zero or below once it
   * has passed. Counted on the server so both renders agree on what day it
   * is: a client-side count differs from the server's whenever the two
   * straddle midnight, which is a hydration mismatch on the one figure the
   * banner is scanned for.
   */
  daysLeft: number | null;
  /**
   * Whether the organization's access is CLOSED right now, as the gate on
   * this same request decided. Distinct from a passed end date: a suspension
   * closes an organization while its stored end date is still ahead. See the
   * note above. Not passed for the guest shell, which is redirected to the
   * access-ended page under a suspension and so never renders here closed.
   */
  accessEnded?: boolean;
  /** Whether this viewer may run the organization export (owner or admin). */
  canExport?: boolean;
  /** Co-counsel guest shell: phrase it as the FIRM's trial workspace. */
  guest?: boolean;
}) {
  const [hidden, setHidden] = useState(true);

  // Read dismissal after mount so SSR + first paint agree (avoids hydration
  // flicker); the banner reveals itself only if this session hasn't closed it.
  useEffect(() => {
    try {
      setHidden(sessionStorage.getItem('adv_trial_banner_dismissed') === '1');
    } catch {
      setHidden(false);
    }
  }, []);

  if (hidden) return null;
  // No end date, no claim. See the note above.
  if (!trialEndsAt || daysLeft == null) return null;

  const days = Math.max(0, daysLeft);
  const dayLabel = days === 1 ? 'day' : 'days';
  // Two separate facts, and the copy below needs both. `lapsed` is the date
  // having passed, which is the only thing that licenses naming the date as
  // the reason. `ended` is the organization being closed, by that date OR by
  // a suspension the banner cannot see.
  const lapsed = daysLeft <= 0;
  const ended = lapsed || accessEnded;
  const ending = !ended && daysLeft <= WARN_WITHIN_DAYS;
  const endDate = <LocaleTime iso={trialEndsAt} mode="date" />;

  return (
    <div className="relative z-30 border-b border-gold-500/30 bg-gradient-to-r from-gold-500/15 via-gold-400/10 to-gold-500/15">
      <div className="mx-auto flex w-full max-w-none items-center gap-3 px-4 py-2 sm:px-6 lg:px-10">
        {/* The chip has to agree with the sentence beside it. */}
        <span
          className="hidden h-5 items-center rounded-full bg-gold-400/20 px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-gold-200 sm:inline-flex"
          aria-hidden
        >
          {ended
            ? lapsed
              ? 'Trial ended'
              : 'Access ended'
            : ending
              ? 'Trial ending'
              : 'Free trial'}
        </span>
        <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-cream-100/90">
          {guest ? (
            /* A co-counsel guest is scoped to a matter and is not the
               organization. They are told what is happening and are not
               offered a download, which is not theirs to take. A guest is
               also not closed out by an expiry, only by a suspension, so
               this says nothing about their own access either way. */
            <>
              {firmName ? (
                <>
                  You&rsquo;re working in{' '}
                  <span className="font-semibold text-cream-100" data-no-translate>
                    {firmName}
                  </span>
                  &rsquo;s Advottic trial workspace
                </>
              ) : (
                <>You&rsquo;re working in an Advottic trial workspace</>
              )}
              {ended ? (
                <>. The trial ended on {endDate}.</>
              ) : (
                <>
                  , with all features included. The trial ends on {endDate}
                  {ending ? (
                    <>
                      , in{' '}
                      <span className="font-semibold text-gold-200">
                        {days} {dayLabel}
                      </span>
                    </>
                  ) : null}
                  .
                </>
              )}
            </>
          ) : ended ? (
            <>
              <span className="font-semibold text-cream-100" data-no-translate>
                {firmName}
              </span>
              {lapsed ? (
                <>&rsquo;s free trial ended on {endDate}.</>
              ) : (
                /* Closed while the stored end date is still ahead, which is a
                   suspension. The date is not the reason, so it is not named,
                   and the trial is not said to have ended. */
                <>&rsquo;s access to Advottic has ended.</>
              )}{' '}
              Your organization keeps everything it has in Advottic, and{' '}
              {canExport
                ? 'you can download it at any time.'
                : 'an owner or an administrator can download it at any time.'}
            </>
          ) : ending ? (
            /* The warning state, and the reason this component was rewritten.
               It names the date, and it says what can be done before it. */
            <>
              <span className="font-semibold text-cream-100" data-no-translate>
                {firmName}
              </span>
              &rsquo;s access ends on {endDate}, in{' '}
              <span className="font-semibold text-gold-200">
                {days} {dayLabel}
              </span>
              . Your organization keeps everything it has in Advottic after
              that, and{' '}
              {canExport
                ? 'you can download it'
                : 'an owner or an administrator can download it'}{' '}
              before then.
            </>
          ) : (
            <>
              <span className="font-semibold text-cream-100" data-no-translate>
                {firmName}
              </span>{' '}
              is on a free trial, with all features included. It ends on{' '}
              {endDate}.
            </>
          )}
        </p>
        {/* The download sits next to the sentence that mentions it, and only
            for someone who can actually run it. Offering it to a paralegal
            produces a refusal from the export route, which reads as the
            product being broken at the worst possible moment.

            It is shown at every width, unlike the chip above it. The chip is
            decoration and can go; this is the control the sentence beside it
            points at, and hiding it on a phone left that sentence offering a
            download with nothing to press. There is room, because the chip
            gives up its space at exactly the widths where this needs it. */}
        {!guest && canExport && (ending || ended) ? (
          <a
            href="/api/firm/export"
            className="inline-flex shrink-0 rounded-md border border-gold-400/40 px-2.5 py-1 text-[11.5px] font-semibold text-gold-200 transition-colors hover:bg-gold-400/15"
          >
            Download your data
          </a>
        ) : null}
        <button
          type="button"
          onClick={() => {
            try {
              sessionStorage.setItem('adv_trial_banner_dismissed', '1');
            } catch {
              /* private mode - just hide for now */
            }
            setHidden(true);
          }}
          aria-label="Dismiss trial notice"
          className="shrink-0 rounded-md p-1 text-cream-100/60 transition-colors hover:bg-cream-100/10 hover:text-cream-100"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
