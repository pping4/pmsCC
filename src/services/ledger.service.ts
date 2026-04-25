/**
 * ledger.service.ts
 *
 * Double-entry bookkeeping engine.
 * All LedgerEntry writes are APPEND-ONLY — no updates, no deletes.
 * Always called inside a Prisma transaction.
 *
 * Debit/Credit rules (standard accounting):
 *   DEBIT  increases: Assets (CASH, BANK, AR), Expenses (EXPENSE, DISCOUNT_GIVEN)
 *   CREDIT increases: Liabilities (DEPOSIT_LIABILITY), Revenue (REVENUE, PENALTY_REVENUE)
 */

import { Prisma, LedgerAccount, LedgerType, AccountSubKind } from '@prisma/client';
import { randomUUID } from 'crypto';
import { resolveAccount } from './financialAccount.service';
import { assertPeriodOpen } from './fiscalPeriod.service';

type TxClient = Prisma.TransactionClient;

/**
 * Pick the money-side subKind + legacy bucket for a payment method.
 *
 * Phase D: credit_card now clears through CARD_CLEARING (asset-subkind)
 * instead of the generic BANK bucket — acquirer settles T+1/T+2, so funds
 * sit in clearing until the bank sweep reconciles them. The legacy
 * LedgerAccount enum stays BANK for backward-compat queries; the accurate
 * breakdown lives on financialAccountId.
 */
async function resolveMoneyAccount(
  tx: TxClient,
  method: string,
  explicitAccountId?: string | null,
) {
  const m = String(method).toLowerCase();
  let subKind: AccountSubKind;
  let legacy: LedgerAccount;
  if (m === 'cash') {
    subKind = 'CASH';        legacy = LedgerAccount.CASH;
  } else if (m === 'credit_card') {
    subKind = 'CARD_CLEARING'; legacy = LedgerAccount.BANK;
  } else if (m === 'ota_collect') {
    // Phase H2: OTA collected from guest on our behalf. Money isn't ours yet —
    // OTA holds it until monthly settlement. Record as AR (receivable from OTA),
    // not BANK. When the OTA statement is reconciled, the settlement pair:
    //   DR BANK / CR AR (net) + DR EXPENSE(OTA commission) / CR AR (commission)
    // clears this receivable.
    subKind = 'AR';          legacy = LedgerAccount.AR;
  } else {
    // transfer / promptpay / qr / other
    subKind = 'BANK';        legacy = LedgerAccount.BANK;
  }
  const acc = await resolveAccount(tx, { subKind, explicitAccountId });
  return { subKind, legacy, accountId: acc.id };
}

interface LedgerPair {
  debitAccount: LedgerAccount;
  creditAccount: LedgerAccount;
  amount: Prisma.Decimal | number;
  referenceType: string;
  referenceId: string;
  description?: string;
  createdBy: string;
  // Phase A: optional explicit account ids. When omitted, resolver picks the
  // system default for the LedgerAccount's subKind. This keeps every legacy
  // call site working while starting to record financialAccountId.
  debitAccountId?: string | null;
  creditAccountId?: string | null;
}

// Legacy LedgerAccount enum → Chart-of-Accounts subKind for resolver lookup.
// REVENUE is intentionally mapped to ROOM_REVENUE because the vast majority
// of existing postings are room-stay charges; F&B / other revenue postings
// should migrate to explicit subKinds in Phase D.
const SUBKIND_FOR_LEGACY: Record<LedgerAccount, AccountSubKind> = {
  CASH:              'CASH',
  BANK:              'BANK',
  AR:                'AR',
  AR_CORPORATE:      'AR_CORPORATE',
  REVENUE:           'ROOM_REVENUE',
  DEPOSIT_LIABILITY: 'DEPOSIT_LIABILITY',
  PENALTY_REVENUE:   'PENALTY_REVENUE',
  EXPENSE:           'OTHER_EXPENSE',
  DISCOUNT_GIVEN:    'DISCOUNT_GIVEN',
  VAT_OUTPUT:             'VAT_OUTPUT',
  SERVICE_CHARGE_PAYABLE: 'SERVICE_CHARGE_PAYABLE',
};

