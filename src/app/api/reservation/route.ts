import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { recalculateRate, RateCalculationContext } from '@/services/bookingRate.service';
import { logActivity } from '@/services/activityLog.service';
import { z } from 'zod';
import { Decimal } from '@prisma/client/runtime/library';

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
  expectedVersion: z.number().int().min(1).optional(),
  idempotencyKey: z.string().optional(),
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
  const segmentRows = await prisma.bookingRoomSegment.findMany({
    where: {
      booking: {
        status:   { not: 'cancelled' },
        checkIn:  { lt: toDate   },
        checkOut: { gt: fromDate },
      },
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

        let expectedTotal = rate;
        if (b.bookingType === 'daily') {
          const nights = calculateNights(new Date(b.checkIn), new Date(b.checkOut));
          expectedTotal = rate * Math.max(1, nights);
        }

        const totalPaid = invoices
          .filter((inv: any) => inv.status !== 'voided' && inv.status !== 'cancelled')
          .reduce((sum: number, inv: any) => sum + Number(inv.paidAmount ?? 0), 0);

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
        const rateAuditId = `ra_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const auditNotes = rateResult.userMessage || null;
        const changedBy = session.user?.id || session.user?.email || 'system';
        await tx.$executeRaw`
          INSERT INTO rate_audits (id, booking_id, changed_by, change_type, previous_rate, new_rate, previous_nights, new_nights, previous_total, new_total, scenario, notes, created_at)
          VALUES (${rateAuditId}, ${bookingId}, ${changedBy}, 'drag_resize', ${Number(booking.rate)}, ${Number(rateResult.newRate)}, ${originalNights}, ${newNights}, ${Number(booking.rate)}, ${Number(rateResult.newRate)}, ${rateResult.scenario}, ${auditNotes}, NOW())
        `;
      } catch (auditErr) {
        // Log but don't fail the booking update if audit insert fails
        console.warn('RateAudit insert failed (non-fatal):', auditErr);
      }

      // Handle financial adjustments based on scenario
      if (
        rateResult.scenario === 'D' &&
        rateResult.additionalCharge &&
        rateResult.additionalCharge.greaterThan(0)
      ) {
        // Scenario D (extend, fully paid): Create new invoice
        const invoiceCount = await tx.invoice.count();
        const invoiceNumber = `INV-EX-${String(invoiceCount + 1).padStart(5, '0')}`;

        await tx.invoice.create({
          data: {
            invoiceNumber,
            bookingId,
            guestId: booking.guestId,
            issueDate: new Date(),
            dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
            subtotal: rateResult.additionalCharge,
            vatAmount: new Decimal(0),
            grandTotal: rateResult.additionalCharge,
            status: 'unpaid',
            notes: `Additional charge for extended stay`,
          },
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
        if (oldRoomActiveBookings === 0) {
          await tx.room.update({
            where: { id: booking.roomId },
            data: { status: 'available', currentBookingId: null },
          });
        }
        // Mark new room as reserved/occupied
        const newStatus = upd.status === 'checked_in' ? 'occupied' : 'reserved';
        await tx.room.update({
          where: { id: roomId },
          data: { status: newStatus, currentBookingId: bookingId },
        });
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
    console.error('PATCH /api/reservation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
