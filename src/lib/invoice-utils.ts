/**
 * invoice-utils.ts
 *
 * Shared helpers for building invoice and receipt line items.
 *
 * Key feature: expandNightlyItems / expandNightlyReceiptItems
 *   Converts a single multi-night ROOM charge into per-night rows,
 *   each with its own periodStart / periodEnd — identical to how
 *   Booking.com, Agoda, etc. present nightly breakdowns.
 *
 * Usage:
 *   // API route (server-side only)
 *   import { expandNightlyItems } from '@/lib/invoice-utils';
 */

import { fmtDate } from '@/lib/date-format';
import type { InvoiceLineItem } from '@/components/invoice/types';
import type { ReceiptLineItem }  from '@/components/receipt/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Strip "X คืน —" or "X คืน" suffix that was embedded in legacy descriptions */
function cleanRoomDesc(desc: string): string {
  return desc
    .replace(/\s*\d+\s*คืน\s*—?\s*/g, '')  // e.g. " 9 คืน — "
    .replace(/\s*\d+\s*วัน\s*—?\s*/g, '')   // e.g. " 9 วัน — "
    .trim() || desc;
}

/** Add `n` days to a Date without mutating it */
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

// ─── InvoiceLineItem expansion ────────────────────────────────────────────────

export interface ExpandNightlyParams {
  description: string;
  startDate:   Date;
  nights:      number;      // total number of nights to expand
  unitPrice:   number;      // price per night
  taxType?:    string;      // default 'no_tax'
}

/**
 * Expand a multi-night ROOM charge into individual nightly InvoiceLineItems.
 * Each row: qty=1, unitPrice=rate, periodStart="YYYY-MM-DD", periodEnd="YYYY-MM-DD"
 */
export function expandNightlyItems(p: ExpandNightlyParams): InvoiceLineItem[] {
  const { description, startDate, nights, unitPrice, taxType = 'no_tax' } = p;
  const baseDesc = cleanRoomDesc(description);

  return Array.from({ length: nights }, (_, i) => {
    const nightStart = addDays(startDate, i);
    const nightEnd   = addDays(startDate, i + 1);
    return {
      description: baseDesc,
      quantity:    1,
      unitPrice,
      amount:      +unitPrice.toFixed(2),
      taxType,
      periodStart: fmtDate(nightStart),
      periodEnd:   fmtDate(nightEnd),
    };
  });
}

// ─── ReceiptLineItem expansion ────────────────────────────────────────────────

/**
 * Same as expandNightlyItems but returns ReceiptLineItem[].
 * Used when building thermal receipt items in API routes.
 */
export function expandNightlyReceiptItems(
  p: Omit<ExpandNightlyParams, 'taxType'>
): ReceiptLineItem[] {
  return expandNightlyItems({ ...p, taxType: 'no_tax' }).map(item => ({
    description: item.description,
    quantity:    item.quantity,
    unitPrice:   item.unitPrice,
    amount:      item.amount,
    periodStart: item.periodStart,
    periodEnd:   item.periodEnd,
  }));
}

// ─── Compute period end for a single charge ───────────────────────────────────

/**
 * Given a serviceDate and quantity (nights), return formatted period strings.
 * Returns { periodStart, periodEnd } or {} if dates are unavailable.
 */
export function computePeriod(
  serviceDate: Date | null | undefined,
  quantity:    number | null | undefined,
  chargeType:  string | null | undefined,
  safeDate:    (d: Date) => string
): { periodStart?: string; periodEnd?: string } {
  if (!serviceDate) return {};
  const start = new Date(serviceDate);
  const periodStart = safeDate(start);

  // Compute end only for ROOM / EXTRA_SERVICE charges with valid quantity
  if ((chargeType === 'ROOM') && quantity && quantity > 0) {
    const end = addDays(start, quantity);
    return { periodStart, periodEnd: safeDate(end) };
  }

  return { periodStart };
}
