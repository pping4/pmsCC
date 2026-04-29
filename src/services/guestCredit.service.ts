/**
 * guestCredit.service.ts — Phase 3
 *
 * เครดิตคงเหลือของลูกค้า (Guest Credit Liability)
 *
 * When a refund is taken as `credit` (or the credit portion of `split`),
 * the hotel still holds the money — it's a liability. The accounting:
 *
 *   At issue (refund processing):
 *     DR AR                        / CR GUEST_CREDIT_LIABILITY
 *     (AR was just debited by partialVoidInvoice; this clears it again
 *      and parks the obligation as a liability)
 *
 *   At consumption (next booking applies the credit):
 *     DR GUEST_CREDIT_LIABILITY    / CR AR
 *     (releases the liability, marks the new invoice partially paid via
 *      a kind='credit' PaymentAllocation row)
 *
 *   At cash-out (guest later asks for the credit as cash):
 *     DR GUEST_CREDIT_LIABILITY    / CR CASH|BANK
 *     (treats the same as a fresh refund pulling from the credit balance)
 */

import { Prisma, LedgerAccount, GuestCreditStatus } from '@prisma/client';
import { postLedgerPair } from './ledger.service';

type TxClient = Prisma.TransactionClient;

function pad(n: number, w = 4): string { return String(n).padStart(w, '0'); }
function todayPrefix(): string {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`;
}

async function generateCreditNumber(tx: TxClient): Promise<string> {
  const prefix = `GC-${todayPrefix()}`;
  const count = await tx.guestCredit.count({
    where: { creditNumber: { startsWith: prefix } },
  });
  return `${prefix}-${pad(count + 1)}`;
}

// ─── Issue (called from refund processing) ───────────────────────────────────

export interface IssueGuestCreditInput {
  guestId: string;
  bookingId?: string;
  amount: number;
  expiresAt?: Date | null;
  notes?: string;
  createdBy: string;
}

export async function issueGuestCredit(
  tx: TxClient,
  input: IssueGuestCreditInput,
): Promise<{ id: string; creditNumber: string }> {
  if (input.amount <= 0) throw new Error('GuestCredit amount must be positive');

  const creditNumber = await generateCreditNumber(tx);

  const credit = await tx.guestCredit.create({
    data: {
      creditNumber,
      guestId:         input.guestId,
      bookingId:       input.bookingId ?? null,
      amount:          new Prisma.Decimal(input.amount),
      remainingAmount: new Prisma.Decimal(input.amount),
      status:          'active' as GuestCreditStatus,
      expiresAt:       input.expiresAt ?? null,
      notes:           input.notes ?? null,
      createdBy:       input.createdBy,
    },
    select: { id: true, creditNumber: true },
  });

  // DR AR / CR GUEST_CREDIT_LIABILITY — parks the refund obligation
  // as a liability instead of cashing it out.
  await postLedgerPair(tx, {
    debitAccount:  LedgerAccount.AR,
    creditAccount: LedgerAccount.GUEST_CREDIT_LIABILITY,
    amount:        input.amount,
    referenceType: 'GuestCredit',
    referenceId:   credit.id,
    description:   `Guest credit issued ${creditNumber}`,
    createdBy:     input.createdBy,
  });

  return credit;
}

// ─── Consume (called when next invoice is being paid) ────────────────────────

export interface ConsumeGuestCreditInput {
  guestId:     string;
  invoiceId:   string;
  /** maximum to consume — usually the invoice's outstanding balance */
  maxAmount:   number;
  createdBy:   string;
}

/**
 * Apply a guest's available credit to an invoice. Picks active credits
 * oldest-first (FIFO). Creates kind='credit' PaymentAllocation rows
 * (positive amount) and posts DR GUEST_CREDIT_LIABILITY / CR AR for
 * each consumed credit.
 *
 * Returns the total amount applied (may be < maxAmount if the guest
 * doesn't have enough credit, or 0 if no active credits exist).
 *
 * Note: this needs a "fake" Payment row to anchor the allocation.
 * Rather than create one, we mint a single sentinel Payment per
 * consumption with paymentMethod='cash' and amount=consumed-total —
 * this keeps PaymentAllocation.paymentId NOT NULL contract intact and
 * makes shift KPI / reports treat it as a non-cash receipt.
 */
export async function consumeGuestCredit(
  tx: TxClient,
  input: ConsumeGuestCreditInput,
): Promise<{ applied: number; creditsUsed: string[] }> {
  if (input.maxAmount <= 0) return { applied: 0, creditsUsed: [] };

  const credits = await tx.guestCredit.findMany({
    where:   { guestId: input.guestId, status: 'active', remainingAmount: { gt: 0 } },
    orderBy: { createdAt: 'asc' },
    select:  { id: true, remainingAmount: true },
  });
  if (credits.length === 0) return { applied: 0, creditsUsed: [] };

  let toApply = input.maxAmount;
  let totalApplied = 0;
  const creditsUsed: string[] = [];

  // Sentinel payment lets PaymentAllocation.paymentId stay NOT NULL.
  // Method 'ota_collect' chosen as a non-cash, non-shift-affecting tag —
  // it has no cash drawer impact. amount filled in after the loop.
  const { generatePaymentNumber, generateReceiptNumber } = await import('./invoice-number.service');
  const [paymentNumber, receiptNumber] = await Promise.all([
    generatePaymentNumber(tx),
    generateReceiptNumber(tx),
  ]);
  const sentinel = await tx.payment.create({
    data: {
      paymentNumber,
      receiptNumber,
      guestId:        input.guestId,
      amount:         new Prisma.Decimal(0),  // patched at end
      paymentMethod:  'ota_collect' as never,
      paymentDate:    new Date(),
      status:         'ACTIVE' as never,
      reconStatus:    'CLEARED' as never,
      idempotencyKey: `gc-consume-${input.invoiceId}-${Date.now()}`,
      createdBy:      input.createdBy,
      notes:          'Guest credit applied (Phase 3)',
    },
    select: { id: true },
  });

  for (const c of credits) {
    if (toApply <= 0) break;
    const remaining = Number(c.remainingAmount);
    const useNow    = Math.min(remaining, toApply);

    await tx.guestCredit.update({
      where: { id: c.id },
      data: {
        remainingAmount: new Prisma.Decimal(remaining - useNow),
        status: remaining - useNow <= 0 ? 'consumed' : 'active',
      },
    });

    await tx.paymentAllocation.create({
      data: {
        paymentId:     sentinel.id,
        invoiceId:     input.invoiceId,
        amount:        new Prisma.Decimal(useNow),
        kind:          'credit' as never,
        guestCreditId: c.id,
      },
    });

    await postLedgerPair(tx, {
      debitAccount:  LedgerAccount.GUEST_CREDIT_LIABILITY,
      creditAccount: LedgerAccount.AR,
      amount:        useNow,
      referenceType: 'GuestCredit',
      referenceId:   c.id,
      description:   `Guest credit applied to invoice ${input.invoiceId}`,
      createdBy:     input.createdBy,
    });

    creditsUsed.push(c.id);
    totalApplied += useNow;
    toApply      -= useNow;
  }

  await tx.payment.update({
    where: { id: sentinel.id },
    data:  { amount: new Prisma.Decimal(totalApplied) },
  });

  return { applied: totalApplied, creditsUsed };
}

// ─── List active credits for a guest (for UI display) ────────────────────────

export async function listActiveCredits(
  tx: TxClient,
  guestId: string,
): Promise<Array<{ id: string; creditNumber: string; remainingAmount: number; expiresAt: Date | null }>> {
  const credits = await tx.guestCredit.findMany({
    where:  { guestId, status: 'active', remainingAmount: { gt: 0 } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, creditNumber: true, remainingAmount: true, expiresAt: true },
  });
  return credits.map((c) => ({
    ...c,
    remainingAmount: Number(c.remainingAmount),
  }));
}

// ─── Sum of available credit for a guest (number only) ───────────────────────

export async function getAvailableCredit(
  tx: TxClient,
  guestId: string,
): Promise<number> {
  const agg = await tx.guestCredit.aggregate({
    where: { guestId, status: 'active', remainingAmount: { gt: 0 } },
    _sum:  { remainingAmount: true },
  });
  return Number(agg._sum.remainingAmount ?? 0);
}

// ─── Expire / forfeit a single credit ────────────────────────────────────────
//
// When a credit expires (past expiresAt) or a manager forfeits it manually
// at fiscal close, the hotel's liability turns into recognized revenue:
//
//     DR GUEST_CREDIT_LIABILITY   / CR Forfeited Revenue (4140-01)
//
// for the REMAINING amount (already-consumed portion is not affected — the
// guest already used it). Sets status='expired' and zeroes remainingAmount.

export interface ExpireGuestCreditInput {
  creditId:    string;
  reason:      string;
  expiredBy:   string;
  /**
   * Status to set. Defaults to 'expired'. Use 'revoked' for manager-driven
   * revocation (e.g. wrongly issued); the ledger leg is identical but the
   * audit trail differentiates intent.
   */
  finalStatus?: 'expired' | 'revoked';
}

export async function expireGuestCredit(
  tx: TxClient,
  input: ExpireGuestCreditInput,
): Promise<{ amountForfeited: number }> {
  const credit = await tx.guestCredit.findUniqueOrThrow({
    where: { id: input.creditId },
    select: {
      id: true, creditNumber: true,
      status: true, remainingAmount: true,
    },
  });
  if (credit.status !== 'active') {
    throw new Error('GUEST_CREDIT_NOT_ACTIVE');
  }
  const remaining = Number(credit.remainingAmount);
  if (remaining <= 0) {
    // Already fully consumed — just flip status without ledger movement
    await tx.guestCredit.update({
      where: { id: credit.id },
      data:  { status: 'consumed' },
    });
    return { amountForfeited: 0 };
  }

  const finalStatus: GuestCreditStatus = input.finalStatus ?? 'expired';

  await tx.guestCredit.update({
    where: { id: credit.id },
    data: {
      status:          finalStatus,
      remainingAmount: new Prisma.Decimal(0),
      notes:           input.reason,
    },
  });

  // Resolve the FORFEITED_REVENUE FinancialAccount explicitly so the ledger
  // CR side hits 4140-01 (Forfeited Guest Credit) instead of the default
  // ROOM_REVENUE that the SUBKIND_FOR_LEGACY mapping would pick.
  const { resolveAccount } = await import('./financialAccount.service');
  let forfeitedAccountId: string | null = null;
  try {
    const acc = await resolveAccount(tx, { subKind: 'FORFEITED_REVENUE', explicitAccountId: null });
    forfeitedAccountId = acc.id;
  } catch {
    // Seed missing — fall back to default revenue resolution.
  }

  // DR liability (releases the obligation) / CR forfeited revenue (recognized)
  await postLedgerPair(tx, {
    debitAccount:    LedgerAccount.GUEST_CREDIT_LIABILITY,
    creditAccount:   LedgerAccount.REVENUE,
    creditAccountId: forfeitedAccountId,    // route to 4140-01 not 4110-01
    amount:          remaining,
    referenceType:   'GuestCredit',
    referenceId:     credit.id,
    description:     `Guest credit ${finalStatus} ${credit.creditNumber} — ${input.reason}`,
    createdBy:       input.expiredBy,
  });

  return { amountForfeited: remaining };
}

// ─── Bulk expire — fiscal close / year-end forfeit ───────────────────────────
//
// Any active credit older than `cutoffDate` (or with expiresAt <= cutoffDate)
// gets force-expired. Returns count + total amount forfeited so finance can
// see "we just absorbed ฿X of unclaimed credits into income".
//
// Admin-only — gate at the route level.

export interface BulkExpireInput {
  /** Cutoff: any credit created on/before this date is expired.
   *  When omitted, only credits whose own expiresAt has passed are expired. */
  cutoffDate?: Date;
  /** Free-form reason recorded on every expired credit. */
  reason: string;
  expiredBy: string;
}

export async function bulkExpireGuestCredits(
  tx: TxClient,
  input: BulkExpireInput,
): Promise<{ count: number; totalAmount: number; creditNumbers: string[] }> {
  const now = new Date();
  const where: Prisma.GuestCreditWhereInput = {
    status:          'active',
    remainingAmount: { gt: 0 },
    OR: [
      // explicit expiry already passed
      { expiresAt: { lt: now } },
      // manager-set cutoff
      ...(input.cutoffDate ? [{ createdAt: { lte: input.cutoffDate } }] : []),
    ],
  };

  const targets = await tx.guestCredit.findMany({
    where,
    select: { id: true, creditNumber: true, remainingAmount: true },
  });

  let totalAmount = 0;
  const creditNumbers: string[] = [];
  for (const c of targets) {
    const result = await expireGuestCredit(tx, {
      creditId:  c.id,
      reason:    input.reason,
      expiredBy: input.expiredBy,
    });
    totalAmount += result.amountForfeited;
    creditNumbers.push(c.creditNumber);
  }

  return { count: targets.length, totalAmount, creditNumbers };
}
