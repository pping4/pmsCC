/**
 * GET /api/cash-sessions/current — Sprint 4B.
 *
 * Returns the caller's single active session (or null). Used by:
 *   - /cashier page on mount to decide state 1 (picker) vs state 2 (dashboard)
 *   - payment collection flows to know which cashBox receives the cash
 *
 * No permission required beyond authentication — every authenticated user
 * may ask "do *I* have an open shift?" (answer is always scoped to them).
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getActiveSessionForUser } from '@/services/cashSession.service';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const active = await prisma.$transaction((tx) =>
    getActiveSessionForUser(tx, session.user.id),
  );

  if (!active) return NextResponse.json({ session: null });

  // Enrich with a cheap payment count so the dashboard pill renders without
  // a second round-trip on first paint.
  const count = await prisma.payment.count({
    where: { cashSessionId: active.id, status: 'ACTIVE' },
  });

  return NextResponse.json({
    session: {
      id:             active.id,
      openedAt:       active.openedAt,
      openingBalance: active.openingBalance,
      cashBoxId:      active.cashBoxId,
      cashBoxCode:    active.cashBoxCode,
      cashBoxName:    active.cashBoxName,
      totalPayments:  count,
    },
  });
}
