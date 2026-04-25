/**
 * refund.service.ts
 *
 * Refund lifecycle: PENDING → PROCESSED (or CANCELLED).
 *
 * Pattern mirrors SecurityDeposit:
 *  - createPendingRefund(tx, ...)  → inserts a RefundRecord (status=pending).
 *    No ledger post yet — cash hasn't moved. The record is the audit trail
 *    saying "we owe this guest X THB for reason Y".
 *  - processRefund(tx, ...)        → marks PROCESSED and posts the ledger
 *    pair (reverses the original receipt): DEBIT source liability / CREDIT Cash|Bank.
 *
 * Must be called inside a Prisma $transaction.
 */

import { Prisma, PaymentMethod, RefundSource, RefundStatus, LedgerAccount } from '@prisma/client';
import { postLedgerPair } from './ledger.service';

type TxClient = Prisma.TransactionClient;

function pad(n: number, width = 4): string {
  return String(n).padStart(width, '0');
}

function todayPrefix(): string {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`;
}

async function generateRefundNumber(tx: TxClient): Promise<string> {
  const prefix = `RFD-${todayPrefix()}-`;
  const count = await tx.refundRecord.count({
    where: { refundNumber: { startsWith: prefix } },
  });
  return `${prefix}${pad(count + 1)}`;
}

export interface CreatePendingRefundInput {
  bookingId: string;
  guestId: string;
  amount: Prisma.Decimal | number;
  source: RefundSource;
  reason: string;
  referenceType?: string;
  referenceId?: string;
  notes?: string;
  createdBy: string;
}

export interface CreatePendingRefundResult {
  refundId: string;
  refundNumber: string;
}

/**
 * Create a pending refund record (no ledger impact).
 * The actual cash-out + ledger post happens later via processRefund().
 */
export async function createPendingRefund(
  tx: TxClient,
  input: CreatePendingRefundInput,
): Promise<CreatePendingRefundResult> {
  const refundNumber = await generateRefundNumber(tx);
  const amount = new Prisma.Decimal(String(input.amount));

  if (amount.lessThanOrEqualTo(0)) {
    throw new Error('REFUND_AMOUNT_INVALID');
  }

  const rec = await tx.refundRecord.create({
    data: {
      refundNumber,
      bookingId: input.bookingId,
      guestId: input.guestId,
      amount,
      source: input.source,
      reason: input.reason,
      status: RefundStatus.pending,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      notes: input.notes ?? null,
      createdBy: input.createdBy,
    },
    select: { id: true, refundNumber: true },
  });

  return { refundId: rec.id, refundNumber: rec.refundNumber };
}

export interface ProcessRefundInput {
  refundId: string;
  method: PaymentMethod;
  bankName?: string;
  bankAccount?: string;
  bankAccountName?: string;
  notes?: string;
  processedBy: string;
  // Phase A (optional): explicit FinancialAccount to pay from. If omitted,
  // resolver picks the system default for the method's subKind.
  financialAccountId?: string;
  // Phase B: required when method = 'cash' — which session paid the cash out.
  // Enforced so shift close can reconcile. For other methods, leave undefined.
  cashSessionId?: string;
  // Phase B (optional): link to the original payment being reversed. If not
  // provided we auto-pick the most recent ACTIVE payment on the booking
  // whose remaining balance can absorb the refund.
  reversesPaymentId?: string;
}

/**
 * Mark refund as processed AND post the ledger pair.
 *
 * Ledger direction depends on source:
 *  - deposit          → DEBIT DEPOSIT_LIABILITY / CREDIT Cash|Bank
 *  - overpayment      → DEBIT AR               / CREDIT Cash|Bank  (we owed the guest back)
 *  - rate_adjustment  → DEBIT REVENUE          / CREDIT Cash|Bank  (reverse revenue)
 *  - cancellation     → DEBIT REVENUE          / CREDIT Cash|Bank  (reverse revenue)
 */
export async function processRefund(
  tx: TxClient,
  input: ProcessRefundInput,
): Promise<void> {
  const rec = await tx.refundRecord.findUnique({
    where: { id: input.refundId },
    select: {
      id: true,
      bookingId: true,
      amount: true,
      source: true,
      status: true,
      referenceType: true,
      referenceId: true,
    },
  });

  if (!rec) throw new Error('REFUND_NOT_FOUND');
  if (rec.status !== RefundStatus.pending) {
    throw new Error('REFUND_ALREADY_FINALIZED');
  }

  // ── Phase B: cash refunds must come out of an OPEN session ─────────────────
  let cashSessionId: string | null = null;
  if (input.method === 'cash') {
    if (!input.cashSessionId) {
      throw new Error('CASH_REFUND_REQUIRES_SESSION');
    }
    const session = await tx.cashSession.findUnique({
      where: { id: input.cashSessionId },
      select: { id: true, status: true },
    });
    if (!session || session.status !== 'OPEN') {
      throw new Error('CASH_SESSION_NOT_OPEN');
    }
    cashSessionId = session.id;
  }

  const creditAccount = ['transfer', 'promptpay', 'credit_card'].includes(input.method)
    ? LedgerAccount.BANK
    : LedgerAccount.CASH;

  let debitAccount: LedgerAccount;
  switch (rec.source) {
    case RefundSource.deposit:
      debitAccount = LedgerAccount.DEPOSIT_LIABILITY;
      break;
    case RefundSource.overpayment:
      debitAccount = LedgerAccount.AR;
      break;
    case RefundSource.rate_adjustment:
    case RefundSource.cancellation:
      debitAccount = LedgerAccount.REVENUE;
      break;
    default:
      throw new Error('REFUND_SOURCE_UNSUPPORTED');
  }

  // Phase A: resolve which physical FinancialAccount the money comes out of.
  const { subKindForPaymentMethod, resolveAccount } = await import('./financialAccount.service');
  let financialAccountId: string | null = null;
  try {
    const acc = await resolveAccount(tx, {
      subKind: subKindForPaymentMethod(input.method),
      explicitAccountId: input.financialAccountId ?? null,
    });
    financialAccountId = acc.id;
  } catch {
    // seed missing — keep processing, accountId stays null and can be backfilled
  }

  // ── Phase B: link to the original Payment this refund reverses ─────────────
  // Priority: caller-provided id > most recent ACTIVE payment on the booking.
  // Does NOT void the Payment — a Payment that was received is historical fact.
  // The link is purely for traceability; net-cash reporting uses the ledger.
  let reversesPaymentId: string | null = input.reversesPaymentId ?? null;
  if (!reversesPaymentId && rec.bookingId) {
    const candidate = await tx.payment.findFirst({
      where: { bookingId: rec.bookingId, status: 'ACTIVE' },
      orderBy: { paymentDate: 'desc' },
      select: { id: true },
    });
    reversesPaymentId = candidate?.id ?? null;
  }

  await tx.refundRecord.update({
    where: { id: input.refundId },
    data: {
      status: RefundStatus.processed,
      method: input.method,
      bankName: input.bankName ?? null,
      bankAccount: input.bankAccount ?? null,
      bankAccountName: input.bankAccountName ?? null,
      notes: input.notes ?? undefined,
      processedAt: new Date(),
      processedBy: input.processedBy,
      financialAccountId,
      cashSessionId,
      reversesPaymentId,
    },
  });

  await postLedgerPair(tx, {
    debitAccount,
    creditAccount,
    creditAccountId: financialAccountId, // stamp chosen account on the CR leg
    amount: rec.amount,
    referenceType: 'RefundRecord',
    referenceId: rec.id,
    description: `Refund processed (${rec.source}) via ${input.method}`,
    createdBy: input.processedBy,
  });
}

/**
 * Cancel a pending refund (e.g. user changed mind, or refund was consolidated).
 */
export async function cancelPendingRefund(
  tx: TxClient,
  input: { refundId: string; reason: string; cancelledBy: string },
): Promise<void> {
  const rec = await tx.refundRecord.findUnique({
    where: { id: input.refundId },
    select: { status: true },
  });

  if (!rec) throw new Error('REFUND_NOT_FOUND');
  if (rec.status !== RefundStatus.pending) {
    throw new Error('REFUND_ALREADY_FINALIZED');
  }

  await tx.refundRecord.update({
    where: { id: input.refundId },
    data: {
      status: RefundStatus.cancelled,
      notes: input.reason,
      processedAt: new Date(),
      processedBy: input.cancelledBy,
    },
  });
}
