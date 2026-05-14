/**
 * POST /api/bookings/[id]/billing/generate-next
 *
 * Manually trigger draft generation for the next billing cycle of a monthly
 * booking. Useful for managers who want to create a bill mid-month or before
 * the automated cron runs.
 *
 * Role: admin | manager
 *
 * Body (all optional):
 *   { cycleIndex?: number }   ← if omitted, auto-computes max(existing) + 1
 *
 * Returns:
 *   {
 *     ok:          true,
 *     invoiceId:   string,
 *     invoiceNumber: string,
 *     cycleIndex:  number,
 *     periodStart: string,   // YYYY-MM-DD
 *     periodEnd:   string,   // YYYY-MM-DD
 *     grandTotal:  number,
 *     needsReading: boolean,
 *   }
 *
 * Error mapping:
 *   BillingStateError(BOOKING_NOT_MONTHLY) → 422
 *   BillingStateError(FOLIO_NOT_FOUND)     → 422
 *   Booking not found                      → 404
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z, ZodError } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/auth/rbac';
import { generateDraftInvoice, BillingStateError } from '@/services/billing.service';

// ─── Zod body ─────────────────────────────────────────────────────────────────

const Body = z.object({
  cycleIndex: z.number().int().min(1).optional(),
});

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const forbidden = requireRole(session, ['admin', 'manager']);
  if (forbidden) return forbidden;

  const bookingId = params.id;

  let body: z.infer<typeof Body>;
  try {
    const raw = await req.json().catch(() => ({}));
    body = Body.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'ข้อมูลไม่ถูกต้อง', details: err.issues },
        { status: 400 },
      );
    }
    throw err;
  }

  try {
    // Verify booking exists
    const booking = await prisma.booking.findUnique({
      where:  { id: bookingId },
      select: { id: true },
    });
    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    const result = await prisma.$transaction(async (tx) => {
      // Resolve cycleIndex: explicit or auto-compute max+1
      let cycleIndex = body.cycleIndex;
      if (cycleIndex === undefined) {
        const maxPeriod = await tx.billingPeriod.findFirst({
          where:   { bookingId },
          orderBy: { cycleIndex: 'desc' },
          select:  { cycleIndex: true },
        });
        cycleIndex = (maxPeriod?.cycleIndex ?? 0) + 1;
      }

      return generateDraftInvoice(tx, {
        bookingId,
        cycleIndex,
        createdBy: session.user?.email ?? session.user?.name ?? 'manager',
      });
    });

    // Format dates as YYYY-MM-DD slices for the response body
    const periodStart = result.periodStart.toISOString().slice(0, 10);
    const periodEnd   = result.periodEnd.toISOString().slice(0, 10);

    return NextResponse.json({
      ok:           true,
      invoiceId:    result.invoiceId,
      invoiceNumber: result.invoiceNumber,
      cycleIndex:   body.cycleIndex ?? /* resolved inside tx — not returned */ 0,
      periodStart,
      periodEnd,
      grandTotal:   result.grandTotal,
      needsReading: result.needsReading,
    }, { status: 201 });

  } catch (err) {
    if (err instanceof BillingStateError) {
      const status =
        err.code === 'BOOKING_NOT_MONTHLY' ? 422 :
        err.code === 'FOLIO_NOT_FOUND'     ? 422 : 500;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    console.error('[POST /api/bookings/[id]/billing/generate-next]', err);
    return NextResponse.json({ error: 'ไม่สามารถสร้าง draft ได้' }, { status: 500 });
  }
}
