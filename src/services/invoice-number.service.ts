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

// ─── Generic counter based on prefix match ──────────────────────────────────

async function nextSequence(
  tx: TxClient,
  model: 'invoice' | 'payment' | 'folio' | 'booking' | 'securityDeposit',
  field: string,
  prefix: string,
): Promise<string> {
  // Count existing records with this prefix today
  let count: number;

  switch (model) {
    case 'invoice':
      count = await tx.invoice.count({
        where: { invoiceNumber: { startsWith: prefix } },
      });
      break;
    case 'payment':
      count = await tx.payment.count({
        where: { [field]: { startsWith: prefix } } as Record<string, unknown>,
      });
      break;
    case 'folio':
      count = await tx.folio.count({
        where: { folioNumber: { startsWith: prefix } },
      });
      break;
    case 'booking': {
      // We need the MAX numeric suffix among bookings in this year, but a
      // lex-desc orderBy is unreliable: any malformed booking number (e.g.
      // a test fixture with an embedded letter like "BK-2026-T0864")
      // sorts ABOVE numeric ones because letters > digits in ASCII, so
      // findFirst returns the malformed row, parseInt yields NaN, and the
      // generator resets to 0001 -- colliding with the real first booking
      // and breaking every subsequent insert with P2002.
      //
      // Pull the candidates and parse each suffix in JS, skipping anything
      // that isn't a clean integer. The candidate set is bounded by the
      // year prefix, so this stays cheap (one cashier-year is hundreds,
      // not millions of rows).
      const rows = await tx.booking.findMany({
        where:  { bookingNumber: { startsWith: prefix + '-' } },
        select: { bookingNumber: true },
      });
      let maxSeq = 0;
      for (const r of rows) {
        const tail = r.bookingNumber.slice(prefix.length + 1);
        if (/^\d+$/.test(tail)) {
          const n = parseInt(tail, 10);
          if (n > maxSeq) maxSeq = n;
        }
      }
      count = maxSeq;
      break;
    }
    case 'securityDeposit':
      count = await tx.securityDeposit.count({
        where: { depositNumber: { startsWith: prefix } },
      });
      break;
    default:
      throw new Error(`Unknown model: ${model}`);
  }

  return `${prefix}-${pad(count + 1)}`;
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
  const count = await tx.cityLedgerPayment.count({
    where: { paymentNumber: { startsWith: prefix } },
  });
  return `${prefix}-${pad(count + 1)}`;
}

/** MNT-YYYYMM-NNNN (monthly billing — uses INV-MN now) */
export async function generateMonthlyInvoiceNumber(
  tx: TxClient,
  billingDate: Date,
): Promise<string> {
  const ym = `${billingDate.getFullYear()}${pad(billingDate.getMonth() + 1, 2)}`;
  const prefix = `INV-MN-${ym}`;
  // Count existing for this month (not just today)
  const count = await tx.invoice.count({
    where: { invoiceNumber: { startsWith: prefix } },
  });
  return `${prefix}-${pad(count + 1)}`;
}
