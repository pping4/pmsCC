/**
 * date-format.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Central date / time formatting utility for the entire PMS application.
 *
 * RULES (see also CLAUDE.md):
 *  ✅ Date only  → "2026-04-03"          (yyyy-mm-dd)
 *  ✅ Time only  → "14:30"               (HH:mm, 24-hour)
 *  ✅ Seconds    → "14:30:45"            (HH:mm:ss, 24-hour)
 *  ✅ DateTime   → "2026-04-03 14:30"    (yyyy-mm-dd HH:mm)
 *  ✅ Full       → "2026-04-03 14:30:45" (yyyy-mm-dd HH:mm:ss)
 *
 * NEVER use:
 *  ❌ toLocaleDateString('th-TH', ...) — shows Buddhist year + Thai text
 *  ❌ toLocaleString('th-TH', ...)     — same problem
 *  ❌ new Date().toISOString()         — includes timezone offset / Z suffix
 *
 * Usage:
 *  import { fmtDate, fmtTime, fmtDateTime } from '@/lib/date-format';
 */

// ─── Internal helper ──────────────────────────────────────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toLocalParts(d: Date) {
  return {
    yyyy: d.getFullYear(),
    mm:   pad2(d.getMonth() + 1),
    dd:   pad2(d.getDate()),
    HH:   pad2(d.getHours()),
    MM:   pad2(d.getMinutes()),
    ss:   pad2(d.getSeconds()),
  };
}

// ─── Core formatters ──────────────────────────────────────────────────────────

/**
 * Date only: "2026-04-03"
 */
export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '-';
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return '-';
  const { yyyy, mm, dd } = toLocalParts(date);
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Time only (24-hour): "14:30"
 */
export function fmtTime(d: Date | string | null | undefined): string {
  if (!d) return '-';
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return '-';
  const { HH, MM } = toLocalParts(date);
  return `${HH}:${MM}`;
}

/**
 * Time with seconds (24-hour): "14:30:45"
 */
export function fmtTimeSec(d: Date | string | null | undefined): string {
  if (!d) return '-';
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return '-';
  const { HH, MM, ss } = toLocalParts(date);
  return `${HH}:${MM}:${ss}`;
}

/**
 * Date + time (24-hour): "2026-04-03 14:30"
 */
export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return '-';
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return '-';
  const { yyyy, mm, dd, HH, MM } = toLocalParts(date);
  return `${yyyy}-${mm}-${dd} ${HH}:${MM}`;
}

/**
 * Date + time + seconds (24-hour): "2026-04-03 14:30:45"
 */
export function fmtDateTimeSec(d: Date | string | null | undefined): string {
  if (!d) return '-';
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return '-';
  const { yyyy, mm, dd, HH, MM, ss } = toLocalParts(date);
  return `${yyyy}-${mm}-${dd} ${HH}:${MM}:${ss}`;
}

/**
 * ISO date string for DB/API: "2026-04-03"  (local date, NOT UTC)
 * Use this when sending dates to the API that expects YYYY-MM-DD strings.
 */
export function toDateStr(d: Date): string {
  const { yyyy, mm, dd } = toLocalParts(d);
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Parse "YYYY-MM-DD" API string → Date at local midnight (not UTC midnight).
 * Use for date-only values that should represent a calendar day.
 */
export function parseDateStr(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Parse "YYYY-MM-DD" API string → Date at UTC midnight.
 * Use inside the tape chart / calendar calculations.
 */
export function parseUTCDateStr(s: string): Date {
  return new Date(s + 'T00:00:00.000Z');
}

// ─── Tape-chart / calendar helpers (Thai month names allowed here) ────────────

/** Short Thai month name for tape chart column header: "เม.ย." */
export function fmtMonthShortTH(d: Date): string {
  return d.toLocaleDateString('th-TH', { month: 'short' });
}

/** Long Thai month + year for period labels: "เมษายน 2569" */
export function fmtMonthLongTH(d: Date): string {
  return d.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
}

// ─── Currency (not date, but shared utility) ──────────────────────────────────

/**
 * Format number as Thai Baht without symbol: "1,234.50"
 * Uses en-US grouping (comma) for consistency across all pages.
 */
export function fmtBaht(n: number | null | undefined, decimals = 2): string {
  if (n == null) return '0.00';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
