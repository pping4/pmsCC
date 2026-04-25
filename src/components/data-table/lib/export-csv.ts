import type { ColDef } from '../types';
import { cellText, downloadBlob, makeFilename, sanitizeForExcel, type ExportOptions } from './export-shared';

/**
 * Escape one CSV cell per RFC 4180:
 *   - wrap in double quotes if contains `,`, `"`, or newline
 *   - double up embedded `"`
 */
function escapeCSV(v: string): string {
  if (v == null) return '';
  const s = String(v);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Export rows to CSV. Writes UTF-8 with BOM so Excel on Windows detects
 * the encoding correctly (otherwise Thai text shows as gibberish).
 */
export function exportCSV<T, K extends string>(
  rows:    T[],
  columns: ColDef<T, K>[],
  opts:    ExportOptions = {}
): void {
  const {
    filename      = 'export',
    filterSummary,
  } = opts;

  const lines: string[] = [];

  // Optional metadata rows (not standard CSV, but useful for context)
  if (filterSummary) {
    lines.push(escapeCSV(`ตัวกรอง: ${filterSummary}`));
    lines.push('');
  }

  // Header row
  lines.push(columns.map(c => escapeCSV(c.label)).join(','));

  // Data rows
  for (const row of rows) {
    lines.push(
      columns.map(c => escapeCSV(sanitizeForExcel(cellText(c, row)))).join(',')
    );
  }

  // UTF-8 BOM for Excel
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + lines.join('\r\n')], {
    type: 'text/csv;charset=utf-8',
  });
  downloadBlob(blob, makeFilename(filename, 'csv'));
}
