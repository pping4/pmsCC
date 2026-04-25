/**
 * depositForfeit.service.ts — Sprint 3B / Module B / T12
 *
 * Deposit forfeit & early-termination settlement engine.
 *
 * Three public surfaces:
 *
 *   1. `calculateForfeit()` — PURE. Given (deposit, rule, %, lock-in math,
 *      monthly rent), returns forfeited/refundable amount plus a human-readable
 *      breakdown. No DB, fully unit-testable.
 *
 *   2. `previewTerminationSettlement()` — READ-ONLY. Loads Contract +
 *      SecurityDeposit + Folio balance; runs the calculator; returns the
 *      projected refund / additional-charge split. Safe to call from UI
 *      previews.
 *
 *   3. `settleDepositOnTermination()` — WRITE. MUST be called INSIDE the same
 *      `$transaction` envelope that transitions the Contract to `terminated`.
 *      Writes in this order (lock-order-safe):
 *        Booking-owned Folio  →  SecurityDeposit  →  RefundRecord  →  LedgerEntry
 *
 *      Ledger postings (double-entry, per plan §5.3):
 *        Forfeited portion:   DR DEPOSIT_LIABILITY  /  CR PENALTY_REVENUE
 *        Refundable portion:  (no ledger yet — RefundRecord is pending.
 *                              processRefund() posts DR DEPOSIT_LIABILITY / CR Cash|Bank
 *                              when cash actually leaves.)
 *
 * Idempotency:
 *   If the SecurityDeposit status is already `forfeited`, `refunded`, or
 *   `partially_deducted` we throw `AlreadySettledError` — callers must check
 *   before retrying a termination.
 *
 * Rounding:
 *   All monetary math goes through `roundHalfToEven2` (banker's rounding, 2 dp)
 *   exported from `@/lib/contract/periodCalc` — the same rounding used by the
 *   rent prorator, so reconciliation is consistent across the contract lifecycle.
 */

import {
  Prisma,
  type PrismaClient,
  type TerminationRule,
  type DepositStatus,
} from '@prisma/client';
import { differenceInCalendarDays } from 'date-fns';
import { addContractMonths, roundHalfToEven2 } from '@/lib/contract/periodCalc';
import { postLedgerPair } from './ledger.service';
import { createPendingRefund } from './refund.service';

type Tx = Prisma.TransactionClient;
type Db = PrismaClient | Tx;

// ─── Errors ────────────────────────────────────────────────────────────────

export type DepositForfeitErrorCode =
  | 'CONTRACT_NOT_FOUND'
  | 'DEPOSIT_NOT_FOUND'
  | 'DEPOSIT_VOIDED'
  | 'ALREADY_SETTLED'
  | 'INVALID_TERMINATION_DATE';

export class DepositForfeitError extends Error {
  constructor(public code: DepositForfeitErrorCode, msg: string) {
    super(msg);
    this.name = 'DepositForfeitError';
  }
}

export class AlreadySettledError extends DepositForfeitError {
  constructor(msg = 'เงินประกันนี้ถูกปิดบัญชีไปแล้ว') {
    super('ALREADY_SETTLED', msg);
    this.name = 'AlreadySettledError';
  }
}

// ─── Types ─────────────────────────────────────────────────────────────────

export type ForfeitRuleKind = 'forfeit_full' | 'forfeit_percent' | 'prorated' | 'none';

export interface CalculateForfeitInput {
  securityDepositAmount: number;
  forfeitType: ForfeitRuleKind;
  forfeitPercent?: number | null;
  contractStartDate: Date;
  contractEndDate: Date;
  terminationDate: Date;
  lockInMonths: number | null;
  monthlyRent: number;
}

export interface CalculateForfeitResult {
  forfeitedAmount: number;
  refundableAmount: number;
  breakdown: {
    depositHeld: number;
    lockInViolated: boolean;
    monthsRemainingInLockIn: number;
    penaltyBase: number;
    method: string;
  };
}

export interface PreviewSettlementResult {
  contract: { id: string; contractNumber: string; status: string };
  deposit: { id: string; amount: number } | null;
  outstandingBalance: number;
  forfeit: CalculateForfeitResult;
  netRefund: number;
  additionalCharge: number;
}

