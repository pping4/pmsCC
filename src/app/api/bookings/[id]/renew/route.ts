/**
 * POST /api/bookings/[id]/renew
 *
 * Contract renewal — extends a monthly booking's checkOut date.
 * Optionally updates the rate for the new period.
 *
 * Body:
 * {
 *   newCheckOut:    "2026-12-31",
 *   newRate?:       9500,
 *   notes?:         "ต่อสัญญา 6 เดือน",
 * }
 *
 * Security checklist:
 * ✅ Auth: Manager+ only (rate change is a financial decision)
 * ✅ Zod validation
 * ✅ $transaction
 * ✅ Business rules enforced in service (checked_in only, daily not allowed, newCheckOut > old)
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { renewContract } from '@/services/billing.service';
import { z } from 'zod';

const RenewSchema = z.object({
  newCheckOut: z.coerce.date({ required_error: 'ต้องระบุวันสิ้นสุดสัญญาใหม่' }),
  newRate:     z.number().positive().optional(),
  notes:       z.string().max(500).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const authSession = await getServerSession(authOptions);
  if (!authSession?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Manager+ only — rate change is a financial decision
  const role = authSession.user.role;
  if (role !== 'admin' && role !== 'manager') {
    return NextResponse.json({ error: 'ต้องการสิทธิ์ Manager ขึ้นไปสำหรับการต่อสัญญา' }, { status: 403 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = RenewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'ข้อมูลไม่ถูกต้อง', details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const userId   = authSession.user.id ?? authSession.user.email ?? 'system';
  const userName = authSession.user.name ?? undefined;

  try {
    const result = await prisma.$transaction(async (tx) =>
      renewContract(tx, {
        bookingId:     params.id,
        newCheckOut:   parsed.data.newCheckOut,
        newRate:       parsed.data.newRate,
        notes:         parsed.data.notes,
        renewedBy:     userId,
        renewedByName: userName,
      })
    );

    return NextResponse.json({
      success:    true,
      bookingId:  result.bookingId,
      oldCheckOut: result.oldCheckOut,
      newCheckOut: result.newCheckOut,
      newRate:     result.newRate,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
