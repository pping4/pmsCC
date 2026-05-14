/**
 * GET /api/bookings/[id]/readings
 *
 * Returns the meter-reading history for a single booking, ordered by
 * readingDate desc (most-recent first).
 *
 * Phase 6.1 — meter reading data-flow (CLAUDE.md security checklist):
 * ✅ Auth: session required
 * ✅ RBAC: admin / manager / staff only
 * ✅ select: only public fields returned (no internal ids beyond what's needed)
 * ✅ No schema leaks in error messages
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // RBAC: only admin / manager / staff may read meter data
  const allowedRoles = ['admin', 'manager', 'staff'] as const;
  const userRole = (session.user as { role?: string }).role ?? '';
  if (!allowedRoles.includes(userRole as typeof allowedRoles[number])) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const bookingId = params.id;
  if (!bookingId) {
    return NextResponse.json({ error: 'Missing booking id' }, { status: 400 });
  }

  // Confirm booking exists (security: don't reveal readings for non-existent bookings)
  const booking = await prisma.booking.findUnique({
    where:  { id: bookingId },
    select: { id: true },
  });
  if (!booking) {
    return NextResponse.json({ error: 'ไม่พบข้อมูลการจอง' }, { status: 404 });
  }

  const readings = await prisma.utilityReading.findMany({
    where:   { bookingId },
    orderBy: { readingDate: 'desc' },
    select: {
      id:           true,
      readingDate:  true,
      prevWater:    true,
      currWater:    true,
      waterRate:    true,
      prevElectric: true,
      currElectric: true,
      electricRate: true,
      notes:        true,
      recordedBy:   true,
      recordedAt:   true,
    },
  });

  return NextResponse.json(
    readings.map((r) => ({
      id:            r.id,
      // ISO date-only string — safe for API payloads (no display use here)
      readingDate:   r.readingDate?.toISOString().slice(0, 10) ?? null,
      prevWater:     Number(r.prevWater),
      currWater:     Number(r.currWater),
      waterRate:     r.waterRate    !== null ? Number(r.waterRate)    : null,
      prevElectric:  Number(r.prevElectric),
      currElectric:  Number(r.currElectric),
      electricRate:  r.electricRate !== null ? Number(r.electricRate) : null,
      // Derived: usage since previous reading
      waterUsage:    Number(r.currWater)    - Number(r.prevWater),
      electricUsage: Number(r.currElectric) - Number(r.prevElectric),
      notes:         r.notes,
      recordedBy:    r.recordedBy,
      recordedAt:    r.recordedAt?.toISOString() ?? null,
    })),
  );
}
