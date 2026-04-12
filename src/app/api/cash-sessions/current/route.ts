/**
 * /api/cash-sessions/current
 * GET — returns the caller's currently OPEN session (or null)
 *
 * Used by the frontend to:
 *  - Show "กะเปิดอยู่" badge in the navbar
 *  - Gate the payment collection modal (cash requires an open session)
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cashSession = await prisma.cashSession.findFirst({
    where:  { openedBy: session.user.id, status: 'OPEN' },
    select: {
      id:             true,
      openedAt:       true,
      openingBalance: true,
      openedByName:   true,
      _count: { select: { payments: true } },
    },
    orderBy: { openedAt: 'desc' },
  });

  if (!cashSession) {
    return NextResponse.json({ session: null });
  }

  return NextResponse.json({
    session: {
      id:             cashSession.id,
      openedAt:       cashSession.openedAt,
      openingBalance: Number(cashSession.openingBalance),
      openedByName:   cashSession.openedByName,
      totalPayments:  cashSession._count.payments,
    },
  });
}
