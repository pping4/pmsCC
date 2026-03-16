import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');
  const status = searchParams.get('status');
  const search = searchParams.get('search') || '';

  const bookings = await prisma.booking.findMany({
    where: {
      ...(type && type !== 'all' ? { bookingType: type as never } : {}),
      ...(status && status !== 'all' ? { status: status as never } : {}),
      ...(search ? {
        OR: [
          { bookingNumber: { contains: search, mode: 'insensitive' } },
          { guest: { firstName: { contains: search, mode: 'insensitive' } } },
          { guest: { lastName: { contains: search, mode: 'insensitive' } } },
        ],
      } : {}),
    },
    include: {
      guest: true,
      room: { include: { roomType: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(bookings);
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const data = await request.json();

  // Generate booking number
  const count = await prisma.booking.count();
  const bookingNumber = `BK-${String(count + 1).padStart(4, '0')}`;

  // Find room by number
  const room = await prisma.room.findUnique({ where: { number: data.roomNumber } });
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

  const booking = await prisma.booking.create({
    data: {
      bookingNumber,
      guestId: data.guestId,
      roomId: room.id,
      bookingType: data.bookingType,
      source: data.source || 'direct',
      checkIn: new Date(data.checkIn),
      checkOut: new Date(data.checkOut),
      rate: data.rate,
      deposit: data.deposit || 0,
      status: 'confirmed',
      notes: data.notes || null,
    },
    include: {
      guest: true,
      room: { include: { roomType: true } },
    },
  });

  // Update room status to reserved
  await prisma.room.update({
    where: { id: room.id },
    data: { status: 'reserved', currentBookingId: booking.id },
  });

  return NextResponse.json(booking, { status: 201 });
}
