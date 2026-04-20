import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * Timezone-safe date formatter for @db.Date columns.
 * Prisma returns @db.Date as a Date at midnight in the server's local timezone.
 * Using toISOString() would shift dates back 1 day in UTC+ timezones.
 */
function formatDate(d: Date): string {
  const year  = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day   = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * GET /api/reservation/check-overlap
 * ?roomId=xxx&checkIn=YYYY-MM-DD&checkOut=YYYY-MM-DD&excludeId=yyy
 *
 * Returns whether the given date range overlaps an existing booking for the room.
 * Used by the NewBookingDialog and drag/resize handler before committing.
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const roomId    = searchParams.get('roomId');
    const checkIn   = searchParams.get('checkIn');
    const checkOut  = searchParams.get('checkOut');
    const excludeId = searchParams.get('excludeId') || undefined;

    if (!roomId || !checkIn || !checkOut) {
      return NextResponse.json({ error: 'roomId, checkIn, checkOut are required' }, { status: 400 });
    }

    const newCheckIn  = new Date(checkIn  + 'T00:00:00.000Z');
    const newCheckOut = new Date(checkOut + 'T00:00:00.000Z');

    if (newCheckOut <= newCheckIn) {
      return NextResponse.json({ hasOverlap: false });
    }

    // Segment-based overlap check. BookingRoomSegment is authoritative for
    // multi-segment stays (MOVE / SPLIT split a booking across rooms) —
    // checking Booking alone over/under-detects. See /api/bookings POST for
    // the full rationale.
    const conflictSeg = await prisma.bookingRoomSegment.findFirst({
      where: {
        roomId,
        fromDate: { lt: newCheckOut },
        toDate:   { gt: newCheckIn  },
        booking:  { status: { in: ['confirmed', 'checked_in'] } },
        ...(excludeId ? { bookingId: { not: excludeId } } : {}),
      },
      select: {
        fromDate: true,
        toDate:   true,
        booking:  {
          select: {
            id:            true,
            bookingNumber: true,
            checkIn:       true,
            checkOut:      true,
            guest: {
              select: {
                firstName:   true,
                lastName:    true,
                firstNameTH: true,
                lastNameTH:  true,
              },
            },
          },
        },
      },
    });

    if (!conflictSeg) {
      return NextResponse.json({ hasOverlap: false });
    }

    const conflict = conflictSeg.booking;
    const guestName = conflict.guest.firstNameTH && conflict.guest.lastNameTH
      ? `${conflict.guest.firstNameTH} ${conflict.guest.lastNameTH}`
      : `${conflict.guest.firstName} ${conflict.guest.lastName}`;

    return NextResponse.json({
      hasOverlap: true,
      conflictingBooking: {
        id:            conflict.id,
        bookingNumber: conflict.bookingNumber,
        guestName,
        // Return the SEGMENT window, not the booking window — the overlap
        // is specifically with this segment's occupancy of this room.
        checkIn:  formatDate(conflictSeg.fromDate),
        checkOut: formatDate(conflictSeg.toDate),
      },
    });
  } catch (error) {
    console.error('GET /api/reservation/check-overlap error:', error);
    return NextResponse.json(
      { error: 'เกิดข้อผิดพลาดในการตรวจสอบวันที่' },
      { status: 500 }
    );
  }
}
