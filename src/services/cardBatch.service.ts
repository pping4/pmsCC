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

import { Prisma } from '@prisma/client';

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
}

export async function listBatches(
  tx: TxClient,
  filters: { terminalId?: string; from?: Date; to?: Date } = {},
  take = 100,
): Promise<BatchListRow[]> {
  const where: Prisma.CardBatchReportWhereInput = {};
  if (filters.terminalId) where.terminalId = filters.terminalId;
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
