'use client';

import { useEffect, useState } from 'react';

export type TabDef = {
  id: string;
  label: string;
  badge?: string | number;
  content: React.ReactNode;
};

export function Tabs({
  tabs,
  storageKey,
}: {
  tabs: TabDef[];
  /** If set, last-active tab is remembered in sessionStorage. */
  storageKey?: string;
}) {
  const [active, setActive] = useState<string>(() => tabs[0]?.id ?? '');

  // Restore from sessionStorage / hash on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash.replace(/^#/, '');
    if (hash && tabs.some((t) => t.id === hash)) {
      setActive(hash);
      return;
    }
    if (storageKey) {
      const saved = window.sessionStorage.getItem(storageKey);
      if (saved && tabs.some((t) => t.id === saved)) {
        setActive(saved);
      }
    }
    // Only on first mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist on change.
  useEffect(() => {
    if (storageKey && typeof window !== 'undefined') {
      window.sessionStorage.setItem(storageKey, active);
    }
  }, [active, storageKey]);

  return (
    <div>
      <div
        role="tablist"
        aria-label="Case sections"
        className="flex flex-nowrap items-stretch gap-0 overflow-x-auto border-b border-ink-200 -mx-1 px-1"
      >
        {tabs.map((t) => {
          const isActive = t.id === active;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={isActive}
              aria-controls={`tabpanel-${t.id}`}
              id={`tab-${t.id}`}
              onClick={() => setActive(t.id)}
              className={`tab inline-flex items-center gap-2 ${isActive ? 'tab-active' : ''}`}
            >
              <span>{t.label}</span>
              {t.badge !== undefined && t.badge !== null && t.badge !== '' && (
                <span
                  className={`inline-flex items-center justify-center text-[10px] font-mono rounded-full px-1.5 py-0.5 leading-none min-w-[18px] ${
                    isActive
                      ? 'bg-forest-900 text-cream-100'
                      : 'bg-ink-100 text-ink-600'
                  }`}
                >
                  {t.badge}
                </span>
              )}
              {isActive && <span className="tab-underline" />}
            </button>
          );
        })}
      </div>
      <div className="pt-6">
        {tabs.map((t) => (
          <div
            key={t.id}
            role="tabpanel"
            id={`tabpanel-${t.id}`}
            aria-labelledby={`tab-${t.id}`}
            hidden={t.id !== active}
            className={t.id === active ? 'animate-fade-in' : ''}
          >
            {t.content}
          </div>
        ))}
      </div>
    </div>
  );
}
