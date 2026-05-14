/**
 * GET /api/billing/drafts/[id]
 *
 * Returns a single draft invoice with full billing history for the expand-row UI.
 * Role: admin | manager
 *
 * Returns:
 *   {
 *     draft: DraftRow,
 *     history: {
 *       invoices: InvoiceHistoryRow[],
 *       readings: UtilityReadingRow[],
 *     }
 *   }
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
  const forbidden = requireRole(session, ['admin', 'manager']);
  if (forbidden) return forbidden;

  const { id } = params;

  try {
    const inv = await prisma.invoice.findUnique({
      where: { id },
      include: {
        items: {
          select: {
            folioLineItem: {
              select: { chargeType: true, amount: true },
            },
          },
        },
        booking: {
          select: {
            id: true,
            bookingNumber: true,
            bookingType: true,
            checkIn: true,
            contract: {
              select: { contractNumber: true, billingCycle: true, status: true },
            },
            guest: { select: { firstName: true, lastName: true } },
            room:  { select: { number: true } },
          },
        },
        billingPeriod: {
          select: { cycleIndex: true, isPartial: true },
        },
      },
    });

    if (!inv) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    }
    if (inv.status !== 'draft') {
      return NextResponse.json({ error: 'Invoice is not a draft', status: inv.status }, { status: 422 });
    }

    const bookingId = inv.bookingId;

    // Fetch billing history for this booking
    const [historyInvoices, readings] = bookingId
      ? await prisma.$transaction(async (tx) => {
          const invoices = await tx.invoice.findMany({
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

          return [invoices, rds] as const;
        })
      : [[], []] as const;

    const bType = inv.booking?.bookingType;
    const cycle: 'rolling' | 'calendar' = bType === 'monthly_long' ? 'calendar' : 'rolling';
    const cycleIndex    = inv.billingPeriod?.cycleIndex ?? 1;
    const rentAmount    = sumChargeType(inv.items, 'ROOM');
    const waterAmount   = sumChargeType(inv.items, 'UTILITY_WATER');
    const electricAmount = sumChargeType(inv.items, 'UTILITY_ELECTRIC');
    const needsReading  = cycleIndex >= 2 && waterAmount === 0 && electricAmount === 0;

    const contract = inv.booking?.contract?.status !== 'terminated' ? inv.booking?.contract : null;

    const draft = {
      invoiceId:      inv.id,
      invoiceNumber:  inv.invoiceNumber,
      bookingId:      inv.bookingId,
      bookingNumber:  inv.booking?.bookingNumber ?? '',
      guestName:      inv.booking?.guest
        ? `${inv.booking.guest.firstName} ${inv.booking.guest.lastName}`
        : '',
      roomNumber:     inv.booking?.room?.number ?? '',
      contractNumber: contract?.contractNumber ?? null,
      cycle,
      cycleIndex,
      periodStart:    toDateStr(inv.billingPeriodStart),
      periodEnd:      toDateStr(inv.billingPeriodEnd),
      rentAmount,
      waterAmount,
      electricAmount,
      grandTotal:     Number(inv.grandTotal),
      needsReading,
    };

    const invoiceHistory = historyInvoices.map((hi, idx) => {
      const paidAt = hi.allocations[0]?.allocatedAt;
      const daysLate = (hi.status === 'paid' && paidAt)
        ? Math.max(0, Math.floor((paidAt.getTime() - hi.dueDate.getTime()) / 86_400_000))
        : null;
      return {
        cycleIndex:     hi.billingPeriod?.cycleIndex ?? (idx + 1),
        invoiceNumber:  hi.invoiceNumber,
        periodStart:    toDateStr(hi.billingPeriodStart),
        periodEnd:      toDateStr(hi.billingPeriodEnd),
        rentAmount:     sumChargeType(hi.items, 'ROOM'),
        waterAmount:    sumChargeType(hi.items, 'UTILITY_WATER'),
        electricAmount: sumChargeType(hi.items, 'UTILITY_ELECTRIC'),
        grandTotal:     Number(hi.grandTotal),
        paidAmount:     Number(hi.paidAmount),
        paidDate:       toDateStr(paidAt),
        daysLate,
        status:         hi.status,
        isDraft:        hi.id === inv.id,
      };
    });

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
      draft,
      history: {
        invoices: invoiceHistory,
        readings: readingHistory,
      },
    });
  } catch (err) {
    console.error('[GET /api/billing/drafts/[id]]', err);
    return NextResponse.json({ error: 'ไม่สามารถโหลด draft ได้' }, { status: 500 });
  }
}
