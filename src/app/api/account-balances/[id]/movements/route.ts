/**
 * GET /api/account-balances/[id]/movements
 *
 * Returns every ledger entry touching this FinancialAccount in a date window,
 * plus a running balance column. The natural-side formula (ASSET/EXPENSE = DR−CR,
 * LIABILITY/EQUITY/REVENUE = CR−DR) is applied so the running column tracks
 * the same sign convention as the balance shown on the overview dashboard.
 *
 * Query:
 *   ?from=YYYY-MM-DD  (inclusive — default: 30 days ago)
 *   ?to=YYYY-MM-DD    (inclusive end-of-day — default: now)
 *   ?limit=200        (default 200, max 500)
 *
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

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const fromParam = url.searchParams.get('from');
  const toParam   = url.searchParams.get('to');
  const limit     = Math.min(Number(url.searchParams.get('limit') ?? 200), 500);

  const now = new Date();
  const defaultFrom = new Date(now); defaultFrom.setDate(defaultFrom.getDate() - 30);
  const from = fromParam ? new Date(fromParam) : defaultFrom;
  const to   = toParam   ? new Date(toParam)   : now;
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  }
  // Inclusive end-of-day when `to` was a date-only string
  if (toParam && /^\d{4}-\d{2}-\d{2}$/.test(toParam)) {
    to.setHours(23, 59, 59, 999);
  }

  const account = await prisma.financialAccount.findUnique({
    where: { id: params.id },
    select: {
      id: true, code: true, name: true, kind: true, subKind: true,
      openingBalance: true,
    },
  });
  if (!account) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  // Baseline = opening balance + signed sum of all entries strictly before `from`
  const before = await prisma.ledgerEntry.groupBy({
    by: ['type'],
    where: { financialAccountId: params.id, date: { lt: from } },
    _sum: { amount: true },
  });
  const priorDebit  = Number(before.find(r => r.type === 'DEBIT')?._sum.amount  ?? 0);
  const priorCredit = Number(before.find(r => r.type === 'CREDIT')?._sum.amount ?? 0);
  const debitSide   = isDebitNatural(account.kind);
  const baseline    = Number(account.openingBalance)
                    + (debitSide ? priorDebit - priorCredit : priorCredit - priorDebit);

  // Window entries — oldest first so we can compute running balance
  const entries = await prisma.ledgerEntry.findMany({
    where: { financialAccountId: params.id, date: { gte: from, lte: to } },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    take: limit,
    select: {
      id: true, date: true, type: true, amount: true,
      description: true, referenceType: true, referenceId: true,
      batchId: true, createdBy: true, createdAt: true,
    },
  });

  let running = baseline;
  const movements = entries.map(e => {
    const amt = Number(e.amount);
    const signed = debitSide
      ? (e.type === 'DEBIT' ? amt : -amt)
      : (e.type === 'CREDIT' ? amt : -amt);
    running += signed;
    return {
      id:            e.id,
      date:          e.date,
      type:          e.type,                // DEBIT | CREDIT
      amount:        amt,
      signedDelta:   signed,                 // positive = balance ↑, negative = ↓
      description:   e.description,
      referenceType: e.referenceType,
      referenceId:   e.referenceId,
      batchId:       e.batchId,
      createdBy:     e.createdBy,
      runningBalance: running,
    };
  });

  return NextResponse.json({
    account: {
      id: account.id, code: account.code, name: account.name,
      kind: account.kind, subKind: account.subKind,
    },
    window: { from, to },
    baseline,
    closing: running,
    movements,
  });
}
