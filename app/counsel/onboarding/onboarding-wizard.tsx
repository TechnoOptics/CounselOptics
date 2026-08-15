'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createFirmAction, createFirmFromGrantAction } from '@/lib/firm-actions';
import {
  FIRM_TYPES,
  FIRM_TYPE_LABEL,
  FIRM_TYPE_DESCRIPTION,
  type FirmType,
} from '@/lib/firm-types';
import { firmCopy, firmVocabulary } from '@/lib/firm-vocabulary';
import { T, useT } from '@/components/i18n/LocaleProvider';

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
  defaultFirmType,
  grantToken,
}: {
  defaultName: string;
  defaultEmail: string | null;
  /** When provided (e.g. from a grant), pre-fills the firm-type
   *  selector. The user can still change it. */
  defaultFirmType?: FirmType;
  /** When provided, submission uses createFirmFromGrantAction
   *  instead of createFirmAction so the grant is validated +
   *  marked accepted on the server. */
  grantToken?: string;
}) {
  const t = useT();
  const router = useRouter();
  // 'welcome' is the first-time premium splash; 1-5 are the wizard
  // steps proper. Once a user dismisses the welcome we never show
  // it again in this session (it's not persisted - the next signed-
  // in visit lands them straight on /counsel since they have a firm).
  const [step, setStep] = useState<'welcome' | 1 | 2 | 3 | 4 | 5>('welcome');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [firmType, setFirmType] = useState<FirmType>(defaultFirmType ?? 'firm');
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

  // This used to gate the field OFF for corporate and government, under a
  // comment saying those types "swap it for type-specific terminology". They
  // did not: nothing rendered in its place, so an in-house team was simply
  // never asked what work it covers, and firms.practice_areas stayed empty for
  // exactly the workspaces whose dashboard groups by it. The terminology the
  // comment promised now exists in lib/firm-vocabulary.ts, so the field is
  // shown to everyone and named for the type.
  const vocab = firmVocabulary(firmType);
  const copy = firmCopy(firmType);

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
    if (grantToken) formData.set('grant', grantToken);
    startTransition(async () => {
      const res = grantToken
        ? await createFirmFromGrantAction(formData)
        : await createFirmAction(formData);
      if (!res.ok) {
        setError(res.error ?? t('Could not create firm.'));
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
          <p className="eyebrow"><T>What kind of legal team are you?</T></p>
          <p className="text-sm text-muted leading-relaxed">
            <T>Pick the option that fits best. The next steps adapt to it - we won&rsquo;t ask
            a corporate counsel team about firm size, or a public defender about industry.</T>
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {FIRM_TYPES.map((ft) => (
              <li key={ft}>
                <button
                  type="button"
                  onClick={() => setFirmType(ft)}
                  className={`w-full text-left card p-4 transition-all ${
                    firmType === ft
                      ? 'ring-2 ring-gold-400/50 dark:ring-gold-500/50 border-gold-400'
                      : 'hover:border-gold-500/40'
                  }`}
                >
                  <p className="font-semibold text-foreground text-sm">
                    {FIRM_TYPE_LABEL[ft]}
                  </p>
                  <p className="text-[12px] text-muted mt-1.5 leading-relaxed">
                    {FIRM_TYPE_DESCRIPTION[ft]}
                  </p>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setStep(2)} className="btn-primary">
              <T>Continue</T> &rarr;
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
                ? <T>Legal team name</T>
                : firmType === 'government'
                  ? <T>Office / agency name</T>
                  : firmType === 'legal_aid'
                    ? <T>Organization name</T>
                    : <T>Firm name</T>}
            </label>
            <input
              id="firm-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                firmType === 'individual'
                  ? t('Jane Doe Law')
                  : firmType === 'firm'
                    ? t('Acme Law Group, PLLC')
                    : firmType === 'corporate'
                      ? t('Acme Corp Legal')
                      : firmType === 'government'
                        ? t('County of Hennepin - Office of the Attorney')
                        : firmType === 'legal_aid'
                          ? t('Mid-Minnesota Legal Aid')
                          : t('Your organization')
              }
              className="input"
              maxLength={120}
            />
          </div>
          <div>
            <label className="label" htmlFor="firm-slug">
              <T>URL slug</T>{' '}
              <span className="text-muted font-normal">
                <T>(optional - we&rsquo;ll generate one from the name if blank)</T>
              </span>
            </label>
            <input
              id="firm-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder={t('acme')}
              className="input"
              maxLength={40}
            />
          </div>
          {defaultEmail && (
            <p className="text-[11px] text-muted">
              <T>You&rsquo;ll be added as the</T> <strong><T>owner</T></strong> <T>using</T> {defaultEmail}.
            </p>
          )}
          <div className="flex justify-between gap-2 pt-2">
            <button type="button" onClick={() => setStep(1)} className="btn-ghost">
              &larr; <T>Back</T>
            </button>
            <button
              type="button"
              onClick={() => setStep(3)}
              disabled={!canStep2}
              className="btn-primary"
            >
              <T>Continue</T> &rarr;
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-5">
          <p className="eyebrow"><T>A few more about</T> {name || <T>your team</T>}</p>

          {firmType === 'individual' && (
            <>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="block text-sm font-medium text-foreground mb-1.5">
                    <T>Bar number</T>{' '}
                    <span className="text-muted font-normal">
                      <T>(optional)</T>
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
                  <span className="block text-sm font-medium text-foreground mb-1.5">
                    <T>Year admitted to practice</T>{' '}
                    <span className="text-muted font-normal">
                      <T>(optional)</T>
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
                <span className="block text-sm font-medium text-foreground mb-1.5">
                  <T>Firm size</T>
                </span>
                <div className="grid grid-cols-4 gap-2">
                  {FIRM_SIZE_BANDS.map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => setFirmSize(b)}
                      className={`rounded-lg p-2.5 text-sm font-medium border-2 transition-all ${
                        firmSize === b
                          ? 'border-forest-900 dark:border-gold-500 ring-2 ring-forest-900/15 dark:ring-gold-500/30 bg-surface-2'
                          : 'border-edge hover:border-forest-700 dark:hover:border-gold-500/50'
                      }`}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              </div>
              <label className="block">
                <span className="block text-sm font-medium text-foreground mb-1.5">
                  <T>Founded year</T>{' '}
                  <span className="text-muted font-normal">
                    <T>(optional)</T>
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
                <span className="block text-sm font-medium text-foreground mb-1.5">
                  <T>Parent company</T>
                </span>
                <input
                  value={parentCompany}
                  onChange={(e) => setParentCompany(e.target.value)}
                  placeholder={t('Acme Corp.')}
                  className="input"
                  maxLength={120}
                />
              </label>
              <label className="block">
                <span className="block text-sm font-medium text-foreground mb-1.5">
                  <T>Industry</T>
                </span>
                <select
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  className="input"
                >
                  <option value=""><T>Select an industry…</T></option>
                  {CORPORATE_INDUSTRIES.map((i) => (
                    <option key={i} value={i}>
                      <T>{i}</T>
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-start gap-3 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={isGeneralCounsel}
                  onChange={(e) => setIsGeneralCounsel(e.currentTarget.checked)}
                  className="mt-1"
                />
                <span><T>I am the General Counsel for this team.</T></span>
              </label>
              <Chips
                label={t('Business areas of focus')}
                placeholder={t('e.g., M&A, IP, Employment')}
                value={businessAreas}
                onChange={setBusinessAreas}
                input={practiceInput}
                setInput={setPracticeInput}
                suggestions={CORPORATE_BUSINESS_AREAS}
              />
              <p className="text-[11px] text-muted">
                <T>In-house teams typically organize around business areas rather than
                practice areas - we&rsquo;ll show those in the dashboard.</T>
              </p>
            </>
          )}

          {firmType === 'government' && (
            <>
              <label className="block">
                <span className="block text-sm font-medium text-foreground mb-1.5">
                  <T>Agency type</T>
                </span>
                <select
                  value={agencyType}
                  onChange={(e) => setAgencyType(e.target.value)}
                  className="input"
                >
                  <option value=""><T>Select an agency type…</T></option>
                  {GOVERNMENT_AGENCY_TYPES.map((at) => (
                    <option key={at} value={at}>
                      <T>{at}</T>
                    </option>
                  ))}
                </select>
              </label>
              <div>
                <span className="block text-sm font-medium text-foreground mb-1.5">
                  <T>Government level</T>
                </span>
                <div className="grid grid-cols-4 gap-2">
                  {(['federal', 'state', 'county', 'municipal'] as const).map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => setGovernmentLevel(lvl)}
                      className={`rounded-lg p-2.5 text-sm font-medium capitalize border-2 transition-all ${
                        governmentLevel === lvl
                          ? 'border-forest-900 dark:border-gold-500 ring-2 ring-forest-900/15 dark:ring-gold-500/30 bg-surface-2'
                          : 'border-edge hover:border-forest-700 dark:hover:border-gold-500/50'
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
                <span className="block text-sm font-medium text-foreground mb-1.5">
                  <T>Population served</T>{' '}
                  <span className="text-muted font-normal">
                    <T>(optional)</T>
                  </span>
                </span>
                <input
                  value={populationServed}
                  onChange={(e) => setPopulationServed(e.target.value)}
                  placeholder={t('e.g., low-income tenants, asylum seekers')}
                  className="input"
                  maxLength={200}
                />
              </label>
              <label className="block">
                <span className="block text-sm font-medium text-foreground mb-1.5">
                  <T>Funding source</T>{' '}
                  <span className="text-muted font-normal">
                    <T>(optional)</T>
                  </span>
                </span>
                <input
                  value={fundingSource}
                  onChange={(e) => setFundingSource(e.target.value)}
                  placeholder={t('e.g., LSC grant, IOLTA, private donations')}
                  className="input"
                  maxLength={200}
                />
              </label>
            </>
          )}

          {firmType === 'other' && (
            <label className="block">
              <span className="block text-sm font-medium text-foreground mb-1.5">
                <T>Tell us about your organization</T>
              </span>
              <textarea
                rows={4}
                value={otherDescription}
                onChange={(e) => setOtherDescription(e.target.value)}
                placeholder={t("We're a court-appointed mediation panel covering five counties...")}
                className="input resize-y"
                maxLength={1000}
              />
            </label>
          )}

          <div className="flex justify-between gap-2 pt-2">
            <button type="button" onClick={() => setStep(2)} className="btn-ghost">
              &larr; <T>Back</T>
            </button>
            <button type="button" onClick={() => setStep(4)} className="btn-primary">
              <T>Continue</T> &rarr;
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-5">
          <p className="eyebrow"><T>Brand</T></p>
          <div>
            <label className="label"><T>Accent color</T></label>
            <p className="text-[11px] text-muted mb-3">
              <T>Highlights buttons, sidebar icons, and the firm logo placeholder.</T>
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
                      : 'border-edge hover:border-forest-700 dark:hover:border-gold-500/50'
                  }`}
                >
                  <span
                    className="block h-8 w-full rounded mb-1.5 shadow-sm"
                    style={{ backgroundColor: c.hex }}
                  />
                  <span className="text-foreground"><T>{c.name}</T></span>
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <label htmlFor="custom-accent" className="text-xs text-muted">
                <T>Custom hex:</T>
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
                className="h-8 w-8 rounded ring-1 ring-edge flex-none"
                style={{ backgroundColor: /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : '#cccccc' }}
                aria-hidden
              />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="logo-url">
              <T>Logo URL</T>{' '}
              <span className="text-muted font-normal">
                <T>(optional - upload comes in firm settings)</T>
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
              &larr; <T>Back</T>
            </button>
            <button type="button" onClick={() => setStep(5)} className="btn-primary">
              <T>Continue</T> &rarr;
            </button>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="space-y-5">
          <p className="eyebrow"><T>Coverage</T></p>
          <Chips
            label={
              firmType === 'government'
                ? t('Jurisdictions you cover')
                : firmType === 'corporate'
                  ? t('Where the company operates')
                  : t('Jurisdictions where you practice')
            }
            placeholder={t('e.g., Minnesota, US Federal')}
            value={jurisdictions}
            onChange={setJurisdictions}
            input={jurisdictionInput}
            setInput={setJurisdictionInput}
            suggestions={SUGGESTED_JURISDICTIONS}
          />
          <Chips
            label={t(vocab.practiceAreas)}
            placeholder={t(copy.areasExample)}
            value={practiceAreas}
            onChange={setPracticeAreas}
            input={practiceInput}
            setInput={setPracticeInput}
            suggestions={SUGGESTED_PRACTICE_AREAS}
          />

          {error && (
            <p className="rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">
              {error}
            </p>
          )}

          <div className="flex justify-between gap-2 pt-2">
            <button type="button" onClick={() => setStep(4)} className="btn-ghost" disabled={pending}>
              &larr; <T>Back</T>
            </button>
            <button type="button" onClick={submit} disabled={pending} className="btn-primary">
              {pending ? <T>Creating workspace...</T> : <T>Create &amp; continue</T>}
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
          <T>Welcome to Advottic Counsel</T>
        </p>
        <h1 className="text-3xl sm:text-4xl font-medium tracking-[-0.02em] leading-[1.1] text-cream-100">
          <T>Built for the people who carry</T>{' '}
          <span className="bg-gold-shine bg-clip-text text-transparent gold-pan italic">
            <T>other people&rsquo;s stories.</T>
          </span>
        </h1>
        <p className="text-sm sm:text-base text-cream-100/80 mt-4 max-w-2xl mx-auto leading-relaxed">
          <T>Advottic started on the consumer side, helping individuals walk into court
          prepared. As clients shared their files with their attorneys, those attorneys
          asked us for the other half of the picture: a workspace built around their
          firm. This is that workspace.</T>
        </p>
      </div>

      <section className="rounded-xl ring-1 ring-gold-400/30 bg-forest-900/40 p-5 sm:p-6 space-y-3">
        <p className="text-lg font-medium text-cream-100">
          <T>Your data is yours. Full stop.</T>
        </p>
        <ul className="space-y-2.5 text-[14.5px] text-cream-100/85 leading-relaxed">
          <li className="flex items-start gap-3">
            <CheckIcon />
            <span>
              <strong className="text-cream-100"><T>Owned by your organization.</T></strong>{' '}
              <T>Cases, documents, signatures, messages, client records - every row lives
              under your firm&rsquo;s account and only your firm&rsquo;s account. We do
              not access it. We do not aggregate it. We do not sell it.</T>
            </span>
          </li>
          <li className="flex items-start gap-3">
            <CheckIcon />
            <span>
              <strong className="text-cream-100"><T>Encrypted everywhere.</T></strong>{' '}
              <T>TLS 1.3
              on the wire. AES-256 at rest. Per-row access controls enforced by the
              database itself, so a code bug can never expose another firm&rsquo;s file
              to yours.</T>
            </span>
          </li>
          <li className="flex items-start gap-3">
            <CheckIcon />
            <span>
              <strong className="text-cream-100"><T>Never used to train any AI.</T></strong>{' '}
              <T>The
              assistant inside Advottic runs under strict zero-retention commercial
              terms. Your case content reaches the model, returns an answer, and is not
              retained beyond the response.</T>
            </span>
          </li>
          <li className="flex items-start gap-3">
            <CheckIcon />
            <span>
              <strong className="text-cream-100"><T>Privacy of those you serve.</T></strong>{' '}
              <T>Your clients&rsquo; documents and statements are protected by the same
              controls. Signing happens inside Advottic - the signer&rsquo;s link never
              leaves the app, and the file never travels to a third-party service.</T>
            </span>
          </li>
          <li className="flex items-start gap-3">
            <CheckIcon />
            <span>
              <strong className="text-cream-100"><T>Yours to take with you.</T></strong>{' '}
              <T>Export
              everything, any time. Close the workspace and we delete it from primary
              storage within 30 days, from backups within 35.</T>
            </span>
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <p className="text-lg font-medium text-cream-100">
          <T>Why teams choose Counsel</T>
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
          <T>Set up my workspace</T>
          <span aria-hidden className="ml-2">
            &rarr;
          </span>
        </button>
        <p className="text-[11px] text-cream-100/55">
          <T>Two minutes. You can change everything later.</T>
        </p>
      </div>
    </div>
  );
}

function FeatureTile({ title, body }: { title: string; body: string }) {
  return (
    <article className="rounded-lg ring-1 ring-forest-700/40 bg-forest-900/40 p-4">
      <p className="font-semibold text-cream-100 text-[14.5px]"><T>{title}</T></p>
      <p className="text-[13px] text-cream-100/75 mt-1.5 leading-relaxed"><T>{body}</T></p>
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
      {/* The tick is drawn ON the firm accent, so its colour has to come
          from the accent rather than be fixed. --accent-on is set beside
          --firm-accent by the counsel layout; the fallback matches the
          gold that --firm-accent itself falls back to. */}
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
        <path
          d="M5 13l4 4 10-10"
          stroke="var(--accent-on, #000000)"
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
            className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 ring-1 ring-edge px-3 py-1 text-sm text-foreground"
          >
            {chip}
            <button
              type="button"
              onClick={() => onChange(value.filter((v) => v !== chip))}
              className="text-muted hover:text-rose-700 dark:hover:text-rose-300"
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
          <T>Add</T>
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
              className="text-[11px] px-2 py-0.5 rounded-full bg-surface-2 text-muted hover:text-foreground transition-colors"
            >
              + <T>{s}</T>
            </button>
          ))}
      </div>
    </div>
  );
}
