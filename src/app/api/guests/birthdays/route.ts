import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// ─── GET /api/guests/birthdays?days=30 ────────────────────────────────────────
// Returns guests who are currently checked-in AND have a birthday within `days`.
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const days = Math.min(Math.max(parseInt(searchParams.get('days') ?? '30'), 1), 90);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // We need everyone currently checked-in (active booking) who has a dateOfBirth.
  // Birthday comparison must ignore the year — we compare (month, day) only.
  // Most efficient: fetch all checked-in guests with DOB, filter in JS.
  const checkedInBookings = await (prisma.booking as any).findMany({
    where: { status: 'checked_in' },
    select: {
      id: true,
      bookingNumber: true,
      checkIn: true,
      checkOut: true,
      room: { select: { id: true, number: true, floor: true } },
      guest: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          firstNameTH: true,
          lastNameTH: true,
          dateOfBirth: true,
          phone: true,
          nationality: true,
        },
      },
    },
    orderBy: { room: { number: 'asc' } },
  });

  // Filter guests whose birthday (month-day) falls within the next `days` days
  const results: any[] = [];

  for (const booking of checkedInBookings) {
    const dob = booking.guest?.dateOfBirth;
    if (!dob) continue;

    const dobDate = new Date(dob);
    // Construct this year's birthday
    const thisYearBirthday = new Date(
      today.getFullYear(),
      dobDate.getMonth(),
      dobDate.getDate(),
    );
    // If birthday already passed this year, check next year
    const upcomingBirthday =
      thisYearBirthday < today
        ? new Date(today.getFullYear() + 1, dobDate.getMonth(), dobDate.getDate())
        : thisYearBirthday;

    const daysUntil = Math.round(
      (upcomingBirthday.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (daysUntil <= days) {
      results.push({
        guestId: booking.guest.id,
        firstName: booking.guest.firstName,
        lastName: booking.guest.lastName,
        firstNameTH: booking.guest.firstNameTH,
        lastNameTH: booking.guest.lastNameTH,
        dateOfBirth: booking.guest.dateOfBirth,
        phone: booking.guest.phone,
        nationality: booking.guest.nationality,
        roomNumber: booking.room.number,
        roomFloor: booking.room.floor,
        bookingId: booking.id,
        bookingNumber: booking.bookingNumber,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        daysUntil,
        isToday: daysUntil === 0,
      });
    }
  }

  // Sort: today first, then ascending daysUntil
  results.sort((a, b) => a.daysUntil - b.daysUntil);

  return NextResponse.json({ days, results });
}
