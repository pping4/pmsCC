import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function tomorrowRange() {
  const { end: start } = todayRange();
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

// ─── GET /api/rooms/daily-report ──────────────────────────────────────────────
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const today    = todayRange();
  const tomorrow = tomorrowRange();

  // Guest select reused for all booking queries
  const guestSelect = {
    id: true,
    firstName: true,
    lastName: true,
    firstNameTH: true,
    lastNameTH: true,
    phone: true,
  };

  const bookingSelect = {
    id: true,
    bookingNumber: true,
    checkIn: true,
    checkOut: true,
    status: true,
    bookingType: true,
    rate: true,
    guest: { select: guestSelect },
    room: { select: { id: true, number: true, floor: true } },
  };

  const [checkInsToday, checkOutsToday, checkInsTomorrow, checkOutsTomorrow] =
    await Promise.all([
      // ① confirmed bookings whose check-in date is today
      (prisma.booking as any).findMany({
        where: {
          status: 'confirmed',
          checkIn: { gte: today.start, lt: today.end },
        },
        select: bookingSelect,
        orderBy: { room: { number: 'asc' } },
      }),

      // ② currently checked-in whose check-out date is today
      (prisma.booking as any).findMany({
        where: {
          status: 'checked_in',
          checkOut: { gte: today.start, lt: today.end },
        },
        select: bookingSelect,
        orderBy: { room: { number: 'asc' } },
      }),

      // ③ confirmed bookings arriving tomorrow
      (prisma.booking as any).findMany({
        where: {
          status: 'confirmed',
          checkIn: { gte: tomorrow.start, lt: tomorrow.end },
        },
        select: bookingSelect,
        orderBy: { room: { number: 'asc' } },
      }),

      // ④ checked-in guests checking out tomorrow
      (prisma.booking as any).findMany({
        where: {
          status: 'checked_in',
          checkOut: { gte: tomorrow.start, lt: tomorrow.end },
        },
        select: bookingSelect,
        orderBy: { room: { number: 'asc' } },
      }),
    ]);

  // Serialize Decimal / Date fields
  const serialize = (list: any[]) =>
    list.map((b: any) => ({
      id: b.id,
      bookingNumber: b.bookingNumber,
      bookingType: b.bookingType,
      status: b.status,
      checkIn: b.checkIn,
      checkOut: b.checkOut,
      rate: Number(b.rate),
      guest: b.guest,
      room: b.room,
    }));

  return NextResponse.json({
    date: today.start.toISOString().slice(0, 10),
    checkInsToday:     serialize(checkInsToday),
    checkOutsToday:    serialize(checkOutsToday),
    checkInsTomorrow:  serialize(checkInsTomorrow),
    checkOutsTomorrow: serialize(checkOutsTomorrow),
  });
}
