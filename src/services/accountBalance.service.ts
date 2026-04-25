/**
 * Account balance service — computes real-time balance for FinancialAccount rows.
 *
 * Balance = openingBalance + Σ(signed ledger entries)
 *
 * Sign convention (standard double-entry):
 *   ASSET / EXPENSE  → natural debit  : balance = debit − credit
 *   LIABILITY / EQUITY / REVENUE → natural credit : balance = credit − debit
 *
 * Because posted ledger entries are immutable and Phase B wires every posting site
 * through postLedgerPair with financialAccountId set, summing ledger_entries by
 * financial_account_id gives an authoritative balance without any drift.
 *
 * Perf: one GROUP BY query per call (no N+1). For the dashboard we batch all
 * money-subKind accounts in a single query.
 */

import { prisma } from '@/lib/prisma';
import { AccountKind } from '@prisma/client';

export interface AccountBalance {
  accountId:      string;
  code:           string;
  name:           string;
  kind:           AccountKind;
  openingBalance: number;
  debitTotal:     number;
  creditTotal:    number;
  balance:        number;       // signed per natural side
  asOf:           Date;
}

/** Accounts whose natural side is debit (balance = debit − credit). */
function isDebitNatural(kind: AccountKind) {
  return kind === 'ASSET' || kind === 'EXPENSE';
}

/**
 * Compute balances for one or many accounts at a given date (default: now).
 *
 * @param accountIds  if omitted → all active accounts
 * @param asOf        upper bound on ledger entry `date` (inclusive) — default now
 */
export async function getAccountBalances(
  accountIds?: string[],
  asOf: Date = new Date(),
): Promise<AccountBalance[]> {
  const accounts = await prisma.financialAccount.findMany({
    where: accountIds?.length
      ? { id: { in: accountIds } }
      : { isActive: true },
    select: {
      id: true, code: true, name: true, kind: true,
      openingBalance: true, openingBalanceAt: true,
    },
    orderBy: [{ kind: 'asc' }, { code: 'asc' }],
  });

  if (accounts.length === 0) return [];

  // One grouped query covering all requested accounts — O(1) round-trip.
  const rows = await prisma.ledgerEntry.groupBy({
    by: ['financialAccountId', 'type'],
    where: {
      financialAccountId: { in: accounts.map(a => a.id) },
      date: { lte: asOf },
    },
    _sum: { amount: true },
  });

  const agg = new Map<string, { debit: number; credit: number }>();
  for (const r of rows) {
    if (!r.financialAccountId) continue;
    const cur = agg.get(r.financialAccountId) ?? { debit: 0, credit: 0 };
    const amt = Number(r._sum.amount ?? 0);
    if (r.type === 'DEBIT')  cur.debit  += amt;
    if (r.type === 'CREDIT') cur.credit += amt;
    agg.set(r.financialAccountId, cur);
  }

  return accounts.map(a => {
    const { debit = 0, credit = 0 } = agg.get(a.id) ?? {};
    const opening = Number(a.openingBalance);
    const delta   = isDebitNatural(a.kind) ? debit - credit : credit - debit;
    return {
      accountId:      a.id,
      code:           a.code,
      name:           a.name,
      kind:           a.kind,
      openingBalance: opening,
      debitTotal:     debit,
      creditTotal:    credit,
      balance:        opening + delta,
      asOf,
    };
  });
}

/** Convenience: single-account balance (throws if not found). */
export async function getAccountBalance(accountId: string, asOf?: Date) {
  const [b] = await getAccountBalances([accountId], asOf);
  if (!b) throw new Error('ACCOUNT_NOT_FOUND');
  return b;
}
