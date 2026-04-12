/**
 * billing.service.ts
 *
 * Core billing engine for monthly tenants.
 *
 * Responsibilities:
 *  1. Pro-rated calculation  — when guest checks in / out mid-month
 *  2. Full-month invoice generation — for active monthly bookings
 *  3. Late penalty calculation & ledger posting
 *  4. Idempotency — detect if this billing cycle already has an invoice
 *
 * Security checklist (CLAUDE.md):
 * ✅ All functions accept TxClient → called inside $transaction
 * ✅ select used — no full model leaks
 * ✅ Business rules enforced server-side (not trust client)
 */

import { Prisma, InvoiceType, LedgerAccount } from '@prisma/client';
import { postLedgerPair } from './ledger.service';
import { getFolioByBookingId, addCharge, createInvoiceFromFolio } from './folio.service';
import { generateMonthlyInvoiceNumber as genStandardMNNumber } from './invoice-number.service';

type TxClient = Prisma.TransactionClient;

// ─── Thai month labels ─────────────────────────────────────────────────────────

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน',
  'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม',
  'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

export function thaiMonthLabel(date: Date): string {
  return `${THAI_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

/** Next month's billing date from a given anchor day */
export function nextBillingDate(checkInDate: Date, referenceDate: Date): Date {
  const billingDay = checkInDate.getDate();
  const year       = referenceDate.getFullYear();
  const month      = referenceDate.getMonth();
  const dim        = daysInMonth(year, month);
  return new Date(year, month, Math.min(billingDay, dim));
}

// ─── Pro-rated calculation ─────────────────────────────────────────────────────

export interface ProRatedResult {
  /** Full monthly rate (รายเดือน) */
  monthlyRate: number;
  /** Pro-rated amount for the partial period */
  proratedAmount: number;
  /** Number of days in this partial period */
  days: number;
  /** Total days in the month */
  totalDays: number;
  /** Billing period: start date */
  periodStart: Date;
  /** Billing period: end date */
  periodEnd: Date;
}

/**
 * Calculate pro-rated rent for check-in or check-out mid-month.
 *
 * @param monthlyRate  Full monthly rate (e.g. 8,000 THB/month)
 * @param periodStart  First day to charge (inclusive) — usually checkIn date
 * @param periodEnd    Last day to charge (inclusive) — usually end of month or checkOut
 */
export function calcProRated(
  monthlyRate: number,
  periodStart: Date,
  periodEnd: Date
): ProRatedResult {
  const year     = periodStart.getFullYear();
  const month    = periodStart.getMonth();
  const total    = daysInMonth(year, month);
  const days     = Math.max(
    1,
    Math.round((periodEnd.getTime() - periodStart.getTime()) / 86_400_000) + 1
  );
  const amount   = Math.round((monthlyRate / total) * days * 100) / 100;

  return {
    monthlyRate,
    proratedAmount: amount,
    days,
    totalDays: total,
    periodStart,
    periodEnd,
  };
}

// ─── Invoice number generator ──────────────────────────────────────────────────
// Uses standardized numbering from invoice-number.service.ts (INV-MN-YYYYMM-NNNN)

async function generateMonthlyInvoiceNumber(
  tx: TxClient,
  billingDate: Date
): Promise<string> {
  return genStandardMNNumber(tx, billingDate);
}

async function generatePenaltyInvoiceNumber(tx: TxClient): Promise<string> {
  const now    = new Date();
  const prefix = `PEN-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const count  = await tx.invoice.count({
    where: { invoiceNumber: { startsWith: prefix } },
  });
  return `${prefix}-${String(count + 1).padStart(4, '0')}`;
}

// ─── Generate monthly invoice for ONE booking ──────────────────────────────────

export interface GenerateMonthlyInvoiceInput {
  bookingId:    string;
  guestId:      string;
  roomNumber:   string;
  bookingType:  string;
  monthlyRate:  number;
  checkInDate:  Date;          // original check-in date (for billing day anchor)
  billingDate:  Date;          // the billing date for this cycle (1st of month or anniversary)
  dueDate?:     Date;          // defaults to billingDate + 7 days
  proRated?:    boolean;       // is this a partial-month invoice?
  periodStart:  Date;
  periodEnd:    Date;
  createdBy:    string;
  notes?:       string;
}

/**
 * Creates a monthly invoice for one booking.
 * Idempotency: caller must check for existing invoice before calling.
 *
 * If the booking has a Folio, uses FolioLineItem lock mechanism
 * to prevent double-billing. Falls back to direct invoice creation
 * for legacy bookings without a Folio.
 */
