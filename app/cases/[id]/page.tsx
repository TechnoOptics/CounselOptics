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
import { Disclaimer } from '@/components/Disclaimer';
import { UploadForm } from './upload-form';
import { ReviewPanel } from './review-panel';
import { CollaboratorsPanel } from './collaborators-panel';
import { CloseCaseControl } from './close-case-control';
import { HearingPanel } from './hearing-panel';
import { Tabs } from '@/components/Tabs';

export const dynamic = 'force-dynamic';

export default async function CaseDetailPage({ params }: { params: { id: string } }) {
  if (storageUnavailable()) redirect('/cases');
  const c = await getCase(params.id);
  if (!c) notFound();

  const [exhibits, review, collaborators, currentUser] = await Promise.all([
    listExhibits(c.id),
    getLatestReview(c.id),
    usingSupabase() ? listCollaborators(c.id) : Promise.resolve([]),
    usingSupabase() ? getCurrentUser() : Promise.resolve(null),
  ]);

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

      {/* Case header */}
      <div className="card p-7">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <p className="eyebrow">{c.caseType}</p>
              <span
                className={`badge ${
                  c.posture === 'defendant'
                    ? 'bg-rose-50 text-rose-800 border border-rose-200'
                    : 'bg-ink-100 text-ink-700'
                }`}
              >
                {c.posture === 'defendant' ? 'Defendant' : 'Claimant'}
              </span>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-ink-950 leading-tight">
              {c.title}
            </h1>
            <p className="text-sm text-ink-600 mt-2">
              <span className="text-ink-500">{SUBJECT_TYPE_LABEL[c.subjectType]}: </span>
              <span className="font-medium text-ink-900">{c.subjectName}</span>
            </p>
          </div>
          <StatusPill status={c.status} />
        </div>

        <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-4 text-sm pt-5 divider">
          <Field label="Jurisdiction" value={jurisdiction} />
          <Field label="Case type" value={c.caseType} />
          <Field label="Created" value={new Date(c.createdAt).toLocaleString()} />
          <Field label="Last updated" value={new Date(c.updatedAt).toLocaleString()} />
        </dl>

        {c.description && (
          <div className="pt-5 mt-5 divider">
            <p className="eyebrow mb-2">Description</p>
            <p className="text-[15px] leading-relaxed text-ink-800 whitespace-pre-wrap">
              {c.description}
            </p>
          </div>
        )}
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
                  <ul className="card divide-y divide-ink-100">
                    {exhibits.map((e) => (
                      <li key={e.id} className="p-5 flex flex-wrap items-start gap-4">
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
              ]
            : []),
          {
            id: 'settings',
            label: 'Settings',
            content: (
              <div className="space-y-6">
                <CloseCaseControl caseId={c.id} status={c.status} isOwner={isOwner} />
              </div>
            ),
          },
        ]}
      />

      <Disclaimer />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="eyebrow mb-1">{label}</dt>
      <dd className="text-[14px] text-ink-800">
        {value || <span className="text-ink-400">-</span>}
      </dd>
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

const STATUS_STYLES: Record<CaseStatus, string> = {
  draft: 'bg-ink-100 text-ink-700',
  open: 'bg-sky-50 text-sky-800 border border-sky-200',
  under_review: 'bg-amber-50 text-amber-900 border border-amber-200',
  needs_evidence: 'bg-rose-50 text-rose-800 border border-rose-200',
  export_ready: 'bg-emerald-50 text-emerald-800 border border-emerald-200',
  closed: 'bg-ink-100 text-ink-600',
  archived: 'bg-ink-100 text-ink-500',
};

function StatusPill({ status }: { status: CaseStatus }) {
  return <span className={`badge ${STATUS_STYLES[status]}`}>{STATUS_LABEL[status]}</span>;
}
