/**
 * GET /api/reports/financial?type=pl|bs&from=...&to=...&asOf=...
 *
 * Two built-in statements, both derived from the ledger:
 *
 *   • type=pl (Profit & Loss) — movements inside [from, to]
 *       Revenue groups: REVENUE accounts — natural credit
 *       Expense groups: EXPENSE accounts — natural debit
 *       Net income = Σrevenue − Σexpense
 *
 *   • type=bs (Balance Sheet) — balances as of `asOf`
 *       Assets       (ASSET,  debit-natural)
 *       Liabilities  (LIABILITY, credit-natural)
 *       Equity       (EQUITY,    credit-natural)
 *       Retained earnings = YTD revenue − YTD expense (computed inside)
 *       Identity: Assets = Liabilities + Equity + Retained earnings
 *
 * Both queries use grouped aggregates (one DB round-trip per statement).
 * Auth: any authenticated user.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { AccountKind } from '@prisma/client';

function isDebitNatural(kind: AccountKind) {
  return kind === 'ASSET' || kind === 'EXPENSE';
}

/**
 * Compute per-account balance for a set of accounts, optionally bounded by date range.
 * @param dateFilter passed directly to ledger where-clause (use { gte, lte } or { lte } as needed)
 */
async function computeBalances(
  where: { kind?: AccountKind },
  dateFilter: { gte?: Date; lte?: Date },
  addOpening = false,
) {
  const accounts = await prisma.financialAccount.findMany({
    where: { ...where, isActive: true },
    select: {
      id: true, code: true, name: true, kind: true, subKind: true,
      openingBalance: true,
    },
    orderBy: [{ kind: 'asc' }, { code: 'asc' }],
  });
  if (accounts.length === 0) return [];

  const rows = await prisma.ledgerEntry.groupBy({
    by: ['financialAccountId', 'type'],
    where: {
      financialAccountId: { in: accounts.map(a => a.id) },
      ...(dateFilter.gte || dateFilter.lte ? { date: dateFilter } : {}),
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
    const opening = addOpening ? Number(a.openingBalance) : 0;
    const delta   = isDebitNatural(a.kind) ? debit - credit : credit - debit;
    return {
      id:      a.id,
      code:    a.code,
      name:    a.name,
      kind:    a.kind,
      subKind: a.subKind,
      balance: opening + delta,
    };
  });
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url  = new URL(request.url);
  const type = url.searchParams.get('type') ?? 'pl';

  if (type === 'pl') {
    const fromParam = url.searchParams.get('from');
    const toParam   = url.searchParams.get('to');

    // Default: this month (1st → today end-of-day)
    const now = new Date();
    const defFrom = new Date(now.getFullYear(), now.getMonth(), 1);
    const from = fromParam ? new Date(fromParam) : defFrom;
    const to   = toParam   ? new Date(toParam)   : now;
    if (toParam && /^\d{4}-\d{2}-\d{2}$/.test(toParam)) to.setHours(23, 59, 59, 999);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
    }

    const [revenue, expense, refundsAgg] = await Promise.all([
      computeBalances({ kind: 'REVENUE' }, { gte: from, lte: to }, false),
      computeBalances({ kind: 'EXPENSE' }, { gte: from, lte: to }, false),
      // Refunds netted into revenue are invisible to the cashier — surface
      // them as a separate breakdown so a manager can see "เราคืนเงินไป
      // เท่าไหร่ในเดือนนี้" without the user having to know that revenue is
      // already net.
      prisma.refundRecord.aggregate({
        where: {
          status:      'processed' as never,
          processedAt: { gte: from, lte: to },
        },
        _sum:   { amount: true },
        _count: { _all: true },
      }),
    ]);

    const totalRevenue = revenue.reduce((s, a) => s + a.balance, 0);
    const totalExpense = expense.reduce((s, a) => s + a.balance, 0);
    const refundsTotal = Number(refundsAgg._sum.amount ?? 0);
    const refundsCount = refundsAgg._count._all;

    return NextResponse.json({
      type: 'pl',
      window: { from, to },
      revenue,
      expense,
      // Visibility line — already netted INTO `revenue` by the ledger DR/CR
      // pair, but a separate field lets the UI show "หัก: คืนเงิน ฿X (Y รายการ)"
      // alongside the gross-revenue breakdown.
      refunds: { total: refundsTotal, count: refundsCount },
      totals: {
        revenue:   totalRevenue,
        expense:   totalExpense,
        netIncome: totalRevenue - totalExpense,
      },
    });
  }

  if (type === 'bs') {
    const asOfParam = url.searchParams.get('asOf');
    const asOf = asOfParam ? new Date(asOfParam) : new Date();
    if (asOfParam && /^\d{4}-\d{2}-\d{2}$/.test(asOfParam)) asOf.setHours(23, 59, 59, 999);
    if (isNaN(asOf.getTime())) return NextResponse.json({ error: 'Invalid asOf' }, { status: 400 });

    const [assets, liab, equity, revenueYTD, expenseYTD] = await Promise.all([
      computeBalances({ kind: 'ASSET' },     { lte: asOf }, true),
      computeBalances({ kind: 'LIABILITY' }, { lte: asOf }, true),
      computeBalances({ kind: 'EQUITY' },    { lte: asOf }, true),
      computeBalances({ kind: 'REVENUE' },   { lte: asOf }, false),
      computeBalances({ kind: 'EXPENSE' },   { lte: asOf }, false),
    ]);

    const totalAssets    = assets.reduce((s, a) => s + a.balance, 0);
    const totalLiab      = liab.reduce((s, a) => s + a.balance, 0);
    const totalEquityRaw = equity.reduce((s, a) => s + a.balance, 0);
    const retained       = revenueYTD.reduce((s, a) => s + a.balance, 0)
                         - expenseYTD.reduce((s, a) => s + a.balance, 0);
    const totalEquity    = totalEquityRaw + retained;

    return NextResponse.json({
      type: 'bs',
      asOf,
      assets,
      liabilities: liab,
      equity,
      retainedEarnings: retained,
      totals: {
        assets:      totalAssets,
        liabilities: totalLiab,
        equity:      totalEquity,
        balanceCheck: totalAssets - (totalLiab + totalEquity), // should be 0 if books balance
      },
    });
  }

  return NextResponse.json({ error: 'Invalid type (use pl or bs)' }, { status: 400 });
}