export async function generateMonthlyInvoice(
  tx: TxClient,
  input: GenerateMonthlyInvoiceInput
): Promise<{ invoiceId: string; invoiceNumber: string; amount: number }> {
  const billingDate = input.billingDate;

  // Compute amount (full or pro-rated)
  let amount: number;
  let description: string;

  if (input.proRated) {
    const pr = calcProRated(input.monthlyRate, input.periodStart, input.periodEnd);
    amount      = pr.proratedAmount;
    description = `ค่าห้องพัก (pro-rated ${pr.days}/${pr.totalDays} วัน) — ห้อง ${input.roomNumber}`;
  } else {
    amount      = input.monthlyRate;
    description = `ค่าห้องพักประจำเดือน${thaiMonthLabel(billingDate)} — ห้อง ${input.roomNumber}`;
  }

  const dueDate     = input.dueDate ?? new Date(billingDate.getTime() + 7 * 86_400_000);
  const periodLabel = thaiMonthLabel(billingDate);

  // ★ Try Folio-centric flow first ★
  const folio = await getFolioByBookingId(tx, input.bookingId);

  if (folio) {
    // Add charge to Folio → create invoice from unbilled items
    await addCharge(tx, {
      folioId: folio.folioId,
      chargeType: 'ROOM',
      description,
      amount,
      serviceDate: input.periodStart,
      referenceType: 'monthly_billing',
      referenceId: `${input.bookingId}-${billingDate.getFullYear()}${String(billingDate.getMonth() + 1).padStart(2, '0')}`,
      notes: input.notes ?? `ค่าห้องพัก${periodLabel} ห้อง ${input.roomNumber}`,
      createdBy: input.createdBy,
    });

    const invResult = await createInvoiceFromFolio(tx, {
      folioId: folio.folioId,
      guestId: input.guestId,
      bookingId: input.bookingId,
      invoiceType: 'MN',
      dueDate,
      billingPeriodStart: input.periodStart,
      billingPeriodEnd: input.periodEnd,
      notes: input.notes ?? `ค่าห้องพัก${periodLabel} ห้อง ${input.roomNumber}`,
      createdBy: input.createdBy,
    });

    if (!invResult) {
      // Zero-balance: all items already billed — skip
      throw new Error(`ไม่มีรายการที่ยังไม่ออกบิล — ห้อง ${input.roomNumber} เดือน${periodLabel}`);
    }

    return {
      invoiceId:     invResult.invoiceId,
      invoiceNumber: invResult.invoiceNumber,
      amount:        invResult.grandTotal,
    };
  }

  // ── Fallback: legacy flow for bookings without Folio ────────────────────
  const invoiceNumber = await generateMonthlyInvoiceNumber(tx, billingDate);

  const invoice = await tx.invoice.create({
    data: {
      invoiceNumber,
      bookingId:          input.bookingId,
      guestId:            input.guestId,
      issueDate:          billingDate,
      dueDate,
      invoiceType:        InvoiceType.monthly_rent,
      subtotal:           amount,
      vatAmount:          0,
      grandTotal:         amount,
      paidAmount:         0,
      status:             'unpaid',
      billingPeriodStart: input.periodStart,
      billingPeriodEnd:   input.periodEnd,
      createdBy:          input.createdBy,
      notes:              input.notes ?? `ค่าห้องพัก${periodLabel} ห้อง ${input.roomNumber}`,
      items: {
        create: [{
          description,
          amount,
          taxType: 'no_tax',
        }],
      },
    },
    select: { id: true, invoiceNumber: true, grandTotal: true },
  });

  // Post ledger: DEBIT AR / CREDIT Revenue (accrual)
  await postLedgerPair(tx, {
    debitAccount:  LedgerAccount.AR,
    creditAccount: LedgerAccount.REVENUE,
    amount,
    referenceType: 'Invoice',
    referenceId:   invoice.id,
    description:   `Accrued monthly rent — ${input.roomNumber} ${periodLabel}`,
    createdBy:     input.createdBy,
  });

  return {
    invoiceId:     invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    amount,
  };
}

// ─── Late Penalty ──────────────────────────────────────────────────────────────

export interface ApplyLatePenaltyInput {
  invoiceId:     string;
  penaltyAmount: number;          // fixed amount or calculated outside
  penaltyReason: string;
  createdBy:     string;
}

/**
 * Add late penalty to an existing unpaid/overdue invoice.
 * Updates `latePenalty` and `grandTotal` then posts ledger entry.
 */
