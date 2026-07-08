'use client';

import { useMemo, useState } from 'react';
import { T, useT } from '@/components/i18n/LocaleProvider';
import type { EvidenceExportItem } from '@/lib/case-evidence-actions';

/**
 * The firm-native "Share" for a hand-picked set of evidence: it presents a
 * ready-to-hand-over evidence index (exhibit numbers, filing, mined facts, and a
 * short-TTL link to each file) that the firm can download or copy and pass to a
 * collaborator or the represented client. Nothing is sent anywhere from here;
 * the reader exports it deliberately. (Chosen over an in-place collaborator grant
 * because case access is already managed at the matter level via collaborators,
 * whereas a per-item hand-off is what was missing.)
 */
export function ShareExportDialog({
  matter,
  items,
  onClose,
}: {
  matter: string;
  items: EvidenceExportItem[];
  onClose: () => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  const markdown = useMemo(() => buildMarkdown(matter, items), [matter, items]);

  const download = () => {
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `evidence-index-${slug(matter)}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard can be blocked; the download always works */
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('Share selected evidence')}
      onClick={onClose}
      className="fixed inset-0 z-[110] flex items-center justify-center bg-forest-950/70 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-forest-900"
      >
        <div className="border-b border-ink-100 p-5 dark:border-forest-700/40">
          <h2 className="text-[15px] font-semibold text-forest-900 dark:text-cream-100">
            <T>Share evidence index</T>
          </h2>
          <p className="mt-1 text-[12.5px] text-ink-500 dark:text-cream-100/55">
            {t('An index of {n} selected item(s). The links stay valid for a short time. Nothing is sent until you download or copy it.').replace(
              '{n}',
              String(items.length),
            )}
          </p>
        </div>

        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap bg-cream-50/60 p-5 text-[12px] leading-relaxed text-ink-700 dark:bg-forest-950/40 dark:text-cream-100/80" data-no-translate>
          {markdown}
        </pre>

        <div className="flex items-center justify-end gap-2 border-t border-ink-100 p-4 dark:border-forest-700/40">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[38px] items-center rounded-md px-3 text-[13px] text-ink-600 ring-1 ring-ink-200 hover:bg-cream-50 dark:text-cream-100/80 dark:ring-forest-700/40 dark:hover:bg-forest-800/30"
          >
            <T>Close</T>
          </button>
          <button
            type="button"
            onClick={() => void copy()}
            className="inline-flex min-h-[38px] items-center rounded-md px-3 text-[13px] text-ink-700 ring-1 ring-ink-200 hover:bg-cream-50 dark:text-cream-100/85 dark:ring-forest-700/40 dark:hover:bg-forest-800/30"
          >
            {copied ? <T>Copied</T> : <T>Copy</T>}
          </button>
          <button type="button" onClick={download} className="btn-primary">
            <T>Download index</T>
          </button>
        </div>
      </div>
    </div>
  );
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'matter';
}

/** Assemble a plain, readable evidence index. No AI phrasing is introduced here. */
function buildMarkdown(matter: string, items: EvidenceExportItem[]): string {
  const lines: string[] = [];
  lines.push(`# Evidence index: ${matter}`);
  lines.push('');
  lines.push(`${items.length} item(s).`);
  lines.push('');
  for (const it of items) {
    const head = [it.exhibit, it.name].filter(Boolean).join('  ');
    lines.push(`## ${head}`);
    const meta: string[] = [];
    if (it.documentType) meta.push(it.documentType.replace(/_/g, ' '));
    meta.push(it.folder);
    meta.push(it.captured);
    if (typeof it.relevance === 'number') meta.push(`relevance ${it.relevance}/100`);
    lines.push(`_${meta.join(' · ')}_`);
    if (it.summary) {
      lines.push('');
      lines.push(it.summary);
    }
    const fact = (name: string, arr: string[]) => (arr.length ? lines.push(`- ${name}: ${arr.join(', ')}`) : 0);
    if (it.people.length || it.organizations.length || it.locations.length || it.dates.length) {
      lines.push('');
      fact('People', it.people);
      fact('Organizations', it.organizations);
      fact('Locations', it.locations);
      fact('Dates', it.dates);
    }
    if (it.url) {
      lines.push('');
      lines.push(`File: ${it.url}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
