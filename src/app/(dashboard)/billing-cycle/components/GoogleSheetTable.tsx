/**
 * GoogleSheetTable.tsx — Billing Cycle module
 *
 * Per CLAUDE.md §5: each feature module carries its own re-export wrapper so
 * imports from `./components/GoogleSheetTable` resolve correctly and there is
 * no copy-paste drift from the canonical DataTable implementation.
 */

export { DataTable as GoogleSheetTable } from '@/components/data-table';
export type { ColDef, SortState, DataTableProps } from '@/components/data-table';
