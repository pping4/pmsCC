// ─── Shared DataTable Types ──────────────────────────────────────────────────
//
// Generic, reusable Google-Sheets-style column filter/sort table.
// Reference skill: .claude/skills/google-sheet-filter-sort.md
//
// USAGE (quick start):
//
//   const cols: ColDef<Booking>[] = [
//     { key: 'number', label: 'เลขที่',
//       getValue: r => r.number,
//       render:   r => <strong>{r.number}</strong> },
//     { key: 'amount', label: 'ยอด', align: 'right',
//       getValue: r => String(Math.round(r.amount)).padStart(10, '0'),
//       getLabel: r => `฿${fmtBaht(r.amount)}`,
//       render:   r => <>฿{fmtBaht(r.amount)}</>,
//       aggregate: 'sum' },
//   ];
//
//   <DataTable rows={bookings} columns={cols} rowKey={r => r.id} />

import type React from 'react';

// ─── Sort / Filter primitives ────────────────────────────────────────────────

export type SortDir = 'asc' | 'desc';

export interface SortState<K extends string = string> {
  col: K;
  dir: SortDir;
}

// undefined = no filter (all values pass). Set = only listed values pass.
export type ColFilters<K extends string = string> = Partial<Record<K, Set<string>>>;

// ─── Aggregation ─────────────────────────────────────────────────────────────

export type AggregateFn = 'sum' | 'avg' | 'min' | 'max' | 'count';

// ─── Column definition ───────────────────────────────────────────────────────

/**
 * Per-column definition. `T` = row shape, `K` = union of column keys.
 *
 * Rules (see google-sheet-filter-sort skill):
 *  - `getValue` is the sort/filter KEY. MUST be stable and MUST normalize
 *    equivalent rows into the same key (e.g. all "paid in full" → '__paid__'
 *    instead of distinct padded negative numbers).
 *  - `getLabel` is the human-readable label in the filter dropdown. Falls
 *    back to `getValue` if omitted. Provide it whenever getValue is
 *    padded/raw (dates, numbers).
 *  - `render` is the cell JSX — can be as rich as needed.
 *  - `aggregate` opts this column into the footer totals row.
 */
export interface ColDef<T, K extends string = string> {
  key:       K;
  label:     string;
  align?:    'left' | 'right' | 'center';
  minW?:     number;
  /** Hide by default (user can toggle via column-visibility menu, once built). */
  hiddenByDefault?: boolean;
  /** sort/filter key — see rules above */
  getValue:  (row: T) => string;
  /** display label in filter dropdown; falls back to getValue */
  getLabel?: (row: T) => string;
  /** cell render */
  render:    (row: T) => React.ReactNode;
  /** optional numeric aggregator for footer totals. Reads raw number via `aggValue`. */
  aggregate?: AggregateFn;
  /** numeric value used by aggregation (defaults to parseFloat(getValue)) */
  aggValue?:  (row: T) => number;
  /** Disable filter/sort for this column. Use for action columns or columns
   *  whose values are irrelevant to filter/sort (e.g. action buttons). */
  noFilter?:  boolean;
}

// ─── Public DataTable props ──────────────────────────────────────────────────

export interface DataTableProps<T, K extends string = string> {
  rows:       T[];
  columns:    ColDef<T, K>[];
  /** MUST be unique per row across the full flattened dataset.
   *  See skill: composite keys prevent stale-DOM bugs. */
  rowKey:     (row: T) => string;
  /** default sort applied before user interaction */
  defaultSort?: SortState<K>;
  /** click handler for row */
  onRowClick?:    (row: T) => void;
  onRowContextMenu?: (e: React.MouseEvent, row: T) => void;
  /** optional per-row highlight (returns CSS background) */
  rowHighlight?:  (row: T) => string | undefined;
  /** shown at top-left of the summary bar (e.g. "📋 {filtered}/{total} การจอง") */
  summaryLabel?:  (filtered: number, total: number) => React.ReactNode;
  /** shown at top-right of the summary bar */
  summaryRight?:  (rows: T[]) => React.ReactNode;
  /** empty-state text */
  emptyText?:   string;
  /** table font family override */
  fontFamily?:  string;

  // ── Phase 2: Export + Column Visibility ────────────────────────────────
  /** Stable key identifying this table — used to scope localStorage
   *  persistence (column visibility, saved views). Required if
   *  `persistPreferences` is true. */
  tableKey?:    string;
  /** Enable Excel/CSV export menu in the summary bar. Default: true */
  enableExport?:     boolean;
  /** Base filename for export (without extension/timestamp). Defaults to tableKey. */
  exportFilename?:   string;
  /** Excel sheet name. Defaults to exportFilename. */
  exportSheetName?:  string;
  /** Enable column visibility menu. Default: true */
  enableColVisibility?: boolean;
  /** Persist column visibility to localStorage (requires tableKey). Default: true */
  persistPreferences?:  boolean;

  // ── Phase 3: URL-shareable state ──────────────────────────────────────
  /** Sync (sort, filters, visible columns) with the URL query string so the
   *  user can bookmark/share the exact view. Requires `tableKey`. Default: false.
   *
   *  Keys are scoped as `${tableKey}.s`, `${tableKey}.v`, `${tableKey}.f.<col>`
   *  so multiple tables on one page don't collide. URL wins over localStorage
   *  on initial mount when both are present. */
  syncUrl?: boolean;

  // ── Phase 4a: Date-range filter ───────────────────────────────────────
  /** Enable the date-range preset picker (📅) in the toolbar. Filters rows
   *  whose `getDate(row)` falls inside the selected range (inclusive on both
   *  ends). `label` appears on the button when no range is active. */
  dateRange?: {
    col:      K;
    getDate:  (row: T) => Date | null;
    label?:   string;
  };

  // ── Phase 4b: Group-by rows ───────────────────────────────────────────
  /** Whitelist of column keys eligible for group-by. When non-empty, shows
   *  a "🗂 จัดกลุ่ม" menu in the toolbar. Group value is derived from each
   *  column's `getLabel ?? getValue`. Footer aggregates, if any, are computed
   *  per group AND globally. */
  groupByCols?: K[];
}
