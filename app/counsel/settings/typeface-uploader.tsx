'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  removeFirmTypefaceAction,
  uploadFirmTypefaceAction,
} from '@/lib/firm-actions';
import { MAX_FONT_BYTES, type DocumentTypeface } from '@/lib/document-typeface';
import { T, useT } from '@/components/i18n/LocaleProvider';

/**
 * Set the typeface the firm's generated documents are SET IN.
 *
 * The letterhead uploader above controls the stationery. This controls the
 * words on it, which are Times until a firm uploads something else. The two
 * sit together for that reason, and this follows the letterhead uploader's
 * idiom throughout: the same `label` and `input` classes, the same
 * useTransition pending flag, the same rose error box, the same
 * router.refresh() after a write.
 *
 * WHY THIS IS ONE FORM WITH ONE BUTTON, rather than the letterhead's
 * upload-on-pick. Every upload here carries a licence attestation and a family
 * name alongside the file (see uploadFirmTypefaceAction), so the file cannot be
 * sent the moment it is chosen: the answers it has to travel with have not been
 * given yet. One form also puts the two weights in a single act, which is what
 * lets a firm that has no typeface at all upload the regular and the bold
 * together. The regular is always sent first, because the server refuses a bold
 * weight that has no regular to sit beside.
 *
 * THE LICENCE QUESTION IS ASKED FRESH EVERY TIME, never pre-ticked from the
 * stored record. A new upload is a new file, and the point of the question is to
 * record who said what about the file that is actually being embedded.
 */

/** The family name the specimen below is registered under in the browser. */
const SPECIMEN_FAMILY = 'AdvotticFirmSpecimen';

/**
 * Load the firm's stored font into the browser so this panel can show the face
 * itself, not only its name. The letterhead uploader shows a picture of the
 * letterhead; the honest equivalent for a typeface is a specimen.
 *
 * The bold slot deliberately falls back to the regular file when no bold weight
 * is stored, which is exactly what resolveDocumentFaces in
 * lib/branded-document-pdf.ts does at render time. So the specimen's heading
 * shows the heading the firm would actually get, rather than a browser's
 * synthetic bold, which no document will ever contain.
 *
 * Any failure (an unreachable file, a browser without the API) leaves this
 * false and the specimen is simply not drawn. Nothing about the stored typeface
 * or the rendered document depends on it.
 */
function useLoadedSpecimen(regularUrl: string | null, boldUrl: string | null) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
    if (!regularUrl || typeof document === 'undefined' || !document.fonts) {
      return;
    }
    let cancelled = false;
    const faces = [
      new FontFace(SPECIMEN_FAMILY, `url("${regularUrl}")`, { weight: '400' }),
      new FontFace(SPECIMEN_FAMILY, `url("${boldUrl ?? regularUrl}")`, {
        weight: '700',
      }),
    ];
    Promise.all(faces.map((face) => face.load()))
      .then((loaded) => {
        if (cancelled) return;
        loaded.forEach((face) => document.fonts.add(face));
        setReady(true);
      })
      .catch(() => {
        /* No specimen. The stored typeface is unaffected. */
      });
    return () => {
      cancelled = true;
      faces.forEach((face) => document.fonts.delete(face));
    };
  }, [regularUrl, boldUrl]);

  return ready;
}

