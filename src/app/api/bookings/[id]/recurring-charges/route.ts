/**
 * GET  /api/bookings/[id]/recurring-charges — list recurring charges for a booking
 * POST /api/bookings/[id]/recurring-charges — create a new recurring charge
 *
 * GET  Role: admin | manager | staff
 * POST Role: admin | manager
 *
 * GET query params:
 *   ?status=active      (default) — only active charges
 *   ?status=cancelled   — only cancelled charges
 *   ?status=all         — both
 *
 * POST body:
 *   {
 *     productId?:  string (UUID, optional — links to Product catalog),
 *     chargeType:  'EXTRA_SERVICE' | 'OTHER',
 *     description: string (1–200 chars),
 *     amount:      number (positive, ≤ 1_000_000),
 *     startDate:   "YYYY-MM-DD",
 *     endDate?:    "YYYY-MM-DD" | null,
 *     notes?:      string (≤ 500),
 *   }
 *
 * Returns 201 { ok: true, id } on success.
 * GET response includes product: { id, code, name } | null for badge display.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z, ZodError } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/auth/rbac';
import { createRecurringCharge, RecurringValidationError } from '@/services/recurring.service';

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const forbidden = requireRole(session, ['admin', 'manager', 'staff']);
  if (forbidden) return forbidden;

  const bookingId = params.id;
  const statusParam = req.nextUrl.searchParams.get('status') ?? 'active';

  type RCStatus = 'active' | 'cancelled';
  const whereStatus: { status?: RCStatus | { in: RCStatus[] } } =
    statusParam === 'all'
      ? {}
      : statusParam === 'cancelled'
        ? { status: 'cancelled' as const }
        : { status: 'active' as const };

  try {
    const charges = await prisma.recurringCharge.findMany({
      where: { bookingId, ...whereStatus },
      orderBy: { startDate: 'asc' },
      select: {
        id:          true,
        chargeType:  true,
        description: true,
        amount:      true,
        startDate:   true,
        endDate:     true,
        status:      true,
        notes:       true,
        createdBy:   true,
        createdAt:   true,
        cancelledAt: true,
        cancelledBy: true,
        product: {
          select: { id: true, code: true, name: true },
        },
      },
    });

    const result = charges.map((c) => ({
      id:          c.id,
      chargeType:  c.chargeType,
      description: c.description,
      amount:      Number(c.amount),
      startDate:   c.startDate.toISOString().slice(0, 10),
      endDate:     c.endDate ? c.endDate.toISOString().slice(0, 10) : null,
      status:      c.status,
      notes:       c.notes,
      createdBy:   c.createdBy,
      createdAt:   c.createdAt.toISOString(),
      cancelledAt: c.cancelledAt ? c.cancelledAt.toISOString() : null,
      cancelledBy: c.cancelledBy,
      product:     c.product ?? null,
    }));

    return NextResponse.json(result);
  } catch (err) {
    console.error('[GET /api/bookings/[id]/recurring-charges]', err);
    return NextResponse.json({ error: 'โหลดข้อมูลไม่สำเร็จ' }, { status: 500 });
  }
}

// ─── POST Zod schema ──────────────────────────────────────────────────────────

const CreateBody = z.object({
  productId:   z.string().uuid().optional(),
  chargeType:  z.enum(['EXTRA_SERVICE', 'OTHER']),
  description: z.string().min(1).max(200),
  amount:      z.number().positive().max(1_000_000),
  startDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes:       z.string().max(500).optional(),
}).refine(
  (d) => {
    if (!d.endDate) return true;
    return d.endDate >= d.startDate;
  },
  { message: 'endDate must be >= startDate', path: ['endDate'] },
);

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

  let body: z.infer<typeof CreateBody>;
  try {
    body = CreateBody.parse(await req.json());
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
      return createRecurringCharge(tx, {
        bookingId,
        productId:   body.productId,
        chargeType:  body.chargeType,
        description: body.description,
        amount:      body.amount,
        startDate:   new Date(body.startDate + 'T00:00:00.000Z'),
        endDate:     body.endDate ? new Date(body.endDate + 'T00:00:00.000Z') : null,
        notes:       body.notes,
        createdBy:   session.user?.email ?? session.user?.name ?? 'manager',
      });
    });

    return NextResponse.json({ ok: true, id: result.id }, { status: 201 });

  } catch (err) {
    if (err instanceof RecurringValidationError) {
      const status = err.code === 'INVALID_DATES' ? 400 : 422;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    console.error('[POST /api/bookings/[id]/recurring-charges]', err);
    return NextResponse.json({ error: 'ไม่สามารถเพิ่มบริการได้' }, { status: 500 });
  }
}