export interface SettleInput {
  contractId: string;
  terminationDate: Date;
  userRef: string;
  note?: string;
  /**
   * Operator override on the computed forfeit (T13 step 4).
   * When supplied, REPLACES the rule-based forfeit amount.
   * Still capped at the held-deposit amount for safety.
   */
  manualForfeitOverride?: number;
  /**
   * Extra deduction line items added by the operator (T13 step 4).
   * Recorded as UNBILLED folio line items — they add to outstanding
   * balance and therefore reduce the net refund.
   */
  additionalDeductions?: Array<{ label: string; amount: number }>;
}

export interface SettleResult {
  forfeitLineItemId: string | null;
  refundRecordId: string | null;
  additionalChargeLineItemId: string | null;
  ledgerEntries: string[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Months remaining in the lock-in window, as of `terminationDate`.
 * Computed by taking the lock-in END date = startDate + lockInMonths,
 * then counting whole calendar months between terminationDate and that end.
 * Fractional partial months count as 1 (any day under lock-in is a violation
 * of the whole month under the K.V. Mansion interpretation).
 */
function computeMonthsRemainingInLockIn(
  contractStartDate: Date,
  terminationDate: Date,
  lockInMonths: number,
): number {
  if (lockInMonths <= 0) return 0;
  const lockInEnd = addContractMonths(contractStartDate, lockInMonths);
  if (terminationDate >= lockInEnd) return 0;
  const daysRemaining = differenceInCalendarDays(lockInEnd, terminationDate);
  // 30-day month approximation for counting, but always round UP so any
  // partial month still counts as a full month of penalty.
  const months = Math.ceil(daysRemaining / 30);
  return Math.min(months, lockInMonths);
}

function isLockInViolated(
  contractStartDate: Date,
  terminationDate: Date,
  lockInMonths: number,
): boolean {
  if (lockInMonths <= 0) return false;
  const lockInEnd = addContractMonths(contractStartDate, lockInMonths);
  return terminationDate < lockInEnd;
}

// ─── 1. Pure calculator ────────────────────────────────────────────────────

export function calculateForfeit(
  input: CalculateForfeitInput,
): CalculateForfeitResult {
  const deposit = roundHalfToEven2(Math.max(0, input.securityDepositAmount));
  const lockIn = Math.max(0, input.lockInMonths ?? 0);
  const violated = isLockInViolated(
    input.contractStartDate,
    input.terminationDate,
    lockIn,
  );
  const monthsRemaining = computeMonthsRemainingInLockIn(
    input.contractStartDate,
    input.terminationDate,
    lockIn,
  );

  // Rule: if the lock-in is NOT violated, the full deposit is refundable
  // regardless of the configured rule (per plan §5 — lock-in gate).
  if (!violated) {
    return {
      forfeitedAmount: 0,
      refundableAmount: deposit,
      breakdown: {
        depositHeld: deposit,
        lockInViolated: false,
        monthsRemainingInLockIn: 0,
        penaltyBase: 0,
        method:
          lockIn === 0
            ? 'No lock-in configured — full refund.'
            : 'Lock-in period already satisfied — full refund.',
      },
    };
  }

  // Lock-in violated: apply the configured forfeit rule.
  let forfeited = 0;
  let penaltyBase = 0;
  let method = '';

  switch (input.forfeitType) {
    case 'forfeit_full': {
      forfeited = deposit;
      penaltyBase = deposit;
      method = 'Full forfeit — deposit fully retained per contract.';
      break;
    }
    case 'forfeit_percent': {
      const pct = Math.min(100, Math.max(0, input.forfeitPercent ?? 0));
      penaltyBase = deposit;
      forfeited = roundHalfToEven2((deposit * pct) / 100);
      method = `Percent forfeit — ${pct}% of deposit retained.`;
      break;
    }
    case 'prorated': {
      // forfeit = monthsRemaining × monthlyRent, capped at deposit.
      const rent = Math.max(0, input.monthlyRent);
      const raw = monthsRemaining * rent;
      penaltyBase = roundHalfToEven2(raw);
      forfeited = Math.min(deposit, roundHalfToEven2(raw));
      method = `Prorated forfeit — ${monthsRemaining} month(s) remaining × ฿${rent.toFixed(2)}/mo (capped at deposit).`;
      break;
    }
    case 'none': {
      forfeited = 0;
      penaltyBase = 0;
      method = 'Forfeit rule = none — full refund even during lock-in.';
      break;
    }
    default: {
      // TypeScript exhaustiveness guard
      const _never: never = input.forfeitType;
      throw new Error(`Unknown forfeit type: ${String(_never)}`);
    }
  }

  forfeited = roundHalfToEven2(Math.max(0, Math.min(forfeited, deposit)));
  const refundable = roundHalfToEven2(Math.max(0, deposit - forfeited));

  return {
    forfeitedAmount: forfeited,
    refundableAmount: refundable,
    breakdown: {
      depositHeld: deposit,
      lockInViolated: true,
      monthsRemainingInLockIn: monthsRemaining,
      penaltyBase,
      method,
    },
  };
}

// ─── 2. Preview (read-only) ────────────────────────────────────────────────

export async function previewTerminationSettlement(
  db: Db,
  contractId: string,
  terminationDate: Date,
): Promise<PreviewSettlementResult> {
  const contract = await db.contract.findUnique({
    where: { id: contractId },
    select: {
      id: true,
      contractNumber: true,
      status: true,
      startDate: true,
      endDate: true,
      lockInMonths: true,
      earlyTerminationRule: true,
      earlyTerminationPercent: true,
      monthlyRoomRent: true,
      monthlyFurnitureRent: true,
      securityDeposit: true,
      bookingId: true,
    },
  });
  if (!contract) {
    throw new DepositForfeitError('CONTRACT_NOT_FOUND', 'ไม่พบสัญญา');
  }

  // Pick the ACTIVE (held / partially_deducted) deposit for this contract.
  // There's rarely more than one, but we scope defensively.
  const deposit = await db.securityDeposit.findFirst({
    where: {
      contractId,
      status: { in: ['held', 'partially_deducted', 'pending'] as DepositStatus[] },
    },
    select: { id: true, amount: true, status: true },
    orderBy: { createdAt: 'desc' },
  });

  // Outstanding folio balance (charges − payments) for the booking.
  const folio = await db.folio.findUnique({
    where: { bookingId: contract.bookingId },
    select: { balance: true },
  });
  const outstandingBalance = folio ? Number(folio.balance) : 0;

  const depositAmount = deposit ? Number(deposit.amount) : Number(contract.securityDeposit);
  const monthlyRent =
    Number(contract.monthlyRoomRent) + Number(contract.monthlyFurnitureRent);

  const forfeit = calculateForfeit({
    securityDepositAmount: depositAmount,
    forfeitType: contract.earlyTerminationRule as ForfeitRuleKind,
    forfeitPercent: contract.earlyTerminationPercent,
    contractStartDate: contract.startDate,
    contractEndDate: contract.endDate,
    terminationDate,
    lockInMonths: contract.lockInMonths ?? 0,
    monthlyRent,
  });

  // Apply outstanding folio balance against the refundable portion.
  const outstanding = roundHalfToEven2(Math.max(0, outstandingBalance));
  const refundAfterDebt = Math.max(0, forfeit.refundableAmount - outstanding);
  const coveredByRefundable = Math.min(outstanding, forfeit.refundableAmount);
  const additionalCharge = roundHalfToEven2(
    Math.max(0, outstanding - coveredByRefundable),
  );

  return {
    contract: {
      id: contract.id,
      contractNumber: contract.contractNumber,
      status: contract.status,
    },
    deposit: deposit ? { id: deposit.id, amount: depositAmount } : null,
    outstandingBalance: outstanding,
    forfeit,
    netRefund: roundHalfToEven2(refundAfterDebt),
    additionalCharge,
  };
}

// ─── 3. Execute settlement (writes) ────────────────────────────────────────

export async function settleDepositOnTermination(
  tx: Tx,
  input: SettleInput,
): Promise<SettleResult> {
  const contract = await tx.contract.findUnique({
    where: { id: input.contractId },
    select: {
      id: true,
      bookingId: true,
      guestId: true,
      startDate: true,
      endDate: true,
      lockInMonths: true,
      earlyTerminationRule: true,
      earlyTerminationPercent: true,
      monthlyRoomRent: true,
      monthlyFurnitureRent: true,
      securityDeposit: true,
      contractNumber: true,
    },
  });
  if (!contract) {
    throw new DepositForfeitError('CONTRACT_NOT_FOUND', 'ไม่พบสัญญา');
  }

  const deposit = await tx.securityDeposit.findFirst({
    where: { contractId: input.contractId },
    select: { id: true, amount: true, status: true },
    orderBy: { createdAt: 'desc' },
  });

  // Idempotency guard — if a deposit exists and has already been settled
  // into a terminal state, abort.
  if (deposit) {
    const terminal: DepositStatus[] = [
      'forfeited',
      'refunded',
      'partially_deducted',
    ];
    if (terminal.includes(deposit.status)) {
      throw new AlreadySettledError();
    }
  }

  const monthlyRent =
    Number(contract.monthlyRoomRent) + Number(contract.monthlyFurnitureRent);
  const depositAmount = deposit
    ? Number(deposit.amount)
    : Number(contract.securityDeposit);

  const calcBase = calculateForfeit({
    securityDepositAmount: depositAmount,
    forfeitType: contract.earlyTerminationRule as ForfeitRuleKind,
    forfeitPercent: contract.earlyTerminationPercent,
    contractStartDate: contract.startDate,
    contractEndDate: contract.endDate,
    terminationDate: input.terminationDate,
    lockInMonths: contract.lockInMonths ?? 0,
    monthlyRent,
  });

  // Apply operator override (T13 step 4) if present — replaces the rule-based
  // forfeit amount, still capped at the deposit. The refundable portion is
  // re-derived so the arithmetic remains consistent.
  const calc: CalculateForfeitResult =
    input.manualForfeitOverride !== undefined &&
    Number.isFinite(input.manualForfeitOverride)
      ? (() => {
          const forfeited = roundHalfToEven2(
            Math.max(
              0,
              Math.min(input.manualForfeitOverride ?? 0, depositAmount),
            ),
          );
          const refundable = roundHalfToEven2(
            Math.max(0, depositAmount - forfeited),
          );
          return {
            forfeitedAmount: forfeited,
            refundableAmount: refundable,
            breakdown: {
              ...calcBase.breakdown,
              method: `${calcBase.breakdown.method} · Operator override applied (฿${forfeited.toFixed(2)})`,
            },
          };
        })()
      : calcBase;

  // Folio for the booking — we need it for both the forfeit line item
  // (for audit/paper trail of what came out of the deposit) and for any
  // additional charge beyond the deposit.
  const folio = await tx.folio.findUnique({
    where: { bookingId: contract.bookingId },
    select: { id: true, balance: true },
  });
  const baseBalance = folio ? Number(folio.balance) : 0;
  // Operator-added extra deductions increase outstanding balance — they're
  // posted as UNBILLED folio line items below, but must also be reflected
  // in the refund math here BEFORE we decide what's covered.
  const extraDeductionsTotal = roundHalfToEven2(
    (input.additionalDeductions ?? []).reduce(
      (acc, d) => acc + Math.max(0, Number(d.amount) || 0),
      0,
    ),
  );
  const outstandingBalance = baseBalance + extraDeductionsTotal;
  const outstanding = roundHalfToEven2(Math.max(0, outstandingBalance));
  const coveredByRefundable = Math.min(outstanding, calc.refundableAmount);
  const refundAfterDebt = roundHalfToEven2(
    Math.max(0, calc.refundableAmount - outstanding),
  );
  const additionalCharge = roundHalfToEven2(
    Math.max(0, outstanding - coveredByRefundable),
  );

  const ledgerEntryDescriptors: string[] = [];
  let forfeitLineItemId: string | null = null;
  let refundRecordId: string | null = null;
  let additionalChargeLineItemId: string | null = null;

  // ── 1. Folio line items (audit-only, UNBILLED) ──────────────────────────
  //     These are informational rows on the guest's folio showing what
  //     happened to their deposit. The money itself moves via ledger +
  //     RefundRecord below, not via these line items.

  if (folio && calc.forfeitedAmount > 0) {
    const forfeitLine = await tx.folioLineItem.create({
      data: {
        folioId: folio.id,
        chargeType: 'PENALTY',
        description: `ค่าปรับยกเลิกสัญญา (${contract.contractNumber}) — ${calc.breakdown.method}`,
        amount: new Prisma.Decimal(calc.forfeitedAmount),
        quantity: 1,
        unitPrice: new Prisma.Decimal(calc.forfeitedAmount),
        taxType: 'no_tax',
        billingStatus: 'BILLED', // already settled via deposit, do not re-bill
        referenceType: 'ContractTermination',
        referenceId: contract.id,
        notes: input.note ?? null,
        createdBy: input.userRef,
      },
      select: { id: true },
    });
    forfeitLineItemId = forfeitLine.id;
  }

  // Operator-added deduction line items (T13 step 4). Posted UNBILLED so the
  // existing folio balance reflects the extra charge; the settlement logic
  // above already accounts for them when computing `additionalCharge`.
  if (folio && input.additionalDeductions && input.additionalDeductions.length > 0) {
    for (const d of input.additionalDeductions) {
      const amt = Math.max(0, Number(d.amount) || 0);
      if (amt <= 0) continue;
      await tx.folioLineItem.create({
        data: {
          folioId: folio.id,
          chargeType: 'PENALTY',
          description: `${d.label} (${contract.contractNumber})`,
          amount: new Prisma.Decimal(amt),
          quantity: 1,
          unitPrice: new Prisma.Decimal(amt),
          taxType: 'no_tax',
          billingStatus: 'UNBILLED',
          referenceType: 'ContractTermination',
          referenceId: contract.id,
          notes: input.note ?? null,
          createdBy: input.userRef,
        },
      });
    }
  }

  if (folio && additionalCharge > 0) {
    const addLine = await tx.folioLineItem.create({
      data: {
        folioId: folio.id,
        chargeType: 'PENALTY',
        description: `ยอดค้างชำระหลังหักเงินประกัน (${contract.contractNumber})`,
        amount: new Prisma.Decimal(additionalCharge),
        quantity: 1,
        unitPrice: new Prisma.Decimal(additionalCharge),
        taxType: 'no_tax',
        billingStatus: 'UNBILLED', // guest still owes this — must be billed
        referenceType: 'ContractTermination',
        referenceId: contract.id,
        notes: input.note ?? null,
        createdBy: input.userRef,
      },
      select: { id: true },
    });
    additionalChargeLineItemId = addLine.id;
  }

  // ── 2. SecurityDeposit status update ────────────────────────────────────

  if (deposit) {
    const newStatus: DepositStatus =
      calc.forfeitedAmount >= depositAmount
        ? 'forfeited'
        : calc.forfeitedAmount > 0
          ? 'partially_deducted'
          : 'refunded';

    const deductions =
      calc.forfeitedAmount > 0
        ? [
            {
              reason: calc.breakdown.method,
              amount: calc.forfeitedAmount,
            },
          ]
        : [];

    try {
      await tx.securityDeposit.update({
        where: { id: deposit.id },
        data: {
          status: newStatus,
          forfeitReason:
            calc.forfeitedAmount > 0
              ? calc.breakdown.method
              : null,
          forfeitType:
            calc.forfeitedAmount > 0 ? 'early_termination' : 'none',
          deductions:
            deductions as unknown as Prisma.InputJsonValue,
          refundAmount:
            refundAfterDebt > 0
              ? new Prisma.Decimal(refundAfterDebt)
              : null,
          refundAt: refundAfterDebt > 0 ? new Date() : null,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2034'
      ) {
        // Caller is responsible for retrying the whole $transaction with the
        // same userRef. We surface a clear marker.
        throw err;
      }
      throw err;
    }
  }

  // ── 3. Ledger: forfeit portion (DR DEPOSIT_LIABILITY / CR PENALTY_REVENUE)
  //     Refundable portion posts later via processRefund() — we only create
  //     the RefundRecord here (pending, no ledger impact yet).

  if (calc.forfeitedAmount > 0) {
    await postLedgerPair(tx, {
      debitAccount: 'DEPOSIT_LIABILITY',
      creditAccount: 'PENALTY_REVENUE',
      amount: new Prisma.Decimal(calc.forfeitedAmount),
      referenceType: 'ContractTermination',
      referenceId: contract.id,
      description: `Forfeit deposit on contract ${contract.contractNumber} — ${calc.breakdown.method}`,
      createdBy: input.userRef,
    });
    ledgerEntryDescriptors.push(
      `DR DEPOSIT_LIABILITY ${calc.forfeitedAmount.toFixed(2)} / CR PENALTY_REVENUE ${calc.forfeitedAmount.toFixed(2)}`,
    );
  }

  // ── 4. RefundRecord (pending) for any net refund owed to guest ──────────
  if (refundAfterDebt > 0) {
    const { refundId } = await createPendingRefund(tx, {
      bookingId: contract.bookingId,
      guestId: contract.guestId,
      amount: refundAfterDebt,
      source: 'deposit',
      reason: `Contract ${contract.contractNumber} terminated — deposit refund`,
      referenceType: 'SecurityDeposit',
      referenceId: deposit?.id ?? contract.id,
      notes: input.note,
      createdBy: input.userRef,
    });
    refundRecordId = refundId;
  }

  return {
    forfeitLineItemId,
    refundRecordId,
    additionalChargeLineItemId,
    ledgerEntries: ledgerEntryDescriptors,
  };
}

// Re-export the rule type alias under the schema enum name for callers that
// already import `TerminationRule` from Prisma — keeps service signatures
// aligned with the DB.
export type { TerminationRule };
