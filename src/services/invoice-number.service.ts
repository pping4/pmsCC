/**
 * invoice-number.service.ts
 *
 * Centralized, sequential invoice/folio number generator.
 * Pattern: {PREFIX}-{YYYYMMDD}-{NNNN}
 *
 * All functions MUST be called inside a Prisma $transaction
 * to guarantee uniqueness under concurrent writes.
 *
 * ┌────────────┬─────────────────────────────────┐
 * │ Prefix     │ Meaning                         │
 * ├────────────┼─────────────────────────────────┤
 * │ FLO        │ Folio                           │
 * │ INV-CI     │ Invoice — Check-In stay charge  │
 * │ INV-CO     │ Invoice — Check-Out balance      │
 * │ INV-MN     │ Invoice — Monthly rent           │
 * │ INV-UT     │ Invoice — Utility                │
 * │ INV-EX     │ Invoice — Extra service          │
 * │ INV-BD     │ Invoice — Bad debt               │
 * │ INV-BK     │ Invoice — Booking prepayment     │
 * │ INV-GN     │ Invoice — General / manual       │
 * │ INV-CL     │ Invoice — City Ledger summary    │
 * │ PAY        │ Payment                          │
 * │ RCP        │ Receipt                          │
 * │ DEP        │ Security Deposit                 │
 * │ BK         │ Booking                          │
 * │ CL         │ City Ledger Account              │
 * │ CL-PAY     │ City Ledger Payment              │
 * └────────────┴─────────────────────────────────┘
 */

import { Prisma } from '@prisma/client';

type TxClient = Prisma.TransactionClient;

function pad(n: number, width = 4): string {
  return String(n).padStart(width, '0');
}

