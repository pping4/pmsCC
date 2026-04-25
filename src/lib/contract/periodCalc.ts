/**
 * Contract billing-period calculator (Sprint 3B).
 *
 * Pure functions — no Prisma, no I/O.
 *
 * Two billing cycles are supported:
 *   - 'rolling'  : anniversary. Period N = [anchor + (N-1) months, anchor + N months - 1 day]
 *   - 'calendar' : month-1st anchored. First period may be a partial prorated slice
 *                  from startDate to end-of-month; last period may be truncated to endDate.
 *
 * All dates are treated as date-only (local). Callers should pass JS Date objects
 * that represent a calendar date (time-of-day is ignored).
 */

import {
  addDays,
  addMonths,
  differenceInCalendarMonths,
  endOfMonth,
  getDate,
  getDaysInMonth,
  startOfDay,
  isAfter,
  isEqual,
} from 'date-fns';

export type BillingCycleKind = 'rolling' | 'calendar';

export interface ContractPeriodInput {
  startDate: Date;
  endDate: Date;
  billingCycle: BillingCycleKind;
}

export interface PeriodResult {
  start: Date;
  end: Date;
  /** True when this period does not cover a full calendar month (calendar cycle only, or last period clamp). */
  isProrated: boolean;
  /** 1-based index of this period within the contract. */
  periodNumber: number;
  /** Number of billable days in this period (inclusive of start and end). */
  daysInPeriod: number;
  /** Days in the full reference month — used as denominator when prorating. */
  daysInFullMonth: number;
}

/**
 * Banker's rounding (half-to-even) to 2 decimals — avoids the systematic bias
 * of standard round-half-up across many monthly prorations.
 */
export function roundHalfToEven2(n: number): number {
  const scaled = n * 100;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  // Tolerate tiny float noise around 0.5
  const EPS = 1e-9;
  if (Math.abs(diff - 0.5) < EPS) {
    // exact half — round to even
    const rounded = floor % 2 === 0 ? floor : floor + 1;
    return rounded / 100;
  }
  return Math.round(scaled) / 100;
}

/**
 * Adds `months` to `date` with date-fns's end-of-month-safe behavior
 * (e.g. 31 Jan + 1 month = 28 Feb in non-leap, 29 Feb in leap years).
 */
export function addContractMonths(date: Date, months: number): Date {
  return addMonths(startOfDay(date), months);
}

/**
 * Compute the next billing period for a contract.
 *
 * @param contract      startDate / endDate / billingCycle
 * @param lastPeriodEnd End of the most recently completed period, or null for the first period.
 */
export function computeNextPeriod(
  contract: ContractPeriodInput,
  lastPeriodEnd: Date | null,
): PeriodResult {
  const anchor = startOfDay(contract.startDate);
  const contractEnd = startOfDay(contract.endDate);

  if (contract.billingCycle === 'rolling') {
    return computeRollingPeriod(anchor, contractEnd, lastPeriodEnd);
  }
  return computeCalendarPeriod(anchor, contractEnd, lastPeriodEnd);
}

function computeRollingPeriod(
  anchor: Date,
  contractEnd: Date,
  lastPeriodEnd: Date | null,
): PeriodResult {
  // Period N starts at anchor + (N-1) months; ends at anchor + N months - 1 day.
  // date-fns addMonths safely clamps (31 Jan + 1m = 28/29 Feb).
  const start = lastPeriodEnd
    ? startOfDay(addDays(lastPeriodEnd, 1))
    : anchor;

  // Determine period number from the anchor
  const periodNumber = differenceInCalendarMonths(start, anchor) + 1;

  // end = addMonths(anchor, periodNumber) - 1 day → gives correct end-of-month clamp
  const naturalEnd = addDays(addMonths(anchor, periodNumber), -1);

  // Clamp to contract end (last period may be shorter)
  const clamped = isAfter(naturalEnd, contractEnd) ? contractEnd : naturalEnd;
  const isProrated = !isEqual(clamped, naturalEnd);

  const daysInPeriod = diffDaysInclusive(start, clamped);
  // Reference full month: the calendar month containing `start`
  const daysInFullMonth = getDaysInMonth(start);

  return {
    start,
    end: clamped,
    isProrated,
    periodNumber,
    daysInPeriod,
    daysInFullMonth,
  };
}

function computeCalendarPeriod(
  anchor: Date,
  contractEnd: Date,
  lastPeriodEnd: Date | null,
): PeriodResult {
  if (!lastPeriodEnd) {
    // Period 1 may start mid-month → prorate to end-of-month (or contractEnd, whichever is earlier).
    const start = anchor;
    const monthEnd = endOfMonth(start);
    const end = isAfter(monthEnd, contractEnd) ? contractEnd : monthEnd;
    const isProrated = getDate(start) !== 1 || !isEqual(end, monthEnd);
    return {
      start,
      end,
      isProrated,
      periodNumber: 1,
      daysInPeriod: diffDaysInclusive(start, end),
      daysInFullMonth: getDaysInMonth(start),
    };
  }

  // Subsequent period: starts on the day AFTER lastPeriodEnd.
  // Normal case: lastPeriodEnd = end of month → start = 1st of next month.
  const start = startOfDay(addDays(lastPeriodEnd, 1));
  const monthEnd = endOfMonth(start);
  const end = isAfter(monthEnd, contractEnd) ? contractEnd : monthEnd;
  const isProrated = !isEqual(end, monthEnd) || getDate(start) !== 1;

  // Period number: how many calendar months between anchor's month and start's month, plus 1.
  const periodNumber =
    differenceInCalendarMonths(start, anchor) + 1;

  return {
    start,
    end,
    isProrated,
    periodNumber,
    daysInPeriod: diffDaysInclusive(start, end),
    daysInFullMonth: getDaysInMonth(start),
  };
}

/**
 * Prorate a monthly amount for a partial period.
 * Uses banker's rounding (half-to-even) at 2 decimals.
 */
export function prorateAmount(
  monthlyAmount: number,
  daysInPeriod: number,
  daysInFullMonth: number,
): number {
  if (daysInFullMonth <= 0) return 0;
  if (daysInPeriod <= 0) return 0;
  if (daysInPeriod >= daysInFullMonth) return roundHalfToEven2(monthlyAmount);
  const raw = (monthlyAmount * daysInPeriod) / daysInFullMonth;
  return roundHalfToEven2(raw);
}

/** Inclusive day count between two calendar dates (start and end both counted). */
function diffDaysInclusive(start: Date, end: Date): number {
  const s = startOfDay(start).getTime();
  const e = startOfDay(end).getTime();
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((e - s) / MS_PER_DAY) + 1;
}
