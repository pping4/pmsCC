import type { GuestInfo } from './types';
import { fmtDate, fmtBaht } from '@/lib/date-format';

// ─── UTC-Safe Date Parsing ────────────────────────────────────────────────────
// All dates from the API are "YYYY-MM-DD" strings.
// We always parse as UTC midnight to avoid timezone drift.

export function parseUTCDate(s: string): Date {
  // "2026-03-21" → Date at 2026-03-21T00:00:00.000Z
  return new Date(s + 'T00:00:00.000Z');
}

export function formatDateStr(d: Date): string {
  // UTC date → "YYYY-MM-DD"
  return d.toISOString().split('T')[0];
}

export function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

/** Add N calendar months, UTC-safe (preserves the day-of-month). */
export function addUTCMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

export function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

// Day index of a date string relative to a range start date (0-based, can be negative)
export function dayIndex(dateStr: string, rangeStart: Date): number {
  return diffDays(rangeStart, parseUTCDate(dateStr));
}

// ─── Display Formatters ───────────────────────────────────────────────────────

export function fmtThai(s: string | null | undefined): string {
  return fmtDate(s);
}

export function fmtThaiLong(s: string | null | undefined): string {
  return fmtDate(s);
}

export function fmtCurrency(n: number | null | undefined): string {
  return fmtBaht(n, 0);
}

export function guestDisplayName(g: GuestInfo): string {
  if (g.firstNameTH && g.lastNameTH) return `${g.firstNameTH} ${g.lastNameTH}`;
  return `${g.firstName} ${g.lastName}`;
}

// Build the flat list of days in a range (UTC)
export function buildDayList(rangeStart: Date, rangeDays: number): Date[] {
  return Array.from({ length: rangeDays }, (_, i) => addDays(rangeStart, i));
}

// Thai short day names (0=Sunday)
export const TH_DAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'] as const;