// ─── Core: write one DEBIT + one CREDIT entry pair ───────────────────────────

export async function postLedgerPair(tx: TxClient, pair: LedgerPair) {
  const date = new Date();

  // Phase E guard — single chokepoint for all ledger writes.
  // Using `date` (now) is correct for operational postings; when we later
  // allow backdated entries the caller will pass `pair.date` instead.
  await assertPeriodOpen(tx, date);

  const amount = new Prisma.Decimal(String(pair.amount));
  const batchId = randomUUID();

  // Resolve FinancialAccount ids — explicit wins, else default for subKind.
  // Resolver never throws for seeded defaults; if seed is missing the insert
  // below still succeeds (financial_account_id stays null).
  const [dr, cr] = await Promise.all([
    resolveAccountSafe(tx, pair.debitAccount, pair.debitAccountId),
    resolveAccountSafe(tx, pair.creditAccount, pair.creditAccountId),
  ]);

  await tx.ledgerEntry.createMany({
    data: [
      {
        date,
        type: LedgerType.DEBIT,
        account: pair.debitAccount,
        financialAccountId: dr,
        batchId,
        amount,
        referenceType: pair.referenceType,
        referenceId: pair.referenceId,
        description: pair.description,
        createdBy: pair.createdBy,
      },
      {
        date,
        type: LedgerType.CREDIT,
        account: pair.creditAccount,
        financialAccountId: cr,
        batchId,
        amount,
        referenceType: pair.referenceType,
        referenceId: pair.referenceId,
        description: pair.description,
        createdBy: pair.createdBy,
      },
    ],
  });
}

async function resolveAccountSafe(
  tx: TxClient,
  legacy: LedgerAccount,
  explicitId: string | null | undefined,
): Promise<string | null> {
  try {
    const acc = await resolveAccount(tx, {
      subKind: SUBKIND_FOR_LEGACY[legacy],
      explicitAccountId: explicitId,
    });
    return acc.id;
  } catch {
    // Seed not yet run — keep posting working, accountId will be null and
    // backfill script will stamp it later. Never block a ledger entry.
    return null;
  }
}

// ─── Named accounting scenarios ───────────────────────────────────────────────

/**
 * Receive payment for room/service revenue
 *
 * Without fee (feeAmount is 0/undefined):
 *   DEBIT Cash/Bank/CardClearing  |  CREDIT Revenue
 *
 * Phase D — with processor fee (feeAmount > 0):
 *   Gross = Net + Fee. Booked as two balanced pairs so the ledger stays
 *   in double-entry discipline:
 *     DEBIT Money  (net)   | CREDIT Revenue (net)
 *     DEBIT CardFee (fee)  | CREDIT Revenue (fee)
 *   Net effect: Revenue is credited for gross; money lands as net; fee
 *   is recognized as expense. No manual JE needed at settlement.
 */
