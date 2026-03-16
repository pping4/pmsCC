import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const booking = await prisma.booking.findUnique({
    where: { id: params.id },
    include: {
      guest: true,
      room: { include: { roomType: true } },
      invoices: { include: { items: true } },
    },
  });

  if (!booking) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(booking);
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const data = await request.json();

  if (data.action === 'checkin') {
    const booking = await prisma.booking.update({
      where: { id: params.id },
      data: { status: 'checked_in' },
    });
    await prisma.room.update({
      where: { id: booking.roomId },
      data: { status: 'occupied', currentBookingId: booking.id },
    });
    return NextResponse.json(booking);
  }

  if (data.action === 'checkout') {
    const booking = await prisma.booking.update({
      where: { id: params.id },
      data: { status: 'checked_out' },
    });
    await prisma.room.update({
      where: { id: booking.roomId },
      data: { status: 'cleaning', currentBookingId: null },
    });
    return NextResponse.json(booking);
  }

  const booking = await prisma.booking.update({
    where: { id: params.id },
    data: {
      checkIn: data.checkIn ? new Date(data.checkIn) : undefined,
      checkOut: data.checkOut ? new Date(data.checkOut) : undefined,
      rate: data.rate,
      deposit: data.deposit,
      status: data.status,
      notes: data.notes,
    },
    include: { guest: true, room: { include: { roomType: true } } },
  });

  return NextResponse.json(booking);
}
