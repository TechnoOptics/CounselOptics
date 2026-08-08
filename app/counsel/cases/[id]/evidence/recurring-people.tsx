'use client';

import { useCallback, useEffect, useState } from 'react';
import { T, useT } from '@/components/i18n/LocaleProvider';
import {
  getRecurringFacesEnabledAction,
  getCaseRecurringPeopleAction,
  setRecurringFacesEnabledAction,
  analyzeCaseFacesAction,
  labelClusterAction,
  mergeClustersAction,
  splitFacesAction,
  getFaceMediaUrlAction,
  type RecurringPerson,
  type RecurringFaceCrop,
} from '@/lib/face-actions';

/**
 * "Recurring people" panel for firm evidence. Surfaces faces that keep showing
 * up across a matter's photos, grouped as "this face appears in N photos". It
 * never says who anyone is: a group is a set of similar-looking crops, and any
 * label a firm adds is its own private note, not an identity assertion. The
 * whole feature is gated behind a per-firm opt-in and processes nothing until a
 * firm turns it on. Detection is self-hosted; no biometric data leaves Advottic.
 */

const CROP = 88;

/** Crop one face out of its source photo using the stored normalised box. */
function FaceCrop({ url, bbox, size = CROP }: { url: string | null; bbox: RecurringFaceCrop['bbox']; size?: number }) {
  if (!url) {
    return (
      <div
        className="rounded-lg bg-cream-100 dark:bg-forest-800/50 animate-pulse"
        style={{ width: size, height: size }}
      />
    );
  }
  const w = bbox.width > 0 ? bbox.width : 1;
  return (
    <div
      className="relative overflow-hidden rounded-lg ring-1 ring-ink-100 dark:ring-forest-700/40 bg-cream-100 dark:bg-forest-900"
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt=""
        data-no-translate
        style={{
          position: 'absolute',
          width: `${100 / w}%`,
          maxWidth: 'none',
          left: `${(-bbox.x / w) * 100}%`,
          top: `${(-bbox.y / w) * 100}%`,
        }}
      />
    </div>
  );
}

