'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createFirmAction } from '@/lib/firm-actions';
import {
  FIRM_TYPES,
  FIRM_TYPE_LABEL,
  FIRM_TYPE_DESCRIPTION,
  type FirmType,
} from '@/lib/firm-types';

const ACCENTS = [
  { name: 'Forest', hex: '#0f2d24' },
  { name: 'Burgundy', hex: '#7a1d2c' },
  { name: 'Navy', hex: '#1c3460' },
  { name: 'Slate', hex: '#334155' },
  { name: 'Charcoal', hex: '#1f2937' },
  { name: 'Olive', hex: '#4d5436' },
  { name: 'Crimson', hex: '#8a1c1c' },
  { name: 'Indigo', hex: '#3b3970' },
];

const SUGGESTED_PRACTICE_AREAS = [
  'Family',
  'Estate planning',
  'Civil litigation',
  'Criminal defense',
  'Immigration',
  'Personal injury',
  'Real estate',
  'Corporate / business',
  'Employment',
  'IP',
  'Tax',
  'Bankruptcy',
];

const SUGGESTED_JURISDICTIONS = [
  'United States - Federal',
  'California',
  'Texas',
  'New York',
  'Florida',
  'Illinois',
  'Pennsylvania',
  'Ohio',
  'Georgia',
  'Minnesota',
];

const CORPORATE_BUSINESS_AREAS = [
  'Mergers & acquisitions',
  'Intellectual property',
  'Employment / HR',
  'Regulatory / compliance',
  'Contracts',
  'Disputes / litigation',
  'Privacy & data',
  'Securities',
  'Tax',
];

const CORPORATE_INDUSTRIES = [
  'Technology',
  'Financial services',
  'Healthcare',
  'Manufacturing',
  'Energy / utilities',
  'Real estate',
  'Retail / consumer',
  'Media / entertainment',
  'Other',
];

const GOVERNMENT_AGENCY_TYPES = [
  'Attorney General office',
  'Public defender',
  'County / city counsel',
  'State agency legal',
  'Federal agency legal',
  'Court system',
  'Other government legal',
];

const FIRM_SIZE_BANDS = ['1-5', '6-25', '26-100', '100+'] as const;

/**
 * Five-step wizard:
 *   1. Firm type (radio with descriptions)
 *   2. Name + slug
 *   3. Type-specific questions (different per firm type)
 *   4. Brand color + logo
 *   5. Jurisdictions + practice areas (or per-type-equivalent)
 *
 * Submission packs the firm type and a metadata JSON blob into the
 * server action so all type-specific answers are preserved.
 */
