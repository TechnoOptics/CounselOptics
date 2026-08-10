'use client';

import { useMemo, useState, useTransition } from 'react';
import { updateHearingAction } from '@/lib/actions';
import type { AIReview, Case, Exhibit } from '@/lib/types';
import { formatDateTimeLong } from '@/lib/format';

type Phase = 'view' | 'edit';

export function HearingPanel({
  caseRecord,
  exhibits,
  review,
  isOwner,
  collaboratorCount,
}: {
  caseRecord: Case;
  exhibits: Exhibit[];
  review: AIReview | null;
  isOwner: boolean;
  collaboratorCount: number;
}) {
  const [phase, setPhase] = useState<Phase>('view');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const initialLocal = caseRecord.hearingAt
    ? toLocalDateTimeInput(caseRecord.hearingAt)
    : '';
  const [hearingAt, setHearingAt] = useState(initialLocal);
  const [hearingLocation, setHearingLocation] = useState(caseRecord.hearingLocation ?? '');
  const [hearingNotes, setHearingNotes] = useState(caseRecord.hearingNotes ?? '');

  const countdown = useMemo(() => buildCountdown(caseRecord.hearingAt), [caseRecord.hearingAt]);
  const checklist = useMemo(
    () =>
      buildChecklist({
        caseRecord,
        exhibits,
        review,
        collaboratorCount,
        urgency: countdown?.urgency ?? 'none',
      }),
    [caseRecord, exhibits, review, collaboratorCount, countdown?.urgency],
  );

  function save(clearIt = false) {
    setError(null);
    startTransition(async () => {
      try {
        const isoOrNull = clearIt
          ? null
          : hearingAt
            ? new Date(hearingAt).toISOString()
            : null;
        await updateHearingAction(caseRecord.id, {
          hearingAt: isoOrNull,
          hearingLocation: clearIt ? '' : hearingLocation,
          hearingNotes: clearIt ? '' : hearingNotes,
        });
        if (clearIt) {
          setHearingAt('');
          setHearingLocation('');
          setHearingNotes('');
        }
        setPhase('view');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save.');
      }
    });
  }

  // ---------- No hearing scheduled ----------
  if (!caseRecord.hearingAt && phase === 'view') {
    return (
      <section className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow mb-1">Hearing</p>
            <h2 className="text-lg font-semibold tracking-tight text-forest-900">
              No hearing scheduled
            </h2>
            <p className="text-sm text-ink-600 mt-1 max-w-xl leading-relaxed">
              Add a court date or deadline and Advottic will show a countdown plus a
              prioritized pre-hearing checklist tied to this case.
            </p>
          </div>
          {isOwner && (
            <button type="button" onClick={() => setPhase('edit')} className="btn-secondary">
              Add hearing date
            </button>
          )}
        </div>
      </section>
    );
  }

  // ---------- Edit mode ----------
  if (phase === 'edit') {
    return (
      <section className="card p-6 space-y-5 animate-fade-up">
        <div>
          <p className="eyebrow mb-1">Hearing</p>
          <h2 className="text-lg font-semibold tracking-tight text-forest-900">
            {caseRecord.hearingAt ? 'Edit hearing' : 'Add hearing'}
          </h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="label" htmlFor="h-at">
              Date &amp; time
            </label>
            <input
              id="h-at"
              type="datetime-local"
              value={hearingAt}
              onChange={(e) => setHearingAt(e.target.value)}
              // Block past dates and any time inside the next 30
              // minutes - hearings need at least a small buffer for
              // travel + check-in, and selecting "right now" is
              // virtually always a typo. The slice(0,16) trims to the
              // datetime-local format YYYY-MM-DDTHH:MM.
              min={new Date(Date.now() + 30 * 60 * 1000).toISOString().slice(0, 16)}
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="h-loc">
              Location
            </label>
            <input
              id="h-loc"
              value={hearingLocation}
              onChange={(e) => setHearingLocation(e.target.value)}
              maxLength={400}
              placeholder="Court name, courtroom, address"
              className="input"
            />
          </div>
          <div className="md:col-span-2">
            <label className="label" htmlFor="h-notes">
              Notes
            </label>
            <textarea
              id="h-notes"
              value={hearingNotes}
              onChange={(e) => setHearingNotes(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Judge, case number, what to bring, deadlines"
              className="input resize-y"
            />
          </div>
        </div>
        {error && (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {caseRecord.hearingAt ? (
            <button
              type="button"
              onClick={() => save(true)}
              disabled={pending}
              className="text-xs text-rose-700 hover:text-rose-900 underline"
            >
              Remove hearing
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPhase('view')}
              disabled={pending}
              className="btn-ghost"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => save(false)}
              disabled={pending || !hearingAt}
              className="btn-primary"
            >
              {pending ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </section>
    );
  }

  // ---------- View mode (with hearing scheduled) ----------
  return (
    <section className="space-y-4">
      <div
        className={`relative overflow-hidden rounded-2xl p-5 md:p-6 text-white ${
          countdown?.urgency === 'critical'
            ? 'bg-gradient-to-br from-rose-700 via-rose-800 to-forest-900'
            : countdown?.urgency === 'soon'
              ? 'bg-gradient-to-br from-amber-700 via-amber-800 to-forest-900'
              : 'bg-gradient-to-br from-forest-700 via-forest-800 to-forest-950'
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] tracking-[0.3em] uppercase font-semibold opacity-80">
              Upcoming hearing
            </p>
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight mt-1">
              {countdown ? countdown.label : 'Past hearing'}
            </h2>
            <p className="text-sm opacity-90 mt-1.5">
              {formatHearingFull(caseRecord.hearingAt!)}
            </p>
            {caseRecord.hearingLocation && (
              <p className="text-sm opacity-80 mt-1">
                <span className="opacity-70">Location:</span> {caseRecord.hearingLocation}
              </p>
            )}
            {caseRecord.hearingNotes && (
              <p className="text-sm opacity-80 mt-2 whitespace-pre-wrap leading-relaxed max-w-xl">
                {caseRecord.hearingNotes}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-none">
            <a
              href={`/cases/${caseRecord.id}/hearing.ics`}
              download
              className="btn bg-white/15 text-white border border-white/20 hover:bg-white/25 backdrop-blur inline-flex items-center gap-1.5"
              title="Download .ics file - opens in Apple / Google / Outlook Calendar"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="3" y="5" width="18" height="16" rx="2" />
                <path d="M3 10h18M8 3v4M16 3v4" />
                <path d="M12 13v5M9 16h6" />
              </svg>
              Add to calendar
            </a>
            {isOwner && (
              <button
                type="button"
                onClick={() => setPhase('edit')}
                className="btn bg-white/15 text-white border border-white/20 hover:bg-white/25 backdrop-blur"
              >
                Edit
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Checklist */}
      <div className="card p-6 space-y-4">
        <div>
          <p className="eyebrow mb-1">Before your hearing</p>
          <h3 className="text-lg font-semibold tracking-tight text-forest-900">
            Prioritized to-do
          </h3>
          <p className="text-xs text-ink-500 mt-0.5">
            Items reorder by urgency as your hearing date approaches.
          </p>
        </div>
        {checklist.length === 0 ? (
          <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            ✓ Looks like you&apos;re ready. Add an Advottic Review and any new exhibits as they
            come in.
          </p>
        ) : (
          <ul className="space-y-2">
            {checklist.map((item, i) => (
              <li
                key={item.id}
                className={`flex items-start gap-3 rounded-lg border p-3 ${
                  item.priority === 'critical'
                    ? 'border-rose-200 bg-rose-50/60'
                    : item.priority === 'high'
                      ? 'border-amber-200 bg-amber-50/60'
                      : item.priority === 'medium'
                        ? 'border-ink-200 bg-cream-50/60'
                        : 'border-ink-100 bg-white'
                }`}
              >
                <span
                  className={`mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full text-[10px] font-mono font-semibold ${
                    item.priority === 'critical'
                      ? 'bg-rose-700 text-white'
                      : item.priority === 'high'
                        ? 'bg-amber-700 text-white'
                        : item.priority === 'medium'
                          ? 'bg-forest-900 text-cream-100'
                          : 'bg-ink-200 text-ink-700'
                  }`}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink-950">{item.title}</p>
                  <p className="text-xs text-ink-600 leading-relaxed mt-0.5">{item.body}</p>
                </div>
                {item.cta && (
                  <a
                    href={item.cta.href}
                    className="text-xs text-forest-900 underline underline-offset-2 hover:text-forest-700 whitespace-nowrap"
                  >
                    {item.cta.label}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Countdown
// ---------------------------------------------------------------------------

type Urgency = 'none' | 'far' | 'soon' | 'critical' | 'past';

function buildCountdown(hearingAt: string | null | undefined):
  | {
      label: string;
      urgency: Urgency;
      daysOut: number;
    }
  | null {
  if (!hearingAt) return null;
  const t = Date.parse(hearingAt);
  if (Number.isNaN(t)) return null;
  const diffMs = t - Date.now();
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (diffMs < 0) {
    const past = Math.abs(days);
    return {
      label: past === 0 ? 'Earlier today' : `${past} day${past === 1 ? '' : 's'} ago`,
      urgency: 'past',
      daysOut: -past,
    };
  }
  if (days === 0) {
    const hours = Math.max(1, Math.round(diffMs / (1000 * 60 * 60)));
    return {
      label: `In ${hours} hour${hours === 1 ? '' : 's'}`,
      urgency: 'critical',
      daysOut: 0,
    };
  }
  const urgency: Urgency = days <= 3 ? 'critical' : days <= 14 ? 'soon' : 'far';
  return { label: `In ${days} day${days === 1 ? '' : 's'}`, urgency, daysOut: days };
}

function formatHearingFull(hearingAt: string): string {
  const d = new Date(hearingAt);
  return formatDateTimeLong(d);
}

function toLocalDateTimeInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// Checklist generator
// ---------------------------------------------------------------------------

type ChecklistItem = {
  id: string;
  title: string;
  body: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  cta?: { href: string; label: string };
};

function buildChecklist({
  caseRecord,
  exhibits,
  review,
  collaboratorCount,
  urgency,
}: {
  caseRecord: Case;
  exhibits: Exhibit[];
  review: AIReview | null;
  collaboratorCount: number;
  urgency: Urgency;
}): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const bumpFor = (base: 'high' | 'medium' | 'low'): ChecklistItem['priority'] => {
    if (urgency === 'critical') return base === 'low' ? 'medium' : 'critical';
    if (urgency === 'soon') return base === 'low' ? 'medium' : 'high';
    return base;
  };

  // Always-on critical reminder for the day-of
  if (urgency === 'critical') {
    items.push({
      id: 'arrival',
      priority: 'critical',
      title: 'Plan to arrive 30 minutes early',
      body: `Confirm courtroom, parking, and security screening time. Bring photo ID and printed copies of every key document.`,
    });
  }

  // Defendant + criminal carve-out
  if (caseRecord.posture === 'defendant' && caseRecord.caseType === 'Criminal allegation') {
    items.push({
      id: 'pd',
      priority: 'critical',
      title: 'Public defender check (criminal matter)',
      body:
        'If you are facing any possibility of incarceration and do not have counsel, request a public defender at your first court appearance. It is a free constitutional right.',
    });
  }

  // Case-type specific document / evidence prep. These are common
  // patterns for each bucket - plain language, not legal advice.
  const typeItems = caseTypeChecklist(caseRecord.caseType, bumpFor);
  for (const it of typeItems) items.push(it);

  if (exhibits.length === 0) {
    items.push({
      id: 'first-exhibit',
      priority: bumpFor('high'),
      title: 'Upload your first exhibit',
      body: 'Photos, documents, screenshots, communications - anything supporting the matter. Each upload becomes a numbered exhibit.',
      cta: { href: `/cases/${caseRecord.id}#tabpanel-exhibits`, label: 'Add exhibit' },
    });
  } else if (exhibits.length < 3) {
    items.push({
      id: 'more-exhibits',
      priority: bumpFor('medium'),
      title: `Add more evidence (${exhibits.length} exhibit${exhibits.length === 1 ? '' : 's'} so far)`,
      body: 'A few targeted exhibits beat one big binder. Aim for at least 3-5 that each prove a different fact.',
      cta: { href: `/cases/${caseRecord.id}#tabpanel-exhibits`, label: 'Add exhibit' },
    });
  }

  if (!review) {
    items.push({
      id: 'run-legal-eye',
      priority: bumpFor('high'),
      title: 'Run Advottic Review',
      body: 'Surfaces possible issues, evidence gaps, and subpoena targets grounded in your jurisdiction. Lets you walk in knowing what to expect.',
      cta: { href: `/cases/${caseRecord.id}#tabpanel-review`, label: 'Run review' },
    });
  } else {
    const reviewAge = Math.floor(
      (Date.now() - Date.parse(review.createdAt)) / (1000 * 60 * 60 * 24),
    );
    if (reviewAge >= 14) {
      items.push({
        id: 'refresh-legal-eye',
        priority: bumpFor('low'),
        title: 'Refresh Advottic Review',
        body: `Your last review is ${reviewAge} days old. Re-run if you have added exhibits or facts since.`,
        cta: { href: `/cases/${caseRecord.id}#tabpanel-review`, label: 'Re-run review' },
      });
    }
  }

  if (review && (review.evidenceToStrengthen ?? []).length > 0) {
    items.push({
      id: 'follow-evidence-gaps',
      priority: bumpFor('medium'),
      title: 'Close out evidence gaps Advottic Review flagged',
      body:
        'Open the Advottic Review and walk through "Evidence to strengthen the case" - upload exhibits that fill those gaps before the hearing.',
      cta: { href: `/cases/${caseRecord.id}#tabpanel-review`, label: 'Open review' },
    });
  }

  if (caseRecord.posture === 'defendant') {
    items.push({
      id: 'answer',
      priority: bumpFor('high'),
      title: 'Confirm any procedural deadlines',
      body:
        'If you have a complaint, the date your Answer is due is on the summons. Calendar it now if you have not. Missing it can mean a default judgment.',
    });
  }

  items.push({
    id: 'export-packet',
    priority: bumpFor('medium'),
    title: 'Export the case packet PDF',
    body:
      'A single PDF with the cover, case info, exhibits index, and Advottic Review - ready to email or print.',
    cta: { href: `/cases/${caseRecord.id}/export`, label: 'Export PDF' },
  });

  if (collaboratorCount === 0) {
    items.push({
      id: 'invite-attorney',
      priority: bumpFor('low'),
      title: 'Share the case with your attorney',
      body:
        'Invite by email - they get read access plus the ability to add exhibits, but cannot edit the case metadata.',
      cta: { href: `/cases/${caseRecord.id}#tabpanel-sharing`, label: 'Invite' },
    });
  }

  if (!caseRecord.hearingLocation) {
    items.push({
      id: 'confirm-location',
      priority: bumpFor('low'),
      title: 'Confirm courtroom + judge',
      body:
        'Call the clerk or check your court\'s online docket. Add the courtroom number and judge to the hearing notes so it is one tap away on the day.',
    });
  }

  // Sort by priority (critical, high, medium, low)
  const order: Record<ChecklistItem['priority'], number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  return items.sort((a, b) => order[a.priority] - order[b.priority]);
}

/**
 * Case-type-specific document and evidence prep prompts. These are
 * common patterns for each bucket - plain language reminders of
 * documents people often forget to gather, not legal advice. Each
 * item the user already covered should fall away naturally as they
 * upload exhibits.
 */
function caseTypeChecklist(
  caseType: string,
  bumpFor: (b: 'high' | 'medium' | 'low') => ChecklistItem['priority'],
): ChecklistItem[] {
  switch (caseType) {
    case 'Landlord/tenant issue':
      return [
        {
          id: 'lt-lease',
          priority: bumpFor('high'),
          title: 'Bring the signed lease + every amendment',
          body:
            'Plus rent receipts or bank-statement entries showing payment history, and any written notices you sent or received (move-out, repair requests, late-rent letters).',
        },
        {
          id: 'lt-photos',
          priority: bumpFor('medium'),
          title: 'Photos of the unit condition',
          body:
            'Date-stamped move-in and move-out photos, plus shots of any defect (water damage, mold, broken fixtures) with timestamps.',
        },
      ];
    case 'Employment issue':
      return [
        {
          id: 'emp-docs',
          priority: bumpFor('high'),
          title: 'Pull your offer letter, contract, and handbook',
          body:
            'Add performance reviews, write-ups, and the termination or separation letter if you have one. Save copies to Advottic before they expire from work email.',
        },
        {
          id: 'emp-eeoc',
          priority: bumpFor('medium'),
          title: 'EEOC / state agency timing',
          body:
            'Discrimination claims usually require an agency charge first, with deadlines as short as 180 days from the incident. If you have not filed yet, check whether you still can.',
        },
      ];
    case 'Contract dispute':
      return [
        {
          id: 'contract-original',
          priority: bumpFor('high'),
          title: 'Upload the signed contract + every amendment',
          body:
            'Including any addenda, change orders, and email exchanges that modified terms. The other side will lean on whatever version helps them - have all of them.',
        },
        {
          id: 'contract-perf',
          priority: bumpFor('medium'),
          title: 'Document each side\'s performance',
          body:
            'Invoices, receipts, delivery confirmations, and the email thread where one side flagged the other for breaching. Build a timeline.',
        },
      ];
    case 'Family matter':
      return [
        {
          id: 'fm-orders',
          priority: bumpFor('high'),
          title: 'Existing orders + financial disclosures',
          body:
            'Marriage certificate (if applicable), prior custody / support orders, and the most recent financial-disclosure form. Most family hearings open with the judge asking for these.',
        },
      ];
    case 'Harassment/threats':
      return [
        {
          id: 'harass-log',
          priority: bumpFor('high'),
          title: 'Chronology log of every incident',
          body:
            'Date, time, location, what happened, who witnessed it. Number them. Attach screenshots, voicemails, photos of any injuries or property damage, and any police-report or restraining-order numbers.',
        },
        {
          id: 'harass-protective',
          priority: bumpFor('medium'),
          title: 'Protective-order paperwork',
          body:
            'If you applied for a temporary restraining order or order of protection, bring the application, the temporary order, and proof of service on the other party.',
        },
      ];
    case 'Property damage':
      return [
        {
          id: 'pd-photos',
          priority: bumpFor('high'),
          title: 'Before / after photos and repair estimates',
          body:
            'Two or more written estimates carry more weight than one. Add insurance correspondence and any police or incident report number.',
        },
      ];
    case 'Fraud/scam':
      return [
        {
          id: 'fraud-statements',
          priority: bumpFor('high'),
          title: 'Bank / card statements showing every transaction',
          body:
            'Highlight the disputed entries. Save communications with the other party (email, SMS, app messages) and any FTC / IC3 / police report numbers.',
        },
      ];
    case 'Business dispute':
      return [
        {
          id: 'biz-formation',
          priority: bumpFor('medium'),
          title: 'Formation docs + the contract in dispute',
          body:
            'Operating agreement / bylaws / articles, plus the contract and any amendments at issue. Add financial records relevant to the disputed amounts.',
        },
      ];
    case 'Civil dispute':
      return [
        {
          id: 'civil-incident',
          priority: bumpFor('high'),
          title: 'Incident timeline + witness contacts',
          body:
            'Photos taken on the day, any police or incident report number, and contact info for every witness who saw what happened.',
        },
      ];
    case 'Criminal allegation':
      return [
        {
          id: 'crim-discovery',
          priority: bumpFor('high'),
          title: 'Get the discovery packet from your attorney',
          body:
            'Police report, witness statements, body-cam / dash-cam if any. If you do not have counsel yet, ask the court for a public defender and request discovery as soon as you do.',
        },
      ];
    default:
      return [];
  }
}
