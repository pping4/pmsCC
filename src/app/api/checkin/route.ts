import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { bookingId, notes } = body;

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { room: true, guest: true },
  });

  if (!booking) return NextResponse.json({ error: 'ไม่พบข้อมูลการจอง' }, { status: 404 });
  if (booking.status !== 'confirmed') {
    return NextResponse.json({ error: 'การจองนี้ไม่อยู่ในสถานะรอเช็คอิน' }, { status: 400 });
  }

  const [updatedBooking] = await prisma.$transaction([
    prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: 'checked_in',
        actualCheckIn: new Date(),
        ...(notes && { notes }),
      },
      include: { guest: true, room: { include: { roomType: true } } },
    }),
    prisma.room.update({
      where: { id: booking.roomId },
      data: { status: 'occupied', currentBookingId: bookingId },
    }),
  ]);

  return NextResponse.json({ success: true, booking: updatedBooking });
}
