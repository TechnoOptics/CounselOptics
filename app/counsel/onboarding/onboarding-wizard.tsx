'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createFirmAction } from '@/lib/firm-actions';

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

/**
 * Three-card wizard. Step 1: name + slug. Step 2: brand color +
 * (optional) logo URL. Step 3: jurisdictions + practice areas.
 * Submit creates the firm via server action, marks the user owner,
 * activates the firm, then redirects to /counsel.
 */
export function OnboardingWizard({
  defaultName,
  defaultEmail,
}: {
  defaultName: string;
  defaultEmail: string | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(defaultName);
  const [slug, setSlug] = useState('');
  const [accent, setAccent] = useState(ACCENTS[0].hex);
  const [logoUrl, setLogoUrl] = useState('');
  const [jurisdictions, setJurisdictions] = useState<string[]>([]);
  const [jurisdictionInput, setJurisdictionInput] = useState('');
  const [practiceAreas, setPracticeAreas] = useState<string[]>([]);
  const [practiceInput, setPracticeInput] = useState('');

  const canStep1 = name.trim().length > 0;

  function submit() {
    setError(null);
    const formData = new FormData();
    formData.set('name', name);
    formData.set('slug', slug);
    formData.set('accentColor', accent);
    formData.set('logoUrl', logoUrl);
    formData.set('jurisdictions', jurisdictions.join(','));
    formData.set('practiceAreas', practiceAreas.join(','));
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

  return (
    <div className="card p-6 sm:p-8 space-y-5">
      <Progress step={step} />

      {step === 1 && (
        <div className="space-y-4">
          <div>
            <label className="label" htmlFor="firm-name">
              Firm name
            </label>
            <input
              id="firm-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Law Group, PLLC"
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
            <p className="text-[11px] text-ink-500 dark:text-cream-100/55 mt-1">
              Lowercase letters, numbers, and hyphens.
            </p>
          </div>
          {defaultEmail && (
            <p className="text-[11px] text-ink-500 dark:text-cream-100/55">
              You&rsquo;ll be added as the firm <strong>owner</strong> using {defaultEmail}.
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={!canStep1}
              className="btn-primary"
            >
              Continue &rarr;
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <div>
            <label className="label">Accent color</label>
            <p className="text-[11px] text-ink-500 dark:text-cream-100/55 mb-3">
              Highlights buttons, sidebar icons, and your firm logo placeholder.
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
            <button type="button" onClick={() => setStep(1)} className="btn-ghost">
              &larr; Back
            </button>
            <button type="button" onClick={() => setStep(3)} className="btn-primary">
              Continue &rarr;
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-5">
          <Chips
            label="Jurisdictions where the firm practices"
            placeholder="e.g., Minnesota, US Federal"
            value={jurisdictions}
            onChange={setJurisdictions}
            input={jurisdictionInput}
            setInput={setJurisdictionInput}
            suggestions={SUGGESTED_JURISDICTIONS}
          />
          <Chips
            label="Practice areas"
            placeholder="e.g., Family, Estate planning"
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
            <button type="button" onClick={() => setStep(2)} className="btn-ghost" disabled={pending}>
              &larr; Back
            </button>
            <button type="button" onClick={submit} disabled={pending} className="btn-primary">
              {pending ? 'Creating firm...' : 'Create firm & continue'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Progress({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="flex items-center gap-2">
      {[1, 2, 3].map((s) => (
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
