import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const dateStr = searchParams.get('date') || new Date().toISOString().split('T')[0];
  const date = new Date(dateStr);
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  // 1. Occupancy
  const rooms = await prisma.room.findMany({ select: { id: true, status: true } });
  const totalRooms = rooms.length;
  const occupied = rooms.filter(r => r.status === 'occupied').length;
  const available = rooms.filter(r => r.status === 'available').length;
  const checkout = rooms.filter(r => r.status === 'checkout').length;
  const maintenance = rooms.filter(r => r.status === 'maintenance').length;

  // 2. Check-ins today
  const checkins = await prisma.booking.findMany({
    where: {
      actualCheckIn: { gte: startOfDay, lte: endOfDay },
      status: 'checked_in',
    },
    include: {
      guest: { select: { firstName: true, lastName: true } },
      room: { select: { number: true } },
    },
    orderBy: { actualCheckIn: 'asc' },
  });

  // 3. Check-outs today
  const checkouts = await prisma.booking.findMany({
    where: {
      actualCheckOut: { gte: startOfDay, lte: endOfDay },
      status: 'checked_out',
    },
    include: {
      guest: { select: { firstName: true, lastName: true } },
      room: { select: { number: true } },
    },
    orderBy: { actualCheckOut: 'asc' },
  });

  // 4. Revenue
  const invoices = await prisma.invoice.findMany({
    select: { status: true, grandTotal: true },
  });
  const invoicePaid = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + Number(i.grandTotal), 0);
  const invoiceUnpaid = invoices.filter(i => i.status === 'unpaid').reduce((s, i) => s + Number(i.grandTotal), 0);
  const invoiceOverdue = invoices.filter(i => i.status === 'overdue').reduce((s, i) => s + Number(i.grandTotal), 0);

  const roomRevenue = checkins.reduce((s, b) => s + Number(b.rate), 0);

  // 5. Pending TM30 (foreign guests currently checked in)
  const foreignBookings = await prisma.booking.findMany({
    where: { status: 'checked_in' },
    include: {
      guest: { select: { id: true, firstName: true, lastName: true, nationality: true, tm30Reported: true } },
      room: { select: { number: true } },
    },
  });

  const pendingTM30 = foreignBookings
    .filter(b => {
      const nat = b.guest.nationality?.toLowerCase();
      const isForeign = nat !== 'thai' && nat !== 'ไทย';
      return isForeign && !b.guest.tm30Reported;
    })
    .map(b => {
      const deadline = new Date(new Date(b.checkIn).getTime() + 24 * 60 * 60 * 1000);
      const hoursLeft = Math.floor((deadline.getTime() - Date.now()) / (1000 * 60 * 60));
      return {
        id: b.guest.id,
        name: `${b.guest.firstName} ${b.guest.lastName}`,
        nationality: b.guest.nationality,
        roomNumber: b.room.number,
        checkIn: b.checkIn.toISOString(),
        hoursLeft,
      };
    });

  // 6. Overdue invoices
  const overdueInvoiceList = await prisma.invoice.findMany({
    where: { status: 'overdue' },
    include: {
      guest: { select: { firstName: true, lastName: true } },
      booking: { include: { room: { select: { number: true } } } },
    },
    orderBy: { dueDate: 'asc' },
    take: 10,
  });

  // 7. Pending housekeeping & maintenance
  const cleaningPending = await prisma.housekeepingTask.count({
    where: { status: { in: ['pending', 'in_progress'] } },
  });
  const maintenanceOpen = await prisma.maintenanceTask.count({
    where: { status: { in: ['open', 'in_progress'] } },
  });

  return NextResponse.json({
    date: dateStr,
    occupancy: {
      total: totalRooms,
      occupied,
      available,
      checkout,
      maintenance,
      rate: totalRooms > 0 ? Math.round((occupied / totalRooms) * 100) : 0,
    },
    checkins: checkins.map(b => ({
      id: b.id,
      bookingNumber: b.bookingNumber,
      guestName: `${b.guest.firstName} ${b.guest.lastName}`,
      roomNumber: b.room.number,
      checkIn: b.checkIn.toISOString(),
      rate: Number(b.rate),
    })),
    checkouts: checkouts.map(b => ({
      id: b.id,
      bookingNumber: b.bookingNumber,
      guestName: `${b.guest.firstName} ${b.guest.lastName}`,
      roomNumber: b.room.number,
      checkOut: b.checkOut.toISOString(),
      rate: Number(b.rate),
    })),
    revenue: {
      roomRevenue,
      invoicePaid,
      invoiceUnpaid,
      invoiceOverdue,
      totalCollected: invoicePaid,
    },
    pendingTM30,
    overdueInvoices: overdueInvoiceList.map(inv => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      guestName: `${inv.guest.firstName} ${inv.guest.lastName}`,
      grandTotal: Number(inv.grandTotal),
      dueDate: inv.dueDate.toISOString(),
      roomNumber: inv.booking?.room?.number,
    })),
    cleaningPending,
    maintenanceOpen,
  });
}
