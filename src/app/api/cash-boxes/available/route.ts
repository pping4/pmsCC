/**
 * GET /api/cash-boxes/available — Sprint 4B.
 *
 * Returns only the cash boxes a user could open a shift at right now:
 *   - isActive = true
 *   - currentSessionId IS NULL (no OPEN session)
 *
 * Used by the /cashier state-1 counter picker. We don't need permission
 * gating beyond authentication — seeing the list of empty counters is a
 * pre-condition to requesting cashier.open_shift. The POST that actually
 * opens a session is what enforces the permission.
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const boxes = await prisma.cashBox.findMany({
    where: {
      isActive:         true,
      currentSessionId: null,
    },
    select: {
      id:           true,
      code:         true,
      name:         true,
      location:     true,
      displayOrder: true,
    },
    orderBy: [{ displayOrder: 'asc' }, { code: 'asc' }],
  });

  return NextResponse.json({ boxes });
}
