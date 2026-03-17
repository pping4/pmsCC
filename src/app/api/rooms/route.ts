import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const floor = searchParams.get('floor');

  const rooms = await prisma.room.findMany({
    where: {
      ...(status && status !== 'all' ? { status: status as never } : {}),
      ...(floor && floor !== 'all' ? { floor: parseInt(floor) } : {}),
    },
    include: {
      roomType: true,
      bookings: {
        where: {
          status: { in: ['checked_in', 'confirmed'] },
        },
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
    },
    orderBy: [{ floor: 'asc' }, { number: 'asc' }],
  });

  const enriched = rooms.map(room => {
    const currentBooking = room.bookings[0] || null;
    return {
      id: room.id,
      number: room.number,
      floor: room.floor,
      status: room.status,
      notes: room.notes,
      currentBookingId: room.currentBookingId,
      roomType: room.roomType,
      currentBooking: currentBooking ? {
        id: currentBooking.id,
        bookingNumber: currentBooking.bookingNumber,
        bookingType: currentBooking.bookingType,
        status: currentBooking.status,
        checkIn: currentBooking.checkIn,
        checkOut: currentBooking.checkOut,
        rate: Number(currentBooking.rate),
        guest: currentBooking.guest,
      } : null,
    };
  });

  return NextResponse.json(enriched);
}
