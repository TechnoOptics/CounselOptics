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
import { CloseCaseControl } from './close-case-control';
import { HearingPanel } from './hearing-panel';
import { ExhibitScan } from './exhibit-scan';
import { Tabs } from '@/components/Tabs';
import { BellaPrompt } from '@/components/BellaPrompt';
import { DeleteCaseButton } from './delete-case-button';
import { PresenceIndicator } from '@/components/PresenceIndicator';
import { ViewTracker } from './view-tracker';
import { listCaseAuditEvents } from '@/lib/activity';
import { ActivityList } from './activity-list';
import { getProfile } from '@/lib/storage';

export const dynamic = 'force-dynamic';

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
    isOwner || (myCollab?.role === 'editor' || myCollab?.role === 'attorney');
  const jurisdiction = [c.jurisdiction.city, c.jurisdiction.state, c.jurisdiction.country]
    .filter(Boolean)
    .join(', ');

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
        <a
          href={`/cases/${c.id}/export`}
          className="btn-secondary"
          target="_blank"
          rel="noreferrer"
        >
          <DownloadIcon />
          Export PDF
        </a>
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
                <span className="bg-gold-shine bg-clip-text text-transparent gold-pan">
                  {c.title}
                </span>
              </h1>
              <p className="text-sm text-cream-100/85 mt-3">
                <span className="text-cream-100/55">{SUBJECT_TYPE_LABEL[c.subjectType]}: </span>
                <span className="font-medium text-cream-100">{c.subjectName}</span>
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
            value={hearingShort(c.hearingAt) ?? '—'}
            sub={c.hearingAt ? hearingDateShort(c.hearingAt) : 'not scheduled'}
            tone={hearingTone(c.hearingAt)}
          />
          <Kpi
            label="Legal Eye"
            value={review ? '✓' : '—'}
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

      <Tabs
        storageKey={`case-tabs:${c.id}`}
        tabs={[
          {
            id: 'exhibits',
            label: 'Exhibits',
            badge: exhibits.length || undefined,
            content: (
              <section className="space-y-4">
                <div className="flex items-end justify-between">
                  <div>
                    <h2 className="text-xl font-semibold tracking-tight text-ink-950">
                      Exhibits
                    </h2>
                    <p className="text-sm text-ink-500 mt-0.5">
                      {exhibits.length === 0
                        ? 'Upload evidence to start building exhibits.'
                        : `${exhibits.length} exhibit${exhibits.length === 1 ? '' : 's'}`}
                    </p>
                  </div>
                </div>

                {canUpload ? (
                  <div className="card p-6">
                    <UploadForm caseId={c.id} />
                  </div>
                ) : (
                  <div className="card p-6 text-sm text-ink-600">
                    You have view-only access on this case. Ask the case owner to upgrade your
                    role to <strong>Editor</strong> or <strong>Attorney</strong> if you need to
                    add exhibits.
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
                                <span className="badge bg-ink-100 text-ink-700">{e.category}</span>
                              )}
                              {e.incidentDate && (
                                <span>
                                  <span className="text-ink-400">Incident:</span>{' '}
                                  {new Date(e.incidentDate).toLocaleDateString()}
                                </span>
                              )}
                              {e.source && (
                                <span>
                                  <span className="text-ink-400">Source:</span> {e.source}
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
              </section>
            ),
          },
          {
            id: 'hearing',
            label: 'Hearing',
            badge: hearingBadge(c.hearingAt),
            content: (
              <HearingPanel
                caseRecord={c}
                exhibits={exhibits}
                review={review}
                isOwner={isOwner}
                collaboratorCount={collaborators.length}
              />
            ),
          },
          {
            id: 'subject',
            label: 'Subject',
            badge: subjectProfileFieldCount(c.subjectProfile) || undefined,
            content: (
              <SubjectProfileView
                subjectName={c.subjectName}
                subjectType={c.subjectType}
                profile={c.subjectProfile ?? {}}
              />
            ),
          },
          {
            id: 'review',
            label: 'Legal Eye',
            badge: review ? '✓' : undefined,
            content: <ReviewPanel caseId={c.id} review={review} />,
          },
          ...(usingSupabase()
            ? [
                {
                  id: 'sharing',
                  label: 'Sharing',
                  badge: collaborators.length || undefined,
                  content: (
                    <CollaboratorsPanel
                      caseId={c.id}
                      collaborators={collaborators}
                      isOwner={isOwner}
                    />
                  ),
                },
                {
                  id: 'activity',
                  label: 'Activity',
                  badge: activity.length || undefined,
                  content: (
                    <section className="space-y-4">
                      <header>
                        <h2 className="text-xl font-semibold tracking-tight text-ink-950 dark:text-cream-100">
                          Case activity
                        </h2>
                        <p className="text-sm text-ink-500 dark:text-cream-100/55 mt-0.5">
                          Every view, upload, and edit is logged here. The case owner is
                          emailed for material changes (we batch related events within a few
                          minutes so you do not get spammed).
                        </p>
                      </header>
                      <ActivityList events={activity} />
                    </section>
                  ),
                },
              ]
            : []),
          {
            id: 'settings',
            label: 'Settings',
            content: (
              <div className="space-y-6">
                <CloseCaseControl caseId={c.id} status={c.status} isOwner={isOwner} />

                {isOwner && (
                  <section className="card border-rose-200 dark:border-rose-900/40 p-5 sm:p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-[0.22em] font-semibold text-rose-700 dark:text-rose-200">
                          Danger zone
                        </p>
                        <h3 className="font-display text-lg font-medium tracking-[-0.01em] text-ink-950 dark:text-cream-100 mt-1">
                          Delete this case
                        </h3>
                        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1.5 max-w-md leading-relaxed">
                          Removes the case, every exhibit, every Legal Eye review, and any
                          collaborator access. This is permanent - the case cannot be recovered.
                        </p>
                      </div>
                      <DeleteCaseButton caseId={c.id} caseTitle={c.title} />
                    </div>
                  </section>
                )}
              </div>
            ),
          },
        ]}
      />
    </div>
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

