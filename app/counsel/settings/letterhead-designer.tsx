'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  importFirmLetterheadAction,
  removeFirmLetterheadDesignAction,
  saveFirmLetterheadDesignAction,
} from '@/lib/firm-actions';
import {
  LETTERHEAD_LINE_GAP_PT,
  LETTERHEAD_MAX_ADDRESS_LINES,
  LETTERHEAD_PT_TO_PX,
  letterheadDesignLines,
  normalizeLetterheadDesign,
  type LetterheadDesign,
} from '@/lib/letterhead-design';
import {
  isWinAnsiEncodable,
  unencodableCharacters,
} from '@/lib/counterparty-fields';
import { T, useT } from '@/components/i18n/LocaleProvider';

/**
 * Design a letterhead here, or import one out of a document the firm already
 * has, instead of uploading an image of one.
 *
 * The preview below is not an approximation. It renders exactly what
 * letterheadDesignLines returns, which is the same list the PDF draws, so the
 * order and the emphasis on screen are the order and the emphasis on the page.
 * Sizes are converted from points to CSS pixels at the standard 4/3, which is
 * the only difference between the two.
 *
 * The draft is normalized on every keystroke before it is previewed, so what a
 * person sees is what would actually be stored, including a field the
 * normalizer would drop.
 */

const EMPTY_DESIGN: LetterheadDesign = {
  firmName: '',
  addressLines: [],
  phone: '',
  email: '',
  website: '',
  admissionsLine: '',
  alignment: 'left',
  showRule: true,
};

