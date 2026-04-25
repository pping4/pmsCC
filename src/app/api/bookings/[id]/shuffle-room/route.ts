/**
 * POST /api/bookings/[id]/shuffle-room
 *
 * Move a pre-arrival booking to another room of the same type to free up
 * the original room — typically triggered by a new incoming reservation
 * that conflicts with this one.
 *
 * Invariants enforced:
 *   - Auth required
 *   - Zod-validated input
 *   - Idempotent via IdempotencyRecord (`room-change:` key prefix)
 *   - Atomic: wrapped in a Serializable $transaction, P2034-retried
 *   - No billing impact (rate/invoice untouched) — see service for the
 *     finance-invariants guarantees.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z, ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  shuffleRoomInTx,
  RoomChangeError,
} from '@/services/roomChange.service';
import { logActivity } from '@/services/activityLog.service';

const ShuffleBodySchema = z.object({
  newRoomId:            z.string().uuid(),
  reason:               z.string().min(1).max(500),
  notes:                z.string().max(2000).optional(),
  expectedVersion:      z.number().int().nonnegative(),
  idempotencyKey:       z.string().min(8).max(128),
  triggeredByBookingId: z.string().uuid().optional(),
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

  let input: z.infer<typeof ShuffleBodySchema>;
  try {
    input = ShuffleBodySchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', issues: err.errors },
        { status: 422 },
      );
    }
    throw err;
  }

  // ── Idempotency ─────────────────────────────────────────────────────────
  const idemKey = `room-change:shuffle:${input.idempotencyKey}`;
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

  // ── Retry loop for Serializable isolation (P2034) ───────────────────────
  let attempt = 0;
  while (true) {
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const shuffle = await shuffleRoomInTx(tx, {
            bookingId:            params.id,
            newRoomId:            input.newRoomId,
            reason:               input.reason,
            notes:                input.notes,
            expectedVersion:      input.expectedVersion,
            createdBy,
            triggeredByBookingId: input.triggeredByBookingId,
          });

          await logActivity(tx, {
            session,
            action:      'booking.room.shuffle',
            category:    'booking',
            description: `SHUFFLE: ห้อง ${shuffle.fromRoomId} → ${shuffle.toRoomId}`,
            bookingId:   shuffle.bookingId,
            roomId:      shuffle.toRoomId,
            severity:    'info',
            metadata: {
              fromRoomId: shuffle.fromRoomId,
              toRoomId:   shuffle.toRoomId,
              reason:     input.reason,
              triggeredByBookingId: input.triggeredByBookingId ?? null,
            },
          });

          return shuffle;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      const payload = {
        success: true,
        bookingId:  result.bookingId,
        fromRoomId: result.fromRoomId,
        toRoomId:   result.toRoomId,
        historyId:  result.historyId,
        version:    result.newVersion,
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
      console.error('[shuffle-room] unexpected error:', err);
      return NextResponse.json(
        { error: 'Internal error' },
        { status: 500 },
      );
    }
  }
}
