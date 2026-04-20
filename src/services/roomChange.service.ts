/**
 * roomChange.service.ts
 *
 * Phase 2 — SHUFFLE: ops-driven room swap used to free up a room for a new
 * incoming reservation. Must be same room type, pre-arrival only, no billing
 * impact.
 *
 * Design:
 *  - Always inside a Serializable $transaction (caller wraps). This avoids
 *    two concurrent shuffles colliding on availability. See the
 *    `prisma-money-transactions` skill for isolation + retry guidance.
 *  - Posted-record immutable: we never touch Folio / Invoice / LineItem /
 *    Payment rows. SHUFFLE is a roomId swap + audit row only.
 *  - Segment model: SHUFFLE updates the one segment of a non-split booking.
 *  - Idempotency is handled at the API layer (`room-change:` key prefix).
 */

import { Prisma, RoomChangeMode, BookingType } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export interface ShuffleInput {
  bookingId: string;
  newRoomId: string;
  reason: string;
  notes?: string;
  expectedVersion: number;
  createdBy: string;                 // user email / id
  triggeredByBookingId?: string;     // the new booking whose arrival forced the shuffle
}

export interface ShuffleResult {
  bookingId: string;
  fromRoomId: string;
  toRoomId: string;
  historyId: string;
  newVersion: number;
}

export class RoomChangeError extends Error {
  constructor(message: string, public code: string, public status = 400) {
    super(message);
    this.name = 'RoomChangeError';
  }
}

/**
 * Execute a SHUFFLE inside an already-open transaction.
 * Caller is responsible for:
 *   - prisma.$transaction with Serializable isolation
 *   - P2034 retry wrapping
 *   - idempotency key handling
 */
