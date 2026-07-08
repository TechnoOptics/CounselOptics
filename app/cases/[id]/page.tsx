import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  getCase,
  getLatestReview,
  listCollaborators,
  listExhibits,
  usingSupabase,
} from '@/lib/storage';
import { getCurrentUser } from '@/lib/supabase/server';
import { storageUnavailable } from '@/lib/setup-status';
import { STATUS_LABEL, SUBJECT_TYPE_LABEL, type CaseStatus, type SubjectProfile, type SubjectType } from '@/lib/types';
import { UploadForm } from './upload-form';
import { ReviewPanel } from './review-panel';
import { CollaboratorsPanel } from './collaborators-panel';
import { WitnessStatementEditor } from './witness-statement-editor';
import { CloseCaseControl } from './close-case-control';
import { HearingPanel } from './hearing-panel';
import { ExhibitScan } from './exhibit-scan';
import { Tabs } from '@/components/Tabs';
import { CaseStory, type StoryItem } from '@/components/CaseStory';
import { OpposingCounsel } from '@/components/OpposingCounsel';
import { EvidenceHeatmap } from '@/components/EvidenceHeatmap';
import { BellaPrompt } from '@/components/BellaPrompt';
import { DeleteCaseButton } from './delete-case-button';
import { PresenceIndicator } from '@/components/PresenceIndicator';
import { ViewTracker } from './view-tracker';
import { listCaseAuditEvents } from '@/lib/activity';
import { ActivityList } from './activity-list';
import { CaseSearch, type SearchItem } from './case-search';
import { CallALawyerCallout } from '@/components/CallALawyerCallout';
import { hasDecisionCue } from '@/lib/decision-cues';
import { getProfile } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/**
 * Per-case browser-tab title. Audit W20 V3 CR-30: previously the page
 * inherited the consumer marketing title ("Advottic - Build your case")
 * for every case detail view, so a user with three matters open in
 * three tabs could not tell them apart from the tab strip alone.
 * generateMetadata reads the matter title server-side and surfaces it
 * via the standard title-template ("%s · Advottic"), turning each tab
 * into a usable matter identifier. Falls back gracefully when the
 * case row can't be loaded so a transient DB error doesn't 500 the
 * tab title.
 */
export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  if (storageUnavailable()) return { title: 'Case' };
  try {
    const c = await getCase(params.id);
    if (!c) return { title: 'Case · Not found' };
    return {
      title: `${c.title} · Cases`,
      robots: { index: false, follow: false },
    };
  } catch {
    return { title: 'Case' };
  }
}

