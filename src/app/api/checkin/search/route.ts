import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { fetchRateMap } from '@/lib/room-rate-db';

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') || '';
  const mode = searchParams.get('mode') || 'checkin'; // 'checkin' | 'checkout'

  const statusFilter = mode === 'checkout' ? ['checked_in'] : ['confirmed'];

  // Load room rates (supports both Prisma model and raw SQL fallback)
  let rateMap: Record<string, any> = {};
  try {
    rateMap = await fetchRateMap();
  } catch {
    // room_rates table not ready yet
  }

  if (!q && mode === 'checkin') {
    // Return today's arrivals
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const bookings = await prisma.booking.findMany({
      where: {
        status: { in: statusFilter as any },
        checkIn: { gte: today, lt: tomorrow },
      },
      include: {
        guest: true,
        room: { include: { roomType: true } },
        invoices: true,
      },
      orderBy: { checkIn: 'asc' },
      take: 20,
    });
    return NextResponse.json(enrichBookings(bookings, rateMap));
  }

  if (!q && mode === 'checkout') {
    // Return today's checkouts (checked_in guests)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const bookings = await prisma.booking.findMany({
      where: {
        status: 'checked_in',
        checkOut: { gte: today, lt: tomorrow },
      },
      include: {
        guest: true,
        room: { include: { roomType: true } },
        invoices: true,
      },
      orderBy: { checkOut: 'asc' },
      take: 20,
    });
    return NextResponse.json(enrichBookings(bookings, rateMap));
  }

  const bookings = await prisma.booking.findMany({
    where: {
      status: { in: statusFilter as any },
      OR: [
        { bookingNumber: { contains: q, mode: 'insensitive' } },
        { guest: { firstName: { contains: q, mode: 'insensitive' } } },
        { guest: { lastName: { contains: q, mode: 'insensitive' } } },
        { guest: { firstNameTH: { contains: q, mode: 'insensitive' } } },
        { guest: { lastNameTH: { contains: q, mode: 'insensitive' } } },
        { room: { number: { contains: q, mode: 'insensitive' } } },
      ],
    },
    include: {
      guest: true,
      room: { include: { roomType: true } },
      invoices: true,
    },
    orderBy: { checkIn: 'asc' },
    take: 20,
  });

  return NextResponse.json(enrichBookings(bookings, rateMap));
}

function calcExpectedStayAmount(b: any): number {
  const rate = Number(b.rate);
  if (b.bookingType === 'daily') {
    const checkIn = new Date(b.checkIn);
    const checkOut = new Date(b.checkOut);
    const nights = Math.max(
      1,
      Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24))
    );
    return rate * nights;
  }
  // monthly_short / monthly_long
  return rate;
}

function enrichBookings(bookings: any[], rateMap: Record<string, any> = {}) {
  return bookings.map((b) => {
    const totalInvoiced = b.invoices.reduce((sum: number, inv: any) => sum + Number(inv.grandTotal), 0);
    const totalPaid = b.invoices
      .filter((inv: any) => inv.status === 'paid')
      .reduce((sum: number, inv: any) => sum + Number(inv.grandTotal), 0);

    // When no invoices exist (no deposit/upfront collected at check-in),
    // compute the expected stay amount so the checkout panel shows the correct pending balance.
    const effectiveInvoiced =
      b.invoices.length === 0 && b.status === 'checked_in'
        ? calcExpectedStayAmount(b)
        : totalInvoiced;

    const balance = Math.max(0, effectiveInvoiced - totalPaid);

    return {
      ...b,
      rate: Number(b.rate),
      deposit: Number(b.deposit),
      room: {
        ...b.room,
        rate: rateMap[b.room.id] ?? null,
      },
      paymentSummary: {
        totalInvoiced: effectiveInvoiced,
        totalPaid,
        balance,
        depositPaid: Number(b.deposit),
      },
    };
  });
}