export async function postPaymentReceived(
  tx: TxClient,
  opts: {
    paymentMethod: string;
    amount: number;             // GROSS
    paymentId: string;
    createdBy: string;
    feeAmount?: number | null;
    feeAccountId?: string | null;   // explicit override
    moneyAccountId?: string | null; // explicit override for debit side
  }
) {
  const money = await resolveMoneyAccount(tx, opts.paymentMethod, opts.moneyAccountId);
  const gross = new Prisma.Decimal(String(opts.amount));
  const fee   = new Prisma.Decimal(String(opts.feeAmount ?? 0));

  if (fee.lte(0)) {
    await postLedgerPair(tx, {
      debitAccount: money.legacy, debitAccountId: money.accountId,
      creditAccount: LedgerAccount.REVENUE,
      amount: gross,
      referenceType: 'Payment',
      referenceId: opts.paymentId,
      description: `Payment received via ${opts.paymentMethod}`,
      createdBy: opts.createdBy,
    });
    return;
  }

  if (fee.gte(gross)) {
    throw new Error('feeAmount must be less than payment amount');
  }
  const net = gross.sub(fee);

  // Leg 1: money (net) vs revenue (net)
  await postLedgerPair(tx, {
    debitAccount: money.legacy, debitAccountId: money.accountId,
    creditAccount: LedgerAccount.REVENUE,
    amount: net,
    referenceType: 'Payment',
    referenceId: opts.paymentId,
    description: `Payment received via ${opts.paymentMethod} (net)`,
    createdBy: opts.createdBy,
  });

  // Leg 2: fee expense vs revenue — default CARD_FEE for cards, BANK_FEE otherwise
  const feeSubKind: AccountSubKind =
    money.subKind === 'CARD_CLEARING' ? 'CARD_FEE' : 'BANK_FEE';
  const feeAcc = await resolveAccount(tx, {
    subKind: feeSubKind,
    explicitAccountId: opts.feeAccountId ?? null,
  });
  await postLedgerPair(tx, {
    debitAccount: LedgerAccount.EXPENSE, debitAccountId: feeAcc.id,
    creditAccount: LedgerAccount.REVENUE,
    amount: fee,
    referenceType: 'Payment',
    referenceId: opts.paymentId,
    description: `Processor fee on ${opts.paymentMethod}`,
    createdBy: opts.createdBy,
  });
}

/**
 * Record discount given (contra-revenue)
 * DEBIT Discount Given  |  CREDIT Revenue  (reduces net revenue on P&L)
 * Note: Called IN ADDITION to postPaymentReceived when a discount exists.
 * The Revenue credit in postPaymentReceived is for the FULL subtotal.
 * This pair records the discount reduction.
 */
export async function postDiscountGiven(
  tx: TxClient,
  opts: {
    discountAmount: number;
    invoiceId: string;
    createdBy: string;
    description?: string;
  }
) {
  await postLedgerPair(tx, {
    debitAccount: LedgerAccount.DISCOUNT_GIVEN,
    creditAccount: LedgerAccount.REVENUE,
    amount: opts.discountAmount,
    referenceType: 'Discount',
    referenceId: opts.invoiceId,
    description: opts.description ?? 'Discount given',
    createdBy: opts.createdBy,
  });
}

/**
 * Receive security deposit
 * DEBIT Cash/Bank  |  CREDIT Deposit Liability
 */
export async function postDepositReceived(
  tx: TxClient,
  opts: {
    paymentMethod: string;
    amount: number;
    depositId: string;
    createdBy: string;
  }
) {
  const money = await resolveMoneyAccount(tx, opts.paymentMethod);

  await postLedgerPair(tx, {
    debitAccount: money.legacy, debitAccountId: money.accountId,
    creditAccount: LedgerAccount.DEPOSIT_LIABILITY,
    amount: opts.amount,
    referenceType: 'SecurityDeposit',
    referenceId: opts.depositId,
    description: 'Security deposit received',
    createdBy: opts.createdBy,
  });
}

/**
 * Refund security deposit to guest
 * DEBIT Deposit Liability  |  CREDIT Cash/Bank
 */
export async function postDepositRefunded(
  tx: TxClient,
  opts: {
    refundMethod: string;
    amount: number;
    depositId: string;
    createdBy: string;
  }
) {
  const money = await resolveMoneyAccount(tx, opts.refundMethod);

  await postLedgerPair(tx, {
    debitAccount: LedgerAccount.DEPOSIT_LIABILITY,
    creditAccount: money.legacy, creditAccountId: money.accountId,
    amount: opts.amount,
    referenceType: 'SecurityDeposit',
    referenceId: opts.depositId,
    description: 'Security deposit refunded',
    createdBy: opts.createdBy,
  });
}

/**
 * Forfeit security deposit (break contract / damage)
 * DEBIT Deposit Liability  |  CREDIT Penalty Revenue
 */
