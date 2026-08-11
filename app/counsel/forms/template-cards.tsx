'use client';

import { useMemo, useState } from 'react';
import type { FirmTemplate, TemplateField } from '@/lib/firm-templates';
import { unmergedPlaceholders } from '@/lib/firm-template-placeholders';
import {
  TEMPLATE_FIELD_TYPES,
  TEMPLATE_FIELD_TYPE_LABELS,
} from '@/lib/template-field-formats';
import {
  Chip,
  MonoRef,
  ViewStrip,
  shortRef,
  type ViewOption,
} from '@/components/counsel/patterns';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { StatusPill, PILL_COLORS } from '@/components/counsel/StatusPill';

/**
 * The field formats a template body can produce, in the order the editor
 * offers them.
 *
 * Taken from TEMPLATE_FIELD_TYPES rather than written out, which it used to
 * be: the hand-written list carried three of them, so a template's email and
 * amount fields were counted by nothing and the card understated what the
 * template asks for.
 */
const FIELD_TYPES: { type: TemplateField['type']; label: string }[] =
  TEMPLATE_FIELD_TYPES.map((type) => ({
    type,
    label: TEMPLATE_FIELD_TYPE_LABELS[type],
  }));

/**
 * The configuration-list pattern from PARITY-SPEC.md section 3: one
 * card per template rather than one row, carrying what an author has
 * to know before opening the editor.
 *
 * Every number on a card is counted from that template's own fields,
 * and every phrase after them names a setting the template actually
 * has: `requiresApproval` and `deliveryMode`. There is no DEFAULT
 * badge and no Categories button, because a firm template has neither
 * a default flag nor anywhere to manage categories, and the mono
 * reference is the template's id rather than a slug, because a
 * template has no slug.
 *
 * The scope strip only appears once there are at least two categories
 * to choose between. One category is not a filter, it is a label, and
 * a strip with a single option would be a control that does nothing.
 */
export function TemplateCards({
  templates,
  busy,
  onEdit,
  onArchive,
}: {
  templates: FirmTemplate[];
  busy: boolean;
  onEdit: (t: FirmTemplate) => void;
  onArchive: (id: string) => void;
}) {
  const t = useT();
  const [scope, setScope] = useState('');

  const categories = useMemo(() => {
    const seen: string[] = [];
    for (const tpl of templates) {
      const c = (tpl.category ?? '').trim();
      if (c && !seen.includes(c)) seen.push(c);
    }
    return seen.sort((a, b) => a.localeCompare(b));
  }, [templates]);

  const shown = scope
    ? templates.filter((tpl) => (tpl.category ?? '').trim() === scope)
    : templates;

  const options: ViewOption[] = [
    { key: '', label: <T>All</T>, count: templates.length },
    ...categories.map((c) => ({
      key: c,
      // A firm-authored category name is data, not UI copy, so it is
      // not wrapped for translation.
      label: <span data-no-translate>{c}</span>,
      count: templates.filter((tpl) => (tpl.category ?? '').trim() === c).length,
    })),
  ];

  return (
    <div className="space-y-3">
      {/* The count lives here rather than in the page subtitle because
          archiving a template updates this list without a reload, and a
          server-rendered count would sit there being wrong. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {categories.length > 1 ? (
          <ViewStrip
            options={options}
            active={scope}
            onSelect={setScope}
            label={t('Template categories')}
          />
        ) : (
          <span />
        )}
        <p className="text-[12px] tabular-nums text-muted">
          {shown.length}/{templates.length} <T>templates shown</T>
        </p>
      </div>

      <ul className="grid gap-3">
        {shown.map((tpl) => {
          const required = tpl.fields.filter((f) => f.required).length;
          const counterparty = tpl.fields.filter(
            (f) => f.party === 'counterparty',
          ).length;
          // TEMPLATES THAT WERE ALREADY SAVED. The save gate can only speak to
          // the next person who edits one, and a firm may hold a template with
          // a stray placeholder in it that nobody opens for a year while
          // colleagues keep sending documents from it. Shown on the list so it
          // is visible without opening anything, from the template's own
          // stored body and fields.
          const unmerged = unmergedPlaceholders({
            body: tpl.body,
            fields: tpl.fields,
          });
          return (
            <li key={tpl.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p
                      className="text-[14px] font-semibold text-foreground"
                      data-no-translate
                    >
                      {tpl.name}
                    </p>
                    {tpl.category && (
                      <Chip tone="accent">
                        <span data-no-translate>{tpl.category}</span>
                      </Chip>
                    )}
                    <StatusPill
                      size="sm"
                      dot
                      color={
                        tpl.status === 'published'
                          ? PILL_COLORS.good
                          : PILL_COLORS.neutral
                      }
                    >
                      {t(tpl.status === 'published' ? 'Published' : 'Draft')}
                    </StatusPill>
                  </div>
                  {tpl.description && (
                    <p
                      className="mt-1.5 text-[12.5px] leading-relaxed text-muted"
                      data-no-translate
                    >
                      {tpl.description}
                    </p>
                  )}
                </div>
                <MonoRef title={`${t('Template id')} ${tpl.id}`}>
                  {shortRef(tpl.id)}
                </MonoRef>
              </div>

              <p className="mt-2.5 text-[12px] text-muted">
                {tpl.fields.length}{' '}
                {tpl.fields.length === 1 ? <T>field</T> : <T>fields</T>}
                {' · '}
                {required} <T>required</T>
                {counterparty > 0 && (
                  <>
                    {' · '}
                    {counterparty} <T>filled by the other side</T>
                  </>
                )}
                {' · '}
                {tpl.requiresApproval ? (
                  <T>reviewed before it is sent</T>
                ) : (
                  <T>employees send it themselves</T>
                )}
                {' · '}
                {tpl.deliveryMode === 'signature' ? (
                  <T>sent for signature</T>
                ) : (
                  <T>shared read-only</T>
                )}
              </p>

              {unmerged.length > 0 && (
                <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[12px] leading-relaxed text-amber-900 dark:border-amber-700/40 dark:bg-amber-950/30 dark:text-amber-100">
                  {unmerged.length === 1 ? (
                    <T>One placeholder in this template fills in as nothing and prints as written:</T>
                  ) : (
                    <T>Some placeholders in this template fill in as nothing and print as written:</T>
                  )}{' '}
                  <span className="font-mono" data-no-translate>
                    {unmerged.join(' ')}
                  </span>
                </p>
              )}

              {tpl.fields.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {FIELD_TYPES.map(({ type, label }) => {
                    const n = tpl.fields.filter((f) => f.type === type).length;
                    if (n === 0) return null;
                    return (
                      <Chip key={type}>
                        {t(label)}
                        <span className="tabular-nums opacity-70">{n}</span>
                      </Chip>
                    );
                  })}
                </div>
              )}

              <div className="mt-3 flex items-center gap-4 border-t border-edge pt-3">
                <button
                  type="button"
                  onClick={() => onEdit(tpl)}
                  className="text-[13px] font-medium text-accent-text hover:underline"
                >
                  <T>Edit</T>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onArchive(tpl.id)}
                  className="text-[13px] text-muted hover:text-danger-text"
                >
                  <T>Archive</T>
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
