/**
 * cardBatch.service.ts — Sprint 5 Phase 5 (EDC Batch Close)
 *
 * Cashier/Night auditor presses "ส่งยอด" on the EDC terminal, then enters the
 * EDC-reported totals into the PMS. This service:
 *   1) Computes the PMS-side total from ACTIVE, non-VOIDED credit-card payments
 *      on that terminal + close-date that have **no** batchNo yet.
 *   2) Creates a CardBatchReport with the variance EDC − PMS.
 *   3) Stamps matched Payment rows with `batchNo` so the next close excludes them.
 *
 * Notes:
 *  - Single `$transaction` for atomicity. Duplicate `(terminalId, batchNo)`
 *    surfaces as Prisma P2002 → translated to 409 at the API edge.
 *  - Variance ≠ 0 is allowed — it's the signal that accounting needs to investigate.
 *  - We never mutate `reconStatus` here; clearing is Phase 7's job.
 */

import { Prisma, LedgerAccount } from '@prisma/client';
import { postLedgerPair } from './ledger.service';

type TxClient = Prisma.TransactionClient;

export interface CreateBatchInput {
  terminalId:     string;
  batchNo:        string;
  closeDate:      Date;          // already parsed to Date (YYYY-MM-DD → midnight UTC)
  edcTotalAmount: number;
  edcTxCount:     number;
  note?:          string;
  closedByUserId: string;        // session.user.id — audit trail
  closedByName?:  string | null;
}

export interface BatchPreview {
  terminalCode: string;
  pmsTotal:     number;
  pmsTxCount:   number;
  alreadyBatchedTotal: number;
  alreadyBatchedCount: number;
}

/** Inclusive [start, end) day range for a given close-date. */
function dayRange(d: Date): { start: Date; end: Date } {
  const start = new Date(d); start.setHours(0, 0, 0, 0);
  const end   = new Date(start); end.setDate(end.getDate() + 1);
  return { start, end };
}

/**
 * Preview PMS-side totals for a (terminal, closeDate) — used by the UI before
 * the user confirms the batch close.
 */
export async function previewBatch(
  tx: TxClient,
  terminalId: string,
  closeDate: Date,
): Promise<BatchPreview | null> {
  const term = await tx.edcTerminal.findUnique({
    where: { id: terminalId },
    select: { code: true },
  });
  if (!term) return null;

  const { start, end } = dayRange(closeDate);

  const unbatched = await tx.payment.aggregate({
    _sum: { amount: true }, _count: { _all: true },
    where: {
      terminalId,
      paymentMethod: 'credit_card',
      status: 'ACTIVE',
      reconStatus: { not: 'VOIDED' },
      batchNo: null,
      paymentDate: { gte: start, lt: end },
    },
  });

  const alreadyBatched = await tx.payment.aggregate({
    _sum: { amount: true }, _count: { _all: true },
    where: {
      terminalId,
      paymentMethod: 'credit_card',
      status: 'ACTIVE',
      batchNo: { not: null },
      paymentDate: { gte: start, lt: end },
    },
  });

  return {
    terminalCode: term.code,
    pmsTotal:     Number(unbatched._sum.amount ?? 0),
    pmsTxCount:   unbatched._count._all,
    alreadyBatchedTotal: Number(alreadyBatched._sum.amount ?? 0),
    alreadyBatchedCount: alreadyBatched._count._all,
  };
}

export interface CreateBatchResult {
  batch: {
    id: string;
    batchNo: string;
    terminalId: string;
    terminalCode: string;
    closeDate: Date;
    edcTotal: number;
    pmsTotal: number;
    variance: number;
    edcTxCount: number;
    pmsTxCount: number;
  };
  matchedPayments: number;
  variance: { amount: number; ok: boolean };
}

/**
 * Create a batch report and stamp all matching unbatched payments.
 *
 * Throws `Prisma.PrismaClientKnownRequestError` P2002 on duplicate
 * `(terminalId, batchNo)` — caller should translate to 409.
 */
