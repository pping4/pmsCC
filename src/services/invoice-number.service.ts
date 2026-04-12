/**
 * invoice-number.service.ts
 *
 * Centralized, sequential invoice/folio number generator.
 * Pattern: {PREFIX}-{YYYYMMDD}-{NNNN}
 *
 * All functions MUST be called inside a Prisma $transaction
 * to guarantee uniqueness under concurrent writes.
 *
 * ┌───────────┬─────────────────────────────────┐
 * │ Prefix    │ Meaning                         │
 * ├───────────┼─────────────────────────────────┤
 * │ FLO       │ Folio                           │
 * │ INV-CI    │ Invoice — Check-In stay charge  │
 * │ INV-CO    │ Invoice — Check-Out balance      │
 * │ INV-MN    │ Invoice — Monthly rent           │
 * │ INV-UT    │ Invoice — Utility                │
 * │ INV-EX    │ Invoice — Extra service          │
 * │ INV-BD    │ Invoice — Bad debt               │
 * │ INV-BK    │ Invoice — Booking prepayment     │
 * │ INV-GN    │ Invoice — General / manual       │
 * │ PAY       │ Payment                          │
 * │ RCP       │ Receipt                          │
 * │ DEP       │ Security Deposit                 │
 * │ BK        │ Booking                          │
 * └───────────┴─────────────────────────────────┘
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
      // Use MAX-based approach (not COUNT) to handle gaps in sequence.
      // e.g. if BK-2026-0006..0009 were created with old format,
      // count() would return 65 and generate BK-2026-0066 which already exists.
      // findFirst + orderBy desc gives the true highest number.
      const latest = await tx.booking.findFirst({
        where: { bookingNumber: { startsWith: prefix + '-' } },
        orderBy: { bookingNumber: 'desc' },
        select: { bookingNumber: true },
      });
      if (!latest) {
        count = 0;
      } else {
        // "BK-2026-0069" → split by '-' → last part → 69
        const parts = latest.bookingNumber.split('-');
        const seq = parseInt(parts[parts.length - 1], 10);
        count = isNaN(seq) ? 0 : seq;
      }
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
  type: 'CI' | 'CO' | 'MN' | 'UT' | 'EX' | 'BD' | 'BK' | 'GN',
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
