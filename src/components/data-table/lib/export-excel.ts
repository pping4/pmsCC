import ExcelJS from 'exceljs';
import type { AggregateFn, ColDef } from '../types';
import { cellText, downloadBlob, makeFilename, sanitizeForExcel, type ExportOptions } from './export-shared';

/**
 * Compute aggregate numerically (matches DataTable.tsx footer logic).
 * Used only when `includeAggregates` is true and the column has `aggregate`.
 */
function computeAgg<T, K extends string>(
  col: ColDef<T, K>,
  rows: T[]
): number | null {
  if (!col.aggregate) return null;
  const pick = col.aggValue ?? ((r: T) => parseFloat(col.getValue(r)) || 0);
  const vals = rows.map(pick);
  switch (col.aggregate as AggregateFn) {
    case 'sum':   return vals.reduce((s, v) => s + v, 0);
    case 'avg':   return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
    case 'min':   return vals.length ? Math.min(...vals) : 0;
    case 'max':   return vals.length ? Math.max(...vals) : 0;
    case 'count': return vals.length;
  }
}

/**
 * Export to .xlsx with:
 *   - Bold header row, frozen at top
 *   - Auto column widths (with sensible bounds)
 *   - Optional filter-summary metadata row above the header
 *   - Optional aggregation footer row
 *   - Right-aligned numeric columns
 */
export async function exportExcel<T, K extends string>(
  rows:    T[],
  columns: ColDef<T, K>[],
  opts:    ExportOptions = {}
): Promise<void> {
  const {
    filename          = 'export',
    sheetName         = 'Data',
    filterSummary,
    includeAggregates = true,
  } = opts;

  const wb = new ExcelJS.Workbook();
  wb.creator    = 'PMS';
  wb.created    = new Date();
  const ws = wb.addWorksheet(sheetName.slice(0, 31) /* xlsx sheet-name limit */);

  let rowIndex = 1;

  // Metadata: generated-at + filter summary
  ws.getCell(`A${rowIndex}`).value = `สร้างเมื่อ: ${new Date().toLocaleString('th-TH')}`;
  ws.getCell(`A${rowIndex}`).font = { italic: true, color: { argb: 'FF6B7280' }, size: 9 };
  rowIndex++;
  if (filterSummary) {
    ws.getCell(`A${rowIndex}`).value = `ตัวกรอง: ${filterSummary}`;
    ws.getCell(`A${rowIndex}`).font = { italic: true, color: { argb: 'FF6B7280' }, size: 9 };
    rowIndex++;
  }
  rowIndex++; // blank line

  // Header
  const headerRowIdx = rowIndex;
  const headerRow = ws.getRow(headerRowIdx);
  columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.label;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern', pattern: 'solid',
      fgColor: { argb: 'FF4F46E5' },  // primary purple
    };
    cell.alignment = { horizontal: col.align ?? 'left', vertical: 'middle' };
    cell.border = { bottom: { style: 'medium', color: { argb: 'FF4338CA' } } };
  });
  rowIndex++;

  // Data rows
  for (const row of rows) {
    const r = ws.getRow(rowIndex++);
    columns.forEach((col, i) => {
      const cell = r.getCell(i + 1);
      // Prefer numeric value for aggregate-enabled columns so Excel treats
      // them as numbers (user can SUM/filter in Excel itself)
      if (col.aggregate && col.aggValue) {
        const n = col.aggValue(row);
        cell.value = Number.isFinite(n) ? n : sanitizeForExcel(cellText(col, row));
        if (typeof cell.value === 'number') {
          cell.numFmt = '#,##0.##';
        }
      } else {
        cell.value = sanitizeForExcel(cellText(col, row));
      }
      cell.alignment = { horizontal: col.align ?? 'left', vertical: 'middle' };
    });
    // Zebra striping
    if ((rowIndex - headerRowIdx) % 2 === 0) {
      for (let i = 1; i <= columns.length; i++) {
        r.getCell(i).fill = {
          type: 'pattern', pattern: 'solid',
          fgColor: { argb: 'FFF9FAFB' },
        };
      }
    }
  }

  // Aggregation footer
  if (includeAggregates && columns.some(c => c.aggregate)) {
    const r = ws.getRow(rowIndex++);
    columns.forEach((col, i) => {
      const cell = r.getCell(i + 1);
      if (i === 0) {
        cell.value = `รวม ${rows.length} รายการ`;
      } else {
        const agg = computeAgg(col, rows);
        if (agg !== null) {
          cell.value = agg;
          cell.numFmt = '#,##0.##';
        }
      }
      cell.font = { bold: true };
      cell.fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: 'FFF3F4F6' },
      };
      cell.border = { top: { style: 'medium', color: { argb: 'FFD1D5DB' } } };
      cell.alignment = { horizontal: col.align ?? 'left', vertical: 'middle' };
    });
  }

  // Auto-size columns (cap at 40 chars to avoid absurd widths)
  columns.forEach((col, i) => {
    let maxLen = col.label.length;
    for (const row of rows) {
      const s = sanitizeForExcel(cellText(col, row));
      if (s.length > maxLen) maxLen = s.length;
    }
    ws.getColumn(i + 1).width = Math.min(Math.max(maxLen + 2, 8), 40);
  });

  // Freeze header row
  ws.views = [{ state: 'frozen', ySplit: headerRowIdx }];

  // Generate + download
  const buf  = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  downloadBlob(blob, makeFilename(filename, 'xlsx'));
}