export async function createBatch(
  tx: TxClient,
  input: CreateBatchInput,
): Promise<CreateBatchResult> {
  const term = await tx.edcTerminal.findUnique({
    where: { id: input.terminalId },
    select: { id: true, code: true },
  });
  if (!term) throw new Error('TERMINAL_NOT_FOUND');

  const { start, end } = dayRange(input.closeDate);

  // 1) Collect unbatched payment IDs for this terminal + date
  const payments = await tx.payment.findMany({
    where: {
      terminalId: input.terminalId,
      paymentMethod: 'credit_card',
      status: 'ACTIVE',
      reconStatus: { not: 'VOIDED' },
      batchNo: null,
      paymentDate: { gte: start, lt: end },
    },
    select: { id: true, amount: true },
  });

  const pmsTotal = payments.reduce((s, p) => s + Number(p.amount), 0);
  const pmsTxCount = payments.length;
  const variance = Number((input.edcTotalAmount - pmsTotal).toFixed(2));

  // 2) Create batch report (may throw P2002 on dup (terminalId, batchNo))
  const batch = await tx.cardBatchReport.create({
    data: {
      terminalId:     input.terminalId,
      batchNo:        input.batchNo,
      closeDate:      start,
      totalAmount:    input.edcTotalAmount,
      txCount:        input.edcTxCount,
      closedByUserId: input.closedByUserId,
      note:           input.note,
      varianceAmount: variance,
    },
    select: { id: true, batchNo: true, closeDate: true },
  });

  // 3) Stamp payments with batchNo
  if (payments.length > 0) {
    await tx.payment.updateMany({
      where: { id: { in: payments.map((p) => p.id) } },
      data:  { batchNo: input.batchNo },
    });
  }

  // 4) Audit log
  await tx.activityLog.create({
    data: {
      userId:   input.closedByUserId,
      userName: input.closedByName ?? null,
      action:   'CARD_BATCH_CLOSED',
      category: 'cashier',
      description: `ปิด batch ${input.batchNo} เครื่อง ${term.code} · ${pmsTxCount} รายการ · ต่าง ${variance.toFixed(2)}`,
      icon: '💳',
      severity: Math.abs(variance) < 0.01 ? 'info' : 'warning',
      metadata: {
        batchId: batch.id,
        terminalId: input.terminalId,
        terminalCode: term.code,
        batchNo: input.batchNo,
        closeDate: start.toISOString().slice(0, 10),
        edcTotal: input.edcTotalAmount,
        edcTxCount: input.edcTxCount,
        pmsTotal,
        pmsTxCount,
        variance,
      },
    },
  });

  return {
    batch: {
      id: batch.id,
      batchNo: batch.batchNo,
      terminalId: input.terminalId,
      terminalCode: term.code,
      closeDate: start,
      edcTotal: input.edcTotalAmount,
      pmsTotal,
      variance,
      edcTxCount: input.edcTxCount,
      pmsTxCount,
    },
    matchedPayments: pmsTxCount,
    variance: { amount: variance, ok: Math.abs(variance) < 0.01 },
  };
}

export interface BatchListRow {
  id: string;
  batchNo: string;
  closeDate: Date;
  totalAmount: number;
  txCount: number;
  varianceAmount: number;
  closedAt: Date;
  terminalId: string;
  terminalCode: string;
  terminalName: string;
  // Phase 5 — settlement state
  status: 'CLOSED' | 'SETTLED' | 'VOIDED';
  bankDepositAmount: number | null;
  feeAmount: number | null;
  bankReferenceNo: string | null;
  depositedAt: Date | null;
}

