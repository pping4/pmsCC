import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // ── Time-range filter (for revenue metrics) ───────────────────────────────
  const { searchParams } = new URL(req.url);
  const fromParam = searchParams.get('from'); // ISO string, e.g. "2026-03-01T00:00:00.000Z"
  const toParam   = searchParams.get('to');   // ISO string, e.g. "2026-03-22T23:59:59.999Z"

  const rangeFrom = fromParam ? new Date(fromParam) : null;
  const rangeTo   = toParam   ? new Date(toParam)   : null;

  // Prisma filter clause applied to createdAt for revenue queries
  // (paidAt was removed from Invoice in Phase 1 — payment date now lives on Payment model)
  const paidAtFilter = (rangeFrom || rangeTo)
    ? {
        createdAt: {
          ...(rangeFrom ? { gte: rangeFrom } : {}),
          ...(rangeTo   ? { lte: rangeTo   } : {}),
        },
      }
    : {};

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    rooms,
    checkedInBookings,
    recentBookings,
    invoices,
    unpaidInvoices,
    recentPaidInvoices,
    revenueAggregate,
    allGuests,
    tm30Guests,
    housekeepingList,
    maintenanceList,
  ] = await Promise.all([
    // All rooms with type
    prisma.room.findMany({
      include: { roomType: true },
      orderBy: [{ floor: 'asc' }, { number: 'asc' }],
    }),

    // Currently checked-in bookings (for guests panel)
    prisma.booking.findMany({
      where: { status: 'checked_in' },
      include: { guest: true, room: { include: { roomType: true } } },
      orderBy: { checkIn: 'asc' },
      take: 50,
    }),

    // Recent bookings for sidebar card
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

    // Invoice summary counts (unpaid/overdue — always all-time; paid filtered by range)
    prisma.invoice.findMany({
      where: { status: { in: ['unpaid', 'overdue', 'paid'] } },
      select: { status: true, grandTotal: true, createdAt: true },
    }),

    // Unpaid invoices with full detail (for outstanding balance + unpaid panel) — always all-time
    prisma.invoice.findMany({
      where: { status: { in: ['unpaid', 'overdue'] } },
      include: { booking: { include: { room: true } }, guest: true },
      orderBy: [{ dueDate: 'asc' }],
    }),

    // Recent paid invoices for revenue panel — filtered by time range if provided
    prisma.invoice.findMany({
      where: { status: 'paid', ...paidAtFilter },
      include: {
        guest: { select: { firstName: true, lastName: true } },
        booking: { include: { room: { select: { number: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),

    // Revenue total aggregate — accurate sum regardless of record count
    prisma.invoice.aggregate({
      where: { status: 'paid', ...paidAtFilter },
      _sum: { grandTotal: true },
    }),

    // All guests for TM30 count
    prisma.guest.findMany({
      select: { id: true, nationality: true, tm30Reported: true },
    }),

    // Foreign guests needing TM30 with their current booking
    prisma.guest.findMany({
      where: { nationality: { not: 'Thai' }, tm30Reported: false },
      include: {
        bookings: {
          where: { status: 'checked_in' },
          include: { room: { select: { number: true, floor: true } } },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),

    // Housekeeping tasks with room
    (prisma.housekeepingTask as any).findMany({
      where: { status: { in: ['pending', 'in_progress'] } },
      include: { room: { select: { number: true, floor: true } } },
      orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
      take: 30,
    }),

    // Maintenance tasks with room
    (prisma.maintenanceTask as any).findMany({
      where: { status: { in: ['open', 'in_progress'] } },
      include: { room: { select: { number: true, floor: true } } },
      orderBy: [{ reportDate: 'desc' }],
      take: 30,
    }),
  ]);

  // ── Room statistics ──────────────────────────────────────────────────────
  const roomStats = {
    total: rooms.length,
    available: rooms.filter((r) => r.status === 'available').length,
    occupied: rooms.filter((r) => r.status === 'occupied').length,
    reserved: rooms.filter((r) => r.status === 'reserved').length,
    maintenance: rooms.filter((r) => r.status === 'maintenance').length,
    cleaning: rooms.filter((r) => r.status === 'cleaning').length,
    checkout: rooms.filter((r) => r.status === 'checkout').length,
    occupancyRate:
      rooms.length > 0
        ? Math.round(
            (rooms.filter((r) => r.status === 'occupied').length / rooms.length) * 100
          )
        : 0,
  };

  // Room list for detail panels (occupancy + available)
  const roomList = rooms.map((r) => ({
    id: r.id,
    number: r.number,
    floor: r.floor,
    status: r.status,
    typeName: r.roomType.name,
    notes: r.notes || null,
  }));

  // ── Revenue ──────────────────────────────────────────────────────────────
  // Use aggregate for accurate total — not capped by take limit
  const thisMonthRevenue = Number(revenueAggregate._sum.grandTotal ?? 0);

  const pendingRevenue = invoices
    .filter((i) => i.status === 'unpaid' || i.status === 'overdue')
    .reduce((sum, i) => sum + Number(i.grandTotal), 0);

  // ── Guest stats ───────────────────────────────────────────────────────────
  const foreignGuests = allGuests.filter((g) => g.nationality !== 'Thai');
  const unreportedTM30 = foreignGuests.filter((g) => !g.tm30Reported);

  // ── Housekeeping / Maintenance stats ─────────────────────────────────────
  const hkPending = housekeepingList.filter((t: any) => t.status === 'pending').length;
  const hkInProgress = housekeepingList.filter((t: any) => t.status === 'in_progress').length;
  const mtOpen = maintenanceList.filter((t: any) => t.status === 'open').length;
  const mtUrgent = maintenanceList.filter(
    (t: any) => t.priority === 'urgent' || t.priority === 'high'
  ).length;

  // ── Outstanding balance breakdown ─────────────────────────────────────────
  const dailyInvoices = unpaidInvoices.filter(
    (i) => i.booking?.bookingType === 'daily'
  );
  const monthlyShortInvoices = unpaidInvoices.filter(
    (i) => i.booking?.bookingType === 'monthly_short'
  );
  const monthlyLongInvoices = unpaidInvoices.filter(
    (i) => i.booking?.bookingType === 'monthly_long'
  );
  const badDebtInvoices = unpaidInvoices.filter((i) => (i as any).badDebt);

  const daily = dailyInvoices.reduce((sum, i) => sum + Number(i.grandTotal), 0);
  const monthlyShort = monthlyShortInvoices.reduce(
    (sum, i) => sum + Number(i.grandTotal),
    0
  );
  const monthlyLong = monthlyLongInvoices.reduce(
    (sum, i) => sum + Number(i.grandTotal),
    0
  );
  const badDebt = badDebtInvoices.reduce((sum, i) => sum + Number(i.grandTotal), 0);
  const otherUnpaid = unpaidInvoices
    .filter(
      (i) =>
        !i.booking ||
        (!['daily', 'monthly_short', 'monthly_long'].includes(
          i.booking.bookingType
        ))
    )
    .reduce((sum, i) => sum + Number(i.grandTotal), 0);

  return NextResponse.json({
    rooms: roomStats,

    // Full room list for detail panels
    roomList,

    recentBookings: recentBookings,

    revenue: {
      thisMonth: thisMonthRevenue,
      pending: pendingRevenue,
      unpaidCount: invoices.filter((i) => i.status === 'unpaid').length,
      overdueCount: invoices.filter((i) => i.status === 'overdue').length,
    },

    // Recent paid invoices for revenue detail
    recentPaidInvoices: recentPaidInvoices.map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      guestName: `${inv.guest.firstName} ${inv.guest.lastName}`,
      roomNumber: inv.booking?.room?.number || '-',
      amount: Number(inv.grandTotal),
      createdAt: inv.createdAt,
      notes: inv.notes,
    })),

    guests: {
      total: allGuests.length,
      foreign: foreignGuests.length,
      unreportedTM30: unreportedTM30.length,
      checkedIn: checkedInBookings.length,
    },

    // Currently checked-in guests for guests detail panel
    checkedInGuests: checkedInBookings.map((b) => ({
      bookingId: b.id,
      bookingNumber: b.bookingNumber,
      guestName: `${b.guest.firstName} ${b.guest.lastName}`,
      nationality: b.guest.nationality,
      roomNumber: b.room.number,
      roomType: b.room.roomType.name,
      checkIn: b.checkIn,
      checkOut: b.checkOut,
      rate: Number(b.rate),
      bookingType: b.bookingType,
    })),

    // TM30 pending guests
    tm30List: tm30Guests.map((g) => {
      const currentBooking = g.bookings[0] || null;
      return {
        id: g.id,
        firstName: g.firstName,
        lastName: g.lastName,
        nationality: g.nationality,
        roomNumber: currentBooking?.room?.number || '-',
        floor: currentBooking?.room?.floor || null,
        isCheckedIn: !!currentBooking,
      };
    }),

    housekeeping: {
      pending: hkPending,
      inProgress: hkInProgress,
    },

    // Housekeeping task list
    housekeepingList: (housekeepingList as any[]).map((t) => ({
      id: t.id,
      taskNumber: t.taskNumber,
      taskType: t.taskType,
      roomNumber: t.room.number,
      floor: t.room.floor,
      status: t.status,
      priority: t.priority,
      scheduledAt: t.scheduledAt,
      assignedTo: t.assignedTo,
      notes: t.notes,
    })),

    maintenance: {
      open: mtOpen,
      urgent: mtUrgent,
    },

    // Maintenance task list
    maintenanceList: (maintenanceList as any[]).map((t) => ({
      id: t.id,
      taskNumber: t.taskNumber,
      issue: t.issue,
      roomNumber: t.room.number,
      floor: t.room.floor,
      status: t.status,
      priority: t.priority,
      reportDate: t.reportDate,
      assignedTo: t.assignedTo,
      cost: Number(t.cost),
    })),

    outstandingBalance: {
      total: daily + monthlyShort + monthlyLong + badDebt + otherUnpaid,
      daily,
      monthlyShort,
      monthlyLong,
      badDebt,
      other: otherUnpaid,
      invoices: unpaidInvoices.slice(0, 30).map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        guestName: `${inv.guest.firstName} ${inv.guest.lastName}`,
        roomNumber: inv.booking?.room?.number || '-',
        amount: Number(inv.grandTotal),
        dueDate: inv.dueDate,
        bookingType: inv.booking?.bookingType || 'other',
        status: inv.status,
        badDebt: (inv as any).badDebt,
      })),
    },
  });
}
