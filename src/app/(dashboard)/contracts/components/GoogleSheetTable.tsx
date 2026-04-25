/**
 * GoogleSheetTable.tsx — Contracts module
 *
 * Per CLAUDE.md §5 "Data Tables & Dashboards": every data table must use
 * the Google-Sheets-style table with per-column filter/sort, global search,
 * row count, and "ล้างทั้งหมด". The canonical implementation lives at
 * `@/components/data-table` (DataTable). This file is the feature-scoped
 * re-export for the Contracts module so callers can import from the
 * conventional `./components/GoogleSheetTable` path and so we keep one
 * single source of truth (no copy-paste drift).
 *
 * Usage:
 *   import { GoogleSheetTable, type ColDef } from './components/GoogleSheetTable';
 *   <GoogleSheetTable<ContractRow, ColKey> rows={...} columns={...} ... />
 */

export { DataTable as GoogleSheetTable } from '@/components/data-table';
export type { ColDef, SortState, DataTableProps } from '@/components/data-table';
