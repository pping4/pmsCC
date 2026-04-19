/**
 * POST /api/bookings/[id]/move-room
 *
 * Guest-initiated room change. Distinguished from SHUFFLE:
 *   - MOVE may cross room types
 *   - MOVE is allowed for both `confirmed` and `checked_in` bookings
 *   - MOVE for `checked_in` splits the current segment at `effectiveDate`
 *
 * Invariants preserved:
 *   - Auth required
 *   - Zod-validated input
 *   - Idempotent via IdempotencyRecord (`room-change:move:` key prefix)
 *   - Serializable $transaction with P2034 retry
 *   - Billing-invariant: rate / invoices / folios / payments are NOT touched.
 *     Whatever the guest already paid remains honored on the new segment.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z, ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  moveRoomInTx,
  RoomChangeError,
} from '@/services/roomChange.service';
import { logActivity } from '@/services/activityLog.service';

const MoveBodySchema = z.object({
  newRoomId:       z.string().uuid(),
  effectiveDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
  reason:          z.string().min(1).max(500),
  notes:           z.string().max(2000).optional(),
  expectedVersion: z.number().int().nonnegative(),
  idempotencyKey:  z.string().min(8).max(128),
});

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_SERIALIZATION_RETRIES = 3;

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  let input: z.infer<typeof MoveBodySchema>;
  try {
    input = MoveBodySchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', issues: err.errors },
        { status: 422 },
      );
    }
    throw err;
  }

  const idemKey = `room-change:move:${input.idempotencyKey}`;
  const existing = await prisma.idempotencyRecord.findUnique({
    where: { key: idemKey },
  });
  if (existing) {
    if (existing.expiresAt > new Date()) {
      return NextResponse.json(existing.result, { status: 200 });
    }
    await prisma.idempotencyRecord.delete({ where: { key: idemKey } });
  }

  const createdBy = session.user?.email ?? 'system';
  const effectiveDate = new Date(`${input.effectiveDate}T00:00:00.000Z`);

  let attempt = 0;
  while (true) {
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const move = await moveRoomInTx(tx, {
            bookingId:       params.id,
            newRoomId:       input.newRoomId,
            effectiveDate,
            reason:          input.reason,
            notes:           input.notes,
            expectedVersion: input.expectedVersion,
            createdBy,
          });

          // Resolve room numbers so the history entry is human-readable.
          // (Using UUIDs in description strings makes the Detail Panel's
          // history tab show opaque hashes — unreadable for operators.)
          const [fromRoom, toRoom] = await Promise.all([
            tx.room.findUnique({ where: { id: move.fromRoomId }, select: { number: true } }),
            tx.room.findUnique({ where: { id: move.toRoomId },   select: { number: true } }),
          ]);
          const fromLabel = fromRoom?.number ?? move.fromRoomId.slice(0, 8);
          const toLabel   = toRoom?.number   ?? move.toRoomId.slice(0, 8);

          await logActivity(tx, {
            session,
            action:      'booking.room.move',
            category:    'booking',
            description: `ย้ายห้อง: ${fromLabel} → ${toLabel}${move.splitApplied ? ' (แยกช่วงการพัก)' : ''}`,
            bookingId:   move.bookingId,
            roomId:      move.toRoomId,
            icon:        '🔀',
            severity:    'info',
            metadata: {
              fromRoomId:     move.fromRoomId,
              fromRoomNumber: fromRoom?.number ?? null,
              toRoomId:       move.toRoomId,
              toRoomNumber:   toRoom?.number ?? null,
              reason:         input.reason,
              effectiveDate:  input.effectiveDate,
              splitApplied:   move.splitApplied,
            },
          });

          return move;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      const payload = {
        success:      true,
        bookingId:    result.bookingId,
        fromRoomId:   result.fromRoomId,
        toRoomId:     result.toRoomId,
        historyId:    result.historyId,
        version:      result.newVersion,
        splitApplied: result.splitApplied,
      };

      await prisma.idempotencyRecord.create({
        data: {
          key: idemKey,
          result: payload,
          expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
        },
      });

      return NextResponse.json(payload, { status: 200 });
    } catch (err) {
      if (err instanceof RoomChangeError) {
        return NextResponse.json(
          { error: err.message, code: err.code },
          { status: err.status },
        );
      }
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2034' &&
        attempt < MAX_SERIALIZATION_RETRIES
      ) {
        attempt += 1;
        await new Promise((r) => setTimeout(r, 50 * attempt));
        continue;
      }
      console.error('[move-room] unexpected error:', err);
      return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
  }
}
