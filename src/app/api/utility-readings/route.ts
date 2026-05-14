/**
 * POST /api/utility-readings
 *
 * Records a meter reading (water + electric) for a room.
 * Role: admin | manager | staff  (broadest — staff record readings on shift)
 *
 * Returns: { id: string }  201
 * Errors:
 *   400 — Zod validation failure OR future-date / backdated reading
 *   401 — no session
 *   403 — insufficient role
 *   500 — unexpected
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z, ZodError } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireRole, getUserRef } from '@/lib/auth/rbac';
import { recordReading, UtilityValidationError } from '@/services/utility.service';
import { Prisma } from '@prisma/client';

// ─── Zod schema ──────────────────────────────────────────────────────────────

const Body = z.object({
  roomId:       z.string().uuid('roomId must be a valid UUID'),
  bookingId:    z.string().uuid('bookingId must be a valid UUID').optional(),
  readingDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'readingDate must be YYYY-MM-DD'),
  currWater:    z.number().nonnegative().max(1_000_000),
  currElectric: z.number().nonnegative().max(1_000_000),
  notes:        z.string().max(500).optional(),
});

// ─── POST ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // staff may record readings on shift; manager/admin see full list
  const forbidden = requireRole(session, ['admin', 'manager', 'staff']);
  if (forbidden) return forbidden;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'ข้อมูลไม่ถูกต้อง', details: err.issues.map((i) => ({ path: i.path, message: i.message })) },
        { status: 400 },
      );
    }
    throw err;
  }

  try {
    const reading = await prisma.$transaction((tx) =>
      recordReading(tx, {
        roomId:      body.roomId,
        bookingId:   body.bookingId,
        readingDate: new Date(body.readingDate + 'T00:00:00.000Z'),
        currWater:   body.currWater,
        currElectric: body.currElectric,
        notes:       body.notes,
        recordedBy:  getUserRef(session),
      }),
    );
    return NextResponse.json({ id: reading.id }, { status: 201 });
  } catch (err) {
    if (err instanceof UtilityValidationError) {
      // FUTURE_DATE and BACKDATED both map to 400 Bad Request
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') {
        return NextResponse.json({ error: 'มีข้อมูลการจดมิเตอร์วันนี้อยู่แล้ว' }, { status: 409 });
      }
    }
    console.error('[POST /api/utility-readings]', err);
    return NextResponse.json({ error: 'ไม่สามารถบันทึกข้อมูลมิเตอร์ได้' }, { status: 500 });
  }
}
