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
    available: rooms.filter((r: { status: string }) => r.status === 'available').length,
    occupied: rooms.filter((r: { status: string }) => r.status === 'occupied').length,
    reserved: rooms.filter((r: { status: string }) => r.status === 'reserved').length,
    maintenance: rooms.filter((r: { status: string }) => r.status === 'maintenance').length,
    cleaning: rooms.filter((r: { status: string }) => r.status === 'cleaning').length,
    checkout: rooms.filter((r: { status: string }) => r.status === 'checkout').length,
    occupancyRate: Math.round((rooms.filter((r: { status: string }) => r.status === 'occupied').length / rooms.length) * 100),
  };

  // Revenue
  const paidInvoices = invoices.filter((i: { status: string }) => i.status === 'paid');
  const thisMonthRevenue = paidInvoices
    .filter((i: { createdAt: Date }) => {
      const d = new Date(i.createdAt);
      return d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
    })
    .reduce((sum: number, i: { grandTotal: number | string }) => sum + Number(i.grandTotal), 0);

  const pendingRevenue = invoices
    .filter((i: { status: string }) => i.status === 'unpaid' || i.status === 'overdue')
    .reduce((sum: number, i: { grandTotal: number | string }) => sum + Number(i.grandTotal), 0);

  // Guest stats
  const foreignGuests = guests.filter((g: { nationality: string | null }) => g.nationality !== 'Thai');
  const unreportedTM30 = foreignGuests.filter((g: { tm30Reported: boolean }) => !g.tm30Reported);

  return NextResponse.json({
    rooms: roomStats,
    recentBookings: bookings,
    revenue: {
      thisMonth: thisMonthRevenue,
      pending: pendingRevenue,
      unpaidCount: invoices.filter((i: { status: string }) => i.status === 'unpaid').length,
      overdueCount: invoices.filter((i: { status: string }) => i.status === 'overdue').length,
    },
    guests: {
      total: guests.length,
      foreign: foreignGuests.length,
      unreportedTM30: unreportedTM30.length,
    },
    housekeeping: {
      pending: housekeepingTasks.filter((t: { status: string }) => t.status === 'pending').length,
      inProgress: housekeepingTasks.filter((t: { status: string }) => t.status === 'in_progress').length,
    },
    maintenance: {
      open: maintenanceTasks.filter((t: { status: string }) => t.status === 'open').length,
      urgent: maintenanceTasks.filter((t: { priority: string }) => t.priority === 'urgent' || t.priority === 'high').length,
    },
  });
}