export async function shuffleRoomInTx(
  tx: Tx,
  input: ShuffleInput,
): Promise<ShuffleResult> {
  // 1. Lock booking + load the minimum fields we need
  const booking = await tx.booking.findUnique({
    where: { id: input.bookingId },
    select: {
      id: true,
      status: true,
      checkIn: true,
      checkOut: true,
      roomId: true,
      roomLocked: true,
      version: true,
      rate: true,
      bookingType: true,
      room: { select: { typeId: true, number: true } },
      roomSegments: { select: { id: true, roomId: true } },
    },
  });
  if (!booking) {
    throw new RoomChangeError('ไม่พบการจอง', 'BOOKING_NOT_FOUND', 404);
  }

  // 2. Version check — optimistic concurrency
  if (booking.version !== input.expectedVersion) {
    throw new RoomChangeError(
      'การจองถูกแก้ไขโดยผู้อื่น กรุณาลองใหม่อีกครั้ง',
      'VERSION_CONFLICT',
      409,
    );
  }

  // 3. Room-lock check
  if (booking.roomLocked) {
    throw new RoomChangeError(
      'การจองนี้ถูกล็อคห้องไว้ — ปลดล็อคก่อนย้าย',
      'BOOKING_LOCKED',
    );
  }

  // 4. Pre-arrival only — SHUFFLE is ops-driven before the guest checks in
  if (booking.status !== 'confirmed') {
    throw new RoomChangeError(
      'SHUFFLE ใช้ได้เฉพาะการจองที่ยังไม่ check-in',
      'INVALID_STATUS',
    );
  }

  // 5. Same-room no-op guard
  if (booking.roomId === input.newRoomId) {
    throw new RoomChangeError('ห้องปลายทางคือห้องเดิม', 'SAME_ROOM');
  }

  // 6. New room must exist + same room type
  const newRoom = await tx.room.findUnique({
    where: { id: input.newRoomId },
    select: {
      id: true,
      number: true,
      typeId: true,
      status: true,
    },
  });
  if (!newRoom) {
    throw new RoomChangeError('ไม่พบห้องปลายทาง', 'ROOM_NOT_FOUND', 404);
  }
  if (newRoom.typeId !== booking.room.typeId) {
    throw new RoomChangeError(
      'SHUFFLE ต้องย้ายไปห้องประเภทเดียวกันเท่านั้น',
      'ROOM_TYPE_MISMATCH',
    );
  }
  if (newRoom.status === 'maintenance') {
    throw new RoomChangeError(
      'ห้องปลายทางอยู่ระหว่างซ่อมบำรุง',
      'ROOM_UNAVAILABLE',
    );
  }

  // 7. Availability check on the new room for [checkIn, checkOut)
  //    Uses segments (authoritative for multi-segment bookings).
  const overlap = await tx.bookingRoomSegment.findFirst({
    where: {
      roomId: input.newRoomId,
      bookingId: { not: input.bookingId },
      fromDate: { lt: booking.checkOut },
      toDate: { gt: booking.checkIn },
      booking: { status: { not: 'cancelled' } },
    },
    select: { id: true, bookingId: true, fromDate: true, toDate: true },
  });
  if (overlap) {
    throw new RoomChangeError(
      `ห้องปลายทางไม่ว่างในช่วงที่ต้องการ (ชนกับการจองอื่น)`,
      'ROOM_UNAVAILABLE',
    );
  }

  // 8. Enforce single-segment invariant for SHUFFLE (pre-arrival, no splits yet)
  if (booking.roomSegments.length !== 1) {
    throw new RoomChangeError(
      'SHUFFLE รองรับเฉพาะการจองที่ยังไม่ split ห้อง',
      'MULTI_SEGMENT_NOT_SUPPORTED',
    );
  }
  const segment = booking.roomSegments[0];

  // 9. Apply the swap — segment + booking.roomId + version bump
  await tx.bookingRoomSegment.update({
    where: { id: segment.id },
    data: { roomId: input.newRoomId },
  });

  await tx.booking.update({
    where: { id: input.bookingId },
    data: {
      roomId: input.newRoomId,
      version: { increment: 1 },
    },
  });

  // 10. Audit row — immutable record of the change
  const history = await tx.roomMoveHistory.create({
    data: {
      bookingId: input.bookingId,
      mode: RoomChangeMode.SHUFFLE,
      fromRoomId: booking.roomId,
      toRoomId: input.newRoomId,
      effectiveDate: booking.checkIn,
      reason: input.reason,
      notes: input.notes ?? null,
      oldRate: booking.rate,
      newRate: booking.rate,           // SHUFFLE never changes rate
      billingImpact: new Prisma.Decimal(0),
      triggeredByBookingId: input.triggeredByBookingId ?? null,
      createdBy: input.createdBy,
    },
    select: { id: true },
  });

  return {
    bookingId: input.bookingId,
    fromRoomId: booking.roomId,
    toRoomId: input.newRoomId,
    historyId: history.id,
    newVersion: booking.version + 1,
  };
}

/**
 * Find rooms that can receive `bookingId` as a SHUFFLE target:
 *  - Same room type
 *  - Not in maintenance
 *  - No booking-segment overlap in [checkIn, checkOut)
 *  - Not the current room
 *
 * Read-only — safe to call outside a transaction.
 */
export async function listShuffleCandidates(
  prisma: Pick<Prisma.TransactionClient, 'booking' | 'room' | 'bookingRoomSegment'>,
  bookingId: string,
): Promise<Array<{ id: string; number: string; floor: number }>> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      roomId: true,
      checkIn: true,
      checkOut: true,
      room: { select: { typeId: true } },
    },
  });
  if (!booking) return [];

  // Rooms of the same type, not current room, not in maintenance
  const candidateRooms = await prisma.room.findMany({
    where: {
      typeId: booking.room.typeId,
      id: { not: booking.roomId },
      status: { not: 'maintenance' },
    },
    select: { id: true, number: true, floor: true },
    orderBy: [{ floor: 'asc' }, { number: 'asc' }],
  });

  if (candidateRooms.length === 0) return [];

  // Exclude rooms that have any segment overlapping the booking's date range
  const roomIds = candidateRooms.map((r) => r.id);
  const busyRooms = await prisma.bookingRoomSegment.findMany({
    where: {
      roomId: { in: roomIds },
      bookingId: { not: bookingId },
      fromDate: { lt: booking.checkOut },
      toDate: { gt: booking.checkIn },
      booking: { status: { not: 'cancelled' } },
    },
    select: { roomId: true },
    distinct: ['roomId'],
  });
  const busySet = new Set(busyRooms.map((r) => r.roomId));

  return candidateRooms.filter((r) => !busySet.has(r.id));
}

