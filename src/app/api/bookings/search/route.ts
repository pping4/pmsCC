/**
 * GET /api/bookings/search?q=... — lookup by bookingNumber prefix or UUID.
 * Used by OTA match UI.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  if (q.length < 3) return NextResponse.json([]);

  const rows = await prisma.booking.findMany({
    where: {
      OR: [
        { bookingNumber: { contains: q, mode: 'insensitive' } },
        { id: q },
      ],
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, bookingNumber: true, checkIn: true, checkOut: true,
      guest: { select: { firstName: true, lastName: true } },
    },
    take: 10,
  });
  return NextResponse.json(rows);
}
