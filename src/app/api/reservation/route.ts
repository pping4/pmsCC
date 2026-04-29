import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { recalculateRate, RateCalculationContext } from '@/services/bookingRate.service';
import { logActivity } from '@/services/activityLog.service';
import { addCharge, addNightlyRoomCharges, createInvoiceFromFolio, getFolioByBookingId, partialVoidInvoice, voidCharge } from '@/services/folio.service';
import { createPendingRefund } from '@/services/refund.service';
import { transitionRoom, canTransition } from '@/services/roomStatus.service';
import { z } from 'zod';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toUTCMidnight(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00.000Z');
}

function toUTCEndOfDay(dateStr: string): Date {
  return new Date(dateStr + 'T23:59:59.999Z');
}

function addUTCDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

/**
 * Timezone-safe date formatter for @db.Date columns.
 * Prisma returns @db.Date as a Date at midnight in the server's local timezone.
 * Using toISOString() would shift dates back 1 day in UTC+ timezones.
 * Instead, we use local date parts which match the stored calendar date.
 */
function formatUTCDate(d: Date): string {
  const year  = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day   = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Helper: Calculate nights between two dates
 */
function calculateNights(checkIn: Date, checkOut: Date): number {
  const ms = checkOut.getTime() - checkIn.getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

/**
 * Zod schema for PATCH request with optional expectedVersion for optimistic locking
 */
const ReservationUpdateSchema = z.object({
  bookingId: z.string().min(1),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  roomId: z.string().optional(),
  expectedVersion: z.number().int().min(1),
  idempotencyKey: z.string().min(1),
});

// ─── GET /api/reservation ─────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);

  const todayStr = formatUTCDate(new Date());
  const defaultTo = addUTCDays(new Date(), 29);
  const defaultToStr = formatUTCDate(defaultTo);

  const fromStr = searchParams.get('from') || todayStr;
  const toStr   = searchParams.get('to')   || defaultToStr;

  const fromDate = toUTCMidnight(fromStr);
  const toDate   = toUTCEndOfDay(toStr);

  // Optional filters
  const floorFilter    = searchParams.get('floor')      ? Number(searchParams.get('floor'))      : undefined;
  const roomTypeFilter = searchParams.get('roomTypeId') || undefined;

  // ── Fetch room segments in the date range ──
  // BookingRoomSegment is the authoritative source of "where was this booking
  // physically staying on a given day". For bookings that were split across
  // rooms (guest-initiated MOVE mid-stay), one booking has multiple segments
  // landing in different rooms. We use segments to drive tape-chart placement
  // so split bookings render as distinct blocks in each room row.
  // We fetch ALL segments of bookings whose stay overlaps the window (not
  // just segments that themselves overlap). Why: for a split booking where
  // only one segment is visible in the window, we still need to know the TRUE
  // total segment count so continuation markers (dashed edges, "✂ ช่วงที่ 2/3")
  // render correctly on the visible segment.
  // IMPORTANT: filter by SEGMENT's own dates, not booking.checkIn/checkOut.
  // The overlap-check API does the same — using booking dates here creates
  // inconsistency where check-overlap blocks a room (segment overlaps window)
  // but render misses it (booking dates fall outside window). Could happen
  // from orphan segments left after MOVE/SPLIT + date change, which should
  // still be visible so the user understands why a room is blocked.
  const segmentRows = await prisma.bookingRoomSegment.findMany({
    where: {
      fromDate: { lt: toDate   },
      toDate:   { gt: fromDate },
      booking: { status: { not: 'cancelled' } },
    },
    select: {
      bookingId: true,
      roomId:    true,
      fromDate:  true,
      toDate:    true,
    },
    orderBy: [{ bookingId: 'asc' }, { fromDate: 'asc' }],
  });

  // segmentsByBooking: bookingId → ordered list of segments (across all rooms)
  const segmentsByBooking = new Map<string, Array<{ roomId: string; fromDate: Date; toDate: Date }>>();
  for (const s of segmentRows) {
    const arr = segmentsByBooking.get(s.bookingId) ?? [];
    arr.push({ roomId: s.roomId, fromDate: s.fromDate, toDate: s.toDate });
    segmentsByBooking.set(s.bookingId, arr);
  }

  // ── Fetch room types + rooms + their bookings in the date range ──
  const roomTypes = await prisma.roomType.findMany({
    orderBy: { code: 'asc' },
    include: {
      rooms: {
        where: {
          ...(floorFilter !== undefined ? { floor: floorFilter } : {}),
        },
        orderBy: [{ floor: 'asc' }, { number: 'asc' }],
        include: {
          rate: {
            select: {
              dailyRate:        true,
              monthlyShortRate: true,
              monthlyLongRate:  true,
            },
          },
          bookings: {
            where: {
              status:   { not: 'cancelled' },
              checkIn:  { lt: toDate   },
              checkOut: { gt: fromDate },
            },
            select: {
              id:            true,
              bookingNumber: true,
              status:        true,
              bookingType:   true,
              source:        true,
              checkIn:       true,
              checkOut:      true,
              rate:          true,
              deposit:       true,
              notes:         true,
              version:       true,
              roomLocked:    true,
              guest: {
                select: {
                  id:          true,
                  firstName:   true,
                  lastName:    true,
                  firstNameTH: true,
                  lastNameTH:  true,
                  nationality: true,
                  phone:       true,
                  email:       true,
                },
              },
              // City Ledger account (populated after migration)
              cityLedgerAccountId: true,
              cityLedgerAccount: {
                select: { id: true, companyName: true, accountCode: true },
              },
              // Include invoices to calculate payment level
              invoices: {
                select: {
                  grandTotal: true,
                  paidAmount: true,
                  status:     true,
                },
              },
              // Folio totals are the source of truth for the popup's
              // outstanding/paid figures.  Computing `rate * nights` at the
              // client breaks after drag-resize because route.ts stores
              // booking.rate as cumulative, not per-night.
              folio: {
                select: {
                  totalCharges:  true,
                  totalPayments: true,
                  balance:       true,
                },
              },
            },
            orderBy: { checkIn: 'asc' },
          },
        },
      },
    },
    ...(roomTypeFilter ? { where: { id: roomTypeFilter } } : {}),
  });

  // ── Calculate occupancy per day ──
  // For each day in range, count bookings with status checked_in or confirmed
  const rangeDays = Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
  const occupancyPerDay: Record<string, number> = {};

  for (let i = 0; i < rangeDays; i++) {
    const day = addUTCDays(fromDate, i);
    const dayStr = formatUTCDate(day);
    const dayEnd = addUTCDays(day, 1);
    let count = 0;
    for (const rt of roomTypes) {
      for (const room of rt.rooms) {
        for (const b of room.bookings) {
          const bIn  = new Date(b.checkIn);
          const bOut = new Date(b.checkOut);
          if (bIn < dayEnd && bOut > day) count++;
        }
      }
    }
    occupancyPerDay[dayStr] = count;
  }

  // Total rooms count (for occupancy %)
  const totalRooms = roomTypes.reduce((s, rt) => s + rt.rooms.length, 0);

  // ── Serialize + compute payment level per booking ────────────────────────
  // First: build a per-booking snapshot keyed by id. This lets us emit the
  // same booking in multiple rooms (for split bookings) without recomputing
  // totalPaid / paymentLevel / expectedTotal each time.
  type BookingSnapshot = {
    id:            string;
    bookingNumber: string;
    status:        string;
    bookingType:   string;
    source:        string;
    notes:         string | null;
    version:       number;
    guest:         unknown;
    rate:          number;
    deposit:       number;
    roomLocked:    boolean;
    paymentLevel:  'pending' | 'deposit_paid' | 'fully_paid';
    totalPaid:     number;
    expectedTotal: number;
    cityLedgerAccountId: string | null;
    cityLedgerAccount:   unknown;
    checkIn:       string;
    checkOut:      string;
    // which room booking.roomId points to (for fallback when no segments)
    _roomId:       string;
  };

  const bookingsById = new Map<string, BookingSnapshot>();
  for (const rt of roomTypes) {
    for (const room of rt.rooms) {
      for (const b of room.bookings) {
        if (bookingsById.has(b.id)) continue;
        // `booking.roomId` isn't in the select; since this booking is nested
        // under `room`, we know its canonical roomId is the parent room.id.
        const bookingRoomId = room.id;
        const rate    = Number(b.rate);
        const deposit = Number(b.deposit);
        const invoices = (b as any).invoices || [];

        // Authoritative numbers come from the Folio (totalCharges / totalPayments
        // are kept in sync by recalculateFolioBalance after every charge,
        // payment, void).  Folio is missing for legacy bookings that predate
        // the folio rollout, so fall back to the old rate*nights/invoice-sum
        // calculation in that case.
        const folio = (b as any).folio as
          | { totalCharges: unknown; totalPayments: unknown; balance: unknown }
          | null
          | undefined;
        let expectedTotal: number;
        let totalPaid:     number;
        if (folio) {
          expectedTotal = Number(folio.totalCharges ?? 0);
          totalPaid     = Number(folio.totalPayments ?? 0);
        } else {
          expectedTotal = rate;
          if (b.bookingType === 'daily') {
            const nights = calculateNights(new Date(b.checkIn), new Date(b.checkOut));
            expectedTotal = rate * Math.max(1, nights);
          }
          totalPaid = invoices
            .filter((inv: any) => inv.status !== 'voided' && inv.status !== 'cancelled')
            .reduce((sum: number, inv: any) => sum + Number(inv.paidAmount ?? 0), 0);
        }

        let paymentLevel: 'pending' | 'deposit_paid' | 'fully_paid' = 'pending';
        if (totalPaid >= expectedTotal && expectedTotal > 0) {
          paymentLevel = 'fully_paid';
        } else if (totalPaid > 0) {
          paymentLevel = 'deposit_paid';
        }

        bookingsById.set(b.id, {
          id:            b.id,
          bookingNumber: b.bookingNumber,
          status:        b.status,
          bookingType:   b.bookingType,
          source:        b.source,
          notes:         b.notes,
          version:       b.version,
          guest:         b.guest,
          rate,
          deposit,
          roomLocked:    (b as any).roomLocked ?? false,
          paymentLevel,
          totalPaid,
          expectedTotal,
          cityLedgerAccountId: (b as any).cityLedgerAccountId ?? null,
          cityLedgerAccount:   (b as any).cityLedgerAccount   ?? null,
          checkIn:  formatUTCDate(new Date(b.checkIn)),
          checkOut: formatUTCDate(new Date(b.checkOut)),
          _roomId:  bookingRoomId,
        });
      }
    }
  }

  // ── Backfill: bookings that have segments in visible rooms but whose
  // canonical `booking.roomId` points OUTSIDE the visible room set. This
  // happens when a booking was MOVEd across rooms — BookingRoomSegment
  // records the physical occupancy, but booking.roomId still points to the
  // original room. Without this backfill the tape chart would show that room
  // as empty even though the overlap-check API (which queries segments)
  // correctly blocks new bookings — the exact inconsistency the user saw.
  const missingBookingIds: string[] = [];
  for (const bid of segmentsByBooking.keys()) {
    if (!bookingsById.has(bid)) missingBookingIds.push(bid);
  }
  if (missingBookingIds.length > 0) {
    const missing = await prisma.booking.findMany({
      where: { id: { in: missingBookingIds } },
      select: {
        id:            true,
        bookingNumber: true,
        status:        true,
        bookingType:   true,
        source:        true,
        notes:         true,
        version:       true,
        rate:          true,
        deposit:       true,
        roomLocked:    true,
        roomId:        true,
        checkIn:       true,
        checkOut:      true,
        cityLedgerAccountId: true,
        cityLedgerAccount: { select: { id: true, companyName: true, accountCode: true } },
        guest: {
          select: {
            id: true, firstName: true, lastName: true, firstNameTH: true,
            lastNameTH: true, nationality: true, phone: true, email: true,
          },
        },
        invoices: { select: { grandTotal: true, paidAmount: true, status: true } },
        folio: { select: { totalCharges: true, totalPayments: true, balance: true } },
      },
    });
    for (const b of missing) {
      const rate    = Number(b.rate);
      const deposit = Number(b.deposit);
      const invoices = b.invoices ?? [];
      // Same authoritative-folio logic as the primary branch above.
      let expectedTotal: number;
      let totalPaid:     number;
      if (b.folio) {
        expectedTotal = Number(b.folio.totalCharges ?? 0);
        totalPaid     = Number(b.folio.totalPayments ?? 0);
      } else {
        expectedTotal = rate;
        if (b.bookingType === 'daily') {
          const nights = calculateNights(new Date(b.checkIn), new Date(b.checkOut));
          expectedTotal = rate * Math.max(1, nights);
        }
        totalPaid = invoices
          .filter((inv) => inv.status !== 'voided' && inv.status !== 'cancelled')
          .reduce((sum, inv) => sum + Number(inv.paidAmount ?? 0), 0);
      }
      let paymentLevel: 'pending' | 'deposit_paid' | 'fully_paid' = 'pending';
      if (totalPaid >= expectedTotal && expectedTotal > 0) paymentLevel = 'fully_paid';
      else if (totalPaid > 0)                              paymentLevel = 'deposit_paid';
      bookingsById.set(b.id, {
        id:            b.id,
        bookingNumber: b.bookingNumber,
        status:        b.status,
        bookingType:   b.bookingType,
        source:        b.source,
        notes:         b.notes,
        version:       b.version,
        guest:         b.guest,
        rate,
        deposit,
        roomLocked:    b.roomLocked ?? false,
        paymentLevel,
        totalPaid,
        expectedTotal,
        cityLedgerAccountId: b.cityLedgerAccountId ?? null,
        cityLedgerAccount:   b.cityLedgerAccount   ?? null,
        checkIn:  formatUTCDate(new Date(b.checkIn)),
        checkOut: formatUTCDate(new Date(b.checkOut)),
        _roomId:  b.roomId,
      });
    }
  }

  // Second: bucket bookings into rooms using BookingRoomSegment as the
  // authoritative placement. For each room, collect the segments that land
  // in it and emit one entry per segment. If a booking has no segments
  // (legacy), fall back to placing it in booking.roomId for its full range.
  type RenderEntry = BookingSnapshot & {
    segmentFrom?:    string;
    segmentTo?:      string;
    isFirstSegment?: boolean;
    isLastSegment?:  boolean;
    segmentIndex?:   number;
    segmentCount?:   number;
  };

  const entriesByRoom = new Map<string, RenderEntry[]>();
  const pushEntry = (roomId: string, entry: RenderEntry) => {
    const arr = entriesByRoom.get(roomId) ?? [];
    arr.push(entry);
    entriesByRoom.set(roomId, arr);
  };

  for (const snap of bookingsById.values()) {
    const segs = segmentsByBooking.get(snap.id);
    if (!segs || segs.length === 0) {
      // Legacy booking with no segments — render as one block in booking.roomId
      pushEntry(snap._roomId, { ...snap });
      continue;
    }
    // Stable ordering by fromDate (already ordered from query). We keep the
    // TOTAL segment count so the rendered entries know they're part of a
    // split even if other segments fall outside the visible window.
    const totalSegs = segs.length;
    segs.forEach((s, idx) => {
      // Skip segments that don't overlap the visible window — they produce
      // no rendered block but their existence still informs segmentCount.
      if (s.fromDate.getTime() >= toDate.getTime())   return;
      if (s.toDate.getTime()   <= fromDate.getTime()) return;
      pushEntry(s.roomId, {
        ...snap,
        segmentFrom:    formatUTCDate(new Date(s.fromDate)),
        segmentTo:      formatUTCDate(new Date(s.toDate)),
        isFirstSegment: idx === 0,
        isLastSegment:  idx === totalSegs - 1,
        segmentIndex:   idx,
        segmentCount:   totalSegs,
      });
    });
  }

  const serialized = roomTypes.map(rt => ({
    ...rt,
    rooms: rt.rooms.map(room => {
      const entries = entriesByRoom.get(room.id) ?? [];
      // Sort by (segmentFrom || checkIn) ascending for stable layout
      entries.sort((a, b) => {
        const ka = a.segmentFrom ?? a.checkIn;
        const kb = b.segmentFrom ?? b.checkIn;
        return ka.localeCompare(kb);
      });
      return {
        ...room,
        rate: room.rate
          ? {
              dailyRate:        room.rate.dailyRate        ? Number(room.rate.dailyRate)        : null,
              monthlyShortRate: room.rate.monthlyShortRate ? Number(room.rate.monthlyShortRate) : null,
              monthlyLongRate:  room.rate.monthlyLongRate  ? Number(room.rate.monthlyLongRate)  : null,
            }
          : null,
        bookings: entries.map(({ _roomId, ...rest }) => rest),
      };
    }),
  }));

  return NextResponse.json({
    roomTypes: serialized,
    from:  fromStr,
    to:    toStr,
    today: todayStr,
    occupancyPerDay,
    totalRooms,
  });
}

// ─── PATCH /api/reservation ───────────────────────────────────────────────────
// Move booking dates (drag) or change room (cross-room drag)
// Now includes rate recalculation and optimistic concurrency control

export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const parsed = ReservationUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { bookingId, checkIn, checkOut, roomId, expectedVersion, idempotencyKey } = parsed.data;

    const newCheckIn = toUTCMidnight(checkIn);
    const newCheckOut = toUTCMidnight(checkOut);

    if (newCheckOut <= newCheckIn) {
      return NextResponse.json({ error: 'checkOut ต้องหลัง checkIn' }, { status: 400 });
    }

    // === IDEMPOTENCY CHECK ===
    if (idempotencyKey) {
      const existing = (await prisma.$queryRaw`
        SELECT key, result, expires_at FROM idempotency_records WHERE key = ${idempotencyKey}
      `) as any[];
      if (
        existing &&
        existing.length > 0 &&
        new Date(existing[0].expires_at) > new Date()
      ) {
        return NextResponse.json(existing[0].result, { status: 200 });
      }
    }

    // Fetch the booking with full details for rate recalculation
    const booking = (await prisma.booking.findUnique({
      where: { id: bookingId },
    })) as any;

    if (!booking) {
      return NextResponse.json({ error: 'ไม่พบการจอง' }, { status: 404 });
    }

    if (booking.status === 'cancelled' || booking.status === 'checked_out') {
      return NextResponse.json({
        error: 'ไม่สามารถแก้ไขการจองที่ยกเลิกแล้วหรือเช็คเอาท์แล้ว',
      }, { status: 400 });
    }

    // === OPTIMISTIC CONCURRENCY CONTROL ===
    if (expectedVersion !== undefined && booking.version !== expectedVersion) {
      return NextResponse.json(
        {
          error: 'ข้อมูลถูกเปลี่ยนแปลงโดยผู้ใช้อื่น กรุณารีเฟรชหน้าจอ',
          currentVersion: booking.version,
          expectedVersion,
        },
        { status: 409 }
      );
    }

    const targetRoomId = roomId || booking.roomId;

    // === RATE RECALCULATION LOGIC (Server verification) ===
    const rateResult = await prisma.$transaction(async (tx) => {
      const context: RateCalculationContext = {
        bookingId,
        newCheckIn,
        newCheckOut,
        currentRate: booking.rate,
        currentDeposit: booking.deposit,
        bookingStatus: booking.status,
        bookingType: booking.bookingType,
        roomId: targetRoomId,
        checkIn: new Date(booking.checkIn),
        checkOut: new Date(booking.checkOut),
      };
      return recalculateRate(context, tx);
    });

    // If scenario is not allowed
    if (!rateResult.isAllowed) {
      return NextResponse.json(
        { error: rateResult.userMessage, scenario: rateResult.scenario },
        { status: 400 }
      );
    }

    // === DOUBLE-BOOKING VALIDATION ===
    // Segment-aware: BookingRoomSegment is authoritative for "who physically
    // occupies this room on these dates" (see preview-resize for rationale).
    const conflictSegment = await prisma.bookingRoomSegment.findFirst({
      where: {
        roomId:    targetRoomId,
        bookingId: { not: bookingId },
        fromDate:  { lt: newCheckOut },
        toDate:    { gt: newCheckIn },
        booking:   { status: { in: ['confirmed', 'checked_in'] } },
      },
      select: {
        booking: {
          select: {
            bookingNumber: true,
            guest: { select: { firstName: true, lastName: true, firstNameTH: true, lastNameTH: true } },
          },
        },
      },
    });
    const conflict = conflictSegment?.booking ?? null;

    if (conflict) {
      const guestName =
        conflict.guest.firstNameTH && conflict.guest.lastNameTH
          ? `${conflict.guest.firstNameTH} ${conflict.guest.lastNameTH}`
          : `${conflict.guest.firstName} ${conflict.guest.lastName}`;
      return NextResponse.json(
        { error: `วันที่ทับซ้อนกับการจอง ${conflict.bookingNumber} (${guestName})` },
        { status: 409 }
      );
    }

    // === TRANSACTION: Update booking + handle financial adjustments ===
    const updated = await prisma.$transaction(async (tx) => {
      // Calculate nights for audit
      const originalNights = calculateNights(
        new Date(booking.checkIn),
        new Date(booking.checkOut)
      );
      const newNights = calculateNights(newCheckIn, newCheckOut);

      // Update booking with optimistic lock check: version must match (if expectedVersion provided)
      let updateData: any = {
        checkIn: newCheckIn,
        checkOut: newCheckOut,
        rate: rateResult.newRate,
        ...(roomId ? { roomId } : {}),
      };

      // If expectedVersion is provided, verify version matches before updating
      if (expectedVersion !== undefined) {
        // Verify version matches before updating
        const currentBooking = (await tx.booking.findUnique({
          where: { id: bookingId },
        })) as any;

        if (currentBooking.version !== expectedVersion) {
          throw new Error('VERSION_MISMATCH');
        }

        // Update with version increment
        updateData.version = { increment: 1 };
      }

      const upd = (await tx.booking.update({
        where: { id: bookingId },
        data: updateData,
      })) as any;

      // ── Keep BookingRoomSegment in sync ────────────────────────────────────
      // The tape chart and availability queries read segments as authoritative.
      // Drag-resize / same-room drag here mutates the booking-wide dates / room,
      // so the single segment covering [checkIn, checkOut) must follow.
      //
      // Multi-segment bookings (split across rooms) are guarded at the UI:
      // partial-segment blocks are NOT draggable, so we shouldn't reach here
      // with >1 segment. Defence in depth: if we do, reject rather than silently
      // corrupt the timeline.
      const existingSegs = await tx.bookingRoomSegment.findMany({
        where:  { bookingId },
        select: { id: true },
      });
      if (existingSegs.length > 1) {
        throw new Error('MULTI_SEGMENT_DRAG_REJECTED');
      }
      if (existingSegs.length === 1) {
        await tx.bookingRoomSegment.update({
          where: { id: existingSegs[0].id },
          data: {
            roomId:   targetRoomId,
            fromDate: newCheckIn,
            toDate:   newCheckOut,
          },
        });
      } else {
        // Zero segments — legacy booking. Lazy-create so future reads are
        // consistent (same pattern as moveRoomInTx / backfill script).
        await tx.bookingRoomSegment.create({
          data: {
            bookingId,
            roomId:      targetRoomId,
            fromDate:    newCheckIn,
            toDate:      newCheckOut,
            rate:        rateResult.newRate,
            bookingType: booking.bookingType,
            createdBy:   'system-lazy-backfill',
          },
        });
      }

      // Determine what changed
      const roomChanged = roomId && roomId !== booking.roomId;
      const datesChanged = formatUTCDate(newCheckIn) !== formatUTCDate(new Date(booking.checkIn)) || formatUTCDate(newCheckOut) !== formatUTCDate(new Date(booking.checkOut));

      // Resolve room numbers for human-readable history descriptions.
      // Without this, the history tab shows raw UUIDs like
      // "ย้ายห้อง BK-XXX: ห้อง f84f79b9-... → ห้อง 1819a956-..." — unreadable.
      const [fromRoomRec, toRoomRec] = roomChanged
        ? await Promise.all([
            tx.room.findUnique({ where: { id: booking.roomId }, select: { number: true } }),
            tx.room.findUnique({ where: { id: roomId! },        select: { number: true } }),
          ])
        : [null, null];
      const fromRoomLabel = fromRoomRec?.number ?? String(booking.roomId).slice(0, 8);
      const toRoomLabel   = toRoomRec?.number   ?? String(roomId ?? booking.roomId).slice(0, 8);

      let action = 'booking.updated';
      let description = `อัปเดตการจอง ${booking.bookingNumber}`;
      let icon = '📋';

      if (roomChanged && datesChanged) {
        action = 'booking.movedAndRescheduled';
        description = `ย้ายและเลื่อนวัน ${booking.bookingNumber}: ห้อง ${fromRoomLabel} → ห้อง ${toRoomLabel}, ${formatUTCDate(new Date(booking.checkIn))} → ${formatUTCDate(newCheckIn)}`;
        icon = '🔀';
      } else if (roomChanged) {
        action = 'booking.roomMoved';
        description = `ย้ายห้อง ${booking.bookingNumber}: ห้อง ${fromRoomLabel} → ห้อง ${toRoomLabel}`;
        icon = '🚪';
      } else if (newNights > originalNights) {
        action = 'booking.extended';
        description = `ต่ออายุการจอง ${booking.bookingNumber}: ${originalNights} → ${newNights} คืน`;
        icon = '📅';
      } else if (newNights < originalNights) {
        action = 'booking.shortened';
        description = `ย่นระยะการจอง ${booking.bookingNumber}: ${originalNights} → ${newNights} คืน`;
        icon = '✂️';
      }

      await logActivity(tx, {
        session,
        action,
        category: 'booking',
        description,
        bookingId,
        roomId: targetRoomId,
        guestId: booking.guestId,
        icon,
        severity: 'info',
        metadata: {
          before: { checkIn: formatUTCDate(new Date(booking.checkIn)), checkOut: formatUTCDate(new Date(booking.checkOut)), roomId: booking.roomId, rate: Number(booking.rate), nights: originalNights },
          after:  { checkIn: formatUTCDate(newCheckIn), checkOut: formatUTCDate(newCheckOut), roomId: targetRoomId, rate: Number(rateResult.newRate), nights: newNights },
          scenario: rateResult.scenario,
        },
      });

      // Create RateAudit record — wrapped in try/catch so audit failures don't block the booking update
      try {
        const changedBy = session.user?.id || session.user?.email || 'system';
        await tx.rateAudit.create({
          data: {
            bookingId,
            changedBy,
            changeType: 'drag_resize',
            previousRate: booking.rate,
            newRate: rateResult.newRate,
            previousNights: originalNights,
            newNights,
            previousTotal: booking.rate,
            newTotal: rateResult.newRate,
            scenario: rateResult.scenario,
            notes: rateResult.userMessage || null,
          },
        });
      } catch (auditErr) {
        // Log but don't fail the booking update if audit insert fails
        console.warn('RateAudit insert failed (non-fatal):', auditErr);
      }

      // Handle financial adjustments based on scenario.
      //
      // Run for BOTH scenario C (extend, partial paid) and scenario D (extend,
      // fully paid). Both produce additionalCharge > 0 when nightsDifference
      // > 0 -- they only differ in payment posture.  Originally this block
      // was guarded by `scenario === 'D'` only, which left scenario-C extends
      // with FolioLineItem rows still UNBILLED forever (no invoice = nothing
      // for the cashier to collect against, and the bill tab showed no "รับ
      // ชำระเงิน" button).  Issuing INV-EX immediately means the cashier can
      // collect any time before checkout via the existing pay flow.
      if (
        (rateResult.scenario === 'C' || rateResult.scenario === 'D') &&
        rateResult.additionalCharge &&
        rateResult.additionalCharge.greaterThan(0)
      ) {
        const folio = await getFolioByBookingId(tx, bookingId);
        if (!folio) {
          throw new Error('FOLIO_NOT_FOUND');
        }

        const changedBy = session.user?.id || session.user?.email || 'system';
        const nightsAdded = newNights - originalNights;
        const ratePerNight = Number(rateResult.additionalCharge) / nightsAdded;

        // Receipt-Standardization: drag-resize on a daily booking → 1 row per
        // added night. The first added night starts at the OLD checkOut.
        if (booking.bookingType === 'daily') {
          // Need the room number — fetch since `booking` here doesn't include it
          const r = await tx.room.findUnique({
            where:  { id: booking.roomId },
            select: { number: true },
          });
          await addNightlyRoomCharges(tx, {
            folioId:      folio.folioId,
            roomNumber:   r?.number ?? '?',
            startDate:    new Date(booking.checkOut),
            nights:       nightsAdded,
            ratePerNight,
            taxType:      'no_tax',
            referenceType: 'Booking',
            referenceId:   bookingId,
            notes:         'Drag-resize extension',
            createdBy:    changedBy,
          });
        } else {
          // Monthly drag-resize keeps a single charge spanning the extension
          await addCharge(tx, {
            folioId: folio.folioId,
            chargeType: 'ROOM',
            description: `ค่าเช่าเพิ่มเติม (ขยายระยะเวลา)`,
            amount: Number(rateResult.additionalCharge),
            quantity: 1,
            unitPrice: Number(rateResult.additionalCharge),
            taxType: 'no_tax',
            serviceDate: new Date(booking.checkOut),
            periodEnd:   newCheckOut,
            referenceType: 'Booking',
            referenceId: bookingId,
            notes: 'Drag-resize extension',
            createdBy: changedBy,
          });
        }

        await createInvoiceFromFolio(tx, {
          folioId: folio.folioId,
          guestId: booking.guestId,
          bookingId,
          invoiceType: 'EX',
          dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          notes: `Additional charge for extended stay (${nightsAdded} คืน)`,
          createdBy: changedBy,
        });
      }

      // Refund obligations — Scenarios B (deposit > new rate) and C/D (shortening)
      // Create a PENDING refund record; actual cash-out is handled by finance later.
      if (rateResult.refundDue && rateResult.refundDue.greaterThan(0)) {
        const changedBy = session.user?.id || session.user?.email || 'system';
        const reason =
          rateResult.scenario === 'B'
            ? 'เงินมัดจำเกินกว่าอัตราใหม่ (drag-resize)'
            : `ลดการพัก ${originalNights - newNights} คืน (drag-resize)`;

        // Phase 3 — properly void the affected line items via the
        // partialVoidInvoice helper. This (a) marks the right rows VOIDED,
        // (b) posts DR Revenue / CR AR ledger reversal so subledger and
        // GL stay in sync, (c) resyncs folio totals.  Old code did a raw
        // updateMany + manual recalc which left ledger and folio out of
        // sync (folio.totalCharges dropped, but no ledger reversal was
        // posted -- so the GL still showed the original revenue).
        if (booking.bookingType === 'daily') {
          const folio = await getFolioByBookingId(tx, bookingId);
          if (folio) {
            // Find the folio line items for the now-removed nights, grouped
            // by their parent invoice so we can call partialVoidInvoice
            // once per invoice.
            const orphans = await tx.folioLineItem.findMany({
              where: {
                folioId:    folio.folioId,
                chargeType: 'ROOM' as never,
                billingStatus: { not: 'VOIDED' as never },
                serviceDate: { gte: newCheckOut },
              },
              select: {
                id: true,
                invoiceItem: { select: { invoiceId: true } },
              },
            });
            const byInvoice = new Map<string, string[]>();
            for (const o of orphans) {
              const invId = o.invoiceItem?.invoiceId;
              if (!invId) continue; // unbilled — can be voided directly via voidCharge
              const list = byInvoice.get(invId) ?? [];
              list.push(o.id);
              byInvoice.set(invId, list);
            }
            const reason = `Voided by drag-shorten (${originalNights - newNights} คืน)`;
            for (const [invId, ids] of byInvoice) {
              await partialVoidInvoice(tx, {
                invoiceId:        invId,
                folioLineItemIds: ids,
                reason,
                voidedBy:         changedBy,
              });
            }
            // Any UNBILLED orphans (extension nights that never made it to
            // an invoice) — void each via the existing voidCharge helper.
            for (const o of orphans) {
              if (!o.invoiceItem?.invoiceId) {
                await voidCharge(tx, o.id);
              }
            }
          }
        }

        await createPendingRefund(tx, {
          bookingId,
          guestId: booking.guestId,
          amount: rateResult.refundDue,
          source: 'rate_adjustment',
          reason,
          referenceType: 'Booking',
          referenceId: bookingId,
          notes: rateResult.userMessage,
          createdBy: changedBy,
        });
      }

      // Handle room status changes
      if (roomId && roomId !== booking.roomId) {
        // Free old room if no other active booking
        const oldRoomActiveBookings = await tx.booking.count({
          where: {
            id: { not: bookingId },
            roomId: booking.roomId,
            status: { in: ['confirmed', 'checked_in'] },
          },
        });
        const changedBy = session.user?.id || session.user?.email || 'system';
        if (oldRoomActiveBookings === 0) {
          const oldLive = await tx.room.findUniqueOrThrow({
            where: { id: booking.roomId },
            select: { status: true },
          });
          if (canTransition(oldLive.status, 'available')) {
            await transitionRoom(tx, {
              roomId:           booking.roomId,
              to:               'available',
              reason:           'room move — old room freed',
              userId:           changedBy,
              userName:         session.user?.name ?? undefined,
              bookingId,
              currentBookingId: null,
            });
          }
        }
        // Mark new room as reserved/occupied
        const newStatus = upd.status === 'checked_in' ? 'occupied' : 'reserved';
        const newLive = await tx.room.findUniqueOrThrow({
          where: { id: roomId },
          select: { status: true },
        });
        if (canTransition(newLive.status, newStatus)) {
          await transitionRoom(tx, {
            roomId:           roomId,
            to:               newStatus,
            reason:           'room move — new room assigned',
            userId:           changedBy,
            userName:         session.user?.name ?? undefined,
            bookingId,
            currentBookingId: bookingId,
          });
        }
      }

      return upd;
    }).catch((error) => {
      // Handle optimistic lock failure
      if (error.code === 'P2025') {
        // Record not found (version mismatch)
        throw new Error('VERSION_MISMATCH');
      }
      throw error;
    });

    // === PREPARE RESPONSE ===
    const responseBody = {
      success: true,
      booking: {
        id: updated.id,
        bookingNumber: updated.bookingNumber,
        checkIn: formatUTCDate(updated.checkIn),
        checkOut: formatUTCDate(updated.checkOut),
        status: updated.status,
        roomId: updated.roomId,
        rate: updated.rate.toString(),
        version: updated.version,
      },
    };

    // === SAVE IDEMPOTENCY RECORD ===
    if (idempotencyKey) {
      const idempotencyId = Math.random().toString(36).substring(2, 9);
      await prisma.$executeRaw`
        INSERT INTO idempotency_records (id, key, result, created_at, expires_at)
        VALUES (${idempotencyId}, ${idempotencyKey}, ${JSON.stringify(responseBody)}::jsonb, NOW(), NOW() + INTERVAL '24 hours')
        ON CONFLICT (key) DO NOTHING
      `.catch(() => {
        // Ignore if record already exists
      });
    }

    return NextResponse.json(responseBody);
  } catch (error) {
    if (error instanceof Error && error.message === 'VERSION_MISMATCH') {
      return NextResponse.json(
        { error: 'ข้อมูลถูกเปลี่ยนแปลงโดยผู้ใช้อื่น กรุณารีเฟรชหน้าจอ' },
        { status: 409 }
      );
    }
    if (error instanceof Error && error.message === 'MULTI_SEGMENT_DRAG_REJECTED') {
      return NextResponse.json(
        {
          error: 'การจองนี้ถูก split ข้ามห้อง — ไม่สามารถใช้ drag-resize ได้ กรุณาใช้เมนู "ย้ายห้อง" / "แยกช่วง" ใน Detail Panel',
        },
        { status: 400 }
      );
    }
    if (error instanceof Error && error.message === 'FOLIO_NOT_FOUND') {
      return NextResponse.json(
        { error: 'ไม่พบ Folio สำหรับการจองนี้ กรุณาติดต่อผู้ดูแลระบบ' },
        { status: 500 }
      );
    }
    console.error('PATCH /api/reservation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