export function OnboardingWizard({
  defaultName,
  defaultEmail,
}: {
  defaultName: string;
  defaultEmail: string | null;
}) {
  const router = useRouter();
  // 'welcome' is the first-time premium splash; 1-5 are the wizard
  // steps proper. Once a user dismisses the welcome we never show
  // it again in this session (it's not persisted - the next signed-
  // in visit lands them straight on /counsel since they have a firm).
  const [step, setStep] = useState<'welcome' | 1 | 2 | 3 | 4 | 5>('welcome');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [firmType, setFirmType] = useState<FirmType>('firm');
  const [name, setName] = useState(defaultName);
  const [slug, setSlug] = useState('');
  const [accent, setAccent] = useState(ACCENTS[0].hex);
  const [logoUrl, setLogoUrl] = useState('');
  const [jurisdictions, setJurisdictions] = useState<string[]>([]);
  const [jurisdictionInput, setJurisdictionInput] = useState('');
  const [practiceAreas, setPracticeAreas] = useState<string[]>([]);
  const [practiceInput, setPracticeInput] = useState('');

  // Type-specific metadata fields
  const [barNumber, setBarNumber] = useState('');
  const [yearAdmitted, setYearAdmitted] = useState('');
  const [firmSize, setFirmSize] = useState<string>('');
  const [foundedYear, setFoundedYear] = useState('');
  const [parentCompany, setParentCompany] = useState('');
  const [industry, setIndustry] = useState('');
  const [isGeneralCounsel, setIsGeneralCounsel] = useState(false);
  const [businessAreas, setBusinessAreas] = useState<string[]>([]);
  const [agencyType, setAgencyType] = useState('');
  const [governmentLevel, setGovernmentLevel] = useState<
    'federal' | 'state' | 'county' | 'municipal' | ''
  >('');
  const [populationServed, setPopulationServed] = useState('');
  const [fundingSource, setFundingSource] = useState('');
  const [otherDescription, setOtherDescription] = useState('');

  const canStep2 = name.trim().length > 0;

  // Most types use "practice areas" but corporate + government swap
  // it for type-specific terminology.
  const usesPracticeAreas =
    firmType === 'individual' ||
    firmType === 'firm' ||
    firmType === 'legal_aid' ||
    firmType === 'other';

  function buildMetadata(): Record<string, unknown> {
    switch (firmType) {
      case 'individual':
        return {
          ...(barNumber.trim() && { barNumber: barNumber.trim() }),
          ...(yearAdmitted.trim() && { yearAdmitted: Number(yearAdmitted) || undefined }),
        };
      case 'firm':
        return {
          ...(firmSize && { sizeBand: firmSize }),
          ...(foundedYear.trim() && { foundedYear: Number(foundedYear) || undefined }),
        };
      case 'corporate':
        return {
          ...(parentCompany.trim() && { parentCompany: parentCompany.trim() }),
          ...(industry && { industry }),
          isGeneralCounsel,
          ...(businessAreas.length > 0 && { businessAreas }),
        };
      case 'government':
        return {
          ...(agencyType && { agencyType }),
          ...(governmentLevel && { governmentLevel }),
        };
      case 'legal_aid':
        return {
          ...(populationServed.trim() && { populationServed: populationServed.trim() }),
          ...(fundingSource.trim() && { fundingSource: fundingSource.trim() }),
        };
      case 'other':
        return otherDescription.trim()
          ? { description: otherDescription.trim() }
          : {};
    }
  }

  function submit() {
    setError(null);
    const formData = new FormData();
    formData.set('firmType', firmType);
    formData.set('metadata', JSON.stringify(buildMetadata()));
    formData.set('name', name);
    formData.set('slug', slug);
    formData.set('accentColor', accent);
    formData.set('logoUrl', logoUrl);
    formData.set('jurisdictions', jurisdictions.join(','));
    formData.set(
      'practiceAreas',
      (firmType === 'corporate' ? businessAreas : practiceAreas).join(','),
    );
    startTransition(async () => {
      const res = await createFirmAction(formData);
      if (!res.ok) {
        setError(res.error ?? 'Could not create firm.');
        return;
      }
      router.push('/counsel');
      router.refresh();
    });
  }

  if (step === 'welcome') {
    return <CounselWelcome onContinue={() => setStep(1)} />;
  }

  return (
    <div className="card p-6 sm:p-8 space-y-5">
      <Progress step={step} total={5} />

      {step === 1 && (
        <div className="space-y-4">
          <p className="eyebrow">What kind of legal team are you?</p>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 leading-relaxed">
            Pick the option that fits best. The next steps adapt to it - we won&rsquo;t ask
            a corporate counsel team about firm size, or a public defender about industry.
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {FIRM_TYPES.map((t) => (
              <li key={t}>
                <button
                  type="button"
                  onClick={() => setFirmType(t)}
                  className={`w-full text-left card p-4 transition-all ${
                    firmType === t
                      ? 'ring-2 ring-gold-400/50 dark:ring-gold-500/50 border-gold-400'
                      : 'hover:border-gold-500/40'
                  }`}
                >
                  <p className="font-semibold text-forest-900 dark:text-cream-100 text-sm">
                    {FIRM_TYPE_LABEL[t]}
                  </p>
                  <p className="text-[12px] text-ink-600 dark:text-cream-100/70 mt-1.5 leading-relaxed">
                    {FIRM_TYPE_DESCRIPTION[t]}
                  </p>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setStep(2)} className="btn-primary">
              Continue &rarr;
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <p className="eyebrow">{FIRM_TYPE_LABEL[firmType]}</p>
          <div>
            <label className="label" htmlFor="firm-name">
              {firmType === 'corporate'
                ? 'Legal team name'
                : firmType === 'government'
                  ? 'Office / agency name'
                  : firmType === 'legal_aid'
                    ? 'Organization name'
                    : 'Firm name'}
            </label>
            <input
              id="firm-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                firmType === 'individual'
                  ? 'Jane Doe Law'
                  : firmType === 'firm'
                    ? 'Acme Law Group, PLLC'
                    : firmType === 'corporate'
                      ? 'Acme Corp Legal'
                      : firmType === 'government'
                        ? 'County of Hennepin - Office of the Attorney'
                        : firmType === 'legal_aid'
                          ? 'Mid-Minnesota Legal Aid'
                          : 'Your organization'
              }
              className="input"
              maxLength={120}
            />
          </div>
          <div>
            <label className="label" htmlFor="firm-slug">
              URL slug{' '}
              <span className="text-ink-400 dark:text-cream-100/45 font-normal">
                (optional - we&rsquo;ll generate one from the name if blank)
              </span>
            </label>
            <input
              id="firm-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="acme"
              className="input"
              maxLength={40}
            />
          </div>
          {defaultEmail && (
            <p className="text-[11px] text-ink-500 dark:text-cream-100/55">
              You&rsquo;ll be added as the <strong>owner</strong> using {defaultEmail}.
            </p>
          )}
          <div className="flex justify-between gap-2 pt-2">
            <button type="button" onClick={() => setStep(1)} className="btn-ghost">
              &larr; Back
            </button>
            <button
              type="button"
              onClick={() => setStep(3)}
              disabled={!canStep2}
              className="btn-primary"
            >
              Continue &rarr;
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-5">
          <p className="eyebrow">A few more about {name || 'your team'}</p>

          {firmType === 'individual' && (
            <>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
                    Bar number{' '}
                    <span className="text-ink-400 dark:text-cream-100/45 font-normal">
                      (optional)
                    </span>
                  </span>
                  <input
                    value={barNumber}
                    onChange={(e) => setBarNumber(e.target.value)}
                    placeholder="123456"
                    className="input"
                    maxLength={20}
                  />
                </label>
                <label className="block">
                  <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
                    Year admitted to practice{' '}
                    <span className="text-ink-400 dark:text-cream-100/45 font-normal">
                      (optional)
                    </span>
                  </span>
                  <input
                    type="number"
                    value={yearAdmitted}
                    onChange={(e) => setYearAdmitted(e.target.value)}
                    placeholder="2015"
                    className="input"
                    min={1950}
                    max={new Date().getFullYear()}
                  />
                </label>
              </div>
            </>
          )}

          {firmType === 'firm' && (
            <>
              <div>
                <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
                  Firm size
                </span>
                <div className="grid grid-cols-4 gap-2">
                  {FIRM_SIZE_BANDS.map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => setFirmSize(b)}
                      className={`rounded-lg p-2.5 text-sm font-medium border-2 transition-all ${
                        firmSize === b
                          ? 'border-forest-900 dark:border-gold-500 ring-2 ring-forest-900/15 dark:ring-gold-500/30 bg-cream-50 dark:bg-forest-800/40'
                          : 'border-ink-200 dark:border-forest-700/50 hover:border-forest-700 dark:hover:border-gold-500/50'
                      }`}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              </div>
              <label className="block">
                <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
                  Founded year{' '}
                  <span className="text-ink-400 dark:text-cream-100/45 font-normal">
                    (optional)
                  </span>
                </span>
                <input
                  type="number"
                  value={foundedYear}
                  onChange={(e) => setFoundedYear(e.target.value)}
                  placeholder="2008"
                  className="input"
                  min={1800}
                  max={new Date().getFullYear()}
                />
              </label>
            </>
          )}

          {firmType === 'corporate' && (
            <>
              <label className="block">
                <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
                  Parent company
                </span>
                <input
                  value={parentCompany}
                  onChange={(e) => setParentCompany(e.target.value)}
                  placeholder="Acme Corp."
                  className="input"
                  maxLength={120}
                />
              </label>
              <label className="block">
                <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
                  Industry
                </span>
                <select
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  className="input"
                >
                  <option value="">Select an industry…</option>
                  {CORPORATE_INDUSTRIES.map((i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-start gap-3 text-sm text-ink-700 dark:text-cream-100/80">
                <input
                  type="checkbox"
                  checked={isGeneralCounsel}
                  onChange={(e) => setIsGeneralCounsel(e.currentTarget.checked)}
                  className="mt-1"
                />
                <span>I am the General Counsel for this team.</span>
              </label>
              <Chips
                label="Business areas of focus"
                placeholder="e.g., M&A, IP, Employment"
                value={businessAreas}
                onChange={setBusinessAreas}
                input={practiceInput}
                setInput={setPracticeInput}
                suggestions={CORPORATE_BUSINESS_AREAS}
              />
              <p className="text-[11px] text-ink-500 dark:text-cream-100/55">
                In-house teams typically organize around business areas rather than
                practice areas - we&rsquo;ll show those in the dashboard.
              </p>
            </>
          )}

          {firmType === 'government' && (
            <>
              <label className="block">
                <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
                  Agency type
                </span>
                <select
                  value={agencyType}
                  onChange={(e) => setAgencyType(e.target.value)}
                  className="input"
                >
                  <option value="">Select an agency type…</option>
                  {GOVERNMENT_AGENCY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <div>
                <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
                  Government level
                </span>
                <div className="grid grid-cols-4 gap-2">
                  {(['federal', 'state', 'county', 'municipal'] as const).map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => setGovernmentLevel(lvl)}
                      className={`rounded-lg p-2.5 text-sm font-medium capitalize border-2 transition-all ${
                        governmentLevel === lvl
                          ? 'border-forest-900 dark:border-gold-500 ring-2 ring-forest-900/15 dark:ring-gold-500/30 bg-cream-50 dark:bg-forest-800/40'
                          : 'border-ink-200 dark:border-forest-700/50 hover:border-forest-700 dark:hover:border-gold-500/50'
                      }`}
                    >
                      {lvl}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {firmType === 'legal_aid' && (
            <>
              <label className="block">
                <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
                  Population served{' '}
                  <span className="text-ink-400 dark:text-cream-100/45 font-normal">
                    (optional)
                  </span>
                </span>
                <input
                  value={populationServed}
                  onChange={(e) => setPopulationServed(e.target.value)}
                  placeholder="e.g., low-income tenants, asylum seekers"
                  className="input"
                  maxLength={200}
                />
              </label>
              <label className="block">
                <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
                  Funding source{' '}
                  <span className="text-ink-400 dark:text-cream-100/45 font-normal">
                    (optional)
                  </span>
                </span>
                <input
                  value={fundingSource}
                  onChange={(e) => setFundingSource(e.target.value)}
                  placeholder="e.g., LSC grant, IOLTA, private donations"
                  className="input"
                  maxLength={200}
                />
              </label>
            </>
          )}

          {firmType === 'other' && (
            <label className="block">
              <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
                Tell us about your organization
              </span>
              <textarea
                rows={4}
                value={otherDescription}
                onChange={(e) => setOtherDescription(e.target.value)}
                placeholder="We're a court-appointed mediation panel covering five counties..."
                className="input resize-y"
                maxLength={1000}
              />
            </label>
          )}

          <div className="flex justify-between gap-2 pt-2">
            <button type="button" onClick={() => setStep(2)} className="btn-ghost">
              &larr; Back
            </button>
            <button type="button" onClick={() => setStep(4)} className="btn-primary">
              Continue &rarr;
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-5">
          <p className="eyebrow">Brand</p>
          <div>
            <label className="label">Accent color</label>
            <p className="text-[11px] text-ink-500 dark:text-cream-100/55 mb-3">
              Highlights buttons, sidebar icons, and the firm logo placeholder.
            </p>
            <div className="grid grid-cols-4 gap-2">
              {ACCENTS.map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  onClick={() => setAccent(c.hex)}
                  className={`rounded-lg p-2 text-center text-xs font-medium border-2 transition-all ${
                    accent === c.hex
                      ? 'border-forest-900 dark:border-gold-500 ring-2 ring-forest-900/20 dark:ring-gold-500/30'
                      : 'border-ink-200 dark:border-forest-700/50 hover:border-forest-700 dark:hover:border-gold-500/50'
                  }`}
                >
                  <span
                    className="block h-8 w-full rounded mb-1.5 shadow-sm"
                    style={{ backgroundColor: c.hex }}
                  />
                  <span className="text-ink-700 dark:text-cream-100/85">{c.name}</span>
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <label htmlFor="custom-accent" className="text-xs text-ink-600 dark:text-cream-100/70">
                Custom hex:
              </label>
              <input
                id="custom-accent"
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
                placeholder="#0f2d24"
                className="input flex-1"
                maxLength={7}
              />
              <span
                className="h-8 w-8 rounded ring-1 ring-ink-200 dark:ring-forest-700/60 flex-none"
                style={{ backgroundColor: /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : '#cccccc' }}
                aria-hidden
              />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="logo-url">
              Logo URL{' '}
              <span className="text-ink-400 dark:text-cream-100/45 font-normal">
                (optional - upload comes in firm settings)
              </span>
            </label>
            <input
              id="logo-url"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://your-cdn.example.com/logo.png"
              className="input"
              maxLength={500}
            />
          </div>
          <div className="flex justify-between gap-2 pt-2">
            <button type="button" onClick={() => setStep(3)} className="btn-ghost">
              &larr; Back
            </button>
            <button type="button" onClick={() => setStep(5)} className="btn-primary">
              Continue &rarr;
            </button>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="space-y-5">
          <p className="eyebrow">Coverage</p>
          <Chips
            label={
              firmType === 'government'
                ? 'Jurisdictions you cover'
                : firmType === 'corporate'
                  ? 'Where the company operates'
                  : 'Jurisdictions where you practice'
            }
            placeholder="e.g., Minnesota, US Federal"
            value={jurisdictions}
            onChange={setJurisdictions}
            input={jurisdictionInput}
            setInput={setJurisdictionInput}
            suggestions={SUGGESTED_JURISDICTIONS}
          />
          {usesPracticeAreas && (
            <Chips
              label="Practice areas"
              placeholder="e.g., Family, Estate planning"
              value={practiceAreas}
              onChange={setPracticeAreas}
              input={practiceInput}
              setInput={setPracticeInput}
              suggestions={SUGGESTED_PRACTICE_AREAS}
            />
          )}

          {error && (
            <p className="rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">
              {error}
            </p>
          )}

          <div className="flex justify-between gap-2 pt-2">
            <button type="button" onClick={() => setStep(4)} className="btn-ghost" disabled={pending}>
              &larr; Back
            </button>
            <button type="button" onClick={submit} disabled={pending} className="btn-primary">
              {pending ? 'Creating workspace...' : 'Create & continue'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The very first screen a brand-new Counsel user sees. Sets the
 * tone: premium, polite, direct about data sovereignty + security
 * before asking them to set up. Skipped on subsequent visits because
 * once the user has a firm we redirect to /counsel directly.
 */
function CounselWelcome({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="card p-7 sm:p-10 space-y-7 animate-fade-up">
      <div className="text-center">
        <p className="text-[10px] uppercase tracking-[0.32em] font-semibold text-gold-300 mb-3">
          Welcome to Advottic Counsel
        </p>
        <h1 className="font-display text-3xl sm:text-4xl font-medium tracking-[-0.02em] leading-[1.1] text-cream-100">
          Built for the people who carry{' '}
          <span className="bg-gold-shine bg-clip-text text-transparent gold-pan italic">
            other people&rsquo;s stories.
          </span>
        </h1>
        <p className="text-sm sm:text-base text-cream-100/80 mt-4 max-w-2xl mx-auto leading-relaxed">
          Advottic started on the consumer side, helping individuals walk into court
          prepared. As clients shared their files with their attorneys, those attorneys
          asked us for the other half of the picture: a workspace built around their
          firm. This is that workspace.
        </p>
      </div>

      <section className="rounded-xl ring-1 ring-gold-400/30 bg-forest-900/40 p-5 sm:p-6 space-y-3">
        <p className="font-display text-lg font-medium text-cream-100">
          Your data is yours. Full stop.
        </p>
        <ul className="space-y-2.5 text-[14.5px] text-cream-100/85 leading-relaxed">
          <li className="flex items-start gap-3">
            <CheckIcon />
            <span>
              <strong className="text-cream-100">Owned by your organization.</strong>{' '}
              Cases, documents, signatures, messages, client records - every row lives
              under your firm&rsquo;s account and only your firm&rsquo;s account. We do
              not access it. We do not aggregate it. We do not sell it.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <CheckIcon />
            <span>
              <strong className="text-cream-100">Encrypted everywhere.</strong> TLS 1.3
              on the wire. AES-256 at rest. Per-row access controls enforced by the
              database itself, so a code bug can never expose another firm&rsquo;s file
              to yours.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <CheckIcon />
            <span>
              <strong className="text-cream-100">Never used to train any AI.</strong> The
              assistant inside Advottic runs under strict zero-retention commercial
              terms. Your case content reaches the model, returns an answer, and is not
              retained beyond the response.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <CheckIcon />
            <span>
              <strong className="text-cream-100">Privacy of those you serve.</strong>{' '}
              Your clients&rsquo; documents and statements are protected by the same
              controls. Signing happens inside Advottic - the signer&rsquo;s link never
              leaves the app, and the file never travels to a third-party service.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <CheckIcon />
            <span>
              <strong className="text-cream-100">Yours to take with you.</strong> Export
              everything, any time. Close the workspace and we delete it from primary
              storage within 30 days, from backups within 35.
            </span>
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <p className="font-display text-lg font-medium text-cream-100">
          Why teams choose Counsel
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          <FeatureTile
            title="Branded, organizational workspace"
            body="Logo, accent color, jurisdictions, and practice areas of your firm. The portal feels like your firm, not ours."
          />
          <FeatureTile
            title="Cases that follow your client in"
            body="When a client shares a case with you, you inherit the timeline, exhibits, hearings, and notes - already organized."
          />
          <FeatureTile
            title="In-app e-signature, no third party"
            body="The signing link stays inside Advottic. The document never leaves your vault. Audit trail recorded automatically."
          />
          <FeatureTile
            title="Bella, jurisdiction-aware"
            body="Your firm&rsquo;s on-demand assistant for issue spotting, drafting outlines, and explaining concepts in plain English. Hedged when uncertain."
          />
          <FeatureTile
            title="Roles built for legal teams"
            body="Owner, admin, attorney, paralegal, staff. Permissions match how legal work actually flows."
          />
          <FeatureTile
            title="Designed to feel calm"
            body="No notification spam. No dark patterns. The app stays out of the way so you can focus on the work."
          />
        </div>
      </section>

      <div className="text-center pt-2 space-y-3">
        <button
          type="button"
          onClick={onContinue}
          className="btn bg-gold-metal text-forest-950 hover:brightness-110 shadow-gold-glow font-semibold px-6 py-3 text-base"
        >
          Set up my workspace
          <span aria-hidden className="ml-2">
            &rarr;
          </span>
        </button>
        <p className="text-[11px] text-cream-100/55">
          Two minutes. You can change everything later.
        </p>
      </div>
    </div>
  );
}

function FeatureTile({ title, body }: { title: string; body: string }) {
  return (
    <article className="rounded-lg ring-1 ring-forest-700/40 bg-forest-900/40 p-4">
      <p className="font-semibold text-cream-100 text-[14.5px]">{title}</p>
      <p className="text-[13px] text-cream-100/75 mt-1.5 leading-relaxed">{body}</p>
    </article>
  );
}

function CheckIcon() {
  return (
    <span
      className="flex-none mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full"
      style={{ backgroundColor: 'var(--firm-accent, #d5bb7e)' }}
      aria-hidden
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
        <path
          d="M5 13l4 4 10-10"
          stroke="#0a1f19"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function Progress({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }, (_, i) => i + 1).map((s) => (
        <span
          key={s}
          className={`h-1 flex-1 rounded-full transition-all ${
            s < step
              ? 'bg-forest-900 dark:bg-gold-500'
              : s === step
                ? 'bg-forest-700 dark:bg-gold-400'
                : 'bg-ink-200 dark:bg-forest-700/50'
          }`}
        />
      ))}
    </div>
  );
}

function Chips({
  label,
  placeholder,
  value,
  onChange,
  input,
  setInput,
  suggestions,
}: {
  label: string;
  placeholder: string;
  value: string[];
  onChange: (v: string[]) => void;
  input: string;
  setInput: (v: string) => void;
  suggestions: string[];
}) {
  function add(v: string) {
    const trimmed = v.trim();
    if (!trimmed) return;
    if (value.includes(trimmed)) return;
    onChange([...value, trimmed].slice(0, 30));
    setInput('');
  }
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex flex-wrap gap-2 mb-2">
        {value.map((chip) => (
          <span
            key={chip}
            className="inline-flex items-center gap-1.5 rounded-full bg-cream-50 dark:bg-forest-800/60 ring-1 ring-ink-200 dark:ring-forest-700/60 px-3 py-1 text-sm text-ink-800 dark:text-cream-100/85"
          >
            {chip}
            <button
              type="button"
              onClick={() => onChange(value.filter((v) => v !== chip))}
              className="text-ink-400 dark:text-cream-100/55 hover:text-rose-700 dark:hover:text-rose-300"
              aria-label={`Remove ${chip}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add(input);
            }
          }}
          placeholder={placeholder}
          className="input flex-1"
          maxLength={80}
        />
        <button type="button" onClick={() => add(input)} className="btn-secondary">
          Add
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {suggestions
          .filter((s) => !value.includes(s))
          .slice(0, 8)
          .map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="text-[11px] px-2 py-0.5 rounded-full bg-ink-100 dark:bg-forest-800/50 text-ink-600 dark:text-cream-100/70 hover:bg-cream-50 dark:hover:bg-forest-700/60 hover:text-forest-900 dark:hover:text-cream-100 transition-colors"
            >
              + {s}
            </button>
          ))}
      </div>
    </div>
  );
}