export async function listBatches(
  tx: TxClient,
  filters: { terminalId?: string; from?: Date; to?: Date; status?: 'CLOSED' | 'SETTLED' | 'VOIDED' } = {},
  take = 100,
): Promise<BatchListRow[]> {
  const where: Prisma.CardBatchReportWhereInput = {};
  if (filters.terminalId) where.terminalId = filters.terminalId;
  if (filters.status)     where.status     = filters.status;
  if (filters.from || filters.to) {
    where.closeDate = {};
    if (filters.from) where.closeDate.gte = filters.from;
    if (filters.to)   where.closeDate.lt  = filters.to;
  }

  const rows = await tx.cardBatchReport.findMany({
    where,
    orderBy: [{ closeDate: 'desc' }, { closedAt: 'desc' }],
    take,
    select: {
      id: true, batchNo: true, closeDate: true, totalAmount: true, txCount: true,
      varianceAmount: true, closedAt: true,
      status: true, bankDepositAmount: true, feeAmount: true,
      bankReferenceNo: true, depositedAt: true,
      terminal: { select: { id: true, code: true, name: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    batchNo: r.batchNo,
    closeDate: r.closeDate,
    totalAmount: Number(r.totalAmount),
    txCount: r.txCount,
    varianceAmount: Number(r.varianceAmount),
    closedAt: r.closedAt,
    terminalId: r.terminal.id,
    terminalCode: r.terminal.code,
    terminalName: r.terminal.name,
    status: r.status as 'CLOSED' | 'SETTLED' | 'VOIDED',
    bankDepositAmount: r.bankDepositAmount ? Number(r.bankDepositAmount) : null,
    feeAmount:         r.feeAmount         ? Number(r.feeAmount)         : null,
    bankReferenceNo:   r.bankReferenceNo,
    depositedAt:       r.depositedAt,
  }));
}

export async function getBatchDetail(tx: TxClient, id: string) {
  const batch = await tx.cardBatchReport.findUnique({
    where: { id },
    select: {
      id: true, batchNo: true, closeDate: true, totalAmount: true, txCount: true,
      varianceAmount: true, closedAt: true, closedByUserId: true, note: true,
      terminal: { select: { id: true, code: true, name: true } },
    },
  });
  if (!batch) return null;

  const payments = await tx.payment.findMany({
    where: { terminalId: batch.terminal.id, batchNo: batch.batchNo },
    select: {
      id: true, amount: true, paymentDate: true, cardBrand: true, cardLast4: true,
      authCode: true, reconStatus: true, referenceNo: true,
    },
    orderBy: { paymentDate: 'asc' },
  });

  return {
    batch: {
      ...batch,
      totalAmount:    Number(batch.totalAmount),
      varianceAmount: Number(batch.varianceAmount),
    },
    payments: payments.map((p) => ({ ...p, amount: Number(p.amount) })),
  };
}

// ─── Phase 5: Bank settlement (record incoming deposit + post ledger) ────────

export interface SettleBatchInput {
  batchId: string;
  /** Net amount the bank actually deposited (after MDR fees deducted). */
  bankDepositAmount: number;
  /** Date the bank credited the account (T+1 / T+2 typical). */
  depositedAt: Date;
  /** Optional bank-statement reference. */
  bankReferenceNo?: string;
  /** Optional bank account to credit. Defaults to the system default BANK. */
  bankAccountId?: string;
  note?: string;
  settledByUserId: string;
}

/**
 * Record a bank settlement against a CLOSED batch.
 *
 * Posts two ledger pairs so the trial balance stays clean:
 *   DR Bank             (bankDepositAmount)
 *   DR Card Fee Expense (fee = totalAmount - bankDepositAmount)
 *              CR Card Clearing   (totalAmount, split across the two pairs)
 *
 * Side effects:
 *  - CardBatchReport.status: CLOSED → SETTLED + settlement fields filled
 *  - Each Payment row in the batch flips reconStatus RECEIVED → CLEARED
 *
 * Idempotent: re-settling a SETTLED batch throws BATCH_ALREADY_SETTLED.
 */
export async function settleBatch(tx: TxClient, input: SettleBatchInput) {
  const batch = await tx.cardBatchReport.findUnique({
    where: { id: input.batchId },
    select: {
      id: true, batchNo: true, terminalId: true, totalAmount: true,
      status: true,
      terminal: { select: { code: true, clearingAccountId: true } },
    },
  });
  if (!batch) throw new Error('BATCH_NOT_FOUND');
  if (batch.status === 'SETTLED') throw new Error('BATCH_ALREADY_SETTLED');
  if (batch.status === 'VOIDED')  throw new Error('BATCH_VOIDED');

  const gross = Number(batch.totalAmount);
  const net   = Number(input.bankDepositAmount);
  if (net < 0)           throw new Error('NEGATIVE_DEPOSIT');
  if (net > gross + 0.5) throw new Error('DEPOSIT_EXCEEDS_GROSS');
  const fee = Math.max(0, Number((gross - net).toFixed(2)));

  // Resolve target FinancialAccounts.
  //  - Bank: caller can override, else default BANK account.
  //  - Card Fee: always the seeded CARD_FEE expense account (5210-01).
  //  - Card Clearing: prefer the terminal's clearing FK, else system default
  //    CARD_CLEARING account.
  const { resolveAccount } = await import('./financialAccount.service');
  const bankAcc = await resolveAccount(tx, {
    subKind: 'BANK',
    explicitAccountId: input.bankAccountId ?? null,
  });
  const feeAcc = await resolveAccount(tx, { subKind: 'CARD_FEE', explicitAccountId: null });
  const clearingAccountId = batch.terminal.clearingAccountId ?? null;

  // Post 2 pairs against the same Card Clearing CR side. Two pairs (not a
  // synthetic triple) keep us on the existing postLedgerPair contract.
  if (net > 0) {
    await postLedgerPair(tx, {
      debitAccount:    LedgerAccount.BANK,
      creditAccount:   LedgerAccount.CASH,        // legacy placeholder
      debitAccountId:  bankAcc.id,
      creditAccountId: clearingAccountId,         // overrides to Card Clearing
      amount:          net,
      referenceType:   'CardBatchReport',
      referenceId:     batch.id,
      description:     `Card batch settled (deposit) — ${batch.terminal.code} #${batch.batchNo}`,
      createdBy:       input.settledByUserId,
    });
  }
  if (fee > 0) {
    await postLedgerPair(tx, {
      debitAccount:    LedgerAccount.EXPENSE,
      creditAccount:   LedgerAccount.CASH,
      debitAccountId:  feeAcc.id,
      creditAccountId: clearingAccountId,
      amount:          fee,
      referenceType:   'CardBatchReport',
      referenceId:     batch.id,
      description:     `Card batch fee (MDR) — ${batch.terminal.code} #${batch.batchNo}`,
      createdBy:       input.settledByUserId,
    });
  }

  // Update the batch row
  const updated = await tx.cardBatchReport.update({
    where: { id: input.batchId },
    data: {
      status:            'SETTLED',
      bankDepositAmount: new Prisma.Decimal(net),
      feeAmount:         new Prisma.Decimal(fee),
      bankAccountId:     bankAcc.id,
      bankReferenceNo:   input.bankReferenceNo ?? null,
      depositedAt:       input.depositedAt,
      settledByUserId:   input.settledByUserId,
      settledAt:         new Date(),
      note:              input.note ?? undefined,
    },
    select: { id: true, batchNo: true, status: true },
  });

  // Flip every payment in the batch from RECEIVED to CLEARED so /finance
  // pendingRecon counters drop.
  const cleared = await tx.payment.updateMany({
    where: {
      terminalId:  batch.terminalId,
      batchNo:     batch.batchNo,
      reconStatus: 'RECEIVED' as never,
    },
    data: {
      reconStatus: 'CLEARED' as never,
      clearedAt:   new Date(),
      clearedBy:   input.settledByUserId,
    },
  });

  return {
    batch: updated,
    netDeposit:   net,
    fee,
    clearedCount: cleared.count,
  };
}

// ─── Phase 6.6: Void a batch (undo close — or undo settlement) ──────────────

export interface VoidBatchInput {
  batchId:        string;
  reason:         string;
  voidedByUserId: string;
}

export interface VoidBatchResult {
  batch:           { id: string; batchNo: string; status: 'VOIDED' };
  reversedLedger:  boolean;      // true if the batch was SETTLED before void
  unstampedCount:  number;       // payments whose batchNo cleared
  resetReconCount: number;       // payments whose reconStatus flipped back
  netDeposit:      number;       // 0 when no ledger to reverse
  fee:             number;
}

/**
 * Void a CardBatchReport.
 *
 *   CLOSED  → VOIDED : free the payments so they can be batched again
 *                       (no ledger movement happened on close).
 *   SETTLED → VOIDED : reverse both ledger pairs from settleBatch AND
 *                       free the payments (reconStatus CLEARED→RECEIVED,
 *                       batchNo cleared). The reversal posts mirror pairs
 *                       so the trial balance returns to pre-settlement
 *                       state.
 *
 * VOIDED is terminal — calling voidBatch on a VOIDED batch is a 409.
 *
 * Security: caller (route handler) MUST enforce admin-only. This service
 * does not check roles.
 */
export async function voidBatch(
  tx: TxClient,
  input: VoidBatchInput,
): Promise<VoidBatchResult> {
  const batch = await tx.cardBatchReport.findUnique({
    where: { id: input.batchId },
    select: {
      id: true, batchNo: true, terminalId: true, totalAmount: true,
      status: true, bankDepositAmount: true, feeAmount: true,
      bankAccountId: true,
      terminal: { select: { code: true, clearingAccountId: true } },
    },
  });
  if (!batch) throw new Error('BATCH_NOT_FOUND');
  if (batch.status === 'VOIDED') throw new Error('BATCH_ALREADY_VOIDED');

  const wasSettled = batch.status === 'SETTLED';
  const net = wasSettled ? Number(batch.bankDepositAmount ?? 0) : 0;
  const fee = wasSettled ? Number(batch.feeAmount ?? 0)         : 0;

  // 1) Reverse the settlement ledger pairs (mirror of settleBatch).
  //    DR Card Clearing / CR Bank   for the net
  //    DR Card Clearing / CR Card Fee for the fee
  //    These two together undo the original pair-of-pairs cleanly.
  if (wasSettled && (net > 0 || fee > 0)) {
    const { resolveAccount } = await import('./financialAccount.service');
    const clearingAccountId = batch.terminal.clearingAccountId ?? null;
    if (net > 0) {
      const bankAccId = batch.bankAccountId ??
        (await resolveAccount(tx, { subKind: 'BANK', explicitAccountId: null })).id;
      await postLedgerPair(tx, {
        debitAccount:    LedgerAccount.BANK,    // legacy placeholder for clearing
        creditAccount:   LedgerAccount.BANK,
        debitAccountId:  clearingAccountId,
        creditAccountId: bankAccId,
        amount:          net,
        referenceType:   'CardBatchReport',
        referenceId:     batch.id,
        description:     `Card batch VOID — reverse deposit · ${batch.terminal.code} #${batch.batchNo} — ${input.reason}`,
        createdBy:       input.voidedByUserId,
      });
    }
    if (fee > 0) {
      const feeAcc = await resolveAccount(tx, { subKind: 'CARD_FEE', explicitAccountId: null });
      await postLedgerPair(tx, {
        debitAccount:    LedgerAccount.BANK,    // legacy placeholder for clearing
        creditAccount:   LedgerAccount.EXPENSE,
        debitAccountId:  clearingAccountId,
        creditAccountId: feeAcc.id,
        amount:          fee,
        referenceType:   'CardBatchReport',
        referenceId:     batch.id,
        description:     `Card batch VOID — reverse fee · ${batch.terminal.code} #${batch.batchNo} — ${input.reason}`,
        createdBy:       input.voidedByUserId,
      });
    }
  }

  // 2) Reset Payment rows. We must flip reconStatus BEFORE clearing
  //    batchNo, otherwise the WHERE matcher in the second updateMany has
  //    nothing to find.
  let resetRecon = 0;
  if (wasSettled) {
    const r = await tx.payment.updateMany({
      where: {
        terminalId:  batch.terminalId,
        batchNo:     batch.batchNo,
        reconStatus: 'CLEARED' as never,
      },
      data: {
        reconStatus: 'RECEIVED' as never,
        clearedAt:   null,
        clearedBy:   null,
      },
    });
    resetRecon = r.count;
  }
  // Unstamp batchNo so the payments are eligible for a new (corrected) batch.
  const unstamp = await tx.payment.updateMany({
    where: {
      terminalId: batch.terminalId,
      batchNo:    batch.batchNo,
    },
    data: { batchNo: null },
  });

  // 3) Flip the batch to VOIDED.
  const updated = await tx.cardBatchReport.update({
    where: { id: input.batchId },
    data: {
      status: 'VOIDED',
      note:   input.reason,
    },
    select: { id: true, batchNo: true, status: true },
  });

  // 4) Audit log
  await tx.activityLog.create({
    data: {
      userId:   input.voidedByUserId,
      action:   'CARD_BATCH_VOIDED',
      category: 'cashier',
      description: `VOID batch ${batch.batchNo} เครื่อง ${batch.terminal.code} — ${input.reason}`,
      icon: '🚫',
      severity: 'warning',
      metadata: {
        batchId:      batch.id,
        batchNo:      batch.batchNo,
        wasSettled,
        netDeposit:   net,
        fee,
        unstamped:    unstamp.count,
        resetRecon,
      },
    },
  });

  return {
    batch:           updated as { id: string; batchNo: string; status: 'VOIDED' },
    reversedLedger:  wasSettled,
    unstampedCount:  unstamp.count,
    resetReconCount: resetRecon,
    netDeposit:      net,
    fee,
  };
}
