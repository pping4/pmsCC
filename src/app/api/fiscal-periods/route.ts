/**
 * GET  /api/fiscal-periods?year=YYYY
 *    Returns all 12 months for the requested year with status + close metadata.
 *    Months that have no row are reported as OPEN (the implicit default).
 *    Auth: any authenticated user.
 *
 * POST /api/fiscal-periods/close   (in /close/route.ts)
 * POST /api/fiscal-periods/reopen  (in /reopen/route.ts)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const yearParam = url.searchParams.get('year');
  const year = yearParam ? Number(yearParam) : new Date().getFullYear();
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: 'Invalid year' }, { status: 400 });
  }

  // Defensive: if the Prisma client hasn't been regenerated yet (model
  // missing) or the migration hasn't been applied (table missing), show
  // 12 implicit-OPEN months rather than a 500 so the admin UI still loads.
  let rows: Array<{
    id: string; year: number; month: number; status: 'OPEN' | 'CLOSED';
    closedAt: Date | null; closedBy: string | null;
    reopenedAt: Date | null; reopenedBy: string | null; reopenReason: string | null;
    notes: string | null;
  }> = [];
  const model = (prisma as unknown as { fiscalPeriod?: typeof prisma.fiscalPeriod }).fiscalPeriod;
  if (model) {
    try {
      rows = await model.findMany({
        where: { year },
        select: {
          id: true, year: true, month: true, status: true,
          closedAt: true, closedBy: true,
          reopenedAt: true, reopenedBy: true, reopenReason: true,
          notes: true,
        },
        orderBy: { month: 'asc' },
      });
    } catch {
      rows = [];
    }
  }

  // Always return 12 rows — fill missing months with implicit OPEN
  const byMonth = new Map(rows.map(r => [r.month, r]));
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    return byMonth.get(m) ?? {
      id: null, year, month: m, status: 'OPEN' as const,
      closedAt: null, closedBy: null,
      reopenedAt: null, reopenedBy: null, reopenReason: null,
      notes: null,
    };
  });

  return NextResponse.json({ year, months });
}
