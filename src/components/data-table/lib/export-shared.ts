import type { ColDef } from '../types';

/**
 * Plain-text extractor for export rows.
 *
 * Excel/CSV cells need plain strings, not JSX. We use the column's `getLabel`
 * when provided (it's the human-readable form shown in filter dropdown) and
 * fall back to `getValue` for columns without a label.
 *
 * NOTE: we intentionally do NOT render the JSX from `render()` — it may
 * include icons, badges, nested elements that don't flatten well to text.
 * Columns that need a special export representation should define `getLabel`.
 */
export function cellText<T, K extends string>(col: ColDef<T, K>, row: T): string {
  if (col.getLabel) return col.getLabel(row);
  return col.getValue(row);
}

/**
 * Strip emoji + invisible characters that cause issues in Excel on Windows
 * (some Thai fonts + emoji combinations render as boxes).
 *
 * We KEEP Thai characters. This strips only known-problematic ranges:
 *   - Emoji presentation selector (U+FE0F)
 *   - Zero-width joiner (U+200D) between unrelated runs
 *   - Leading/trailing whitespace
 *
 * Tweak cautiously — Thai text relies on combining marks that must NOT be
 * stripped.
 */
export function sanitizeForExcel(s: string): string {
  return s
    .replace(/[\uFE0F\u200D]/g, '')
    .trim();
}

export type ExportOptions = {
  /** Base filename (without extension). Default: "export" */
  filename?: string;
  /** Active filter summary to embed in sheet metadata. Example: "สถานะ=เช็คอิน" */
  filterSummary?: string;
  /** Sheet title shown inside the Excel file. Default: filename */
  sheetName?: string;
  /** Include the aggregation footer row if present */
  includeAggregates?: boolean;
};

/** Generate `{prefix}_{YYYY-MM-DD_HHmm}.{ext}` */
export function makeFilename(prefix: string, ext: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `_${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `${prefix}_${stamp}.${ext}`;
}

/** Trigger a browser download from a Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Delay revoke to let download start
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
