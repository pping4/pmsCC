/**
 * GET /api/account-balances — real-time balance per account.
 *
 * Query params:
 *   ?subKind=CASH,BANK,CARD_CLEARING  — filter by subKind list (default: money accounts)
 *   ?ids=<uuid,uuid>                  — explicit id list (overrides subKind filter)
 *   ?asOf=2026-04-21                  — snapshot date (default: now)
 *
 * Auth: any authenticated user (balances are internal reporting data).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getAccountBalances } from '@/services/accountBalance.service';
import { AccountSubKind } from '@prisma/client';

const DEFAULT_MONEY_SUBKINDS: AccountSubKind[] = ['CASH', 'BANK', 'CARD_CLEARING', 'UNDEPOSITED_FUNDS'];

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const subKindParam = url.searchParams.get('subKind');
  const idsParam     = url.searchParams.get('ids');
  const asOfParam    = url.searchParams.get('asOf');

  const asOf = asOfParam ? new Date(asOfParam) : new Date();
  if (asOfParam && isNaN(asOf.getTime())) {
    return NextResponse.json({ error: 'Invalid asOf' }, { status: 400 });
  }

  let accountIds: string[] | undefined;
  if (idsParam) {
    accountIds = idsParam.split(',').map(s => s.trim()).filter(Boolean);
  } else {
    const subKinds = (subKindParam ? subKindParam.split(',') : DEFAULT_MONEY_SUBKINDS) as AccountSubKind[];
    const rows = await prisma.financialAccount.findMany({
      where: { isActive: true, subKind: { in: subKinds } },
      select: { id: true, subKind: true },
    });
    accountIds = rows.map(r => r.id);
  }

  // Fetch subKind alongside balance for UI grouping
  const [balances, meta] = await Promise.all([
    getAccountBalances(accountIds, asOf),
    prisma.financialAccount.findMany({
      where: { id: { in: accountIds } },
      select: {
        id: true, subKind: true,
        bankName: true, bankAccountNo: true, isDefault: true,
      },
    }),
  ]);

  const metaMap = new Map(meta.map(m => [m.id, m]));
  const enriched = balances.map(b => ({
    ...b,
    subKind:       metaMap.get(b.accountId)?.subKind,
    bankName:      metaMap.get(b.accountId)?.bankName ?? null,
    bankAccountNo: metaMap.get(b.accountId)?.bankAccountNo ?? null,
    isDefault:     metaMap.get(b.accountId)?.isDefault ?? false,
  }));

  return NextResponse.json({ balances: enriched, asOf });
}
