/**
 * GET /api/bookings/[id]/segments
 *
 * Returns the booking's BookingRoomSegment rows (sorted by fromDate asc),
 * used by the SPLIT wizard to let the operator pick which segment to cut.
 *
 * Read-only. Only exposes scalar fields + joined room.number for display —
 * not the full Booking object (data-privacy: the dialog only needs segment
 * geometry + rate to render).
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
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const segments = await prisma.bookingRoomSegment.findMany({
      where:   { bookingId: params.id },
      orderBy: { fromDate: 'asc' },
      select: {
        id:          true,
        roomId:      true,
        fromDate:    true,
        toDate:      true,
        rate:        true,
        bookingType: true,
        room:        { select: { number: true } },
      },
    });

    const toYmd = (d: Date) => d.toISOString().slice(0, 10);

    return NextResponse.json({
      segments: segments.map(s => ({
        id:          s.id,
        roomId:      s.roomId,
        roomNumber:  s.room?.number ?? null,
        fromDate:    toYmd(s.fromDate),
        toDate:      toYmd(s.toDate),
        rate:        s.rate.toString(),
        bookingType: s.bookingType,
      })),
    });
  } catch (err) {
    console.error('[segments] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
