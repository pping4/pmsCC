import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [rooms, bookings, invoices, guests, housekeepingTasks, maintenanceTasks] = await Promise.all([
    prisma.room.findMany({ include: { roomType: true } }),
    prisma.booking.findMany({
      where: {
        OR: [
          { status: 'confirmed' },
          { status: 'checked_in' },
          { checkIn: { gte: today } },
        ],
      },
      include: { guest: true, room: { include: { roomType: true } } },
      orderBy: { checkIn: 'asc' },
      take: 10,
    }),
    prisma.invoice.findMany({
      where: { status: { in: ['unpaid', 'overdue', 'paid'] } },
      select: { status: true, grandTotal: true, createdAt: true },
    }),
    prisma.guest.findMany({
      select: { nationality: true, tm30Reported: true },
    }),
    prisma.housekeepingTask.findMany({
      where: { status: { in: ['pending', 'in_progress'] } },
      select: { status: true, priority: true },
    }),
    prisma.maintenanceTask.findMany({
      where: { status: { in: ['open', 'in_progress'] } },
      select: { status: true, priority: true },
    }),
  ]);

  // Room statistics
  const roomStats = {
    total: rooms.length,
    available: rooms.filter((r) => r.status === 'available').length,
    occupied: rooms.filter((r) => r.status === 'occupied').length,
    reserved: rooms.filter((r) => r.status === 'reserved').length,
    maintenance: rooms.filter((r) => r.status === 'maintenance').length,
    cleaning: rooms.filter((r) => r.status === 'cleaning').length,
    checkout: rooms.filter((r) => r.status === 'checkout').length,
    occupancyRate: rooms.length > 0
      ? Math.round((rooms.filter((r) => r.status === 'occupied').length / rooms.length) * 100)
      : 0,
  };

  // Revenue
  const paidInvoices = invoices.filter((i) => i.status === 'paid');
  const thisMonthRevenue = paidInvoices
    .filter((i) => {
      const d = new Date(i.createdAt);
      return d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
    })
    .reduce((sum, i) => sum + Number(i.grandTotal), 0);

  const pendingRevenue = invoices
    .filter((i) => i.status === 'unpaid' || i.status === 'overdue')
    .reduce((sum, i) => sum + Number(i.grandTotal), 0);

  // Guest stats
  const foreignGuests = guests.filter((g) => g.nationality !== 'Thai');
  const unreportedTM30 = foreignGuests.filter((g) => !g.tm30Reported);

  return NextResponse.json({
    rooms: roomStats,
    recentBookings: bookings,
    revenue: {
      thisMonth: thisMonthRevenue,
      pending: pendingRevenue,
      unpaidCount: invoices.filter((i) => i.status === 'unpaid').length,
      overdueCount: invoices.filter((i) => i.status === 'overdue').length,
    },
    guests: {
      total: guests.length,
      foreign: foreignGuests.length,
      unreportedTM30: unreportedTM30.length,
    },
    housekeeping: {
      pending: housekeepingTasks.filter((t) => t.status === 'pending').length,
      inProgress: housekeepingTasks.filter((t) => t.status === 'in_progress').length,
    },
    maintenance: {
      open: maintenanceTasks.filter((t) => t.status === 'open').length,
      urgent: maintenanceTasks.filter((t) => t.priority === 'urgent' || t.priority === 'high').length,
    },
  });
}