export function RecurringPeople({ firmId, caseId }: { firmId: string; caseId: string }) {
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [people, setPeople] = useState<RecurringPerson[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [urls, setUrls] = useState<Record<string, string>>({});

  const loadPeople = useCallback(async () => {
    const res = await getCaseRecurringPeopleAction(firmId, caseId);
    if (res.ok) setPeople(res.people ?? []);
  }, [firmId, caseId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const s = await getRecurringFacesEnabledAction(firmId);
      if (!alive) return;
      setEnabled(Boolean(s.enabled));
      setCanManage(Boolean(s.canManage));
      if (s.enabled) await loadPeople();
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [firmId, loadPeople]);

  // Lazily sign the photos we need to show crops from (one signed URL per path).
  useEffect(() => {
    const paths = new Set<string>();
    for (const p of people) {
      if (p.representative) paths.add(p.representative.mediaPath);
      if (expanded === p.clusterId) for (const f of p.faces) paths.add(f.mediaPath);
    }
    const missing = [...paths].filter((path) => !urls[path]);
    if (!missing.length) return;
    let alive = true;
    (async () => {
      for (const path of missing) {
        const r = await getFaceMediaUrlAction(firmId, caseId, path);
        if (alive && r.ok && r.url) setUrls((prev) => ({ ...prev, [path]: r.url as string }));
      }
    })();
    return () => {
      alive = false;
    };
  }, [people, expanded, firmId, caseId, urls]);

  async function enable() {
    setBusy(true);
    setNotice(null);
    const res = await setRecurringFacesEnabledAction(firmId, true);
    if (res.ok) {
      setEnabled(true);
      await loadPeople();
    } else {
      setNotice(res.error ?? t('Could not turn this on.'));
    }
    setBusy(false);
  }

  async function disable() {
    if (!window.confirm(t('Turn this off and permanently delete every face grouping this firm has stored? This cannot be undone.'))) {
      return;
    }
    setBusy(true);
    setNotice(null);
    const res = await setRecurringFacesEnabledAction(firmId, false);
    if (res.ok) {
      setEnabled(false);
      setPeople([]);
      setExpanded(null);
      setNotice(t('Recurring people is off. Stored face groupings were deleted.'));
    } else {
      setNotice(res.error ?? t('Could not turn this off.'));
    }
    setBusy(false);
  }

  async function scan() {
    setBusy(true);
    setNotice(null);
    const res = await analyzeCaseFacesAction(firmId, caseId);
    if (res.ok) {
      await loadPeople();
      if ((res.faces ?? 0) === 0) {
        setNotice(t('No recurring faces were found in this matter’s photos yet.'));
      } else if (res.truncated) {
        setNotice(t('Scanned the most recent photos. Large matters continue in the background.'));
      } else {
        setNotice(null);
      }
    } else {
      setNotice(res.error ?? t('Could not scan.'));
    }
    setBusy(false);
  }

  async function saveLabel(clusterId: string, label: string) {
    await labelClusterAction(firmId, caseId, clusterId, label);
    setPeople((prev) => prev.map((p) => (p.clusterId === clusterId ? { ...p, label: label.trim() || null } : p)));
  }

  async function merge(sourceId: string, targetId: string) {
    if (!targetId || sourceId === targetId) return;
    setBusy(true);
    await mergeClustersAction(firmId, caseId, sourceId, targetId);
    setExpanded(null);
    await loadPeople();
    setBusy(false);
  }

  async function splitSelected() {
    if (!selected.size) return;
    setBusy(true);
    await splitFacesAction(firmId, caseId, [...selected]);
    setSelected(new Set());
    setExpanded(null);
    await loadPeople();
    setBusy(false);
  }

  function toggleFace(faceId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(faceId)) next.delete(faceId);
      else next.add(faceId);
      return next;
    });
  }

  if (loading) {
    return (
      <section className="rounded-xl ring-1 ring-ink-100 dark:ring-forest-800/40 p-4">
        <div className="h-4 w-40 rounded bg-cream-100 dark:bg-forest-800/50 animate-pulse" />
      </section>
    );
  }

  return (
    <section className="rounded-xl ring-1 ring-ink-100 dark:ring-forest-800/40 overflow-hidden">
      <header className="flex items-start justify-between gap-3 px-4 py-3 bg-cream-50/70 dark:bg-forest-900/30">
        <div className="min-w-0">
          <h2 className="text-lg font-medium text-forest-900 dark:text-cream-100">
            <T>Recurring people</T>
          </h2>
          <p className="text-[12px] text-ink-600 dark:text-cream-100/70 mt-0.5">
            <T>Finds faces that keep showing up across this matter&rsquo;s photos. It groups similar faces so you can see who appears often. It does not identify anyone.</T>
          </p>
        </div>
        {enabled && canManage && (
          <button
            type="button"
            onClick={disable}
            disabled={busy}
            className="shrink-0 text-[12px] text-ink-500 dark:text-cream-100/55 hover:underline disabled:opacity-50"
          >
            <T>Turn off</T>
          </button>
        )}
      </header>

      <div className="p-4 space-y-4">
        {notice && (
          <p className="rounded-lg border border-forest-200 dark:border-forest-700/40 bg-forest-50 dark:bg-forest-900/30 px-3 py-2 text-[13px] text-forest-800 dark:text-cream-100/80" data-no-translate>
            {notice}
          </p>
        )}

        {!enabled ? (
          <div className="space-y-3">
            <p className="text-[13px] text-ink-700 dark:text-cream-100/80">
              <T>
                This uses face grouping, which is sensitive information about the
                people in your evidence photos. It stays on Advottic and is never
                sent to any outside service. Your firm is responsible for having a
                lawful basis to process the people who appear in these photos.
              </T>
            </p>
            {canManage ? (
              <button
                type="button"
                onClick={enable}
                disabled={busy}
                className="inline-flex items-center rounded-full bg-forest-900 dark:bg-cream-100 px-4 py-1.5 text-[13px] font-medium text-cream-50 dark:text-forest-900 disabled:opacity-50"
              >
                <T>Turn on Recurring people</T>
              </button>
            ) : (
              <p className="text-[12px] text-ink-500 dark:text-cream-100/55">
                <T>A firm owner or admin can turn this on.</T>
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={scan}
                disabled={busy}
                className="inline-flex items-center rounded-full bg-forest-900 dark:bg-cream-100 px-4 py-1.5 text-[13px] font-medium text-cream-50 dark:text-forest-900 disabled:opacity-50"
              >
                {busy ? <T>Working</T> : people.length ? <T>Scan again</T> : <T>Scan for recurring people</T>}
              </button>
              {people.length > 0 && (
                <span className="text-[12px] text-ink-500 dark:text-cream-100/55">
                  {people.length} <T>groups</T>
                </span>
              )}
            </div>

            {people.length === 0 ? (
              <p className="text-[13px] text-ink-500 dark:text-cream-100/55">
                <T>No recurring people yet. Scan this matter&rsquo;s photos to find faces that appear more than once.</T>
              </p>
            ) : (
              <ul className="space-y-3">
                {people.map((p) => (
                  <li key={p.clusterId} className="rounded-xl ring-1 ring-ink-100 dark:ring-forest-800/40 p-3">
                    <div className="flex items-start gap-3">
                      <FaceCrop url={p.representative ? urls[p.representative.mediaPath] ?? null : null} bbox={p.representative?.bbox ?? { x: 0, y: 0, width: 1, height: 1 }} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-forest-900 dark:text-cream-100">
                          <T>Appears in</T> {p.photoCount} {p.photoCount === 1 ? <T>photo</T> : <T>photos</T>}
                        </p>
                        <input
                          defaultValue={p.label ?? ''}
                          onBlur={(e) => saveLabel(p.clusterId, e.target.value)}
                          placeholder={t('Add a private note (optional)')}
                          data-no-translate
                          className="mt-1 w-full max-w-xs text-[13px] rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 bg-white dark:bg-forest-900/40 px-2 py-1"
                        />
                        <div className="mt-2 flex flex-wrap items-center gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              setSelected(new Set());
                              setExpanded(expanded === p.clusterId ? null : p.clusterId);
                            }}
                            className="text-[12px] text-forest-700 dark:text-cream-100/70 hover:underline"
                          >
                            {expanded === p.clusterId ? <T>Hide faces</T> : <><T>View</T> {p.faces.length} <T>faces</T></>}
                          </button>
                          {people.length > 1 && (
                            <label className="text-[12px] text-ink-500 dark:text-cream-100/55 inline-flex items-center gap-1">
                              <T>Merge into</T>
                              <select
                                defaultValue=""
                                onChange={(e) => merge(p.clusterId, e.target.value)}
                                disabled={busy}
                                className="text-[12px] rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 bg-white dark:bg-forest-900/40 px-1.5 py-0.5"
                              >
                                <option value="">{t('another group')}</option>
                                {people
                                  .filter((o) => o.clusterId !== p.clusterId)
                                  .map((o, i) => (
                                    <option key={o.clusterId} value={o.clusterId} data-no-translate>
                                      {o.label || `${t('Group')} ${i + 1}`}
                                    </option>
                                  ))}
                              </select>
                            </label>
                          )}
                        </div>
                      </div>
                    </div>

                    {expanded === p.clusterId && (
                      <div className="mt-3 border-t border-ink-100 dark:border-forest-800/40 pt-3">
                        <div className="flex flex-wrap gap-2">
                          {p.faces.map((f) => {
                            const on = selected.has(f.faceId);
                            return (
                              <button
                                key={f.faceId}
                                type="button"
                                onClick={() => toggleFace(f.faceId)}
                                className={`relative rounded-lg ${on ? 'ring-2 ring-forest-700 dark:ring-cream-100' : 'ring-1 ring-transparent'}`}
                                aria-pressed={on}
                                title={t('Select to split off')}
                              >
                                <FaceCrop url={urls[f.mediaPath] ?? null} bbox={f.bbox} size={64} />
                              </button>
                            );
                          })}
                        </div>
                        {selected.size > 0 && (
                          <button
                            type="button"
                            onClick={splitSelected}
                            disabled={busy}
                            className="mt-3 inline-flex items-center rounded-full ring-1 ring-ink-200 dark:ring-forest-700/40 px-3 py-1 text-[12px] text-forest-800 dark:text-cream-100/80 disabled:opacity-50"
                          >
                            <T>Split</T> {selected.size} <T>into a new group</T>
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}
