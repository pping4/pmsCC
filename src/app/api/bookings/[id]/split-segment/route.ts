/**
 * POST /api/bookings/[id]/split-segment
 *
 * Manual SPLIT wizard endpoint. Distinguished from MOVE:
 *   - SPLIT is billing-NON-invariant: the operator chooses a new rate for
 *     the `[splitDate, segment.toDate)` portion (and optionally a new room
 *     or bookingType). MOVE keeps the rate locked.
 *   - SPLIT operates on a specific pre-existing segment (by segmentId); MOVE
 *     works on whichever segment is active at effectiveDate.
 *   - SPLIT does NOT mutate folio / invoices / payments — posted-record
 *     immutable. `billingImpact` is recorded on RoomMoveHistory as a signal
 *     for downstream rate reconciliation.
 *
 * Invariants:
 *   - Auth required (next-auth)
 *   - Zod-validated input
 *   - Idempotent via IdempotencyRecord (`room-change:split:` key prefix)
 *   - Serializable $transaction with P2034 retry
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z, ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  splitSegmentInTx,
  RoomChangeError,
} from '@/services/roomChange.service';
import { logActivity } from '@/services/activityLog.service';

const SplitBodySchema = z.object({
  segmentId:       z.string().uuid(),
  splitDate:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
  newRoomId:       z.string().uuid().optional(),
  newRate:         z.union([z.number(), z.string()])
                    .refine((v) => {
                      const n = typeof v === 'string' ? Number(v) : v;
                      return Number.isFinite(n) && n >= 0;
                    }, 'newRate must be ≥ 0'),
  newBookingType:  z.enum(['daily', 'monthly_short', 'monthly_long']).optional(),
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

  let input: z.infer<typeof SplitBodySchema>;
  try {
    input = SplitBodySchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', issues: err.errors },
        { status: 422 },
      );
    }
    throw err;
  }

  const idemKey = `room-change:split:${input.idempotencyKey}`;
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
  const splitDate = new Date(`${input.splitDate}T00:00:00.000Z`);

  let attempt = 0;
  while (true) {
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const split = await splitSegmentInTx(tx, {
            bookingId:       params.id,
            segmentId:       input.segmentId,
            splitDate,
            newRoomId:       input.newRoomId,
            newRate:         input.newRate,
            newBookingType:  input.newBookingType,
            reason:          input.reason,
            notes:           input.notes,
            expectedVersion: input.expectedVersion,
            createdBy,
          });

          // Resolve room numbers for a human-readable history entry.
          const original = await tx.bookingRoomSegment.findUnique({
            where: { id: split.originalSegmentId },
            select: { roomId: true },
          });
          const [fromRoom, toRoom] = await Promise.all([
            original
              ? tx.room.findUnique({ where: { id: original.roomId }, select: { number: true } })
              : Promise.resolve(null),
            input.newRoomId
              ? tx.room.findUnique({ where: { id: input.newRoomId }, select: { number: true } })
              : Promise.resolve(null),
          ]);

          const fromLabel = fromRoom?.number ?? '—';
          const toLabel   = toRoom?.number   ?? fromLabel;
          const descRoom  = fromLabel === toLabel
            ? `ห้อง ${fromLabel}`
            : `${fromLabel} → ${toLabel}`;

          await logActivity(tx, {
            session,
            action:      'booking.segment.split',
            category:    'booking',
            description: `แยกช่วงการพัก: ${descRoom} @ ${input.splitDate} (เรทใหม่ ${input.newRate})`,
            bookingId:   split.bookingId,
            roomId:      input.newRoomId ?? undefined,
            icon:        '✂️',
            severity:    'info',
            metadata: {
              segmentId:        input.segmentId,
              newSegmentId:     split.newSegmentId,
              splitDate:        input.splitDate,
              fromRoomNumber:   fromRoom?.number ?? null,
              toRoomNumber:     toRoom?.number ?? fromRoom?.number ?? null,
              newRate:          String(input.newRate),
              newBookingType:   input.newBookingType ?? null,
              billingImpact:    split.billingImpact,
              nightsAfterSplit: split.nightsAfterSplit,
              reason:           input.reason,
            },
          });

          return split;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      const payload = {
        success:           true,
        bookingId:         result.bookingId,
        originalSegmentId: result.originalSegmentId,
        newSegmentId:      result.newSegmentId,
        historyId:         result.historyId,
        version:           result.newVersion,
        billingImpact:     result.billingImpact,
        nightsAfterSplit:  result.nightsAfterSplit,
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
      console.error('[split-segment] unexpected error:', err);
      return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
  }
}
