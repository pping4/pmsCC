import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') || '';
  const mode = searchParams.get('mode') || 'checkin'; // 'checkin' | 'checkout'

  const statusFilter = mode === 'checkout' ? ['checked_in'] : ['confirmed'];

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
    return NextResponse.json(enrichBookings(bookings));
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
    return NextResponse.json(enrichBookings(bookings));
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

  return NextResponse.json(enrichBookings(bookings));
}

function enrichBookings(bookings: any[]) {
  return bookings.map((b) => {
    const totalInvoiced = b.invoices.reduce((sum: number, inv: any) => sum + Number(inv.grandTotal), 0);
    const totalPaid = b.invoices
      .filter((inv: any) => inv.status === 'paid')
      .reduce((sum: number, inv: any) => sum + Number(inv.grandTotal), 0);
    return {
      ...b,
      rate: Number(b.rate),
      deposit: Number(b.deposit),
      paymentSummary: {
        totalInvoiced,
        totalPaid,
        balance: totalInvoiced - totalPaid,
        depositPaid: Number(b.deposit),
      },
    };
  });
}
