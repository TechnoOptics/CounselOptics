import { T } from '@/components/i18n/LocaleProvider';
import Link from 'next/link';
import { TimelineIcon, EvidenceIcon, ApproachIcon } from '@/components/counsel/CaseSectionIcons';
import { ExportMenu } from '@/components/counsel/ExportMenu';

/**
 * Case menu: the four primary case surfaces, pinned to the very top of every
 * case page (matter, Case Timeline, Evidence Center) so it sits directly under
 * the counsel header's gold glow line and reads as the case's navigation. The
 * current surface is highlighted; a gold hairline below separates the menu
 * from the page content. Firm members only. A co-counsel guest keeps the
 * stripped guest shell.
 */
export function CaseMenu({
  caseId,
  active,
  approaches,
}: {
  caseId: string;
  /** Which surface this menu is rendered on (highlights that tile). */
  active?: 'timeline' | 'evidence';
  approaches: { id: string; title: string }[];
}) {
  const tile = (isActive: boolean) =>
    'group flex items-center gap-2.5 rounded-lg px-4 py-3 ring-1 text-forest-900 dark:text-cream-100 transition-all ' +
    (isActive
      ? 'bg-white dark:bg-forest-800/60 ring-gold-500/60 shadow-sm'
      : 'ring-transparent hover:bg-white dark:hover:bg-forest-800/60 hover:ring-gold-500/60 hover:shadow-sm');
  const icon = (isActive: boolean) =>
    'grid h-8 w-8 shrink-0 place-items-center rounded-lg ring-1 ring-gold-500/20 transition-colors dark:text-gold-400/90 ' +
    (isActive
      ? 'bg-gold-500/20 text-gold-500'
      : 'bg-gold-500/10 text-gold-600 group-hover:bg-gold-500/20 group-hover:text-gold-500');

  return (
    <div className="-mt-1 space-y-4">
      <nav className="grid grid-cols-2 lg:grid-cols-4 gap-2 rounded-xl border border-ink-200 dark:border-forest-700/50 bg-cream-50/70 dark:bg-forest-900/40 p-1.5">
        <Link
          href={`/counsel/cases/${caseId}/timeline`}
          prefetch={false}
          aria-current={active === 'timeline' ? 'page' : undefined}
          className={tile(active === 'timeline')}
        >
          <span className={icon(active === 'timeline')}>
            <TimelineIcon />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold"><T>Case Timeline</T></span>
            <span className="block truncate text-[11px] text-ink-500 dark:text-cream-100/50"><T>Build the story of events</T></span>
          </span>
        </Link>
        <Link
          href={`/counsel/cases/${caseId}/evidence`}
          prefetch={false}
          aria-current={active === 'evidence' ? 'page' : undefined}
          className={tile(active === 'evidence')}
        >
          <span className={icon(active === 'evidence')}>
            <EvidenceIcon />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold"><T>Evidence Center</T></span>
            <span className="block truncate text-[11px] text-ink-500 dark:text-cream-100/50"><T>Search, review, share exhibits</T></span>
          </span>
        </Link>
        {/* Full path + hash: on the matter page the browser just scrolls to
            the anchor; from Timeline / Evidence it navigates back to the
            matter and lands on the approaches section. */}
        <a href={`/counsel/cases/${caseId}#case-approaches`} className={tile(false)}>
          <span className={icon(false)}>
            <ApproachIcon />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold"><T>Case approach</T></span>
            <span className="block truncate text-[11px] text-ink-500 dark:text-cream-100/50"><T>Argue your theory from exhibits</T></span>
          </span>
        </a>
        <ExportMenu caseId={caseId} approaches={approaches} />
      </nav>
      <div className="gold-rule" aria-hidden />
    </div>
  );
}