export async function postDepositForfeited(
  tx: TxClient,
  opts: {
    amount: number;
    depositId: string;
    reason: string;
    createdBy: string;
  }
) {
  await postLedgerPair(tx, {
    debitAccount: LedgerAccount.DEPOSIT_LIABILITY,
    creditAccount: LedgerAccount.PENALTY_REVENUE,
    amount: opts.amount,
    referenceType: 'SecurityDeposit',
    referenceId: opts.depositId,
    description: `Deposit forfeited: ${opts.reason}`,
    createdBy: opts.createdBy,
  });
}

/**
 * Void / reverse a payment
 * Creates opposite entries of the original payment ledger entries
 */
export async function postPaymentVoided(
  tx: TxClient,
  opts: {
    paymentMethod: string;
    amount: number;                 // GROSS (must match original)
    paymentId: string;
    createdBy: string;
    feeAmount?: number | null;
    feeAccountId?: string | null;
    moneyAccountId?: string | null;
  }
) {
  const money = await resolveMoneyAccount(tx, opts.paymentMethod, opts.moneyAccountId);
  const gross = new Prisma.Decimal(String(opts.amount));
  const fee   = new Prisma.Decimal(String(opts.feeAmount ?? 0));

  if (fee.lte(0)) {
    await postLedgerPair(tx, {
      debitAccount: LedgerAccount.REVENUE,
      creditAccount: money.legacy, creditAccountId: money.accountId,
      amount: gross,
      referenceType: 'Void',
      referenceId: opts.paymentId,
      description: 'Payment void reversal',
      createdBy: opts.createdBy,
    });
    return;
  }

  // Reverse both legs of the Phase-D fee split
  const net = gross.sub(fee);
  await postLedgerPair(tx, {
    debitAccount: LedgerAccount.REVENUE,
    creditAccount: money.legacy, creditAccountId: money.accountId,
    amount: net,
    referenceType: 'Void',
    referenceId: opts.paymentId,
    description: 'Payment void reversal (net)',
    createdBy: opts.createdBy,
  });

  const feeSubKind: AccountSubKind =
    money.subKind === 'CARD_CLEARING' ? 'CARD_FEE' : 'BANK_FEE';
  const feeAcc = await resolveAccount(tx, {
    subKind: feeSubKind,
    explicitAccountId: opts.feeAccountId ?? null,
  });
  await postLedgerPair(tx, {
    debitAccount: LedgerAccount.REVENUE,
    creditAccount: LedgerAccount.EXPENSE, creditAccountId: feeAcc.id,
    amount: fee,
    referenceType: 'Void',
    referenceId: opts.paymentId,
    description: 'Processor fee void reversal',
    createdBy: opts.createdBy,
  });
}

/**
 * Phase H1 — Post invoice accrual split across Revenue / Service / VAT.
 *
 * Invariant: totalDebit(AR) = revenue + serviceCharge + vatAmount = grandTotal
 *
 * Posted as up to three balanced pairs (one per non-zero leg), all sharing the
 * invoice referenceId so reports can reconstruct the split. The legacy
 * LedgerAccount column records the bucket (REVENUE / SERVICE_CHARGE_PAYABLE /
 * VAT_OUTPUT); financial_account_id resolves through the Chart of Accounts.
 */
