/**
 * Transfer service — moves money between two FinancialAccount rows.
 *
 * Every transfer:
 *  1. Validates both accounts exist, are active, and are "money" accounts
 *     (CASH | BANK | CARD_CLEARING | UNDEPOSITED_FUNDS). Transferring to/from
 *     a revenue/liability/equity account is not a transfer — it's a journal
 *     entry and must go through a different flow.
 *  2. When either side is CASH, requires an OPEN CashSession for the caller
 *     to preserve physical-drawer accountability.
 *  3. Creates a TransferRecord row (for audit + traceability).
 *  4. Posts a ledger pair inside the same transaction:
 *        DR toAccount   (asset ↑)
 *        CR fromAccount (asset ↓)
 *     Both entries share the TransferRecord.batchId so a report can always
 *     pair them back together.
 *
 * Idempotency: no client-supplied key yet — callers should rely on the UI
 * confirmation + server-side duplicate-amount heuristic if desired. The
 * ledger pair is posted via postLedgerPair which itself is transactional.
 */

import { Prisma, LedgerAccount, LedgerType, AccountSubKind } from '@prisma/client';
import { randomUUID } from 'crypto';

type TxClient = Omit<Prisma.TransactionClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export interface CreateTransferInput {
  fromAccountId: string;
  toAccountId:   string;
  amount:        number;
  notes?:        string;
  createdBy:     string;
  cashSessionId?: string; // auto-resolved by API route when from/to is CASH
}

const MONEY_SUBKINDS: AccountSubKind[] = ['CASH', 'BANK', 'CARD_CLEARING', 'UNDEPOSITED_FUNDS'];

/** Map a money subKind to the legacy LedgerAccount enum value (required by schema). */
function legacyAccountFor(subKind: AccountSubKind): LedgerAccount {
  if (subKind === 'CASH') return LedgerAccount.CASH;
  // BANK / CARD_CLEARING / UNDEPOSITED_FUNDS all group under the legacy BANK bucket
  // for back-compat — the authoritative link is financialAccountId on each entry.
  return LedgerAccount.BANK;
}

export async function createTransfer(tx: TxClient, input: CreateTransferInput) {
  if (input.fromAccountId === input.toAccountId) {
    throw new Error('SAME_ACCOUNT');
  }
  if (!(input.amount > 0)) {
    throw new Error('INVALID_AMOUNT');
  }

  const [from, to] = await Promise.all([
    tx.financialAccount.findUnique({
      where: { id: input.fromAccountId },
      select: { id: true, subKind: true, isActive: true, name: true, code: true },
    }),
    tx.financialAccount.findUnique({
      where: { id: input.toAccountId },
      select: { id: true, subKind: true, isActive: true, name: true, code: true },
    }),
  ]);

  if (!from || !from.isActive) throw new Error('FROM_ACCOUNT_NOT_FOUND');
  if (!to   || !to.isActive)   throw new Error('TO_ACCOUNT_NOT_FOUND');
  if (!MONEY_SUBKINDS.includes(from.subKind)) throw new Error('FROM_ACCOUNT_NOT_MONEY');
  if (!MONEY_SUBKINDS.includes(to.subKind))   throw new Error('TO_ACCOUNT_NOT_MONEY');

  // Cash-side → require open session
  const touchesCash = from.subKind === 'CASH' || to.subKind === 'CASH';
  if (touchesCash && !input.cashSessionId) {
    throw new Error('CASH_TRANSFER_REQUIRES_SESSION');
  }
  if (input.cashSessionId) {
    const cs = await tx.cashSession.findUnique({
      where: { id: input.cashSessionId },
      select: { status: true },
    });
    if (!cs || cs.status !== 'OPEN') throw new Error('CASH_SESSION_NOT_OPEN');
  }

  const batchId = randomUUID();
  const amount  = new Prisma.Decimal(String(input.amount));
  const date    = new Date();
  const description = `Transfer ${from.code} → ${to.code}${input.notes ? ` · ${input.notes}` : ''}`;

  const record = await tx.transferRecord.create({
    data: {
      date,
      fromAccountId: from.id,
      toAccountId:   to.id,
      amount,
      notes:         input.notes,
      batchId,
      cashSessionId: input.cashSessionId,
      createdBy:     input.createdBy,
    },
    select: { id: true },
  });

  // Post ledger pair directly (bypass postLedgerPair since we already have
  // the explicit FinancialAccount ids and the shared batchId).
  await tx.ledgerEntry.createMany({
    data: [
      {
        date,
        type:               LedgerType.DEBIT,
        account:            legacyAccountFor(to.subKind),
        financialAccountId: to.id,
        batchId,
        amount,
        referenceType:      'Transfer',
        referenceId:        record.id,
        description,
        createdBy:          input.createdBy,
      },
      {
        date,
        type:               LedgerType.CREDIT,
        account:            legacyAccountFor(from.subKind),
        financialAccountId: from.id,
        batchId,
        amount,
        referenceType:      'Transfer',
        referenceId:        record.id,
        description,
        createdBy:          input.createdBy,
      },
    ],
  });

  return record;
}