export function LetterheadDesigner({
  firmId,
  initial,
}: {
  firmId: string;
  initial: LetterheadDesign | null;
}) {
  const t = useT();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState<LetterheadDesign>(initial ?? EMPTY_DESIGN);
  const [saved, setSaved] = useState(initial !== null);
  const [imported, setImported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();

  function set<K extends keyof LetterheadDesign>(key: K, value: LetterheadDesign[K]) {
    setOk(false);
    setError(null);
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function setAddressLine(index: number, value: string) {
    setOk(false);
    setError(null);
    setDraft((d) => {
      const lines = Array.from(
        { length: LETTERHEAD_MAX_ADDRESS_LINES },
        (_, i) => d.addressLines[i] ?? '',
      );
      lines[index] = value;
      return { ...d, addressLines: lines };
    });
  }

  function save() {
    setError(null);
    setOk(false);
    startTransition(async () => {
      const res = await saveFirmLetterheadDesignAction(firmId, draft);
      if (res.ok) {
        setOk(true);
        setSaved(true);
        setImported(false);
        router.refresh();
      } else {
        setError(res.error ?? t('Could not save.'));
      }
    });
  }

  function remove() {
    setError(null);
    setOk(false);
    startTransition(async () => {
      const res = await removeFirmLetterheadDesignAction(firmId);
      if (res.ok) {
        setDraft(EMPTY_DESIGN);
        setSaved(false);
        setImported(false);
        router.refresh();
      } else {
        setError(res.error ?? t('Could not remove the letterhead.'));
      }
    });
  }

  function importFrom(file: File) {
    setError(null);
    setOk(false);
    setImported(false);
    startTransition(async () => {
      const fd = new FormData();
      fd.set('letterheadDocument', file);
      const res = await importFirmLetterheadAction(firmId, fd);
      if (fileRef.current) fileRef.current.value = '';
      if (res.ok && res.design) {
        setDraft(res.design);
        setImported(true);
      } else {
        setError(res.error ?? t('We could not read that document.'));
      }
    });
  }

  const normalized = normalizeLetterheadDesign(draft);
  const lines = normalized ? letterheadDesignLines(normalized) : [];

  // Characters the PDF cannot draw, named here rather than discovered by a
  // recipient. The standard PDF fonts encode WinAnsi only, which covers the
  // accented letters of western Europe but not Chinese, Greek, Hebrew,
  // Cyrillic or emoji, and the renderer drops what it cannot draw. Losing part
  // of an address is a blemish; losing the whole firm name means the renderer
  // refuses the design and falls back to a plain banner, which is a different
  // and much worse outcome, so it is said separately and more plainly.
  const droppedFromName = normalized
    ? unencodableCharacters(normalized.firmName)
    : [];
  const droppedElsewhere = normalized
    ? unencodableCharacters(
        [
          ...normalized.addressLines,
          normalized.phone,
          normalized.email,
          normalized.website,
          normalized.admissionsLine,
        ].join(' '),
      )
    : [];
  // Filter, join, TRIM, exactly as the renderer's winAnsiSafe does. A name of
  // unencodable characters separated by spaces leaves whitespace behind, and
  // whitespace is a character this predicate accepts, so `some(encodable)`
  // would call that name survivable when the renderer will refuse it.
  const nameSurvives = normalized
    ? Array.from(normalized.firmName)
        .filter((ch) => isWinAnsiEncodable(ch))
        .join('')
        .trim().length > 0
    : false;
  const droppedAll = Array.from(new Set([...droppedFromName, ...droppedElsewhere]));
  const addressValues = Array.from(
    { length: LETTERHEAD_MAX_ADDRESS_LINES },
    (_, i) => draft.addressLines[i] ?? '',
  );

  return (
    <div className="space-y-4">
      <div>
        <p className="label">
          <T>Design a letterhead</T>{' '}
          <span className="text-ink-500 dark:text-cream-100/70 font-normal">
            <T>(drawn as text, so it stays sharp at any size)</T>
          </span>
        </p>
        <p className="text-[12.5px] text-ink-600 dark:text-cream-100/70 leading-relaxed max-w-2xl">
          <T>
            Type your firm details once and Advottic prints them at the top of
            the documents it renders. You can also start from a letterhead you
            already have.
          </T>
        </p>
      </div>

      {/* Import. Populates the fields below; it never saves on its own. */}
      <div className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/50 p-3.5 space-y-2">
        <p className="text-[13px] font-medium text-forest-900 dark:text-cream-100">
          <T>Import from a document</T>
        </p>
        <p className="text-[12px] text-ink-600 dark:text-cream-100/70 leading-relaxed">
          <T>
            Upload a PDF or Word letter that already carries your letterhead and
            Advottic will read the details into the fields below for you to
            check.
          </T>
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx"
          disabled={pending}
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f) importFrom(f);
          }}
          className="text-[12.5px] file:mr-3 file:rounded-md file:border-0 file:bg-forest-600 file:px-3 file:py-1.5 file:text-cream-50 file:hover:bg-forest-700 file:cursor-pointer file:disabled:opacity-50"
        />
        {imported && (
          <p className="text-[12px] text-ink-600 dark:text-cream-100/75 leading-relaxed">
            <T>
              These values were read from the document you uploaded. Please
              check each one, correct anything that has changed, and then save.
            </T>
          </p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="letterheadFirmName">
              <T>Firm name</T>
            </label>
            <input
              id="letterheadFirmName"
              className="input"
              maxLength={120}
              disabled={pending}
              value={draft.firmName}
              onChange={(e) => set('firmName', e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <span className="label">
              <T>Address</T>
            </span>
            {addressValues.map((value, i) => (
              <input
                key={i}
                className="input"
                maxLength={120}
                disabled={pending}
                aria-label={t('Address line')}
                placeholder={
                  i === 0
                    ? t('Street')
                    : i === 1
                      ? t('Suite or floor')
                      : i === 2
                        ? t('City, state, postcode')
                        : t('Anything else')
                }
                value={value}
                onChange={(e) => setAddressLine(i, e.target.value)}
              />
            ))}
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="letterheadPhone">
                <T>Phone</T>
              </label>
              <input
                id="letterheadPhone"
                className="input"
                maxLength={60}
                disabled={pending}
                value={draft.phone}
                onChange={(e) => set('phone', e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="letterheadEmail">
                <T>Email</T>
              </label>
              <input
                id="letterheadEmail"
                className="input"
                maxLength={120}
                disabled={pending}
                value={draft.email}
                onChange={(e) => set('email', e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="letterheadWebsite">
              <T>Website</T>
            </label>
            <input
              id="letterheadWebsite"
              className="input"
              maxLength={120}
              disabled={pending}
              value={draft.website}
              onChange={(e) => set('website', e.target.value)}
            />
          </div>

          <div>
            <label className="label" htmlFor="letterheadAdmissions">
              <T>Bar admissions or registered office</T>{' '}
              <span className="text-ink-500 dark:text-cream-100/70 font-normal">
                <T>(optional)</T>
              </span>
            </label>
            <input
              id="letterheadAdmissions"
              className="input"
              maxLength={200}
              disabled={pending}
              value={draft.admissionsLine}
              onChange={(e) => set('admissionsLine', e.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1">
            <span className="flex items-center gap-2 text-[13px] text-forest-900 dark:text-cream-100">
              <T>Alignment</T>
              <select
                className="input py-1.5 w-auto"
                disabled={pending}
                aria-label={t('Text alignment')}
                value={draft.alignment}
                onChange={(e) =>
                  set('alignment', e.target.value === 'center' ? 'center' : 'left')
                }
              >
                <option value="left">{t('Left')}</option>
                <option value="center">{t('Centred')}</option>
              </select>
            </span>
            <label className="flex items-center gap-2 text-[13px] text-forest-900 dark:text-cream-100">
              <input
                type="checkbox"
                className="h-4 w-4 accent-gold-500"
                disabled={pending}
                checked={draft.showRule}
                onChange={(e) => set('showRule', e.target.checked)}
              />
              <T>Rule under the block</T>
            </label>
          </div>
        </div>

        {/* Live preview, from the same layout function the PDF reads. */}
        <div className="space-y-2">
          <p className="label">
            <T>Preview</T>
          </p>
          <div className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/50 bg-cream-50 dark:bg-forest-900/40 p-5 min-h-[140px]">
            {lines.length > 0 ? (
              <div
                style={{ textAlign: draft.alignment === 'center' ? 'center' : 'left' }}
              >
                {lines.map((line, i) => (
                  <p
                    key={i}
                    data-no-translate
                    style={{
                      fontSize: `${line.size * LETTERHEAD_PT_TO_PX}px`,
                      lineHeight: `${(line.size + LETTERHEAD_LINE_GAP_PT) * LETTERHEAD_PT_TO_PX}px`,
                      fontWeight: line.bold ? 600 : 400,
                    }}
                    className={
                      line.bold
                        ? 'text-forest-900 dark:text-cream-100'
                        : 'text-ink-600 dark:text-cream-100/75'
                    }
                  >
                    {line.text}
                  </p>
                ))}
                {draft.showRule && (
                  <span className="block mt-3 border-t border-ink-300 dark:border-forest-700/60" />
                )}
              </div>
            ) : (
              <p className="text-[12.5px] text-ink-500 dark:text-cream-100/60">
                <T>Add your firm name to see the letterhead.</T>
              </p>
            )}
          </div>
        </div>
      </div>

      {normalized && droppedAll.length > 0 && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-700/40 bg-amber-50 dark:bg-amber-950/30 px-3 py-2.5 space-y-1">
          {!nameSurvives ? (
            <p className="text-[12.5px] text-amber-900 dark:text-amber-100 leading-relaxed">
              <T>
                Your firm name uses characters that PDFs we generate cannot
                print, so those documents will fall back to a plain banner
                rather than this letterhead. Everywhere else in Advottic shows
                the name as you typed it. A Latin-script version of the name
                here will let the letterhead print.
              </T>
            </p>
          ) : (
            <p className="text-[12.5px] text-amber-900 dark:text-amber-100 leading-relaxed">
              <T>
                Some characters cannot be printed in the PDFs we generate and
                will be left out of the letterhead there. Everywhere else in
                Advottic shows them as you typed them.
              </T>
            </p>
          )}
          <p
            className="text-[12.5px] text-amber-900 dark:text-amber-100"
            data-no-translate
          >
            {droppedAll.join(' ')}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-primary"
          disabled={pending || normalized === null}
          onClick={save}
        >
          {pending ? <T>Saving...</T> : <T>Save letterhead</T>}
        </button>
        {saved && (
          <button
            type="button"
            className="text-[12.5px] text-rose-700 dark:text-rose-300 hover:underline disabled:opacity-50"
            disabled={pending}
            onClick={remove}
          >
            <T>Remove designed letterhead</T>
          </button>
        )}
        {ok && !error && (
          <span className="text-[12.5px] text-emerald-700 dark:text-emerald-300">
            <T>Saved.</T>
          </span>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </p>
      )}
    </div>
  );
}
