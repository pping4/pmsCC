/**
 * fiscalPeriod.service.ts — Phase E
 *
 * One lookup: is the calendar month of `date` CLOSED?
 *   • If CLOSED → throw PERIOD_CLOSED (postLedgerPair refuses to write)
 *   • If OPEN or not found → permitted (missing row = implicitly OPEN)
 *
 * Why a guard inside postLedgerPair instead of at each call-site:
 *   postLedgerPair is the only entry into the ledger, so a single assert here
 *   protects every posting path (payments, refunds, transfers, deposits, CL).
 *
 * Close / reopen flow lives in the API route — services only enforce and query.
 */

import { Prisma, FiscalPeriodStatus } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export class PeriodClosedError extends Error {
  year: number; month: number;
  constructor(year: number, month: number) {
    super(`PERIOD_CLOSED: งวด ${year}-${String(month).padStart(2, '0')} ปิดบัญชีแล้ว — ไม่สามารถบันทึกย้อนหลังได้`);
    this.name = 'PeriodClosedError';
    this.year = year; this.month = month;
  }
}

/** Throws PeriodClosedError if the calendar month containing `date` is CLOSED. */
export async function assertPeriodOpen(tx: Tx, date: Date): Promise<void> {
  const year  = date.getFullYear();
  const month = date.getMonth() + 1;
  // Defensive: if the Prisma client hasn't been regenerated yet (model
  // missing at runtime) or the migration hasn't been applied (table missing),
  // silently allow the posting. Same additive pattern used elsewhere —
  // a posting must never be blocked by infra drift.
  const model = (tx as unknown as { fiscalPeriod?: { findUnique: typeof tx.fiscalPeriod.findUnique } }).fiscalPeriod;
  if (!model) return;
  let row: { status: FiscalPeriodStatus } | null = null;
  try {
    row = await model.findUnique({
      where: { year_month: { year, month } },
      select: { status: true },
    });
  } catch {
    // Table does not exist yet (migration not deployed) — permit posting.
    return;
  }
  if (row?.status === FiscalPeriodStatus.CLOSED) {
    throw new PeriodClosedError(year, month);
  }
}

/** Quick read-only check — returns status or 'OPEN' if row absent. */
export async function getPeriodStatus(
  tx: Tx | Prisma.PrismaClient,
  year: number,
  month: number,
): Promise<FiscalPeriodStatus> {
  const row = await tx.fiscalPeriod.findUnique({
    where: { year_month: { year, month } },
    select: { status: true },
  });
  return row?.status ?? FiscalPeriodStatus.OPEN;
}
