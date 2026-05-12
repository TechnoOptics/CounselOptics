/**
 * Per-user sidebar customization. Powers the "edit menu" affordance
 * on the consumer Sidebar (and, by following the same shape, the
 * counsel sidebar). Persisted in profiles.menu_preferences (jsonb).
 *
 * Shape:
 *   { "consumer": { hidden: string[], order: string[] }, ... }
 *
 * - hidden:  list of item ids the user has chosen to hide
 * - order:   user-defined order of item ids. Items not in this list
 *            are appended in their component-default order.
 *
 * Item ids are stable strings owned by the sidebar component (we
 * use the href as the id). Unknown ids are ignored on render, so
 * a renamed / removed item never breaks an old preferences row.
 */

export type MenuPortal = 'consumer' | 'counsel' | 'admin';

export type MenuPreferences = {
  hidden?: string[];
  order?: string[];
};

export type AllMenuPreferences = Partial<Record<MenuPortal, MenuPreferences>>;

/**
 * Apply a user's preferences to a master list. Returns the items
 * to render in the right order with hidden items omitted. Items
 * present in the master list but absent from the order are
 * appended in their master-list order so newly-added items show
 * up automatically.
 */
export function applyMenuPreferences<T extends { id: string }>(
  master: T[],
  prefs: MenuPreferences | undefined,
): T[] {
  const hidden = new Set(prefs?.hidden ?? []);
  const order = prefs?.order ?? [];
  const byId = new Map(master.map((it) => [it.id, it]));
  const seen = new Set<string>();
  const result: T[] = [];
  for (const id of order) {
    if (hidden.has(id)) continue;
    const it = byId.get(id);
    if (!it) continue; // unknown id; skip silently
    result.push(it);
    seen.add(id);
  }
  for (const it of master) {
    if (seen.has(it.id)) continue;
    if (hidden.has(it.id)) continue;
    result.push(it);
  }
  return result;
}

/** Type guard - lets us safely read the column even when the
 *  shape drifts (e.g. before the migration is applied locally). */
export function parseMenuPreferences(raw: unknown): AllMenuPreferences {
  if (!raw || typeof raw !== 'object') return {};
  return raw as AllMenuPreferences;
}