export function TypefaceUploader({
  firmId,
  current,
}: {
  firmId: string;
  /** The firm's stored typeface, already normalized on the server. */
  current: DocumentTypeface | null;
}) {
  const t = useT();
  const router = useRouter();
  const regularRef = useRef<HTMLInputElement | null>(null);
  const boldRef = useRef<HTMLInputElement | null>(null);
  const [familyName, setFamilyName] = useState(current?.familyName ?? '');
  const [licenceHolder, setLicenceHolder] = useState(
    current?.licence.holder ?? '',
  );
  const [licenceAcknowledged, setLicenceAcknowledged] = useState(false);
  const [regularFile, setRegularFile] = useState<File | null>(null);
  const [boldFile, setBoldFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();

  const specimenReady = useLoadedSpecimen(
    current?.regularUrl ?? null,
    current?.boldUrl ?? null,
  );

  const maxMb = Math.round(MAX_FONT_BYTES / (1024 * 1024));
  const chosen = Boolean(regularFile || boldFile);
  const answered =
    licenceAcknowledged &&
    licenceHolder.trim().length > 0 &&
    familyName.trim().length > 0;

  function touched() {
    setError(null);
    setOk(false);
  }

  function send(weight: 'regular' | 'bold', file: File) {
    const fd = new FormData();
    fd.set('weight', weight);
    fd.set('font', file);
    fd.set('licenceAcknowledged', licenceAcknowledged ? 'true' : 'false');
    fd.set('licenceHolder', licenceHolder);
    fd.set('familyName', familyName);
    return uploadFirmTypefaceAction(firmId, fd);
  }

  function save() {
    setError(null);
    setOk(false);
    startTransition(async () => {
      // Regular first, always. The server refuses a bold weight with no regular
      // beside it, so sending them the other way round would refuse the upload
      // of a firm that picked both files at once.
      if (regularFile) {
        const res = await send('regular', regularFile);
        if (!res.ok) {
          setError(res.error ?? t('Could not save the typeface.'));
          return;
        }
      }
      if (boldFile) {
        const res = await send('bold', boldFile);
        if (!res.ok) {
          setError(res.error ?? t('Could not save the bold weight.'));
          return;
        }
      }
      setRegularFile(null);
      setBoldFile(null);
      setLicenceAcknowledged(false);
      if (regularRef.current) regularRef.current.value = '';
      if (boldRef.current) boldRef.current.value = '';
      setOk(true);
      router.refresh();
    });
  }

  function remove(weight: 'all' | 'bold') {
    setError(null);
    setOk(false);
    startTransition(async () => {
      const res = await removeFirmTypefaceAction(firmId, weight);
      if (res.ok) {
        if (weight === 'all') setFamilyName('');
        router.refresh();
      } else {
        setError(res.error ?? t('Could not remove the typeface.'));
      }
    });
  }

  const fileInputClassName =
    'text-[12.5px] file:mr-3 file:rounded-md file:border-0 file:bg-forest-600 file:px-3 file:py-1.5 file:text-cream-50 file:hover:bg-forest-700 file:cursor-pointer file:disabled:opacity-50 disabled:opacity-50';

  return (
    <div className="space-y-4">
      <div>
        <p className="label">
          <T>Typeface</T>{' '}
          <span className="text-muted font-normal">
            {t('(TTF or OTF, up to {n} MB per weight)').replace(
              '{n}',
              String(maxMb),
            )}
          </span>
        </p>
        <p className="text-[12.5px] text-muted leading-relaxed max-w-2xl">
          <T>
            Upload your firm&rsquo;s own face and Advottic sets the documents it
            produces in it. A change applies to documents produced from now on;
            anything already sent for signature keeps the face it went out
            with.
          </T>
        </p>
      </div>

      {/* What is set today, shown in the face itself. */}
      <div className="rounded-lg ring-1 ring-edge p-3.5 space-y-2.5">
        {current ? (
          <>
            <div
              className="rounded-md bg-surface-2 px-4 py-3.5"
              style={specimenReady ? { fontFamily: SPECIMEN_FAMILY } : undefined}
            >
              <p
                className="text-[19px] leading-snug text-foreground"
                style={{ fontWeight: 700 }}
                data-no-translate
              >
                {current.familyName}
              </p>
              <p className="text-[13.5px] leading-relaxed text-muted mt-1">
                <T>This is the face your documents are set in.</T>
              </p>
            </div>
            <p className="text-[12.5px] text-muted leading-relaxed">
              {current.boldUrl ? (
                <T>
                  A bold weight is set, and headings and party names use it.
                </T>
              ) : (
                <T>
                  No bold weight is set, so headings are set in the regular
                  weight.
                </T>
              )}
            </p>
            <p className="text-[12.5px] text-muted leading-relaxed">
              <T>Licence held by</T>{' '}
              <span className="text-foreground" data-no-translate>
                {current.licence.holder}
              </span>
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-0.5">
              <button
                type="button"
                className="text-[12.5px] text-rose-700 dark:text-rose-300 hover:underline disabled:opacity-50"
                disabled={pending}
                onClick={() => remove('all')}
              >
                <T>Remove typeface</T>
              </button>
              {current.boldUrl && (
                <button
                  type="button"
                  className="text-[12.5px] text-rose-700 dark:text-rose-300 hover:underline disabled:opacity-50"
                  disabled={pending}
                  onClick={() => remove('bold')}
                >
                  <T>Remove bold weight</T>
                </button>
              )}
            </div>
          </>
        ) : (
          <p className="text-[12.5px] text-muted leading-relaxed">
            <T>
              No typeface is set. Your documents are set in Times, the standard
              face every PDF reader already has.
            </T>
          </p>
        )}
      </div>

      <div className="space-y-3">
        <div>
          <label className="label" htmlFor="typefaceFamilyName">
            <T>Typeface name</T>{' '}
            <span className="text-muted font-normal">
              <T>(what your firm calls it)</T>
            </span>
          </label>
          <input
            id="typefaceFamilyName"
            className="input"
            maxLength={120}
            disabled={pending}
            placeholder={t('Gotham')}
            value={familyName}
            onChange={(e) => {
              touched();
              setFamilyName(e.target.value);
            }}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="typefaceRegular">
              <T>Regular weight</T>{' '}
              <span className="text-muted font-normal">
                {current ? <T>(replace)</T> : <T>(required)</T>}
              </span>
            </label>
            <input
              ref={regularRef}
              id="typefaceRegular"
              type="file"
              accept=".ttf,.otf"
              disabled={pending}
              className={fileInputClassName}
              onChange={(e) => {
                touched();
                setRegularFile(e.currentTarget.files?.[0] ?? null);
              }}
            />
            <p className="text-[12px] text-muted leading-relaxed mt-1.5">
              <T>The body of every document is set in this weight.</T>
            </p>
          </div>
          <div>
            <label className="label" htmlFor="typefaceBold">
              <T>Bold weight</T>{' '}
              <span className="text-muted font-normal">
                {current?.boldUrl ? <T>(replace)</T> : <T>(optional)</T>}
              </span>
            </label>
            <input
              ref={boldRef}
              id="typefaceBold"
              type="file"
              accept=".ttf,.otf"
              disabled={pending}
              className={fileInputClassName}
              onChange={(e) => {
                touched();
                setBoldFile(e.currentTarget.files?.[0] ?? null);
              }}
            />
            {!current?.boldUrl && (
              <p className="text-[12px] text-muted leading-relaxed mt-1.5">
                <T>
                  Without a bold weight, headings are set in the regular
                  weight.
                </T>
              </p>
            )}
          </div>
        </div>

        <div>
          <label className="label" htmlFor="typefaceLicenceHolder">
            <T>Licence holder</T>
          </label>
          <input
            id="typefaceLicenceHolder"
            className="input"
            maxLength={200}
            disabled={pending}
            placeholder={t('The organisation that bought the licence')}
            value={licenceHolder}
            onChange={(e) => {
              touched();
              setLicenceHolder(e.target.value);
            }}
          />
        </div>

        <label className="flex items-start gap-3 rounded-lg ring-1 ring-edge p-3.5">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 flex-none accent-gold-500"
            disabled={pending}
            checked={licenceAcknowledged}
            onChange={(e) => {
              touched();
              setLicenceAcknowledged(e.target.checked);
            }}
          />
          <span>
            <span className="block text-sm font-medium text-foreground">
              <T>
                Our licence for this typeface allows it to be embedded in
                documents.
              </T>
            </span>
            <span className="block text-[12px] text-muted mt-0.5 leading-relaxed">
              <T>
                The font travels inside the documents your firm sends out, so
                the licence needs to permit that. Advottic cannot check a
                licence, so we keep your confirmation and the licence
                holder&rsquo;s name with the file.
              </T>
            </span>
          </span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-primary"
          disabled={pending || !chosen || !answered}
          onClick={save}
        >
          {pending ? <T>Saving...</T> : <T>Save typeface</T>}
        </button>
        {chosen && !answered && !pending && (
          <span className="text-[12.5px] text-muted">
            <T>
              Name the typeface and the licence holder, and confirm the licence,
              to save.
            </T>
          </span>
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
