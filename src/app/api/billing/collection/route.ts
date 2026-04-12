import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const THAI_MONTHS = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
];

function getDaysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function getThaiMonthName(date: Date): string {
  return THAI_MONTHS[date.getMonth()];
}

function getThaiYearLabel(date: Date): string {
  return `${getThaiMonthName(date)} ${date.getFullYear()}`;
}

function getEndOfMonth(date: Date): Date {
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  end.setHours(23, 59, 59, 999);
  return end;
}

interface InvoiceInGroup {
  id: string;
  invoiceNumber: string;
  grandTotal: number;
  dueDate: Date;
  notes: string | null;
  daysOverdue: number;
  guest: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string | null;
  };
  room: {
    number: string;
    floor: number;
  } | null;
  bookingType: string | null;
}

interface NotYetInvoicedItem {
  bookingId: string;
  guestName: string;
  roomNumber: string;
  rate: number;
  nextBillingDate: Date;
  billingDay: number;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);
    todayEnd.setMilliseconds(-1);

    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const monthEnd = getEndOfMonth(now);

    // Fetch all unpaid and overdue invoices
    const invoices = await prisma.invoice.findMany({
      where: {
        status: {
          in: ['unpaid', 'overdue'],
        },
      },
      include: {
        guest: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
          },
        },
        booking: {
          include: {
            room: {
              select: {
                number: true,
                floor: true,
              },
            },
          },
        },
      },
    });

    // Auto-update status to 'overdue' for invoices past due date
    const overdueInvoiceIds = invoices
      .filter((inv) => inv.dueDate < todayStart && inv.status === 'unpaid')
      .map((inv) => inv.id);

    if (overdueInvoiceIds.length > 0) {
      await prisma.$transaction(async (tx) => {
        await tx.invoice.updateMany({
          where: {
            id: {
              in: overdueInvoiceIds,
            },
          },
          data: {
            status: 'overdue',
          },
        });
      });
    }

    // Enrich invoices with daysOverdue and format for grouping
    const enrichedInvoices = invoices.map((inv) => {
      const daysOverdue =
        inv.dueDate < todayStart
          ? Math.floor((now.getTime() - inv.dueDate.getTime()) / 86400000)
          : 0;

      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        grandTotal: Number(inv.grandTotal),
        dueDate: inv.dueDate,
        notes: inv.notes,
        daysOverdue,
        guest: inv.guest,
        room: inv.booking?.room ?? null,
        bookingType: inv.booking?.bookingType ?? null,
      };
    });

    // Group invoices by urgency
    const overdue: InvoiceInGroup[] = [];
    const dueToday: InvoiceInGroup[] = [];
    const dueThisWeek: InvoiceInGroup[] = [];
    const upcoming: InvoiceInGroup[] = [];

    for (const inv of enrichedInvoices) {
      if (inv.dueDate < todayStart) {
        overdue.push(inv);
      } else if (inv.dueDate >= todayStart && inv.dueDate <= todayEnd) {
        dueToday.push(inv);
      } else if (inv.dueDate > todayEnd && inv.dueDate <= weekEnd) {
        dueThisWeek.push(inv);
      } else if (inv.dueDate > weekEnd && inv.dueDate <= monthEnd) {
        upcoming.push(inv);
      }
    }

    // Sort overdue by daysOverdue descending
    overdue.sort((a, b) => b.daysOverdue - a.daysOverdue);

    // Find monthly bookings not yet invoiced this month
    const monthlyBookings = await prisma.booking.findMany({
      where: {
        status: 'checked_in',
        bookingType: {
          in: ['monthly_short', 'monthly_long'],
        },
      },
      include: {
        guest: true,
        room: true,
        invoices: true,
      },
    });

    const notYetInvoiced: NotYetInvoicedItem[] = [];

    for (const booking of monthlyBookings) {
      try {
        const billingDay = booking.checkIn.getDate();
        const daysInMonth = getDaysInMonth(now);
        const adjustedBillingDay = billingDay > daysInMonth ? daysInMonth : billingDay;

        const currentBillingDate = new Date(
          now.getFullYear(),
          now.getMonth(),
          adjustedBillingDay
        );

        // Check if billing date has passed this month
        if (now < currentBillingDate) {
          continue;
        }

        const periodLabel = getThaiYearLabel(currentBillingDate);

        // Check if invoice exists for this cycle
        const hasInvoiceThisCycle = booking.invoices.some((inv) => {
          if (inv.notes && inv.notes.includes(periodLabel)) {
            return true;
          }

          const cycleStart = new Date(currentBillingDate);
          cycleStart.setDate(cycleStart.getDate() - 1);

          const cycleEnd = new Date(currentBillingDate);
          cycleEnd.setDate(cycleEnd.getDate() + 32);

          return inv.createdAt >= cycleStart && inv.createdAt <= cycleEnd;
        });

        if (!hasInvoiceThisCycle) {
          const guestName = `${booking.guest.firstName} ${booking.guest.lastName}`;
          notYetInvoiced.push({
            bookingId: booking.id,
            guestName,
            roomNumber: booking.room.number,
            rate: Number(booking.rate),
            nextBillingDate: currentBillingDate,
            billingDay: adjustedBillingDay,
          });
        }
      } catch (bookingError) {
        console.error(`Error processing booking ${booking.id}:`, bookingError);
      }
    }

    // Calculate summary
    const overdueAmount = overdue.reduce((sum, inv) => sum + inv.grandTotal, 0);
    const dueTodayAmount = dueToday.reduce((sum, inv) => sum + inv.grandTotal, 0);
    const weekAmount = dueThisWeek.reduce((sum, inv) => sum + inv.grandTotal, 0);
    const upcomingAmount = upcoming.reduce((sum, inv) => sum + inv.grandTotal, 0);
    const notYetInvoicedAmount = notYetInvoiced.reduce(
      (sum, item) => sum + item.rate,
      0
    );

    return NextResponse.json(
      {
        summary: {
          overdueAmount,
          overdueCount: overdue.length,
          dueTodayAmount,
          dueTodayCount: dueToday.length,
          weekAmount,
          weekCount: dueThisWeek.length,
          upcomingAmount,
          upcomingCount: upcoming.length,
          notYetInvoicedCount: notYetInvoiced.length,
          notYetInvoicedAmount,
        },
        overdue,
        dueToday,
        dueThisWeek,
        upcoming,
        notYetInvoiced,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error in collection endpoint:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch collection data',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