function todayPrefix(): string {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`;
}

// ─── Generic MAX-suffix sequence (gap-safe) ─────────────────────────────────
//
// Using COUNT breaks when rows have been deleted (gaps), because count=N but
// the Nth+1 slot is already taken. Instead, we read all matching numbers,
// parse the numeric suffix from each, take the MAX, and add 1.
// This is gap-safe and requires no schema change.  The candidate set is
// bounded by the daily/yearly prefix, so it stays cheap (hundreds of rows).

function maxSuffix(nums: string[], prefixWithDash: string): number {
  let max = 0;
  for (const n of nums) {
    const tail = n.slice(prefixWithDash.length);
    if (/^\d+$/.test(tail)) {
      const v = parseInt(tail, 10);
      if (v > max) max = v;
    }
  }
  return max;
}

async function nextSequence(
  tx: TxClient,
  model: 'invoice' | 'payment' | 'folio' | 'booking' | 'securityDeposit',
  field: string,
  prefix: string,
): Promise<string> {
  // prefix already ends without '-'; the stored numbers are "{prefix}-{NNNN}"
  const withDash = `${prefix}-`;
  let maxSeq = 0;

  switch (model) {
    case 'invoice': {
      const rows = await tx.invoice.findMany({
        where:  { invoiceNumber: { startsWith: withDash } },
        select: { invoiceNumber: true },
      });
      maxSeq = maxSuffix(rows.map((r) => r.invoiceNumber), withDash);
      break;
    }
    case 'payment': {
      // 'field' is either 'paymentNumber' or 'receiptNumber'
      if (field === 'paymentNumber') {
        const rows = await tx.payment.findMany({
          where:  { paymentNumber: { startsWith: withDash } },
          select: { paymentNumber: true },
        });
        maxSeq = maxSuffix(rows.map((r) => r.paymentNumber), withDash);
      } else {
        // receiptNumber — nullable on Payment, filter out nulls
        const rows = await tx.payment.findMany({
          where:  { receiptNumber: { startsWith: withDash } },
          select: { receiptNumber: true },
        });
        maxSeq = maxSuffix(rows.map((r) => r.receiptNumber ?? ''), withDash);
      }
      break;
    }
    case 'folio': {
      const rows = await tx.folio.findMany({
        where:  { folioNumber: { startsWith: withDash } },
        select: { folioNumber: true },
      });
      maxSeq = maxSuffix(rows.map((r) => r.folioNumber), withDash);
      break;
    }
    case 'booking': {
      // Bookings use prefix = "BK-YYYY" (no trailing date), pattern "BK-YYYY-NNNN".
      // The stored number is "{prefix}-{NNNN}", same shape as the others.
      const rows = await tx.booking.findMany({
        where:  { bookingNumber: { startsWith: withDash } },
        select: { bookingNumber: true },
      });
      maxSeq = maxSuffix(rows.map((r) => r.bookingNumber), withDash);
      break;
    }
    case 'securityDeposit': {
      const rows = await tx.securityDeposit.findMany({
        where:  { depositNumber: { startsWith: withDash } },
        select: { depositNumber: true },
      });
      maxSeq = maxSuffix(rows.map((r) => r.depositNumber), withDash);
      break;
    }
    default:
      throw new Error(`Unknown model: ${model}`);
  }

  return `${prefix}-${pad(maxSeq + 1)}`;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function generateFolioNumber(tx: TxClient): Promise<string> {
  const prefix = `FLO-${todayPrefix()}`;
  return nextSequence(tx, 'folio', 'folioNumber', prefix);
}

/** INV-CI-YYYYMMDD-NNNN */
export async function generateInvoiceNumber(
  tx: TxClient,
  type: 'CI' | 'CO' | 'MN' | 'UT' | 'EX' | 'BD' | 'BK' | 'GN' | 'CL',
): Promise<string> {
  const prefix = `INV-${type}-${todayPrefix()}`;
  return nextSequence(tx, 'invoice', 'invoiceNumber', prefix);
}

/** PAY-YYYYMMDD-NNNN */
export async function generatePaymentNumber(tx: TxClient): Promise<string> {
  const prefix = `PAY-${todayPrefix()}`;
  return nextSequence(tx, 'payment', 'paymentNumber', prefix);
}

/** RCP-YYYYMMDD-NNNN */
export async function generateReceiptNumber(tx: TxClient): Promise<string> {
  const prefix = `RCP-${todayPrefix()}`;
  return nextSequence(tx, 'payment', 'receiptNumber', prefix);
}

/** DEP-YYYYMMDD-NNNN */
export async function generateDepositNumber(tx: TxClient): Promise<string> {
  const prefix = `DEP-${todayPrefix()}`;
  return nextSequence(tx, 'securityDeposit', 'depositNumber', prefix);
}

/** BK-YYYY-NNNN */
export async function generateBookingNumber(tx: TxClient): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `BK-${year}`;
  return nextSequence(tx, 'booking', 'bookingNumber', prefix);
}

// ─── City Ledger Number Generators ─────────────────────────────────────────

/**
 * CL-NNNN — sequential City Ledger account code (no date, ever-increasing)
 * e.g. CL-0001, CL-0002
 */
export async function generateCLAccountCode(tx: TxClient): Promise<string> {
  const latest = await tx.cityLedgerAccount.findFirst({
    where: { accountCode: { startsWith: 'CL-' } },
    orderBy: { accountCode: 'desc' },
    select: { accountCode: true },
  });
  if (!latest) return 'CL-0001';
  const seq = parseInt(latest.accountCode.replace('CL-', ''), 10);
  return `CL-${pad(isNaN(seq) ? 1 : seq + 1)}`;
}

/**
 * CL-PAY-YYYYMMDD-NNNN — City Ledger payment number
 */
export async function generateCLPaymentNumber(tx: TxClient): Promise<string> {
  const prefix = `CL-PAY-${todayPrefix()}`;
  const withDash = `${prefix}-`;
  const rows = await tx.cityLedgerPayment.findMany({
    where:  { paymentNumber: { startsWith: withDash } },
    select: { paymentNumber: true },
  });
  const maxSeq = maxSuffix(rows.map((r) => r.paymentNumber), withDash);
  return `${prefix}-${pad(maxSeq + 1)}`;
}

/** INV-MN-YYYYMM-NNNN (monthly billing — month-scoped, gap-safe) */
export async function generateMonthlyInvoiceNumber(
  tx: TxClient,
  billingDate: Date,
): Promise<string> {
  const ym = `${billingDate.getFullYear()}${pad(billingDate.getMonth() + 1, 2)}`;
  const prefix = `INV-MN-${ym}`;
  const withDash = `${prefix}-`;
  const rows = await tx.invoice.findMany({
    where:  { invoiceNumber: { startsWith: withDash } },
    select: { invoiceNumber: true },
  });
  const maxSeq = maxSuffix(rows.map((r) => r.invoiceNumber), withDash);
  return `${prefix}-${pad(maxSeq + 1)}`;
}
