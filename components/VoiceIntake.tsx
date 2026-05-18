'use client';

/**
 * Voice-first Case Capture - flagship.
 *
 * Instead of a multi-step form, the litigant just tells their story
 * (spoken or typed). The model structures it; they confirm/edit a
 * clean review; we submit it through the SAME proven
 * createCaseAction the wizard uses (zero risk to the creation path).
 */

import { useRef, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { createCaseAction, type CreateCaseResult } from '@/lib/actions';

type Draft = {
  title: string;
  caseType: string;
  posture: string;
  subjectType: string;
  subjectName: string;
  country: string;
  state: string;
  city: string;
  description: string;
};

const CASE_TYPES = [
  'Civil dispute',
  'Employment issue',
  'Landlord/tenant issue',
  'Contract dispute',
  'Family matter',
  'Criminal allegation',
  'Harassment/threats',
  'Property damage',
  'Fraud/scam',
  'Business dispute',
  'Other',
];

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn bg-gold-400 hover:bg-gold-300 text-forest-950 font-semibold w-full disabled:opacity-50"
    >
      {pending ? 'Creating your case...' : 'Create my case'}
    </button>
  );
}

export function VoiceIntake() {
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<'speak' | 'review'>('speak');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [listening, setListening] = useState(false);
  const recRef = useRef<{ stop: () => void } | null>(null);
  const [state, formAction] = useFormState<CreateCaseResult | null, FormData>(
    createCaseAction,
    null,
  );

  const SR =
    typeof window !== 'undefined'
      ? (window as unknown as {
          webkitSpeechRecognition?: new () => unknown;
          SpeechRecognition?: new () => unknown;
        }).SpeechRecognition ||
        (window as unknown as { webkitSpeechRecognition?: new () => unknown })
          .webkitSpeechRecognition
      : undefined;

  function toggleMic() {
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    if (!SR) return;
    try {
      const rec = new (SR as new () => {
        continuous: boolean;
        interimResults: boolean;
        lang: string;
        onresult: (e: {
          resultIndex: number;
          results: { length: number } & Record<
            number,
            { 0: { transcript: string }; isFinal: boolean }
          >;
        }) => void;
        onend: () => void;
        start: () => void;
        stop: () => void;
      })();
      rec.continuous = true;
      rec.interimResults = false;
      rec.lang = 'en-US';
      rec.onresult = (e) => {
        let add = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) add += e.results[i][0].transcript + ' ';
        }
        if (add) setText((p) => (p ? p + ' ' : '') + add.trim());
      };
      rec.onend = () => setListening(false);
      rec.start();
      recRef.current = rec;
      setListening(true);
    } catch {
      setListening(false);
    }
  }

  async function structure() {
    if (text.trim().length < 25 || busy) return;
    setBusy(true);
    setErr('');
    recRef.current?.stop();
    setListening(false);
    try {
      const res = await fetch('/api/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error || 'Could not structure that.');
      } else {
        setDraft(j as Draft);
        setPhase('review');
      }
    } catch {
      setErr('Network error - try again.');
    } finally {
      setBusy(false);
    }
  }

  if (phase === 'review' && draft) {
    return (
      <div className="space-y-6 animate-fade-up">
        <div>
          <p className="eyebrow mb-2">Review &amp; create</p>
          <h1 className="font-display text-3xl font-medium tracking-[-0.015em] text-forest-900">
            Here&rsquo;s your case. Fix anything.
          </h1>
          <p className="text-sm text-ink-500 mt-1.5">
            Built from your words - check each field, edit freely,
            then create it.
          </p>
        </div>
        <form action={formAction} className="card p-6 space-y-4">
          <Field label="Case title" name="title" defaultValue={draft.title} />
          <Field
            label="Who/what it's about"
            name="subjectName"
            defaultValue={draft.subjectName}
          />
          <div className="grid sm:grid-cols-2 gap-4">
            <Select
              label="This person/entity is a"
              name="subjectType"
              defaultValue={draft.subjectType}
              options={['person', 'business', 'matter', 'state', 'entity']}
            />
            <Select
              label="Your role"
              name="posture"
              defaultValue={draft.posture}
              options={['claimant', 'defendant']}
            />
          </div>
          <Select
            label="Type of matter"
            name="caseType"
            defaultValue={draft.caseType}
            options={CASE_TYPES}
          />
          <div className="grid sm:grid-cols-3 gap-4">
            <Field
              label="Country"
              name="country"
              defaultValue={draft.country}
              placeholder="required"
            />
            <Field label="State" name="state" defaultValue={draft.state} />
            <Field label="City" name="city" defaultValue={draft.city} />
          </div>
          <div>
            <label className="label">What happened</label>
            <textarea
              name="description"
              defaultValue={draft.description}
              rows={6}
              className="w-full resize-y rounded-xl border border-ink-200 focus:border-gold-400 focus:outline-none px-3 py-2 text-sm leading-relaxed"
            />
          </div>
          {state?.error && (
            <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              {state.error}
              {state.duplicateOf && (
                <>
                  {' '}
                  <input type="hidden" name="force" value="1" />
                  Submit again to create anyway.
                </>
              )}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPhase('speak')}
              className="btn-secondary"
            >
              Back
            </button>
            <div className="flex-1">
              <SubmitBtn />
            </div>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-up">
      <div>
        <p className="eyebrow mb-2">Speak your case</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.015em] text-forest-900">
          Just tell us what happened.
        </h1>
        <p className="text-sm text-ink-500 mt-1.5 max-w-xl leading-relaxed">
          No forms. Talk or type it like you&rsquo;d tell a friend -
          who, what, when, where. We&rsquo;ll organize it into a case
          file you can review and fix.
        </p>
      </div>

      {SR && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={toggleMic}
            className={`relative h-28 w-28 rounded-full font-semibold text-sm transition-transform active:scale-95 ${
              listening
                ? 'bg-rose-500 text-white'
                : 'bg-forest-900 text-cream-50'
            }`}
          >
            {listening && (
              <span className="absolute inset-0 rounded-full bg-rose-500/40 animate-ping" />
            )}
            <span className="relative">
              {listening ? 'Listening...' : 'Hold the floor'}
              <span className="block text-[10px] font-normal opacity-75 mt-0.5">
                {listening ? 'tap to pause' : 'tap to speak'}
              </span>
            </span>
          </button>
        </div>
      )}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        placeholder="Start talking, or type here... e.g. 'My landlord kept my $2,400 deposit after I moved out in good condition on March 3. I have photos and our texts.'"
        className="w-full resize-y rounded-2xl border border-ink-200 focus:border-gold-400 focus:outline-none px-4 py-3 text-sm leading-relaxed"
      />
      {err && <p className="text-sm text-rose-700">{err}</p>}
      <button
        type="button"
        onClick={structure}
        disabled={busy || text.trim().length < 25}
        className="btn bg-gold-400 hover:bg-gold-300 text-forest-950 font-semibold disabled:opacity-40"
      >
        {busy ? 'Organizing...' : 'Structure my case'}
      </button>
      <p className="text-[11px] text-ink-400">
        An organizational aid - you confirm every detail before
        anything is created. Not legal advice.
      </p>
    </div>
  );
}

function Field({
  label,
  name,
  defaultValue,
  placeholder,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="w-full rounded-xl border border-ink-200 focus:border-gold-400 focus:outline-none px-3 py-2 text-sm"
      />
    </div>
  );
}

function Select({
  label,
  name,
  defaultValue,
  options,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  options: string[];
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <select
        name={name}
        defaultValue={defaultValue}
        className="w-full rounded-xl border border-ink-200 focus:border-gold-400 focus:outline-none px-3 py-2 text-sm bg-white capitalize"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}
