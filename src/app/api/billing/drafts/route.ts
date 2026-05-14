/**
 * GET /api/billing/drafts
 *
 * Returns all draft monthly invoices pending manager review.
 * Role: admin | manager
 *
 * Query params (all optional):
 *   cycle=rolling|calendar
 *   floor=<string>          — room floor filter
 *   roomTypeId=<uuid>
 *   limit=<number>          (default 100, max 500)
 *   offset=<number>         (default 0)
 *
 * Returns:
 *   { drafts: DraftRow[], total: number }
 *
 * paymentBehavior is derived from prior *paid* invoices for the same booking:
 *   { onTime, late, avgDaysLate }
 * where onTime  = count of invoices paid on or before dueDate,
 *       late    = count paid after dueDate,
 *       avgDaysLate = average (paidAt - dueDate) across late invoices.
 * PaymentAllocation.allocatedAt is used as the payment date proxy.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/auth/rbac';
import { Prisma } from '@prisma/client';

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── GET ────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const forbidden = requireRole(session, ['admin', 'manager']);
  if (forbidden) return forbidden;

  try {
    const { searchParams } = new URL(req.url);
    const cycleParam = searchParams.get('cycle');
    const floor      = searchParams.get('floor');
    const roomTypeId = searchParams.get('roomTypeId');
    const limit      = Math.min(500, Math.max(1, Number(searchParams.get('limit') ?? '100')));
    const offset     = Math.max(0, Number(searchParams.get('offset') ?? '0'));

    // Derive BookingType filter from cycle
    let bookingTypeFilter: string[];
    if (cycleParam === 'rolling')       bookingTypeFilter = ['monthly_short'];
    else if (cycleParam === 'calendar') bookingTypeFilter = ['monthly_long'];
    else                                bookingTypeFilter = ['monthly_short', 'monthly_long'];

    // Build room WHERE clause for the join
    const roomWhere: Record<string, unknown> = {};
    if (floor)      roomWhere.floor = floor;
    if (roomTypeId) roomWhere.roomTypeId = roomTypeId;
    const hasRoomFilter = Object.keys(roomWhere).length > 0;

    const bookingWhere = {
      bookingType: { in: bookingTypeFilter as never[] },
      ...(hasRoomFilter ? { room: roomWhere } : {}),
    };

    const [drafts, total] = await prisma.$transaction(async (tx) => {
      const baseWhere = {
        status:      'draft' as never,
        invoiceType: 'monthly_rent' as never,
        booking:     bookingWhere,
      };

      const [rows, count] = await Promise.all([
        tx.invoice.findMany({
          where:   baseWhere,
          skip:    offset,
          take:    limit,
          orderBy: { createdAt: 'asc' },
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
        }),
        tx.invoice.count({ where: baseWhere }),
      ]);

      return [rows, count] as const;
    });

    // Compute paymentBehavior from prior paid monthly invoices
    const bookingIds = drafts
      .map((d) => d.bookingId)
      .filter((id): id is string => !!id);

    const priorInvoices = bookingIds.length > 0
      ? await prisma.invoice.findMany({
          where: {
            bookingId:   { in: bookingIds },
            status:      'paid' as never,
            invoiceType: 'monthly_rent' as never,
          },
          select: {
            bookingId: true,
            dueDate:   true,
            allocations: {
              orderBy: { allocatedAt: 'desc' },
              take: 1,
              select: { allocatedAt: true },
            },
          },
        })
      : [];

    // Group by bookingId for O(1) lookup
    const payBehaviorMap = new Map<string, { onTime: number; late: number; totalDaysLate: number }>();
    for (const inv of priorInvoices) {
      if (!inv.bookingId) continue;
      const entry = payBehaviorMap.get(inv.bookingId) ?? { onTime: 0, late: 0, totalDaysLate: 0 };
      const paidAt = inv.allocations[0]?.allocatedAt;
      if (paidAt) {
        const daysLate = Math.max(
          0,
          Math.floor((paidAt.getTime() - inv.dueDate.getTime()) / 86_400_000),
        );
        if (daysLate > 0) {
          entry.late++;
          entry.totalDaysLate += daysLate;
        } else {
          entry.onTime++;
        }
      }
      payBehaviorMap.set(inv.bookingId, entry);
    }

    const result = drafts.map((inv) => {
      const bType = inv.booking?.bookingType;
      const cycle: 'rolling' | 'calendar' = bType === 'monthly_long' ? 'calendar' : 'rolling';

      const rentAmount     = sumChargeType(inv.items, 'ROOM');
      const waterAmount    = sumChargeType(inv.items, 'UTILITY_WATER');
      const electricAmount = sumChargeType(inv.items, 'UTILITY_ELECTRIC');

      const cycleIndex   = inv.billingPeriod?.cycleIndex ?? 1;
      const hasUtility   = waterAmount > 0 || electricAmount > 0;
      const needsReading = cycleIndex >= 2 && !hasUtility;

      const pb = payBehaviorMap.get(inv.bookingId ?? '') ?? { onTime: 0, late: 0, totalDaysLate: 0 };

      // Only expose contract if not terminated
      const contract = inv.booking?.contract?.status !== 'terminated'
        ? inv.booking?.contract
        : null;

      return {
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
        paymentBehavior: {
          onTime:      pb.onTime,
          late:        pb.late,
          avgDaysLate: pb.late > 0 ? Math.round(pb.totalDaysLate / pb.late) : 0,
        },
      };
    });

    return NextResponse.json({ drafts: result, total });
  } catch (err) {
    console.error('[GET /api/billing/drafts]', err);
    return NextResponse.json({ error: 'ไม่สามารถโหลดรายการ draft ได้' }, { status: 500 });
  }
}
