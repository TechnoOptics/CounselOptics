'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  saveMenuConfigAction,
  resetMenuConfigAction,
} from '@/lib/firm-actions';
import {
  DEFAULT_MENU,
  EMPTY_MENU_CONFIG,
  type MenuConfig,
} from '@/lib/menu-config';
import { T, useT } from '@/components/i18n/LocaleProvider';

/**
 * Owner/admin: tailor the Counsel sidebar to this org - hide items
 * they don't use, rename them to their own vocabulary, and reorder
 * items + whole sections. "Firm settings" is intentionally not in
 * here so an admin can never hide their way out of this editor.
 */
export function MenuCustomizer({
  firmId,
  initial,
}: {
  firmId: string;
  initial: MenuConfig;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [cfg, setCfg] = useState<MenuConfig>(initial);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const hidden = useMemo(() => new Set(cfg.hidden), [cfg.hidden]);

  // Editor model: every default item, in the configured order, with
  // its visibility + (possibly renamed) label - independent of the
  // live rail's filtering so hidden items can be turned back on.
  const sections = useMemo(() => {
    const secRank = new Map(
      cfg.sectionOrder.map((s, i) => [s, i] as const),
    );
    const orderedSecs = [...DEFAULT_MENU].sort((a, b) => {
      const ra = secRank.has(a.section)
        ? secRank.get(a.section)!
        : Number.MAX_SAFE_INTEGER;
      const rb = secRank.has(b.section)
        ? secRank.get(b.section)!
        : Number.MAX_SAFE_INTEGER;
      return ra - rb;
    });
    return orderedSecs.map((sec) => {
      const want = cfg.itemOrder[sec.section] ?? [];
      const rank = new Map(want.map((h, i) => [h, i] as const));
      const items = [...sec.items].sort((a, b) => {
        const ra = rank.has(a.href)
          ? rank.get(a.href)!
          : Number.MAX_SAFE_INTEGER;
        const rb = rank.has(b.href)
          ? rank.get(b.href)!
          : Number.MAX_SAFE_INTEGER;
        return ra - rb;
      });
      return { section: sec.section, items };
    });
  }, [cfg]);

  function dirty() {
    setOk(false);
    setError(null);
  }

  function toggleHide(href: string) {
    dirty();
    setCfg((c) => {
      const set = new Set(c.hidden);
      if (set.has(href)) set.delete(href);
      else set.add(href);
      return { ...c, hidden: [...set] };
    });
  }

  function rename(href: string, value: string, fallback: string) {
    dirty();
    setCfg((c) => {
      const labels = { ...c.labels };
      const v = value.trim();
      if (!v || v === fallback) delete labels[href];
      else labels[href] = v.slice(0, 40);
      return { ...c, labels };
    });
  }

  function moveSection(idx: number, dir: -1 | 1) {
    const order = sections.map((s) => s.section);
    const j = idx + dir;
    if (j < 0 || j >= order.length) return;
    [order[idx], order[j]] = [order[j], order[idx]];
    dirty();
    setCfg((c) => ({ ...c, sectionOrder: order }));
  }

  function moveItem(section: string, idx: number, dir: -1 | 1) {
    const sec = sections.find((s) => s.section === section);
    if (!sec) return;
    const order = sec.items.map((i) => i.href);
    const j = idx + dir;
    if (j < 0 || j >= order.length) return;
    [order[idx], order[j]] = [order[j], order[idx]];
    dirty();
    setCfg((c) => ({
      ...c,
      itemOrder: { ...c.itemOrder, [section]: order },
    }));
  }

  function save() {
    setError(null);
    setOk(false);
    startTransition(async () => {
      const res = await saveMenuConfigAction(firmId, cfg);
      if (res.ok) {
        setOk(true);
        router.refresh();
      } else {
        setError(res.error ?? t('Could not save the menu.'));
      }
    });
  }

  function reset() {
    startTransition(async () => {
      const res = await resetMenuConfigAction(firmId);
      if (res.ok) {
        setCfg(EMPTY_MENU_CONFIG);
        setOk(true);
        router.refresh();
      } else {
        setError(res.error ?? t('Could not reset.'));
      }
    });
  }

  return (
    /* No card and no eyebrow of its own: the settings page wraps this in
       a PanelCard whose header names the section, and a card inside a
       card drew two borders around one control. */
    <section className="space-y-4">
      <div>
        <p className="text-[13.5px] font-semibold text-foreground">
          <T>Tailor the sidebar to your team</T>
        </p>
        <p className="text-sm text-muted mt-1 max-w-2xl leading-relaxed">
          <T>
            Hide what you don&rsquo;t use, rename items to your own terms, and
            reorder items or whole sections. Changes apply to everyone on the
            legal team. (Firm settings always stays visible so you can get back
            here.)
          </T>
        </p>
      </div>

      <div className="space-y-4">
        {sections.map((sec, si) => (
          <div
            key={sec.section}
            className="rounded-lg ring-1 ring-edge p-3.5"
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-[11px] uppercase tracking-[0.16em] font-semibold text-muted">
                {sec.section}
              </p>
              <div className="flex items-center gap-1">
                <ArrowBtn
                  dir="up"
                  disabled={pending || si === 0}
                  onClick={() => moveSection(si, -1)}
                  label={`Move ${sec.section} up`}
                />
                <ArrowBtn
                  dir="down"
                  disabled={pending || si === sections.length - 1}
                  onClick={() => moveSection(si, 1)}
                  label={`Move ${sec.section} down`}
                />
              </div>
            </div>
            <ul className="space-y-1.5">
              {sec.items.map((item, ii) => {
                const off = hidden.has(item.href);
                return (
                  <li
                    key={item.href}
                    className="flex items-center gap-2.5"
                  >
                    <input
                      type="checkbox"
                      checked={!off}
                      disabled={pending}
                      onChange={() => toggleHide(item.href)}
                      aria-label={`Show ${item.label}`}
                      className="h-4 w-4 flex-none accent-gold-500"
                    />
                    <input
                      defaultValue={cfg.labels[item.href] ?? item.label}
                      placeholder={item.label}
                      disabled={pending || off}
                      onChange={(e) =>
                        rename(item.href, e.target.value, item.label)
                      }
                      className={`input flex-1 !py-1 text-[13px] ${
                        off ? 'opacity-50' : ''
                      }`}
                    />
                    <span className="text-[11px] text-muted hidden sm:block w-40 truncate">
                      {item.href}
                    </span>
                    <div className="flex items-center gap-1">
                      <ArrowBtn
                        dir="up"
                        disabled={pending || ii === 0}
                        onClick={() => moveItem(sec.section, ii, -1)}
                        label={`Move ${item.label} up`}
                      />
                      <ArrowBtn
                        dir="down"
                        disabled={pending || ii === sec.items.length - 1}
                        onClick={() => moveItem(sec.section, ii, 1)}
                        label={`Move ${item.label} down`}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {error && (
        <p className="rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </p>
      )}
      {ok && (
        <p className="rounded-lg border border-emerald-200 dark:border-emerald-700/40 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-sm text-emerald-900 dark:text-emerald-100">
          <T>Saved. The sidebar updates for everyone on the next load.</T>
        </p>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        <button
          type="button"
          onClick={reset}
          disabled={pending}
          className="text-[12px] underline text-muted"
        >
          <T>Reset to default</T>
        </button>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="btn-primary"
        >
          {pending ? <T>Saving...</T> : <T>Save menu</T>}
        </button>
      </div>
    </section>
  );
}

function ArrowBtn({
  dir,
  disabled,
  onClick,
  label,
}: {
  dir: 'up' | 'down';
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="h-10 w-10 inline-flex items-center justify-center rounded ring-1 ring-edge text-muted disabled:opacity-30 hover:bg-surface-2"
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        style={{ transform: dir === 'down' ? 'rotate(180deg)' : undefined }}
      >
        <path d="M6 15l6-6 6 6" />
      </svg>
    </button>
  );
}
