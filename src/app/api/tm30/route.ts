import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Get all active bookings (checked_in or confirmed) with foreign guests
  const bookings = await prisma.booking.findMany({
    where: {
      status: { in: ['checked_in', 'confirmed'] },
      guest: {
        AND: [
          { nationality: { not: 'Thai' } },
          { nationality: { not: 'ไทย' } },
        ],
      },
    },
    include: {
      guest: true,
      room: { select: { number: true } },
    },
    orderBy: { checkIn: 'desc' },
  });

  // Deduplicate by guest (show most recent booking per guest)
  const seen = new Set<string>();
  const result = [];
  for (const bk of bookings) {
    if (!seen.has(bk.guestId)) {
      seen.add(bk.guestId);
      result.push({
        id: bk.guest.id,
        title: bk.guest.title,
        firstName: bk.guest.firstName,
        lastName: bk.guest.lastName,
        nationality: bk.guest.nationality,
        idType: bk.guest.idType,
        idNumber: bk.guest.idNumber,
        idExpiry: bk.guest.idExpiry,
        visaType: bk.guest.visaType,
        visaNumber: bk.guest.visaNumber,
        arrivalDate: bk.guest.arrivalDate,
        portOfEntry: bk.guest.portOfEntry,
        flightNumber: bk.guest.flightNumber,
        lastCountry: bk.guest.lastCountry,
        purposeOfVisit: bk.guest.purposeOfVisit,
        phone: bk.guest.phone,
        tm30Reported: bk.guest.tm30Reported,
        tm30ReportDate: bk.guest.tm30ReportDate,
        bookings: [{
          id: bk.id,
          bookingNumber: bk.bookingNumber,
          checkIn: bk.checkIn,
          checkOut: bk.checkOut,
          room: { number: bk.room.number },
        }],
      });
    }
  }

  return NextResponse.json(result);
}
