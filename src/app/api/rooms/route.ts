import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { fetchRateMap } from '@/lib/room-rate-db';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const floor  = searchParams.get('floor');

  // tomorrow 00:00 — for "next upcoming" booking
  const tomorrow = new Date();
  tomorrow.setHours(0, 0, 0, 0);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // ① Rooms with their current active booking + open maintenance flag
  const rooms = await (prisma.room as any).findMany({
    where: {
      ...(status && status !== 'all' ? { status: status as never } : {}),
      ...(floor  && floor  !== 'all' ? { floor: parseInt(floor)  } : {}),
    },
    include: {
      roomType: true,
      bookings: {
        where: { status: { in: ['checked_in', 'confirmed'] } },
        include: {
          guest: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              firstNameTH: true,
              lastNameTH: true,
              nationality: true,
              phone: true,
            },
          },
        },
        orderBy: { checkIn: 'desc' },
        take: 1,
      },
      maintenanceTasks: {
        where: { status: { in: ['open', 'in_progress'] } },
        select: { id: true },
        take: 1,
      },
    },
    orderBy: [{ floor: 'asc' }, { number: 'asc' }],
  });

  // ② Next confirmed bookings per room (starting from tomorrow onward)
  //    One query for all rooms; we build a Map by roomId.
  const nextBookingsRaw = await (prisma.booking as any).findMany({
    where: {
      status: 'confirmed',
      checkIn: { gte: tomorrow },
    },
    include: {
      guest: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          firstNameTH: true,
          lastNameTH: true,
        },
      },
    },
    orderBy: { checkIn: 'asc' },
  });

  // Build roomId → earliest nextBooking map
  const nextBookingMap = new Map<string, any>();
  for (const nb of nextBookingsRaw) {
    if (!nextBookingMap.has(nb.roomId)) {
      nextBookingMap.set(nb.roomId, nb);
    }
  }

  // ③ Load room rates
  let rateMap: Record<string, any> = {};
  try {
    rateMap = await fetchRateMap();
  } catch {
    // room_rates not ready — rates will be null
  }

  // ④ Assemble enriched response
  const enriched = rooms.map((room: any) => {
    const currentBooking = room.bookings[0] ?? null;
    const nextBookingRaw = nextBookingMap.get(room.id) ?? null;
    const hasMaintenance = room.maintenanceTasks.length > 0;

    return {
      id:               room.id,
      number:           room.number,
      floor:            room.floor,
      status:           room.status,
      notes:            room.notes,
      currentBookingId: room.currentBookingId,
      roomType:         room.roomType,
      rate:             rateMap[room.id] ?? null,
      hasMaintenance,

      currentBooking: currentBooking
        ? {
            id:            currentBooking.id,
            bookingNumber: currentBooking.bookingNumber,
            bookingType:   currentBooking.bookingType,
            status:        currentBooking.status,
            checkIn:       currentBooking.checkIn,
            checkOut:      currentBooking.checkOut,
            rate:          Number(currentBooking.rate),
            guest:         currentBooking.guest,
          }
        : null,

      nextBooking: nextBookingRaw
        ? {
            id:            nextBookingRaw.id,
            bookingNumber: nextBookingRaw.bookingNumber,
            checkIn:       nextBookingRaw.checkIn,
            checkOut:      nextBookingRaw.checkOut,
            rate:          Number(nextBookingRaw.rate),
            guest:         nextBookingRaw.guest,
          }
        : null,
    };
  });

  return NextResponse.json(enriched);
}
