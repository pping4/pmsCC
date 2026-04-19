/**
 * GET /api/bookings/[id]/move-candidates
 *
 * Rooms that can receive the booking as a MOVE target (guest-initiated
 * room change; may cross room types). Read-only.
 *
 * Optional query param `effectiveDate=YYYY-MM-DD` — for in-house moves that
 * split mid-stay, availability is checked from `effectiveDate` onward, not
 * from the original check-in.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { listMoveCandidates } from '@/services/roomChange.service';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const effectiveDateStr = request.nextUrl.searchParams.get('effectiveDate');
  let effectiveDate: Date | undefined;
  if (effectiveDateStr) {
    // Expect YYYY-MM-DD; interpret as UTC midnight.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDateStr)) {
      return NextResponse.json(
        { error: 'effectiveDate must be YYYY-MM-DD' },
        { status: 422 },
      );
    }
    effectiveDate = new Date(`${effectiveDateStr}T00:00:00.000Z`);
  }

  try {
    const candidates = await listMoveCandidates(prisma, params.id, effectiveDate);
    return NextResponse.json({ candidates });
  } catch (err) {
    console.error('[move-candidates] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
