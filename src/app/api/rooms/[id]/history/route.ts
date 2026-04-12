import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/rooms/[id]/history
 * Returns all bookings for a given room (past & current), with guest + companions + photos.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const roomId = params.id;

  // Validate room exists
  const room = await (prisma.room as any).findUnique({
    where: { id: roomId },
    select: { id: true, number: true, floor: true },
  });
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

  // All bookings for this room, most recent first
  const bookings = await (prisma.booking as any).findMany({
    where: { roomId },
    select: {
      id: true,
      bookingNumber: true,
      bookingType: true,
      source: true,
      status: true,
      checkIn: true,
      checkOut: true,
      actualCheckIn: true,
      actualCheckOut: true,
      rate: true,
      deposit: true,
      notes: true,
      createdAt: true,
      guest: {
        select: {
          id: true,
          title: true,
          firstName: true,
          lastName: true,
          firstNameTH: true,
          lastNameTH: true,
          nationality: true,
          phone: true,
          facePhotoUrl: true,
          idPhotoUrl: true,
          dateOfBirth: true,
        },
      },
      companions: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          firstNameTH: true,
          lastNameTH: true,
          phone: true,
          idType: true,
          idNumber: true,
          nationality: true,
          notes: true,
          createdAt: true,
          photos: {
            select: {
              id: true,
              filename: true,
              photoType: true,
              size: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: { checkIn: 'desc' },
    take: 50, // max 50 history entries
  });

  // Serialize Decimal fields
  const serialized = bookings.map((b: any) => ({
    ...b,
    rate: Number(b.rate),
    deposit: Number(b.deposit),
  }));

  return NextResponse.json({
    room,
    bookings: serialized,
  });
}
