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
  /**
   * Phase 3 — three-mode refund picker:
   *   - cash:   pay back the full amount via cash/transfer/card
   *   - credit: keep all on guest account as credit (no money out)
   *   - split:  partial cash + remaining credit
   */
  mode: 'cash' | 'credit' | 'split';
  /** Required for mode='cash' or 'split'; ignored for 'credit'. */
  method?: PaymentMethod;
  /** For mode='split': how much paid back as cash/transfer. The rest
   *  becomes guest credit. Must be > 0 and < total amount. */
  cashAmount?: number;
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
  /** For mode='credit' / 'split' — optional expiry on the issued credit. */
  creditExpiresAt?: Date | null;
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
      id: true, guestId: true,
      bookingId: true, amount: true, source: true, status: true,
      referenceType: true, referenceId: true,
    },
  });
  if (!rec) throw new Error('REFUND_NOT_FOUND');
  if (rec.status !== RefundStatus.pending) {
    throw new Error('REFUND_ALREADY_FINALIZED');
  }

  // ── Phase 3 — Decide cash + credit split based on mode ────────────────────
  const total = Number(rec.amount);
  let cashAmt   = 0;
  let creditAmt = 0;
  if (input.mode === 'cash') {
    cashAmt   = total;
    creditAmt = 0;
    if (!input.method) throw new Error('REFUND_METHOD_REQUIRED');
  } else if (input.mode === 'credit') {
    cashAmt   = 0;
    creditAmt = total;
  } else if (input.mode === 'split') {
    if (!input.method) throw new Error('REFUND_METHOD_REQUIRED');
    if (input.cashAmount == null || input.cashAmount <= 0 || input.cashAmount >= total) {
      throw new Error('SPLIT_CASH_AMOUNT_INVALID');
    }
    cashAmt   = input.cashAmount;
    creditAmt = total - input.cashAmount;
  } else {
    throw new Error('REFUND_MODE_UNSUPPORTED');
  }

  // ── Phase B: cash refunds must come out of an OPEN session ────────────────
  let cashSessionId: string | null = null;
  if (cashAmt > 0 && input.method === 'cash') {
    if (!input.cashSessionId) throw new Error('CASH_REFUND_REQUIRES_SESSION');
    const session = await tx.cashSession.findUnique({
      where: { id: input.cashSessionId },
      select: { id: true, status: true },
    });
    if (!session || session.status !== 'OPEN') {
      throw new Error('CASH_SESSION_NOT_OPEN');
    }
    cashSessionId = session.id;
  }

  // Resolve cash/bank account (only relevant for cashAmt > 0)
  const { subKindForPaymentMethod, resolveAccount } = await import('./financialAccount.service');
  let financialAccountId: string | null = null;
  if (cashAmt > 0 && input.method) {
    try {
      const acc = await resolveAccount(tx, {
        subKind: subKindForPaymentMethod(input.method),
        explicitAccountId: input.financialAccountId ?? null,
      });
      financialAccountId = acc.id;
    } catch {
      // seed missing — keep going with null
    }
  }

  // ── Pick the original Payment to reverse against ──────────────────────────
  // Used for the kind='reversal' allocation row + Payment.refundedAmount.
  let reversesPaymentId: string | null = input.reversesPaymentId ?? null;
  if (!reversesPaymentId && rec.bookingId) {
    const candidate = await tx.payment.findFirst({
      where: { bookingId: rec.bookingId, status: 'ACTIVE' },
      orderBy: { paymentDate: 'desc' },
      select: { id: true },
    });
    reversesPaymentId = candidate?.id ?? null;
  }

  // ── Mode-specific ledger postings ─────────────────────────────────────────
  // For source='rate_adjustment' / 'cancellation' the upstream caller is
  // expected to have invoked partialVoidInvoice() FIRST, which posted
  // DR Revenue / CR AR for the voided line items. So here, the AR balance
  // is "owed back to guest" -- we close it via:
  //   cash leg:   DR AR / CR Cash|Bank
  //   credit leg: DR AR / CR GuestCreditLiability  (handled inside issueGuestCredit)
  //
  // For source='deposit' / 'overpayment' AR/Liability handling stays as-is.

  let debitForCash: LedgerAccount;
  switch (rec.source) {
    case RefundSource.deposit:        debitForCash = LedgerAccount.DEPOSIT_LIABILITY; break;
    case RefundSource.overpayment:
    case RefundSource.rate_adjustment:
    case RefundSource.cancellation:   debitForCash = LedgerAccount.AR; break;
    default: throw new Error('REFUND_SOURCE_UNSUPPORTED');
  }

  if (cashAmt > 0 && input.method) {
    const creditAccount = ['transfer', 'promptpay', 'credit_card'].includes(input.method)
      ? LedgerAccount.BANK
      : LedgerAccount.CASH;
    await postLedgerPair(tx, {
      debitAccount:    debitForCash,
      creditAccount,
      creditAccountId: financialAccountId,
      amount:          cashAmt,
      referenceType:   'RefundRecord',
      referenceId:     rec.id,
      description:     `Refund processed (${rec.source}) via ${input.method}`,
      createdBy:       input.processedBy,
    });
  }

  // Issue guest credit for the credit portion (covers mode='credit' AND
  // 'split' second leg). The service posts DR AR / CR GUEST_CREDIT_LIABILITY.
  let issuedCreditId: string | null = null;
  if (creditAmt > 0) {
    if (rec.source === RefundSource.deposit) {
      // Deposit refunds shouldn't park as guest credit by default — the
      // money was already a liability of a different type. Refuse to mix.
      throw new Error('DEPOSIT_REFUND_AS_CREDIT_NOT_SUPPORTED');
    }
    const { issueGuestCredit } = await import('./guestCredit.service');
    const credit = await issueGuestCredit(tx, {
      guestId:    rec.guestId,
      bookingId:  rec.bookingId ?? undefined,
      amount:     creditAmt,
      expiresAt:  input.creditExpiresAt ?? null,
      notes:      `From refund ${rec.id} (${rec.source})`,
      createdBy:  input.processedBy,
    });
    issuedCreditId = credit.id;
  }

  // ── Reversal allocation against the original Payment ──────────────────────
  // Without this, folio.totalPayments stays at the original amount forever
  // and balance never reflects the refund. The allocation amount is
  // NEGATIVE (the existing aggregator just sums); we pin it to the
  // first ACTIVE invoice we can find for the booking so the FK stays valid.
  if (reversesPaymentId && rec.bookingId) {
    const targetInvoice = await tx.invoice.findFirst({
      where: { bookingId: rec.bookingId },
      orderBy: { issueDate: 'asc' },
      select: { id: true },
    });
    if (targetInvoice) {
      await tx.paymentAllocation.create({
        data: {
          paymentId:      reversesPaymentId,
          invoiceId:      targetInvoice.id,
          amount:         new Prisma.Decimal(-total),
          kind:           'reversal' as never,
          refundRecordId: rec.id,
        },
      });
    }
    // Bump Payment.refundedAmount counter for "remaining reversible" lookups
    await tx.payment.update({
      where: { id: reversesPaymentId },
      data:  { refundedAmount: { increment: new Prisma.Decimal(total) } },
    });
  }

  // ── Mark refund record processed ──────────────────────────────────────────
  await tx.refundRecord.update({
    where: { id: input.refundId },
    data: {
      status:          RefundStatus.processed,
      mode:            input.mode as never,
      method:          input.method ?? null,
      cashAmount:      cashAmt   > 0 ? new Prisma.Decimal(cashAmt)   : null,
      creditAmount:    creditAmt > 0 ? new Prisma.Decimal(creditAmt) : null,
      guestCreditId:   issuedCreditId,
      bankName:        input.bankName ?? null,
      bankAccount:     input.bankAccount ?? null,
      bankAccountName: input.bankAccountName ?? null,
      notes:           input.notes ?? undefined,
      processedAt:     new Date(),
      processedBy:     input.processedBy,
      financialAccountId,
      cashSessionId,
      reversesPaymentId,
    },
  });

  // Recalc folio so the cashier-facing balance reflects the refund
  if (rec.bookingId) {
    const folio = await tx.folio.findUnique({
      where: { bookingId: rec.bookingId },
      select: { id: true },
    });
    if (folio) {
      const { recalculateFolioBalance } = await import('./folio.service');
      await recalculateFolioBalance(tx, folio.id);
    }
  }
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
