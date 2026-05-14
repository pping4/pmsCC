/**
 * GET /api/bookings/[id]/billing-history
 *
 * Returns complete billing history for a monthly booking — used by the
 * expand-row UI in /billing-cycle.
 * Role: admin | manager | staff
 *
 * Returns:
 *   {
 *     summary: {
 *       checkIn:            string (YYYY-MM-DD),
 *       depositStatus:      'paid' | 'unpaid',
 *       invoicesCount:      number,
 *       outstandingBalance: number,
 *       avgDaysLate:        number,
 *     },
 *     invoices: InvoiceHistoryRow[],
 *     readings: UtilityReadingRow[],
 *   }
 *
 * Payment date is approximated from PaymentAllocation.allocatedAt.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/auth/rbac';
import { Prisma } from '@prisma/client';

function toDateStr(d: Date | null | undefined): string {
  if (!d) return '';
  return d.toISOString().slice(0, 10);
}

function sumChargeType(
  items: Array<{ folioLineItem: { chargeType: string; amount: Prisma.Decimal } | null }>,
  type: string,
): number {
  return items
    .filter((i) => i.folioLineItem?.chargeType === type)
    .reduce((acc, i) => acc + Number(i.folioLineItem!.amount), 0);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const forbidden = requireRole(session, ['admin', 'manager', 'staff']);
  if (forbidden) return forbidden;

  const bookingId = params.id;

  try {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        checkIn: true,
        bookingType: true,
        folio: {
          select: {
            invoices: {
              where: { invoiceType: 'deposit_receipt' as never },
              orderBy: { createdAt: 'asc' },
              take: 1,
              select: { status: true },
            },
          },
        },
      },
    });

    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    // Monthly invoices + readings
    const [invoices, readings] = await prisma.$transaction(async (tx) => {
      const invs = await tx.invoice.findMany({
        where: {
          bookingId,
          invoiceType: 'monthly_rent' as never,
        },
        orderBy: { billingPeriodStart: 'asc' },
        include: {
          items: {
            select: {
              folioLineItem: {
                select: { chargeType: true, amount: true },
              },
            },
          },
          allocations: {
            orderBy: { allocatedAt: 'desc' },
            take: 1,
            select: { allocatedAt: true },
          },
          billingPeriod: {
            select: { cycleIndex: true },
          },
        },
      });

      const rds = await tx.utilityReading.findMany({
        where:   { bookingId },
        orderBy: { readingDate: 'asc' },
        select: {
          id: true,
          readingDate: true,
          prevWater: true,
          currWater: true,
          prevElectric: true,
          currElectric: true,
          waterRate: true,
          electricRate: true,
          notes: true,
          recordedBy: true,
        },
      });

      return [invs, rds] as const;
    });

    // Compute summary stats
    let totalDaysLate = 0;
    let lateCount     = 0;

    const invoiceHistory = invoices.map((inv, idx) => {
      const paidAt = inv.allocations[0]?.allocatedAt;
      let daysLate: number | null = null;
      if (inv.status === 'paid' && paidAt) {
        daysLate = Math.max(0, Math.floor((paidAt.getTime() - inv.dueDate.getTime()) / 86_400_000));
        if (daysLate > 0) {
          totalDaysLate += daysLate;
          lateCount++;
        }
      }

      return {
        cycleIndex:     inv.billingPeriod?.cycleIndex ?? (idx + 1),
        invoiceNumber:  inv.invoiceNumber,
        periodStart:    toDateStr(inv.billingPeriodStart),
        periodEnd:      toDateStr(inv.billingPeriodEnd),
        rentAmount:     sumChargeType(inv.items, 'ROOM'),
        waterAmount:    sumChargeType(inv.items, 'UTILITY_WATER'),
        electricAmount: sumChargeType(inv.items, 'UTILITY_ELECTRIC'),
        grandTotal:     Number(inv.grandTotal),
        paidAmount:     Number(inv.paidAmount),
        paidDate:       toDateStr(paidAt),
        daysLate,
        status:         inv.status,
      };
    });

    const avgDaysLate = lateCount > 0 ? Math.round(totalDaysLate / lateCount) : 0;

    // Outstanding balance: sum of unpaid/partial/overdue invoices
    const outstandingBalance = invoices
      .filter((i) => ['unpaid', 'partial', 'overdue'].includes(i.status))
      .reduce((acc, i) => acc + Number(i.grandTotal) - Number(i.paidAmount), 0);

    // Deposit status
    const depositInvoice  = booking.folio?.invoices?.[0];
    const depositStatus: 'paid' | 'unpaid' = depositInvoice?.status === 'paid' ? 'paid' : 'unpaid';

    const readingHistory = readings.map((r) => ({
      id:           r.id,
      readingDate:  toDateStr(r.readingDate),
      prevWater:    Number(r.prevWater),
      currWater:    Number(r.currWater),
      prevElectric: Number(r.prevElectric),
      currElectric: Number(r.currElectric),
      waterRate:    Number(r.waterRate),
      electricRate: Number(r.electricRate),
      notes:        r.notes,
      recordedBy:   r.recordedBy,
    }));

    return NextResponse.json({
      summary: {
        checkIn:            toDateStr(booking.checkIn),
        depositStatus,
        invoicesCount:      invoices.length,
        outstandingBalance: Math.round(outstandingBalance * 100) / 100,
        avgDaysLate,
      },
      invoices: invoiceHistory,
      readings: readingHistory,
    });
  } catch (err) {
    console.error('[GET /api/bookings/[id]/billing-history]', err);
    return NextResponse.json({ error: 'ไม่สามารถโหลดประวัติการเรียกเก็บเงินได้' }, { status: 500 });
  }
}