export async function postInvoiceAccrual(
  tx: TxClient,
  opts: {
    invoiceId: string;
    invoiceNumber: string;
    revenue: number;            // subtotal (pre-tax, pre-service)
    serviceCharge: number;      // 0 if disabled
    vatAmount: number;          // 0 if disabled
    createdBy: string;
  },
) {
  const { invoiceId, invoiceNumber, createdBy } = opts;
  const desc = (leg: string) => `Invoice ${invoiceNumber} — ${leg}`;

  if (opts.revenue > 0) {
    await postLedgerPair(tx, {
      debitAccount: LedgerAccount.AR,
      creditAccount: LedgerAccount.REVENUE,
      amount: opts.revenue,
      referenceType: 'Invoice',
      referenceId: invoiceId,
      description: desc('revenue'),
      createdBy,
    });
  }
  if (opts.serviceCharge > 0) {
    await postLedgerPair(tx, {
      debitAccount: LedgerAccount.AR,
      creditAccount: LedgerAccount.SERVICE_CHARGE_PAYABLE,
      amount: opts.serviceCharge,
      referenceType: 'Invoice',
      referenceId: invoiceId,
      description: desc('service charge'),
      createdBy,
    });
  }
  if (opts.vatAmount > 0) {
    await postLedgerPair(tx, {
      debitAccount: LedgerAccount.AR,
      creditAccount: LedgerAccount.VAT_OUTPUT,
      amount: opts.vatAmount,
      referenceType: 'Invoice',
      referenceId: invoiceId,
      description: desc('VAT output'),
      createdBy,
    });
  }
}

/**
 * Write off bad debt
 * DEBIT Expense  |  CREDIT AR
 */
export async function postBadDebt(
  tx: TxClient,
  opts: {
    amount: number;
    invoiceId: string;
    createdBy: string;
  }
) {
  await postLedgerPair(tx, {
    debitAccount: LedgerAccount.EXPENSE,
    creditAccount: LedgerAccount.AR,
    amount: opts.amount,
    referenceType: 'Invoice',
    referenceId: opts.invoiceId,
    description: 'Bad debt written off',
    createdBy: opts.createdBy,
  });
}

// ─── City Ledger / AR_CORPORATE accounting entries ───────────────────────────

/**
 * Post a City Ledger charge (when invoice is assigned to a CL account)
 * DEBIT AR_CORPORATE  |  CREDIT Revenue
 */
export async function postCityLedgerCharge(
  tx: TxClient,
  opts: {
    amount: number;
    invoiceId: string;
    description?: string;
    createdBy: string;
  }
) {
  await postLedgerPair(tx, {
    debitAccount:  LedgerAccount.AR_CORPORATE,
    creditAccount: LedgerAccount.REVENUE,
    amount:        opts.amount,
    referenceType: 'CityLedger',
    referenceId:   opts.invoiceId,
    description:   opts.description ?? 'City Ledger charge posted',
    createdBy:     opts.createdBy,
  });
}

/**
 * Receive payment from a City Ledger (corporate) account
 * DEBIT Cash/Bank  |  CREDIT AR_CORPORATE
 */
export async function postCityLedgerPaymentReceived(
  tx: TxClient,
  opts: {
    paymentMethod: string;
    amount: number;
    clPaymentId: string;
    description?: string;
    createdBy: string;
  }
) {
  const money = await resolveMoneyAccount(tx, opts.paymentMethod);

  await postLedgerPair(tx, {
    debitAccount: money.legacy, debitAccountId: money.accountId,
    creditAccount: LedgerAccount.AR_CORPORATE,
    amount:        opts.amount,
    referenceType: 'CityLedger',
    referenceId:   opts.clPaymentId,
    description:   opts.description ?? `City Ledger payment received via ${opts.paymentMethod}`,
    createdBy:     opts.createdBy,
  });
}

/**
 * Write off City Ledger bad debt
 * DEBIT Expense  |  CREDIT AR_CORPORATE
 */
export async function postCityLedgerBadDebt(
  tx: TxClient,
  opts: {
    amount: number;
    invoiceId: string;
    reason: string;
    createdBy: string;
  }
) {
  await postLedgerPair(tx, {
    debitAccount:  LedgerAccount.EXPENSE,
    creditAccount: LedgerAccount.AR_CORPORATE,
    amount:        opts.amount,
    referenceType: 'CityLedger',
    referenceId:   opts.invoiceId,
    description:   `City Ledger bad debt: ${opts.reason}`,
    createdBy:     opts.createdBy,
  });
}
