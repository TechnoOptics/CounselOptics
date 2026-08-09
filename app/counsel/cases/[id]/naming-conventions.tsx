import { T } from '@/components/i18n/LocaleProvider';
import { toNormRules } from '@/lib/text-normalize';

/**
 * The matter's naming conventions, shown read-only.
 *
 * `cases.text_normalizations` rewrites wording in generated text and in the
 * court-ready export. Until this panel existed there was no way for a firm to
 * find out that a matter carried such a rule, which meant a document could be
 * filed containing wording that was substituted without anybody being able to
 * see it. The exhibit itself now states any substitution it contains; this is
 * the same fact in the app, before the document is produced.
 *
 * Read-only on purpose. Who may set a convention, and whether a change is
 * recorded, is a product decision that has not been made, and guessing at it
 * would put an unreviewed edit control on the text of filed documents.
 * Matters with no conventions render nothing.
 */
export function NamingConventions({ rules }: { rules: unknown }) {
  const parsed = toNormRules(rules);
  if (parsed.length === 0) return null;

  return (
    <section className="card p-5">
      <p className="eyebrow text-[10px] mb-1"><T>Naming conventions</T></p>
      <p className="text-[13px] text-ink-600 dark:text-cream-100/70">
        <T>
          This matter rewrites the wording below wherever it appears in generated text and in
          exports, so the record stays consistent. Every export that contains a substitution says
          so in its certification section.
        </T>
      </p>
      <ul className="mt-3 space-y-1.5">
        {parsed.map((r) => (
          <li
            key={`${r.from}->${r.to}`}
            className="text-[13px] text-ink-700 dark:text-cream-100/85"
            data-no-translate
          >
            <span className="font-mono">{r.from}</span>
            <span className="mx-2 text-ink-400 dark:text-cream-100/40">&rarr;</span>
            <span className="font-mono">{r.to}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12px] text-ink-500 dark:text-cream-100/55">
        <T>
          Source files stored on this matter are never changed, and the copies reproduced in an
          export are unaltered. Conventions cannot yet be edited in the app. Contact support to
          add or remove one.
        </T>
      </p>
    </section>
  );
}