export async function applyLatePenalty(
  tx: TxClient,
  input: ApplyLatePenaltyInput
): Promise<{ invoiceId: string; newGrandTotal: number }> {
  const invoice = await tx.invoice.findUnique({
    where:  { id: input.invoiceId },
    select: { id: true, grandTotal: true, latePenalty: true, status: true, guestId: true, bookingId: true },
  });

  if (!invoice) throw new Error(`Invoice ${input.invoiceId} not found`);
  if (invoice.status === 'paid' || invoice.status === 'voided' || invoice.status === 'cancelled') {
    throw new Error(`ไม่สามารถเพิ่มค่าปรับ — invoice status: ${invoice.status}`);
  }

  const currentPenalty = Number(invoice.latePenalty);
  const newPenalty     = currentPenalty + input.penaltyAmount;
  const currentTotal   = Number(invoice.grandTotal);
  const newTotal       = currentTotal + input.penaltyAmount;

  // Update invoice
  await tx.invoice.update({
    where: { id: input.invoiceId },
    data: {
      latePenalty: new Prisma.Decimal(newPenalty),
      grandTotal:  new Prisma.Decimal(newTotal),
    },
  });

  // Post ledger: DEBIT AR (more receivable) / CREDIT Penalty Revenue
  await postLedgerPair(tx, {
    debitAccount:  LedgerAccount.AR,
    creditAccount: LedgerAccount.PENALTY_REVENUE,
    amount:        input.penaltyAmount,
    referenceType: 'Invoice',
    referenceId:   input.invoiceId,
    description:   `Late penalty — ${input.penaltyReason}`,
    createdBy:     input.createdBy,
  });

  return { invoiceId: input.invoiceId, newGrandTotal: newTotal };
}

// ─── Calculate penalty for overdue invoices ────────────────────────────────────

export interface PenaltyCalculation {
  invoiceId:      string;
  invoiceNumber:  string;
  daysOverdue:    number;
  originalAmount: number;
  penaltyRate:    number;    // % per day (e.g. 0.05 = 5% per month / 30 days)
  penaltyAmount:  number;
  alreadyPenalised: boolean; // has latePenalty > 0 already?
}

/**
 * Calculate what penalties would be for a list of overdue invoices.
 * Does NOT write to DB — use applyLatePenalty for that.
 *
 * @param dailyPenaltyRate  e.g. 0.001667 = 5%/month / 30 days
 */
export function calculatePenalties(
  invoices: Array<{
    id: string;
    invoiceNumber: string;
    grandTotal: number;
    latePenalty: number;
    dueDate: Date;
  }>,
  dailyPenaltyRate: number
): PenaltyCalculation[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return invoices.map((inv) => {
    const due = new Date(inv.dueDate);
    due.setHours(0, 0, 0, 0);
    const daysOverdue = Math.max(0, Math.floor((today.getTime() - due.getTime()) / 86_400_000));
    const originalAmount = Number(inv.grandTotal) - Number(inv.latePenalty);
    const penaltyAmount  = Math.round(originalAmount * dailyPenaltyRate * daysOverdue * 100) / 100;

    return {
      invoiceId:      inv.id,
      invoiceNumber:  inv.invoiceNumber,
      daysOverdue,
      originalAmount,
      penaltyRate:    dailyPenaltyRate,
      penaltyAmount,
      alreadyPenalised: Number(inv.latePenalty) > 0,
    };
  });
}

// ─── Contract Renewal ─────────────────────────────────────────────────────────

export interface RenewContractInput {
  bookingId:      string;
  /** New check-out date (the new contract end) */
  newCheckOut:    Date;
  /** New monthly rate (optional — keep existing if not provided) */
  newRate?:       number;
  /** New notes */
  notes?:         string;
  renewedBy:      string;
  renewedByName?: string;
}

export interface RenewContractResult {
  bookingId:    string;
  oldCheckOut:  Date;
  newCheckOut:  Date;
  newRate:      number;
}

/**
 * Extends a booking's checkOut date (contract renewal).
 * Optionally updates the rate for the new period.
 * Does NOT generate the first invoice of the new period — that is done
 * by the monthly billing cycle.
 */
export async function renewContract(
  tx: TxClient,
  input: RenewContractInput
): Promise<RenewContractResult> {
  const booking = await tx.booking.findUnique({
    where:  { id: input.bookingId },
    select: { id: true, checkOut: true, rate: true, status: true, bookingType: true },
  });

  if (!booking) throw new Error('ไม่พบข้อมูลการจอง');
  if (booking.status !== 'checked_in') {
    throw new Error('ต่อสัญญาได้เฉพาะผู้เช่าที่ check-in อยู่เท่านั้น');
  }
  if (booking.bookingType === 'daily') {
    throw new Error('การจองรายวันไม่รองรับการต่อสัญญา — ใช้การจองใหม่แทน');
  }

  const oldCheckOut = booking.checkOut;
  const newRate     = input.newRate ?? Number(booking.rate);

  if (input.newCheckOut <= oldCheckOut) {
    throw new Error('วันสิ้นสุดสัญญาใหม่ต้องมากกว่าวันเดิม');
  }

  await tx.booking.update({
    where: { id: input.bookingId },
    data: {
      checkOut:  input.newCheckOut,
      rate:      new Prisma.Decimal(newRate),
      ...(input.notes && { notes: input.notes }),
    },
  });

  return {
    bookingId:   input.bookingId,
    oldCheckOut,
    newCheckOut: input.newCheckOut,
    newRate,
  };
}
