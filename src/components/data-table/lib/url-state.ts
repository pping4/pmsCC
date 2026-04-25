/**
 * URL-shareable DataTable state.
 *
 * Encodes/decodes (sort, filters, visibleCols) as URL query params scoped by
 * a table key so multiple tables on one page don't collide.
 *
 * Keys (all prefixed with `${tableKey}.`):
 *   - `s`  → "col:dir"           e.g. "balance:desc"
 *   - `v`  → "col1,col2,..."     (empty string = hide-all is not allowed; omit key to keep defaults)
 *   - `f.<colKey>` → "v1|v2|v3"  (one query-param per filtered column)
 *
 * URL query params are public, shareable, and bookmarkable. Values are
 * user-visible, so we keep encoding readable (no base64).
 *
 * Security: decoding is strictly additive — invalid keys / unknown columns /
 * malformed sort dirs are silently dropped. We never trust values to be
 * well-formed; the DataTable treats unknown filter-values as "row doesn't
 * match" (the set just won't contain them).
 */
import type { ColFilters, SortDir, SortState } from '../types';

export interface TableUrlState<K extends string = string> {
  sort?:        SortState<K>;
  filters?:     ColFilters<K>;
  visibleCols?: Set<K>;
}

// ─── Encode ──────────────────────────────────────────────────────────────────

export function encodeTableState<K extends string>(
  tableKey:  string,
  state:     TableUrlState<K>,
  params:    URLSearchParams,
): void {
  const prefix = `${tableKey}.`;

  // Remove all existing keys for this tableKey so we overwrite cleanly
  const toDelete: string[] = [];
  params.forEach((_, key) => {
    if (key === prefix + 's' || key === prefix + 'v' || key.startsWith(prefix + 'f.')) {
      toDelete.push(key);
    }
  });
  toDelete.forEach(k => params.delete(k));

  // Sort
  if (state.sort) {
    params.set(`${prefix}s`, `${state.sort.col}:${state.sort.dir}`);
  }

  // Visible columns (only if set explicitly)
  if (state.visibleCols) {
    params.set(`${prefix}v`, Array.from(state.visibleCols).join(','));
  }

  // Filters — one param per column
  if (state.filters) {
    for (const key in state.filters) {
      const set = state.filters[key];
      if (!set || set.size === 0) continue;
      params.set(`${prefix}f.${key}`, Array.from(set).join('|'));
    }
  }
}

// ─── Decode ──────────────────────────────────────────────────────────────────

/**
 * Extract table state from URL params. `validKeys` is the set of column keys
 * currently defined — used to filter out stale/unknown keys. `validKeys=null`
 * disables that check (use only when re-hydrating without column defs handy).
 */
export function decodeTableState<K extends string>(
  tableKey:  string,
  params:    URLSearchParams,
  validKeys: Set<K> | null = null,
): TableUrlState<K> {
  const prefix = `${tableKey}.`;
  const out: TableUrlState<K> = {};

  // Sort
  const sortRaw = params.get(`${prefix}s`);
  if (sortRaw) {
    const [col, dir] = sortRaw.split(':');
    if (col && (dir === 'asc' || dir === 'desc')) {
      if (!validKeys || validKeys.has(col as K)) {
        out.sort = { col: col as K, dir: dir as SortDir };
      }
    }
  }

  // Visible columns
  const visRaw = params.get(`${prefix}v`);
  if (visRaw !== null) {
    const cols = visRaw.split(',').filter(Boolean) as K[];
    const kept = validKeys ? cols.filter(k => validKeys.has(k)) : cols;
    if (kept.length > 0) out.visibleCols = new Set(kept);
  }

  // Filters
  const filters: ColFilters<K> = {};
  let hasFilters = false;
  params.forEach((value, key) => {
    if (!key.startsWith(`${prefix}f.`)) return;
    const colKey = key.slice(prefix.length + 2) as K;
    if (validKeys && !validKeys.has(colKey)) return;
    const vals = value.split('|').filter(Boolean);
    if (vals.length === 0) return;
    filters[colKey] = new Set(vals);
    hasFilters = true;
  });
  if (hasFilters) out.filters = filters;

  return out;
}

// ─── Helpers for DataTable integration ───────────────────────────────────────

/**
 * Check if the given URL already encodes this table's state. Used to decide
 * whether to initialize from URL vs from localStorage/defaults on mount.
 */
export function hasTableStateInUrl(tableKey: string, params: URLSearchParams): boolean {
  const prefix = `${tableKey}.`;
  if (params.has(`${prefix}s`) || params.has(`${prefix}v`)) return true;
  let found = false;
  params.forEach((_, key) => { if (key.startsWith(`${prefix}f.`)) found = true; });
  return found;
}
