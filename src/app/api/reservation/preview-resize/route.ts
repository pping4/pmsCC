import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { recalculateRate, RateCalculationContext } from '@/services/bookingRate.service';
import { z } from 'zod';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * Helper: Convert YYYY-MM-DD string to UTC midnight
 */
function toUTCMidnight(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00.000Z');
}

/**
 * Zod schema for preview-resize request
 */
const PreviewResizeSchema = z.object({
  bookingId: z.string().min(1, 'bookingId required'),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'checkIn must be YYYY-MM-DD'),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'checkOut must be YYYY-MM-DD'),
  roomId: z.string().optional(),
});

export async function POST(request: NextRequest) {
  // Auth check (first step)
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = PreviewResizeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { bookingId, checkIn, checkOut, roomId } = parsed.data;

    const newCheckIn = toUTCMidnight(checkIn);
    const newCheckOut = toUTCMidnight(checkOut);

    if (newCheckOut <= newCheckIn) {
      return NextResponse.json(
        { error: 'checkOut ต้องหลัง checkIn' },
        { status: 400 }
      );
    }

    // Fetch booking with version field (using type assertion due to Prisma type generation)
    const booking = (await prisma.booking.findUnique({
      where: { id: bookingId },
    })) as any;

    if (!booking) {
      return NextResponse.json({ error: 'ไม่พบการจอง' }, { status: 404 });
    }

    // Early exit for checked_out / cancelled
    if (booking.status === 'cancelled' || booking.status === 'checked_out') {
      return NextResponse.json(
        {
          allowed: false,
          scenario: booking.status === 'checked_out' ? 'E' : 'F',
          currentVersion: booking.version,
          financial: {
            newRate: '0',
            rateChange: '0',
            requiresConfirmation: false,
            userMessage: booking.status === 'checked_out'
              ? 'ไม่สามารถแก้ไขการจองที่เช็คเอาท์แล้ว'
              : 'ไม่สามารถแก้ไขการจองที่ยกเลิกแล้ว',
          },
        },
        { status: 400 }
      );
    }

    const targetRoomId = roomId || booking.roomId;

    // === RATE RECALCULATION LOGIC (read-only) ===
    // Use a read-only transaction to simulate the rate calculation
    const rateResult = await prisma.$transaction(async (tx) => {
      const context: RateCalculationContext = {
        bookingId,
        newCheckIn,
        newCheckOut,
        currentRate: booking.rate,
        currentDeposit: booking.deposit,
        bookingStatus: booking.status,
        bookingType: booking.bookingType,
        roomId: targetRoomId,
        checkIn: new Date(booking.checkIn),
        checkOut: new Date(booking.checkOut),
      };

      return recalculateRate(context, tx);
    });

    // === DOUBLE-BOOKING VALIDATION ===
    const conflict = await prisma.booking.findFirst({
      where: {
        id: { not: bookingId },
        roomId: targetRoomId,
        status: { in: ['confirmed', 'checked_in'] },
        checkIn: { lt: newCheckOut },
        checkOut: { gt: newCheckIn },
      },
      select: {
        bookingNumber: true,
        guest: {
          select: {
            firstName: true,
            lastName: true,
            firstNameTH: true,
            lastNameTH: true,
          },
        },
      },
    });

    if (conflict) {
      const guestName =
        conflict.guest.firstNameTH && conflict.guest.lastNameTH
          ? `${conflict.guest.firstNameTH} ${conflict.guest.lastNameTH}`
          : `${conflict.guest.firstName} ${conflict.guest.lastName}`;
      return NextResponse.json(
        {
          allowed: false,
          scenario: rateResult.scenario,
          currentVersion: booking.version,
          financial: {
            newRate: rateResult.newRate.toString(),
            rateChange: rateResult.rateChange.toString(),
            requiresConfirmation: false,
            warning: `วันที่ทับซ้อนกับการจอง ${conflict.bookingNumber} (${guestName})`,
          },
        },
        { status: 409 }
      );
    }

    // === RETURN PREVIEW ===
    return NextResponse.json({
      allowed: rateResult.isAllowed,
      scenario: rateResult.scenario,
      currentVersion: booking.version,
      financial: {
        newRate: rateResult.newRate.toString(),
        rateChange: rateResult.rateChange.toString(),
        requiresConfirmation: rateResult.requiresConfirmation,
        warning: rateResult.warning,
        userMessage: rateResult.userMessage,
        refundDue: rateResult.refundDue?.toString(),
        additionalCharge: rateResult.additionalCharge?.toString(),
      },
    });
  } catch (error) {
    console.error('POST /api/reservation/preview-resize error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
