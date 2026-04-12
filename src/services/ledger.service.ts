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

import { Prisma, LedgerAccount, LedgerType } from '@prisma/client';

type TxClient = Prisma.TransactionClient;

interface LedgerPair {
  debitAccount: LedgerAccount;
  creditAccount: LedgerAccount;
  amount: Prisma.Decimal | number;
  referenceType: string;
  referenceId: string;
  description?: string;
  createdBy: string;
}

// ─── Core: write one DEBIT + one CREDIT entry pair ───────────────────────────

export async function postLedgerPair(tx: TxClient, pair: LedgerPair) {
  const date = new Date();
  const amount = new Prisma.Decimal(String(pair.amount));

  await tx.ledgerEntry.createMany({
    data: [
      {
        date,
        type: LedgerType.DEBIT,
        account: pair.debitAccount,
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
        amount,
        referenceType: pair.referenceType,
        referenceId: pair.referenceId,
        description: pair.description,
        createdBy: pair.createdBy,
      },
    ],
  });
}

// ─── Named accounting scenarios ───────────────────────────────────────────────

/**
 * Receive payment for room/service revenue
 * DEBIT Cash/Bank  |  CREDIT Revenue
 */
export async function postPaymentReceived(
  tx: TxClient,
  opts: {
    paymentMethod: string;
    amount: number;
    paymentId: string;
    createdBy: string;
  }
) {
  const debitAccount = ['transfer', 'promptpay', 'credit_card'].includes(opts.paymentMethod)
    ? LedgerAccount.BANK
    : LedgerAccount.CASH;

  await postLedgerPair(tx, {
    debitAccount,
    creditAccount: LedgerAccount.REVENUE,
    amount: opts.amount,
    referenceType: 'Payment',
    referenceId: opts.paymentId,
    description: `Payment received via ${opts.paymentMethod}`,
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
  const debitAccount = ['transfer', 'promptpay', 'credit_card'].includes(opts.paymentMethod)
    ? LedgerAccount.BANK
    : LedgerAccount.CASH;

  await postLedgerPair(tx, {
    debitAccount,
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
  const creditAccount = ['transfer', 'promptpay', 'credit_card'].includes(opts.refundMethod)
    ? LedgerAccount.BANK
    : LedgerAccount.CASH;

  await postLedgerPair(tx, {
    debitAccount: LedgerAccount.DEPOSIT_LIABILITY,
    creditAccount,
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
    amount: number;
    paymentId: string;
    createdBy: string;
  }
) {
  const creditAccount = ['transfer', 'promptpay', 'credit_card'].includes(opts.paymentMethod)
    ? LedgerAccount.BANK
    : LedgerAccount.CASH;

  // Reversal: opposite of postPaymentReceived
  await postLedgerPair(tx, {
    debitAccount: LedgerAccount.REVENUE,
    creditAccount,
    amount: opts.amount,
    referenceType: 'Void',
    referenceId: opts.paymentId,
    description: 'Payment void reversal',
    createdBy: opts.createdBy,
  });
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