// ═══════════════════════════════════════════════════════════════════════════
// MOVE — guest-initiated room change. Billing-invariant (paid money stays
// honored), may cross room types, allowed for pre-arrival (`confirmed`) and
// in-house (`checked_in`) bookings.
//
// For `confirmed` bookings:  behaves like SHUFFLE but with no type restriction.
// For `checked_in` bookings: SPLITS the current segment at `effectiveDate`,
//   leaving [checkIn, effectiveDate) in the old room and creating a new
//   segment [effectiveDate, checkOut) in the new room. The remainder of the
//   stay is spent in the new room. Billing is untouched — the rate locked in
//   when the guest paid stays the rate of the new segment.
// ═══════════════════════════════════════════════════════════════════════════

export interface MoveInput {
  bookingId: string;
  newRoomId: string;
  effectiveDate: Date;              // date-only; when the move takes effect
  reason: string;
  notes?: string;
  expectedVersion: number;
  createdBy: string;
}

export interface MoveResult {
  bookingId: string;
  fromRoomId: string;
  toRoomId: string;
  historyId: string;
  newVersion: number;
  splitApplied: boolean;
}

export async function moveRoomInTx(
  tx: Tx,
  input: MoveInput,
): Promise<MoveResult> {
  const booking = await tx.booking.findUnique({
    where: { id: input.bookingId },
    select: {
      id: true,
      status: true,
      checkIn: true,
      checkOut: true,
      roomId: true,
      roomLocked: true,
      version: true,
      rate: true,
      bookingType: true,
      roomSegments: {
        orderBy: { fromDate: 'asc' },
        select: { id: true, roomId: true, fromDate: true, toDate: true, rate: true, bookingType: true },
      },
    },
  });
  if (!booking) {
    throw new RoomChangeError('ไม่พบการจอง', 'BOOKING_NOT_FOUND', 404);
  }

  if (booking.version !== input.expectedVersion) {
    throw new RoomChangeError(
      'การจองถูกแก้ไขโดยผู้อื่น กรุณาลองใหม่อีกครั้ง',
      'VERSION_CONFLICT',
      409,
    );
  }

  if (booking.roomLocked) {
    throw new RoomChangeError(
      'การจองนี้ถูกล็อคห้องไว้ — ปลดล็อคก่อนย้าย',
      'BOOKING_LOCKED',
    );
  }

  if (booking.status !== 'confirmed' && booking.status !== 'checked_in') {
    throw new RoomChangeError(
      'MOVE ใช้ได้เฉพาะการจองที่ยังไม่ check-out หรือยกเลิก',
      'INVALID_STATUS',
    );
  }

  // Note: we don't short-circuit on booking.roomId === newRoomId here because
  // for multi-segment bookings the "current" room at effectiveDate may differ
  // from booking.roomId. The activeSegment check below handles this precisely.

  const newRoom = await tx.room.findUnique({
    where: { id: input.newRoomId },
    select: { id: true, typeId: true, status: true },
  });
  if (!newRoom) {
    throw new RoomChangeError('ไม่พบห้องปลายทาง', 'ROOM_NOT_FOUND', 404);
  }
  if (newRoom.status === 'maintenance') {
    throw new RoomChangeError('ห้องปลายทางอยู่ระหว่างซ่อมบำรุง', 'ROOM_UNAVAILABLE');
  }

  // Normalize effectiveDate to UTC midnight (date-only semantics)
  const eff = new Date(Date.UTC(
    input.effectiveDate.getUTCFullYear(),
    input.effectiveDate.getUTCMonth(),
    input.effectiveDate.getUTCDate(),
  ));

  // Clamp effective date to [checkIn, checkOut). A move at or before checkIn
  // treats the change as pre-arrival (replace segment). After checkOut makes
  // no sense.
  if (eff.getTime() >= booking.checkOut.getTime()) {
    throw new RoomChangeError(
      'วันที่ย้ายต้องอยู่ก่อนเช็คเอาท์',
      'INVALID_EFFECTIVE_DATE',
    );
  }
  const effClamped = eff.getTime() < booking.checkIn.getTime()
    ? booking.checkIn
    : eff;

  // Lazy backfill: bookings created before the BookingRoomSegment feature was
  // integrated into the creation flow have zero segments. Synthesize one
  // covering [checkIn, checkOut) in the current booking.roomId so MOVE can
  // proceed without requiring a full data backfill migration first.
  if (booking.roomSegments.length === 0) {
    const created = await tx.bookingRoomSegment.create({
      data: {
        bookingId:   booking.id,
        roomId:      booking.roomId,
        fromDate:    booking.checkIn,
        toDate:      booking.checkOut,
        rate:        booking.rate,
        bookingType: booking.bookingType,
        createdBy:   'system-lazy-backfill',
      },
      select: { id: true, roomId: true, fromDate: true, toDate: true, rate: true, bookingType: true },
    });
    booking.roomSegments = [created];
  }

  // Find the segment currently active at `effClamped` — that's the one we'll
  // split (or swap). Segments are contiguous and non-overlapping, so at most
  // one matches `fromDate <= eff < toDate`.
  const activeSegment = booking.roomSegments.find(
    s => s.fromDate.getTime() <= effClamped.getTime()
      && effClamped.getTime() < s.toDate.getTime(),
  );
  if (!activeSegment) {
    // Shouldn't happen if segments cover [checkIn, checkOut). Defensive.
    throw new RoomChangeError(
      'ไม่พบช่วงการพักที่ตรงกับวันที่ย้าย',
      'SEGMENT_NOT_FOUND',
    );
  }

  if (activeSegment.roomId === input.newRoomId) {
    throw new RoomChangeError(
      'ณ วันที่ย้าย ลูกค้าอยู่ในห้องนี้อยู่แล้ว',
      'SAME_ROOM',
    );
  }

  // The new room must be free ONLY for the activeSegment's window
  // `[effClamped, activeSegment.toDate)` — NOT for the whole remainder of
  // the stay. Rationale: MOVE is composable. A later segment may already
  // be on a different room (scheduled via a prior MOVE or SPLIT), and this
  // MOVE must not overwrite it. Each MOVE only affects the segment active
  // AT `effClamped`, leaving later segments alone.
  //
  // Concrete scenarios this supports:
  //   • Multiple sequential MOVEs: A→B, stay 1 day, B→C at a later date.
  //   • Scheduled future MOVE: plan a move at day N while still in the
  //     old room, without disturbing an even-later planned move at day M>N.
  //   • SPLIT-then-MOVE: if day-4 was SPLIT onto room X, a MOVE at day 2
  //     to room Y replaces only day 2–4 with Y; day 4 onward stays on X.
  const overlap = await tx.bookingRoomSegment.findFirst({
    where: {
      roomId: input.newRoomId,
      bookingId: { not: input.bookingId },
      fromDate: { lt: activeSegment.toDate },
      toDate:   { gt: effClamped },
      booking:  { status: { not: 'cancelled' } },
    },
    select: { id: true },
  });
  if (overlap) {
    throw new RoomChangeError(
      'ห้องปลายทางไม่ว่างในช่วงที่ต้องการ (ชนกับการจองอื่น)',
      'ROOM_UNAVAILABLE',
    );
  }

  const splitApplied = effClamped.getTime() > activeSegment.fromDate.getTime();

  if (splitApplied) {
    // Shrink active segment to [activeSegment.fromDate, eff), then insert a
    // new segment [eff, activeSegment.toDate) in the new room.
    await tx.bookingRoomSegment.update({
      where: { id: activeSegment.id },
      data:  { toDate: effClamped },
    });
    await tx.bookingRoomSegment.create({
      data: {
        bookingId:   booking.id,
        roomId:      input.newRoomId,
        fromDate:    effClamped,
        toDate:      activeSegment.toDate,
        rate:        activeSegment.rate,        // keep locked-in rate
        bookingType: activeSegment.bookingType,
        createdBy:   input.createdBy,
      },
    });
  } else {
    // Edge: eff == activeSegment.fromDate → swap the whole segment.
    await tx.bookingRoomSegment.update({
      where: { id: activeSegment.id },
      data:  { roomId: input.newRoomId },
    });
  }

  // IMPORTANT: We do NOT redirect later segments. See overlap-check comment
  // above for rationale (MOVE composability + respecting prior SPLIT/MOVE).

  // `booking.roomId` must reflect the LAST segment (the room the guest ends
  // their stay in). After this MOVE, the last segment may still be the
  // newly-created one, OR it may be an untouched later segment from a
  // prior operation. Re-read to find out.
  const latestSeg = await tx.bookingRoomSegment.findFirst({
    where:   { bookingId: booking.id },
    orderBy: { fromDate: 'desc' },
    take:    1,
    select:  { roomId: true },
  });

  await tx.booking.update({
    where: { id: input.bookingId },
    data: {
      roomId:  latestSeg?.roomId ?? input.newRoomId,
      version: { increment: 1 },
    },
  });

  const fromRoomId = activeSegment.roomId;

  const history = await tx.roomMoveHistory.create({
    data: {
      bookingId:     input.bookingId,
      mode:          RoomChangeMode.MOVE,
      fromRoomId,                               // actual from-room at effectiveDate
      toRoomId:      input.newRoomId,
      effectiveDate: effClamped,
      reason:        input.reason,
      notes:         input.notes ?? null,
      oldRate:       booking.rate,
      newRate:       booking.rate,              // MOVE is billing-invariant
      billingImpact: new Prisma.Decimal(0),
      createdBy:     input.createdBy,
    },
    select: { id: true },
  });

  return {
    bookingId:   input.bookingId,
    fromRoomId,
    toRoomId:    input.newRoomId,
    historyId:   history.id,
    newVersion:  booking.version + 1,
    splitApplied,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SPLIT — explicit multi-room stay wizard. Unlike MOVE, SPLIT is
// billing-NON-invariant: the operator chooses a new rate (and optionally a
// new room + bookingType) for the `[splitDate, segment.toDate)` portion.
//
// What SPLIT does:
//   1. Shrinks the chosen segment to [fromDate, splitDate).
//   2. Creates a new segment [splitDate, toDate) with the operator-supplied
//      roomId / rate / bookingType. These may all equal the original (then the
//      split is a pure timeline cut — rejected as NO_CHANGE).
//   3. Records a RoomMoveHistory row with mode=SPLIT, oldRate + newRate, and
//      billingImpact = (newRate - oldRate) * nightsInNewPortion (signal for
//      downstream folio reconciliation — this tx does NOT touch folio /
//      invoice / payment rows).
//
// What SPLIT does NOT do:
//   - Mutate Folio, Invoice, LineItem, Payment (posted-record immutable).
//     A follow-up rate-adjustment operation handles money movement.
//   - Merge segments. Use the future merge/undo op for that.
//   - Touch booking.roomId — splitDate is strictly after activeSegment.fromDate,
//     so the LAST segment by date may or may not change depending on which
//     segment was split. We recompute `booking.roomId` from the final-day
//     segment after the cut.
// ═══════════════════════════════════════════════════════════════════════════

export interface SplitSegmentInput {
  bookingId:       string;
  segmentId:       string;
  splitDate:       Date;            // strictly within (segment.fromDate, segment.toDate)
  newRoomId?:      string;          // defaults to the segment's current roomId
  newRate:         Prisma.Decimal | number | string;
  newBookingType?: BookingType;           // defaults to the segment's type
  reason:          string;
  notes?:          string;
  expectedVersion: number;
  createdBy:       string;
}

export interface SplitSegmentResult {
  bookingId:       string;
  originalSegmentId: string;   // the shrunk segment
  newSegmentId:    string;
  historyId:       string;
  newVersion:      number;
  billingImpact:   string;     // stringified Decimal (signal)
  nightsAfterSplit: number;
}

export async function splitSegmentInTx(
  tx: Tx,
  input: SplitSegmentInput,
): Promise<SplitSegmentResult> {
  const booking = await tx.booking.findUnique({
    where: { id: input.bookingId },
    select: {
      id: true,
      status: true,
      checkIn: true,
      checkOut: true,
      roomId: true,
      roomLocked: true,
      version: true,
      rate: true,
      bookingType: true,
      roomSegments: {
        orderBy: { fromDate: 'asc' },
        select: {
          id: true, roomId: true, fromDate: true, toDate: true,
          rate: true, bookingType: true,
        },
      },
    },
  });
  if (!booking) {
    throw new RoomChangeError('ไม่พบการจอง', 'BOOKING_NOT_FOUND', 404);
  }
  if (booking.version !== input.expectedVersion) {
    throw new RoomChangeError(
      'การจองถูกแก้ไขโดยผู้อื่น กรุณาลองใหม่อีกครั้ง',
      'VERSION_CONFLICT', 409,
    );
  }
  if (booking.roomLocked) {
    throw new RoomChangeError(
      'การจองนี้ถูกล็อคห้องไว้ — ปลดล็อคก่อนแยกช่วง',
      'BOOKING_LOCKED',
    );
  }
  if (booking.status !== 'confirmed' && booking.status !== 'checked_in') {
    throw new RoomChangeError(
      'SPLIT ใช้ได้เฉพาะการจองที่ยังไม่ check-out หรือยกเลิก',
      'INVALID_STATUS',
    );
  }

  const target = booking.roomSegments.find(s => s.id === input.segmentId);
  if (!target) {
    throw new RoomChangeError(
      'ไม่พบช่วงการพักที่จะแยก',
      'SEGMENT_NOT_FOUND', 404,
    );
  }

  // Normalize splitDate to UTC midnight (date-only)
  const split = new Date(Date.UTC(
    input.splitDate.getUTCFullYear(),
    input.splitDate.getUTCMonth(),
    input.splitDate.getUTCDate(),
  ));

  // splitDate must be strictly INSIDE the segment — both ends equal means
  // there's nothing to split.
  if (
    split.getTime() <= target.fromDate.getTime() ||
    split.getTime() >= target.toDate.getTime()
  ) {
    throw new RoomChangeError(
      'วันที่แยกต้องอยู่ในช่วงการพักนี้ (ไม่ใช่วันเริ่มต้น/สิ้นสุด)',
      'INVALID_SPLIT_DATE',
    );
  }

  const newRoomId      = input.newRoomId      ?? target.roomId;
  const newBookingType = input.newBookingType ?? target.bookingType;
  const newRate        = new Prisma.Decimal(input.newRate);

  // No-change guard: if nothing about the new half differs from the old, this
  // is just a timeline cut with no semantic change — reject to prevent noise.
  const sameRoom = newRoomId === target.roomId;
  const sameRate = newRate.equals(target.rate);
  const sameType = newBookingType === target.bookingType;
  if (sameRoom && sameRate && sameType) {
    throw new RoomChangeError(
      'ไม่มีการเปลี่ยนแปลงในช่วงใหม่ (ห้อง/เรท/ประเภท เหมือนเดิม)',
      'NO_CHANGE',
    );
  }

  // If room changes → validate target room + availability for [split, target.toDate)
  if (!sameRoom) {
    const newRoom = await tx.room.findUnique({
      where: { id: newRoomId },
      select: { id: true, status: true },
    });
    if (!newRoom) {
      throw new RoomChangeError('ไม่พบห้องปลายทาง', 'ROOM_NOT_FOUND', 404);
    }
    if (newRoom.status === 'maintenance') {
      throw new RoomChangeError('ห้องปลายทางอยู่ระหว่างซ่อมบำรุง', 'ROOM_UNAVAILABLE');
    }
    const overlap = await tx.bookingRoomSegment.findFirst({
      where: {
        roomId:    newRoomId,
        bookingId: { not: input.bookingId },
        fromDate:  { lt: target.toDate },
        toDate:    { gt: split },
        booking:   { status: { not: 'cancelled' } },
      },
      select: { id: true },
    });
    if (overlap) {
      throw new RoomChangeError(
        'ห้องปลายทางไม่ว่างในช่วงที่ต้องการ (ชนกับการจองอื่น)',
        'ROOM_UNAVAILABLE',
      );
    }
  }

  // Apply: shrink target + insert new segment
  await tx.bookingRoomSegment.update({
    where: { id: target.id },
    data:  { toDate: split },
  });
  const created = await tx.bookingRoomSegment.create({
    data: {
      bookingId:   booking.id,
      roomId:      newRoomId,
      fromDate:    split,
      toDate:      target.toDate,
      rate:        newRate,
      bookingType: newBookingType,
      createdBy:   input.createdBy,
    },
    select: { id: true },
  });

  // Recompute booking.roomId from the LATEST segment (by fromDate) — this is
  // the room the guest will be in on their final night. If we split the last
  // segment, booking.roomId should follow the new half.
  const allSegments = await tx.bookingRoomSegment.findMany({
    where:   { bookingId: booking.id },
    orderBy: { fromDate: 'desc' },
    take:    1,
    select:  { roomId: true },
  });
  const latestRoomId = allSegments[0]?.roomId ?? booking.roomId;

  await tx.booking.update({
    where: { id: booking.id },
    data: {
      roomId:  latestRoomId,
      version: { increment: 1 },
    },
  });

  // Billing-impact signal: Δrate × nights in the new half.
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const nightsAfterSplit = Math.round(
    (target.toDate.getTime() - split.getTime()) / MS_PER_DAY,
  );
  const rateDelta = newRate.minus(target.rate);
  const billingImpact = rateDelta.times(nightsAfterSplit);

  const history = await tx.roomMoveHistory.create({
    data: {
      bookingId:     booking.id,
      mode:          RoomChangeMode.SPLIT,
      fromRoomId:    target.roomId,
      toRoomId:      newRoomId,
      effectiveDate: split,
      reason:        input.reason,
      notes:         input.notes ?? null,
      oldRate:       target.rate,
      newRate,
      billingImpact,
      createdBy:     input.createdBy,
    },
    select: { id: true },
  });

  return {
    bookingId:         booking.id,
    originalSegmentId: target.id,
    newSegmentId:      created.id,
    historyId:         history.id,
    newVersion:        booking.version + 1,
    billingImpact:     billingImpact.toString(),
    nightsAfterSplit,
  };
}

/**
 * Find rooms that can receive `bookingId` as a MOVE target. Unlike SHUFFLE,
 * this allows crossing room types — guest may be upgrading/downgrading.
 */
export async function listMoveCandidates(
  prisma: Pick<Prisma.TransactionClient, 'booking' | 'room' | 'bookingRoomSegment'>,
  bookingId: string,
  effectiveDate?: Date,
): Promise<Array<{ id: string; number: string; floor: number; typeId: string }>> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, roomId: true, checkIn: true, checkOut: true, status: true },
  });
  if (!booking) return [];

  const fromDate =
    effectiveDate && booking.status === 'checked_in' &&
    effectiveDate.getTime() > booking.checkIn.getTime() &&
    effectiveDate.getTime() < booking.checkOut.getTime()
      ? effectiveDate
      : booking.checkIn;

  const candidateRooms = await prisma.room.findMany({
    where: {
      id: { not: booking.roomId },
      status: { not: 'maintenance' },
    },
    select: { id: true, number: true, floor: true, typeId: true },
    orderBy: [{ floor: 'asc' }, { number: 'asc' }],
  });
  if (candidateRooms.length === 0) return [];

  const roomIds = candidateRooms.map((r) => r.id);
  const busyRows = await prisma.bookingRoomSegment.findMany({
    where: {
      roomId: { in: roomIds },
      bookingId: { not: bookingId },
      fromDate: { lt: booking.checkOut },
      toDate:   { gt: fromDate },
      booking:  { status: { not: 'cancelled' } },
    },
    select: { roomId: true },
  });
  const busySet = new Set(busyRows.map((r) => r.roomId));

  return candidateRooms.filter((r) => !busySet.has(r.id));
}