export default async function CaseDetailPage({ params }: { params: { id: string } }) {
  if (storageUnavailable()) redirect('/cases');
  const c = await getCase(params.id);
  if (!c) notFound();

  const [exhibits, review, collaborators, currentUser, activity] = await Promise.all([
    listExhibits(c.id),
    getLatestReview(c.id),
    usingSupabase() ? listCollaborators(c.id) : Promise.resolve([]),
    usingSupabase() ? getCurrentUser() : Promise.resolve(null),
    usingSupabase() ? listCaseAuditEvents(c.id, 50) : Promise.resolve([]),
  ]);

  // Profile of the current viewer for the presence chip avatar/initials.
  const myProfile = currentUser ? await getProfile().catch(() => null) : null;

  const isOwner = !usingSupabase() || Boolean(currentUser && c.ownerId === currentUser.id);
  const myCollab = currentUser
    ? collaborators.find((cc) => cc.userId === currentUser.id)
    : null;
  const canUpload =
    isOwner ||
    myCollab?.role === 'editor' ||
    myCollab?.role === 'attorney' ||
    myCollab?.role === 'witness' ||
    myCollab?.role === 'represented';
  const isWitness = myCollab?.role === 'witness';
  const jurisdiction = [c.jurisdiction.city, c.jurisdiction.state, c.jurisdiction.country]
    .filter(Boolean)
    .join(', ');

  // Flatten everything searchable on this case into a single list
  // for the per-case command-palette search input.
  const searchItems: SearchItem[] = [
    ...exhibits.map((e) => ({
      type: 'exhibit' as const,
      title: `${e.label} - ${e.fileName}`,
      snippet: [e.description, e.category, e.source].filter(Boolean).join(' · '),
      href: `/api/files/${e.id}`,
    })),
    ...activity.map((a) => ({
      type: 'activity' as const,
      title: a.eventType.replace(/_/g, ' '),
      snippet: [a.actorDisplayName, a.actorEmail, JSON.stringify(a.metadata)]
        .filter(Boolean)
        .join(' · '),
    })),
    ...collaborators.map((cc) => ({
      type: 'collaborator' as const,
      title: cc.email || cc.userId || 'Collaborator',
      snippet: cc.role,
    })),
    ...(c.description
      ? [{ type: 'note' as const, title: 'Case description', snippet: c.description }]
      : []),
    ...(c.hearingNotes
      ? [
          {
            type: 'note' as const,
            title: 'Hearing notes',
            snippet: c.hearingNotes,
          },
        ]
      : []),
  ];

  // Case Story spine - exhibits anchored to when the event actually
  // happened (incidentDate), plus the opening, hearing and meaningful
  // activity. Sorted client-side in the component.
  const storyItems: StoryItem[] = [
    {
      id: 'opened',
      at: c.createdAt,
      kind: 'opened' as const,
      title: 'Case opened',
      detail: `${c.caseType} matter - ${c.posture}`,
    },
    ...exhibits.map((e) => ({
      id: `ex-${e.id}`,
      at: e.incidentDate || e.uploadedAt,
      kind: 'evidence' as const,
      title: e.label,
      detail:
        [e.description, e.source && `Source: ${e.source}`]
          .filter(Boolean)
          .join(' · ') || e.fileName,
      category: e.category ?? null,
    })),
    ...(c.hearingAt
      ? [
          {
            id: 'hearing',
            at: c.hearingAt,
            kind: 'hearing' as const,
            title: 'Hearing',
            detail:
              [c.hearingLocation, c.hearingNotes].filter(Boolean).join(' · ') ||
              'Scheduled',
            future: Date.parse(c.hearingAt) > Date.now(),
          },
        ]
      : []),
    ...activity
      .filter((a) => !/viewed|search|opened_case/i.test(a.eventType))
      .slice(0, 30)
      .map((a) => ({
        id: `ev-${a.id}`,
        at: a.createdAt,
        kind: 'event' as const,
        title: a.eventType.replace(/_/g, ' '),
        detail: a.actorDisplayName ? `by ${a.actorDisplayName}` : undefined,
      })),
  ];

  // Decide whether the "this is a moment for counsel" callout
  // should fire on the case page. Keyword cues from the case
  // description / hearing notes drive one variant; an imminent
  // hearing without a review drives another. Either is enough.
  const decisionText = [c.description ?? '', c.hearingNotes ?? '']
    .filter(Boolean)
    .join('\n');
  const showCueCallout = hasDecisionCue(decisionText);
  const hearingMs = c.hearingAt ? Date.parse(c.hearingAt) : NaN;
  const daysToHearing = Number.isFinite(hearingMs)
    ? (hearingMs - Date.now()) / (24 * 60 * 60 * 1000)
    : NaN;
  const showImminentCallout =
    Number.isFinite(daysToHearing) &&
    daysToHearing > 0 &&
    daysToHearing <= 14 &&
    !review &&
    !isWitness;

  return (
    <div className="space-y-8 animate-fade-up">
      <div className="flex items-center justify-between">
        <Link
          href="/cases"
          className="text-sm text-ink-500 hover:text-ink-900 transition-colors inline-flex items-center gap-1.5"
        >
          <ArrowIcon />
          Back to cases
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href={`/cases/${c.id}/courtroom`}
            className="btn bg-forest-900 hover:bg-forest-800 text-cream-50 font-semibold"
          >
            <ShieldIcon />
            Courtroom Mode
          </Link>
          <Link href={`/cases/${c.id}/timeline`} className="btn-secondary">
            <TimelineIcon />
            Timeline
          </Link>
          <Link href={`/cases/${c.id}/packet`} className="btn-secondary">
            <DownloadIcon />
            Court Packet
          </Link>
          <a
            href={`/cases/${c.id}/export`}
            className="btn-secondary"
            target="_blank"
            rel="noreferrer"
          >
            Export PDF
          </a>
        </div>
      </div>

      {/* Case header - dark forest hero with KPI strip */}
      <div className="relative overflow-hidden rounded-3xl text-cream-100 ring-1 ring-forest-700/40 shadow-card-hover hero-bg">
        {/* Drifting decorative orbs */}
        <div aria-hidden className="hero-orb hero-orb--gold hero-orb--a"
          style={{ width: 260, height: 260, right: '-60px', top: '-80px' }} />
        <div aria-hidden className="hero-orb hero-orb--cream hero-orb--b"
          style={{ width: 200, height: 200, right: '15%', bottom: '-100px', opacity: 0.4 }} />

        {/* Live-presence indicator: tiny avatar chips with green
            glowing pulse for everyone currently viewing the case. */}
        {currentUser && (
          <div className="relative px-6 sm:px-8 lg:px-10 pt-5 -mb-2">
            <PresenceIndicator
              caseId={c.id}
              me={{
                userId: currentUser.id,
                displayName:
                  myProfile?.displayName ||
                  (currentUser.user_metadata?.full_name as string | undefined) ||
                  currentUser.email ||
                  'You',
                avatarUrl:
                  myProfile?.avatarUrl ||
                  (currentUser.user_metadata?.avatar_url as string | undefined) ||
                  null,
              }}
            />
          </div>
        )}
        {/* Fire-and-forget view tracking. Lives outside the markup tree
            so it can't block render. */}
        {currentUser && <ViewTracker caseId={c.id} />}

        <div className="relative px-6 sm:px-8 lg:px-10 pt-6 pb-2">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="text-[10px] tracking-[0.28em] uppercase font-semibold text-gold-300">
                  {c.caseType}
                </span>
                <span
                  className={`badge text-[10px] tracking-wide ${
                    c.posture === 'defendant'
                      ? 'bg-rose-500/15 text-rose-200 border border-rose-400/30'
                      : 'bg-cream-100/15 text-cream-100 border border-cream-100/25'
                  }`}
                >
                  {c.posture === 'defendant' ? 'Defendant' : 'Claimant'}
                </span>
              </div>
              <h1 className="font-display text-2xl sm:text-3xl md:text-[40px] font-medium tracking-[-0.015em] leading-[1.05] drop-shadow-[0_2px_18px_rgba(15,45,36,0.45)]">
                <span className="bg-gold-shine bg-clip-text text-transparent gold-pan" data-no-translate>
                  {c.title}
                </span>
              </h1>
              <p className="text-sm text-cream-100/85 mt-3">
                <span className="text-cream-100/55">{SUBJECT_TYPE_LABEL[c.subjectType]}: </span>
                <span className="font-medium text-cream-100" data-no-translate>{c.subjectName}</span>
                {jurisdiction && (
                  <>
                    <span className="text-cream-100/40 mx-2">·</span>
                    <span className="text-cream-100/85">{jurisdiction}</span>
                  </>
                )}
              </p>
            </div>
            <DarkStatusPill status={c.status} />
          </div>

          {c.description && (
            <p className="text-cream-100/85 text-[15px] leading-relaxed mt-5 max-w-3xl whitespace-pre-wrap">
              {c.description}
            </p>
          )}
        </div>

        {/* KPI strip baked into the header */}
        <div className="relative mt-6 grid grid-cols-2 sm:grid-cols-4 border-t border-cream-100/10 bg-forest-950/30 backdrop-blur-sm">
          <Kpi
            label="Exhibits"
            value={String(exhibits.length)}
            sub={exhibits.length === 0 ? 'add evidence' : exhibits.length === 1 ? 'on file' : 'on file'}
            tone="emerald"
          />
          <Kpi
            label="Hearing"
            value={hearingShort(c.hearingAt) ?? '-'}
            sub={c.hearingAt ? hearingDateShort(c.hearingAt) : 'not scheduled'}
            tone={hearingTone(c.hearingAt)}
          />
          <Kpi
            label="Advottic Review"
            value={review ? '✓' : '-'}
            sub={review ? 'review on file' : 'not run'}
            tone={review ? 'emerald' : 'neutral'}
          />
          <Kpi
            label="Sharing"
            value={String(collaborators.length)}
            sub={collaborators.length === 0 ? 'just you' : 'collaborators'}
            tone="cream"
          />
        </div>
      </div>

      <CaseSearch items={searchItems} />

      {/* Contextual "this is a moment to call a lawyer" callouts.
          Two independent triggers fire here: keyword cues in the
          description / hearing notes (settlement / plea / SOL
          risk / opposing counsel / criminal), and an imminent
          hearing date with no Advottic Review yet. Either is
          enough to surface the soft nudge - both can show
          stacked. Witnesses don't see these (not their case). */}
      {showCueCallout && <CallALawyerCallout text={decisionText} />}
      {showImminentCallout && (
        <CallALawyerCallout
          reason={{
            title: `Hearing in ${Math.max(1, Math.ceil(daysToHearing))} day${Math.ceil(daysToHearing) === 1 ? '' : 's'} - no review yet`,
            body: 'You are within two weeks of your hearing. If you have not had a licensed attorney look at the file, even a 30-minute consult before the date is one of the highest-leverage things you can do.',
          }}
          ctaLabel="Find counsel near you"
        />
      )}

      {/*
        Case-detail top tabs - rebuilt around the user's actual goals.
        Was 9-11 tabs (Story, Practice, Strength, Exhibits, Hearing,
        Subject, Advottic Review, Sharing, Activity, Settings) plus a
        4-tab strip nested inside Advottic Review. User complaint:
        "tabs that have tabs felt like a maze."

        New shape (4 groups, no nested tabs):
          Case     = the case file: Story, Subject, Exhibits.
          Analysis = AI + research outputs: Strength, Practice,
                     Advottic Review (now one scrollable section).
          Hearing  = standalone because urgency / countdown.
          Manage   = admin: Sharing, Activity, Settings.

        Witness viewers still get a leading "My statement" tab so they
        land on their editor by default.
      */}
      <Tabs
        swipe
        storageKey={`case-tabs:${c.id}`}
        tabs={[
          ...(isWitness && myCollab
            ? [
                {
                  id: 'witness-statement',
                  label: 'My statement',
                  content: (
                    <WitnessStatementEditor
                      caseId={c.id}
                      collaboratorId={myCollab.id}
                      initialStatement={myCollab.witnessStatement ?? ''}
                      initialUpdatedAt={myCollab.witnessStatementUpdatedAt ?? null}
                    />
                  ),
                },
              ]
            : []),
          {
            // User-requested IA (May 2026): the case tab is everything
            // about the case itself except the evidence + the AI read.
            // That means Story, Subject, Hearing (moved up from its
            // own tab), Sharing, Activity, and the lifecycle/danger
            // controls. Three top-level tabs total: Case / Exhibits /
            // Advottic Review.
            id: 'case',
            label: 'Case',
            badge: hearingBadge(c.hearingAt),
            content: (
              <div className="space-y-10">
                <CaseSection
                  id="case-story"
                  eyebrow="Story"
                  title="Your case in chronological order"
                  subtitle="Every key moment, fact, and exhibit on one timeline."
                >
                  <CaseStory caseId={c.id} items={storyItems} />
                </CaseSection>

                <CaseSection
                  id="case-subject"
                  eyebrow="Subject"
                  title={`Who or what this case is about${
                    c.subjectName ? `: ${c.subjectName}` : ''
                  }`}
                  subtitle="The person or organization on the other side of the matter. Fills auto-populate on cover packets and pleadings."
                >
                  <SubjectProfileView
                    subjectName={c.subjectName}
                    subjectType={c.subjectType}
                    profile={c.subjectProfile ?? {}}
                  />
                </CaseSection>

                <CaseSection
                  id="case-hearing"
                  eyebrow="Hearing"
                  title={
                    c.hearingAt
                      ? 'Your next hearing'
                      : 'No hearing set'
                  }
                  subtitle="Date, courtroom, packet, and prep checklist. Updates here sync to the watch and the home dashboard."
                >
                  <HearingPanel
                    caseRecord={c}
                    exhibits={exhibits}
                    review={review}
                    isOwner={isOwner}
                    collaboratorCount={collaborators.length}
                  />
                </CaseSection>

                {usingSupabase() && (
                  <>
                    <CaseSection
                      id="case-sharing"
                      eyebrow="Sharing"
                      title={
                        collaborators.length === 0
                          ? 'Only you have access'
                          : `${collaborators.length} ${
                              collaborators.length === 1
                                ? 'collaborator'
                                : 'collaborators'
                            }`
                      }
                      subtitle="Invite an attorney, paralegal, or trusted witness. Per-role permissions: viewer, editor, attorney, witness."
                    >
                      <CollaboratorsPanel
                        caseId={c.id}
                        collaborators={collaborators}
                        isOwner={isOwner}
                      />
                    </CaseSection>

                    <CaseSection
                      id="case-activity"
                      eyebrow="Activity"
                      title="Audit trail"
                      subtitle="Every view, upload, and edit is logged. The case owner is emailed for material changes (we batch related events within a few minutes so you don't get spammed)."
                    >
                      <ActivityList events={activity} />
                    </CaseSection>

                    {isOwner && (
                      <CaseSection
                        id="case-community"
                        eyebrow="Community"
                        title="Community Case page"
                        subtitle="Publish a shareable public page so the community can rally support and submit evidence to your attorney. Submissions are always private."
                      >
                        <Link href={`/cases/${c.id}/community`} className="btn-secondary">
                          Manage Community Case page
                        </Link>
                      </CaseSection>
                    )}
                  </>
                )}

                <CaseSection
                  id="case-settings"
                  eyebrow="Settings"
                  title="Case lifecycle"
                  subtitle="Close, reopen, or permanently delete this case."
                >
                  <CloseCaseControl
                    caseId={c.id}
                    status={c.status}
                    isOwner={isOwner}
                  />

                  {isOwner && (
                    <section className="card border-rose-200 dark:border-rose-900/40 p-5 sm:p-6 mt-6">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-[10px] uppercase tracking-[0.22em] font-semibold text-rose-700 dark:text-rose-200">
                            Danger zone
                          </p>
                          <h3 className="font-display text-lg font-medium tracking-[-0.01em] text-ink-950 dark:text-cream-100 mt-1">
                            Delete this case
                          </h3>
                          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1.5 max-w-md leading-relaxed">
                            Removes the case, every exhibit, every
                            Advottic Review, and any collaborator
                            access. This is permanent - the case cannot
                            be recovered.
                          </p>
                        </div>
                        <DeleteCaseButton
                          caseId={c.id}
                          caseTitle={c.title}
                        />
                      </div>
                    </section>
                  )}
                </CaseSection>
              </div>
            ),
          },
          {
            id: 'exhibits',
            label: 'Exhibits',
            badge: exhibits.length || undefined,
            content: (
              <div className="space-y-10">
                <CaseSection
                  id="exhibits-upload"
                  eyebrow="Exhibits"
                  title={
                    exhibits.length === 0
                      ? 'No exhibits yet'
                      : `${exhibits.length} exhibit${
                          exhibits.length === 1 ? '' : 's'
                        }`
                  }
                  subtitle={
                    exhibits.length === 0
                      ? 'Upload evidence to start building exhibits.'
                      : 'Each upload gets a stable label so you can cite it in filings.'
                  }
                >
                  {canUpload ? (
                    <div className="card p-6">
                      <UploadForm caseId={c.id} />
                    </div>
                  ) : (
                    <div className="card p-6 text-sm text-ink-600">
                      You have view-only access on this case. Ask the
                      case owner to upgrade your role to{' '}
                      <strong>Editor</strong> or{' '}
                      <strong>Attorney</strong> if you need to add
                      exhibits.
                    </div>
                  )}

                  {exhibits.length > 0 && (
                    <BellaPrompt
                      title="Ask Bella to make sense of these exhibits"
                      subtitle="She has full visibility into your case description and exhibit list. Plain English, hedged language, no legal advice."
                      prompts={[
                        'Summarize what these exhibits prove.',
                        'Which exhibits look weakest and why?',
                        'What evidence am I missing?',
                      ]}
                    />
                  )}

                  {exhibits.length > 0 && (
                    <ul className="card divide-y divide-ink-100">
                      {exhibits.map((e) => (
                        <li key={e.id} className="p-5">
                          <div className="flex flex-wrap items-start gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2.5 mb-1">
                                <span className="badge bg-ink-950 text-white font-mono tracking-wide">
                                  {e.label}
                                </span>
                                <span className="text-sm font-medium text-ink-950 truncate">
                                  {e.fileName}
                                </span>
                              </div>
                              {e.description && (
                                <p className="text-sm text-ink-700 mb-1.5 leading-relaxed">
                                  {e.description}
                                </p>
                              )}
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
                                {e.category && (
                                  <span className="badge bg-ink-100 text-ink-700">
                                    {e.category}
                                  </span>
                                )}
                                {e.incidentDate && (
                                  <span>
                                    <span className="text-ink-400">Incident:</span>{' '}
                                    {new Date(e.incidentDate).toLocaleDateString()}
                                  </span>
                                )}
                                {e.source && (
                                  <span>
                                    <span className="text-ink-400">Source:</span>{' '}
                                    {e.source}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-ink-500 mt-1">
                                {e.fileType} · {formatBytes(e.fileSize)} · uploaded{' '}
                                {new Date(e.uploadedAt).toLocaleString()}
                              </p>
                            </div>
                            <a
                              href={`/api/files/${e.id}`}
                              className="btn-secondary"
                              target="_blank"
                              rel="noreferrer"
                            >
                              View
                            </a>
                          </div>
                          <ExhibitScan exhibit={e} />
                        </li>
                      ))}
                    </ul>
                  )}
                </CaseSection>
              </div>
            ),
          },
          {
            // 'Advottic Review' is the AI read of the case: the
            // headline review plus the supporting strength heatmap
            // and opposing-counsel profile that used to sit under
            // the broader 'Analysis' tab. All three are AI-generated
            // analysis surfaces so grouping them under a single
            // 'Advottic Review' label matches how users describe
            // them ("did you check Advottic Review yet?").
            id: 'advottic-review',
            label: 'Advottic Review',
            badge: review ? '✓' : undefined,
            content: (
              <div className="space-y-10">
                <CaseSection
                  id="review-summary"
                  eyebrow="Advottic Review"
                  title="AI read of your case"
                  subtitle="Issue-spotting, evidence gaps, possible subpoena targets."
                >
                  <ReviewPanel caseId={c.id} review={review} />
                </CaseSection>

                <CaseSection
                  id="review-strength"
                  eyebrow="Strength"
                  title="Where the case is strong, where it's weak"
                  subtitle="Heatmap of how well your exhibits cover each issue."
                >
                  <EvidenceHeatmap caseId={c.id} />
                </CaseSection>

                <CaseSection
                  id="review-practice"
                  eyebrow="Practice"
                  title="Anticipate the other side"
                  subtitle="Profile opposing counsel's likely tactics from prior cases."
                >
                  <OpposingCounsel caseId={c.id} />
                </CaseSection>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

/**
 * Section wrapper inside a merged tab. Replaces what used to be a
 * top-level tab with an in-page heading + subtitle + scroll anchor,
 * so each group tab reads as one scrollable page. The eyebrow on
 * top echoes the old tab name to preserve user mental model
 * (someone looking for "Subject" still sees "Subject" as a label,
 * just inside Case instead of as its own tab).
 *
 * scroll-mt-20 leaves room for the Tabs strip when the user jumps
 * via #anchor (e.g. from an external link or the URL hash).
 */
function CaseSection({
  id,
  eyebrow,
  title,
  subtitle,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="space-y-4 scroll-mt-24">
      <header className="space-y-1">
        <p className="text-[10px] uppercase tracking-[0.22em] font-semibold text-gold-700 dark:text-gold-300">
          {eyebrow}
        </p>
        <h2 className="font-display text-xl font-medium tracking-[-0.01em] text-ink-950 dark:text-cream-100">
          {title}
        </h2>
        {subtitle && (
          <p className="text-sm text-ink-500 dark:text-cream-100/55 leading-relaxed">
            {subtitle}
          </p>
        )}
      </header>
      <div>{children}</div>
    </section>
  );
}

function subjectProfileFieldCount(profile: SubjectProfile | undefined): number {
  if (!profile) return 0;
  return Object.values(profile).filter((v) => typeof v === 'string' && v.trim().length > 0).length;
}

function hearingBadge(hearingAt: string | null | undefined): string | undefined {
  if (!hearingAt) return undefined;
  const t = Date.parse(hearingAt);
  if (Number.isNaN(t)) return undefined;
  const days = Math.round((t - Date.now()) / (1000 * 60 * 60 * 24));
  if (days < 0) return 'past';
  if (days === 0) return 'today';
  return `${days}d`;
}

// ----- Hero KPI helpers -----

function hearingShort(hearingAt: string | null | undefined): string | null {
  if (!hearingAt) return null;
  const t = Date.parse(hearingAt);
  if (Number.isNaN(t)) return null;
  const diff = t - Date.now();
  const days = Math.round(diff / (1000 * 60 * 60 * 24));
  if (days < 0) return 'past';
  if (days === 0) return 'today';
  if (days === 1) return '1d';
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.round(days / 7)}w`;
  return `${Math.round(days / 30)}mo`;
}

function hearingDateShort(hearingAt: string): string {
  const d = new Date(hearingAt);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function hearingTone(
  hearingAt: string | null | undefined,
): 'emerald' | 'amber' | 'rose' | 'neutral' | 'cream' {
  if (!hearingAt) return 'neutral';
  const t = Date.parse(hearingAt);
  if (Number.isNaN(t)) return 'neutral';
  const days = Math.round((t - Date.now()) / (1000 * 60 * 60 * 24));
  if (days < 0) return 'neutral';
  if (days <= 3) return 'rose';
  if (days <= 14) return 'amber';
  return 'emerald';
}

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: 'emerald' | 'amber' | 'rose' | 'neutral' | 'cream';
}) {
  const accent =
    tone === 'emerald'
      ? 'text-emerald-300'
      : tone === 'amber'
        ? 'text-amber-300'
        : tone === 'rose'
          ? 'text-rose-300'
          : tone === 'cream'
            ? 'text-cream-200'
            : 'text-cream-100/60';
  return (
    <div className="px-4 sm:px-6 py-4 border-r border-cream-100/10 last:border-r-0 sm:[&:nth-child(2n)]:border-r sm:[&:nth-child(4n)]:border-r-0">
      <p className="text-[10px] uppercase tracking-[0.22em] font-semibold text-cream-100/55">
        {label}
      </p>
      <p className={`mt-1.5 text-2xl font-semibold tabular-nums tracking-tight ${accent}`}>
        {value}
      </p>
      <p className="text-[11px] text-cream-100/55 mt-0.5">{sub}</p>
    </div>
  );
}

const STATUS_TONE: Record<CaseStatus, { bg: string; ring: string; text: string }> = {
  draft: { bg: 'bg-cream-100/15', ring: 'ring-cream-100/25', text: 'text-cream-100' },
  open: { bg: 'bg-sky-500/15', ring: 'ring-sky-300/40', text: 'text-sky-200' },
  under_review: { bg: 'bg-amber-500/15', ring: 'ring-amber-300/40', text: 'text-amber-200' },
  needs_evidence: { bg: 'bg-rose-500/15', ring: 'ring-rose-300/40', text: 'text-rose-200' },
  export_ready: { bg: 'bg-emerald-500/15', ring: 'ring-emerald-300/40', text: 'text-emerald-200' },
  closed: { bg: 'bg-cream-100/10', ring: 'ring-cream-100/20', text: 'text-cream-100/70' },
  archived: { bg: 'bg-cream-100/10', ring: 'ring-cream-100/20', text: 'text-cream-100/60' },
};

function DarkStatusPill({ status }: { status: CaseStatus }) {
  const tone = STATUS_TONE[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium ring-1 ${tone.bg} ${tone.ring} ${tone.text}`}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      {STATUS_LABEL[status]}
    </span>
  );
}

const SUBJECT_PROFILE_FIELDS: {
  key: keyof SubjectProfile;
  label: string;
  showFor: SubjectType[] | 'all';
}[] = [
  { key: 'legalName', label: 'Legal name', showFor: 'all' },
  { key: 'alsoKnownAs', label: 'Also known as', showFor: 'all' },
  { key: 'relationship', label: 'Relationship to you', showFor: 'all' },
  { key: 'dateOfBirthApprox', label: 'Date of birth (approx)', showFor: ['person'] },
  { key: 'businessType', label: 'Business type', showFor: ['business'] },
  { key: 'registrationNumber', label: 'Registration / EIN', showFor: ['business'] },
  { key: 'primaryContactName', label: 'Primary contact', showFor: ['business', 'entity'] },
  { key: 'agencyOrDepartment', label: 'Agency / department', showFor: ['state', 'entity'] },
  { key: 'jurisdictionLevel', label: 'Jurisdiction level', showFor: ['state', 'entity'] },
  { key: 'address', label: 'Address', showFor: 'all' },
  { key: 'phone', label: 'Phone', showFor: 'all' },
  { key: 'email', label: 'Email', showFor: 'all' },
  { key: 'website', label: 'Website', showFor: ['business', 'entity', 'state'] },
  { key: 'notes', label: 'Notes', showFor: 'all' },
];

function SubjectProfileView({
  subjectName,
  subjectType,
  profile,
}: {
  subjectName: string;
  subjectType: SubjectType;
  profile: SubjectProfile;
}) {
  const visible = SUBJECT_PROFILE_FIELDS.filter(
    (f) => f.showFor === 'all' || f.showFor.includes(subjectType),
  );
  const filled = visible.filter((f) => {
    const v = profile[f.key];
    return typeof v === 'string' && v.trim().length > 0;
  });

  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-xl font-semibold tracking-tight text-ink-950">
          {subjectName}
        </h2>
        <p className="text-sm text-ink-500 mt-0.5">
          {SUBJECT_TYPE_LABEL[subjectType]} - subject of this case file
        </p>
      </header>
      {filled.length === 0 ? (
        <div className="card p-6 text-sm text-ink-600 leading-relaxed">
          No subject details captured yet. You can add address, contact info, and identifying
          details when creating a case to keep everything in one place. Editing existing subjects
          is coming soon.
        </div>
      ) : (
        <dl className="card p-6 grid sm:grid-cols-2 gap-x-8 gap-y-4 text-sm">
          {filled.map((f) => (
            <div key={String(f.key)}>
              <dt className="eyebrow mb-1">{f.label}</dt>
              <dd className="text-[14px] text-ink-800 whitespace-pre-wrap break-words">
                {profile[f.key]}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function ArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M15 18l-6-6 6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 4v12m0 0l-4-4m4 4l4-4M5 20h14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TimelineIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 7a5 5 0 100 10 5 5 0 000-10Zm0 0V3m0 18v-4M7 12H3m18 0h-4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

