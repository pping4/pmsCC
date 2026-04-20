/**
 * E2E Test Script — Room Change (SHUFFLE / MOVE / split render invariants)
 *
 * Exercises the core service-layer invariants directly (no HTTP server
 * required), the same way the API routes invoke them — inside a Serializable
 * $transaction. Covers:
 *
 *   1. SHUFFLE happy path (pre-arrival, same type, no billing change)
 *   2. SHUFFLE rejects cross-type moves (ROOM_TYPE_MISMATCH)
 *   3. SHUFFLE rejects checked_in bookings (INVALID_STATUS)
 *   4. MOVE pre-arrival (confirmed, cross-type allowed)
 *   5. MOVE mid-stay with split (checked_in, splits active segment)
 *   6. MOVE lazy-backfills zero-segment legacy bookings (SEGMENT_NOT_FOUND fix)
 *   7. MOVE rejects version mismatch (VERSION_CONFLICT)
 *   8. MOVE rejects same-room (SAME_ROOM)
 *   9. MOVE rejects room-locked booking (BOOKING_LOCKED)
 *  10. listShuffleCandidates excludes busy + current + wrong-type rooms
 *  11. listMoveCandidates is segment-aware
 *
 * Run: npx tsx scripts/test-e2e-room-change.ts
 *
 * Idempotent: creates test rooms/guests/bookings with a fixed prefix, cleans
 * up on both start and finish.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import {
  shuffleRoomInTx,
  moveRoomInTx,
  splitSegmentInTx,
  listShuffleCandidates,
  listMoveCandidates,
  RoomChangeError,
} from '../src/services/roomChange.service';

const prisma = new PrismaClient({ log: ['error'] });

// ─── ANSI + assertion helpers ───────────────────────────────────────────────
const RED = '\x1b[31m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m', RESET = '\x1b[0m', BOLD = '\x1b[1m';

let passed = 0, failed = 0;
const failures: string[] = [];

function ok(label: string, value: unknown) {
  if (value) {
    console.log(`  ${GREEN}✓${RESET} ${label}`);
    passed++;
  } else {
    console.log(`  ${RED}✗${RESET} ${label} ${RED}(got: ${JSON.stringify(value)})${RESET}`);
    failed++;
    failures.push(label);
  }
}
async function okThrows(
  label: string,
  expectedCode: string,
  fn: () => Promise<unknown>,
) {
  try {
    await fn();
    console.log(`  ${RED}✗${RESET} ${label} ${RED}(expected throw with code=${expectedCode}, got success)${RESET}`);
    failed++;
    failures.push(label);
  } catch (err) {
    if (err instanceof RoomChangeError && err.code === expectedCode) {
      console.log(`  ${GREEN}✓${RESET} ${label}  ${YELLOW}(${err.code})${RESET}`);
      passed++;
    } else {
      console.log(`  ${RED}✗${RESET} ${label} ${RED}(unexpected: ${err instanceof Error ? err.message : String(err)})${RESET}`);
      failed++;
      failures.push(label);
    }
  }
}
function section(name: string) {
  console.log(`\n${BOLD}${CYAN}━━ ${name} ━━${RESET}`);
}

// ─── Test data prefix (for cleanup isolation) ───────────────────────────────
const PREFIX = 'E2E-RC-';

async function cleanup() {
  // Delete in FK order. Scoped to our prefix only.
  await prisma.roomMoveHistory.deleteMany({
    where: { booking: { bookingNumber: { startsWith: PREFIX } } },
  });
  await prisma.bookingRoomSegment.deleteMany({
    where: { booking: { bookingNumber: { startsWith: PREFIX } } },
  });
  await prisma.booking.deleteMany({ where: { bookingNumber: { startsWith: PREFIX } } });
  await prisma.guest.deleteMany({ where: { firstName: { startsWith: PREFIX } } });
  await prisma.room.deleteMany({ where: { number: { startsWith: PREFIX } } });
  await prisma.roomType.deleteMany({ where: { code: { startsWith: PREFIX } } });
}

// ─── Date helpers (UTC midnight @db.Date semantics) ─────────────────────────
const day0 = (() => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
})();
const addDays = (d: Date, n: number) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));

// ─── Setup: fixtures ────────────────────────────────────────────────────────
async function setupFixtures() {
  // Two room types (to test cross-type rejection on SHUFFLE)
  const std = await prisma.roomType.create({
    data: {
      code: `${PREFIX}STD`, name: 'E2E Std', icon: '🛏',
      baseDaily: 1000, baseMonthly: 20000,
    },
  });
  const dlx = await prisma.roomType.create({
    data: {
      code: `${PREFIX}DLX`, name: 'E2E Dlx', icon: '👑',
      baseDaily: 2000, baseMonthly: 40000,
    },
  });
  // 4 rooms: 2 std (a/b), 2 dlx (c/d)
  const roomA = await prisma.room.create({ data: { number: `${PREFIX}A`, floor: 1, typeId: std.id, status: 'available' } });
  const roomB = await prisma.room.create({ data: { number: `${PREFIX}B`, floor: 1, typeId: std.id, status: 'available' } });
  const roomC = await prisma.room.create({ data: { number: `${PREFIX}C`, floor: 1, typeId: dlx.id, status: 'available' } });
  const roomD = await prisma.room.create({ data: { number: `${PREFIX}D`, floor: 1, typeId: dlx.id, status: 'available' } });

  // Guests
  const g1 = await prisma.guest.create({
    data: { firstName: `${PREFIX}G1`, lastName: 'T', nationality: 'TH', phone: '000', idNumber: `${PREFIX}ID1` },
  });
  const g2 = await prisma.guest.create({
    data: { firstName: `${PREFIX}G2`, lastName: 'T', nationality: 'TH', phone: '001', idNumber: `${PREFIX}ID2` },
  });

  return { std, dlx, roomA, roomB, roomC, roomD, g1, g2 };
}

async function createBooking(opts: {
  num: string;
  guestId: string;
  roomId: string;
  checkIn: Date;
  checkOut: Date;
  status: 'confirmed' | 'checked_in';
  rate?: number;
  withSegment?: boolean;  // default true; set false to simulate legacy zero-segment row
  roomLocked?: boolean;
}) {
  const b = await prisma.booking.create({
    data: {
      bookingNumber: `${PREFIX}${opts.num}`,
      guestId:       opts.guestId,
      roomId:        opts.roomId,
      checkIn:       opts.checkIn,
      checkOut:      opts.checkOut,
      rate:          opts.rate ?? 1000,
      deposit:       0,
      status:        opts.status,
      bookingType:   'daily',
      source:        'direct',
      roomLocked:    opts.roomLocked ?? false,
    },
  });
  if (opts.withSegment !== false) {
    await prisma.bookingRoomSegment.create({
      data: {
        bookingId:   b.id,
        roomId:      opts.roomId,
        fromDate:    opts.checkIn,
        toDate:      opts.checkOut,
        rate:        opts.rate ?? 1000,
        bookingType: 'daily',
        createdBy:   'e2e-test',
      },
    });
  }
  return b;
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`${BOLD}Room-Change E2E Test Suite${RESET}\n`);

  await cleanup();
  const fx = await setupFixtures();

  // ─────────────────────────────────────────────────────────────────────────
  section('SHUFFLE — happy path (same type, pre-arrival)');
  // ─────────────────────────────────────────────────────────────────────────
  {
    const b = await createBooking({
      num: 'S1', guestId: fx.g1.id, roomId: fx.roomA.id,
      checkIn: addDays(day0, 5), checkOut: addDays(day0, 8),
      status: 'confirmed',
    });
    const res = await prisma.$transaction(
      (tx) => shuffleRoomInTx(tx, {
        bookingId: b.id, newRoomId: fx.roomB.id,
        reason: 'free up room A', expectedVersion: b.version,
        createdBy: 'e2e',
      }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    ok('toRoomId matches', res.toRoomId === fx.roomB.id);
    ok('version bumped', res.newVersion === b.version + 1);
    const segs = await prisma.bookingRoomSegment.findMany({ where: { bookingId: b.id } });
    ok('single segment, now on roomB', segs.length === 1 && segs[0].roomId === fx.roomB.id);
    const hist = await prisma.roomMoveHistory.findFirst({ where: { bookingId: b.id, mode: 'SHUFFLE' } });
    ok('history recorded (SHUFFLE)', !!hist && hist.billingImpact.equals(0));
  }

  // ─────────────────────────────────────────────────────────────────────────
  section('SHUFFLE — rejects cross-type');
  // ─────────────────────────────────────────────────────────────────────────
  {
    const b = await createBooking({
      num: 'S2', guestId: fx.g1.id, roomId: fx.roomA.id,
      checkIn: addDays(day0, 20), checkOut: addDays(day0, 22),
      status: 'confirmed',
    });
    await okThrows('SHUFFLE STD→DLX', 'ROOM_TYPE_MISMATCH', () =>
      prisma.$transaction(
        (tx) => shuffleRoomInTx(tx, {
          bookingId: b.id, newRoomId: fx.roomC.id,
          reason: 'x', expectedVersion: b.version, createdBy: 'e2e',
        }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  section('SHUFFLE — rejects checked_in');
  // ─────────────────────────────────────────────────────────────────────────
  {
    const b = await createBooking({
      num: 'S3', guestId: fx.g1.id, roomId: fx.roomA.id,
      checkIn: addDays(day0, -1), checkOut: addDays(day0, 2),
      status: 'checked_in',
    });
    await okThrows('SHUFFLE on checked_in', 'INVALID_STATUS', () =>
      prisma.$transaction(
        (tx) => shuffleRoomInTx(tx, {
          bookingId: b.id, newRoomId: fx.roomB.id,
          reason: 'x', expectedVersion: b.version, createdBy: 'e2e',
        }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  section('MOVE — pre-arrival, cross-type allowed');
  // ─────────────────────────────────────────────────────────────────────────
  {
    const b = await createBooking({
      num: 'M1', guestId: fx.g2.id, roomId: fx.roomA.id,
      checkIn: addDays(day0, 30), checkOut: addDays(day0, 33),
      status: 'confirmed',
    });
    const res = await prisma.$transaction(
      (tx) => moveRoomInTx(tx, {
        bookingId: b.id, newRoomId: fx.roomC.id,
        effectiveDate: addDays(day0, 30),
        reason: 'upgrade', expectedVersion: b.version, createdBy: 'e2e',
      }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    ok('MOVE pre-arrival cross-type', res.toRoomId === fx.roomC.id);
    ok('no split on pre-arrival', res.splitApplied === false);
    const bAfter = await prisma.booking.findUnique({ where: { id: b.id } });
    ok('booking.roomId updated', bAfter?.roomId === fx.roomC.id);
  }

  // ─────────────────────────────────────────────────────────────────────────
  section('MOVE — mid-stay split');
  // ─────────────────────────────────────────────────────────────────────────
  {
    const b = await createBooking({
      num: 'M2', guestId: fx.g2.id, roomId: fx.roomA.id,
      checkIn: addDays(day0, -2), checkOut: addDays(day0, 3),
      status: 'checked_in',
    });
    const splitAt = addDays(day0, 1);
    const res = await prisma.$transaction(
      (tx) => moveRoomInTx(tx, {
        bookingId: b.id, newRoomId: fx.roomB.id,
        effectiveDate: splitAt,
        reason: 'mid-stay move', expectedVersion: b.version, createdBy: 'e2e',
      }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    ok('splitApplied === true', res.splitApplied === true);
    const segs = await prisma.bookingRoomSegment.findMany({
      where: { bookingId: b.id }, orderBy: { fromDate: 'asc' },
    });
    ok('2 segments after split', segs.length === 2);
    ok('seg[0] = roomA [checkIn, splitAt)',
      segs[0].roomId === fx.roomA.id &&
      segs[0].toDate.getTime() === splitAt.getTime());
    ok('seg[1] = roomB [splitAt, checkOut)',
      segs[1].roomId === fx.roomB.id &&
      segs[1].fromDate.getTime() === splitAt.getTime());
    const hist = await prisma.roomMoveHistory.findFirst({
      where: { bookingId: b.id, mode: 'MOVE' },
    });
    ok('history billing-invariant', hist?.billingImpact.equals(0) === true);
  }

  // ─────────────────────────────────────────────────────────────────────────
  section('MOVE — lazy-backfills zero-segment legacy booking');
  // ─────────────────────────────────────────────────────────────────────────
  {
    const b = await createBooking({
      num: 'M3', guestId: fx.g2.id, roomId: fx.roomA.id,
      checkIn: addDays(day0, 40), checkOut: addDays(day0, 43),
      status: 'confirmed',
      withSegment: false,  // simulate pre-Phase-1 legacy row
    });
    const res = await prisma.$transaction(
      (tx) => moveRoomInTx(tx, {
        bookingId: b.id, newRoomId: fx.roomB.id,
        effectiveDate: addDays(day0, 40),
        reason: 'legacy move', expectedVersion: b.version, createdBy: 'e2e',
      }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    ok('MOVE succeeded despite zero starting segments', res.toRoomId === fx.roomB.id);
    const segs = await prisma.bookingRoomSegment.findMany({ where: { bookingId: b.id } });
    ok('segment now exists after lazy backfill + move', segs.length === 1);
    ok('segment points to new room', segs[0].roomId === fx.roomB.id);
  }

  // ─────────────────────────────────────────────────────────────────────────
  section('MOVE — version conflict');
  // ─────────────────────────────────────────────────────────────────────────
  {
    const b = await createBooking({
      num: 'M4', guestId: fx.g2.id, roomId: fx.roomA.id,
      checkIn: addDays(day0, 50), checkOut: addDays(day0, 52),
      status: 'confirmed',
    });
    await okThrows('stale expectedVersion', 'VERSION_CONFLICT', () =>
      prisma.$transaction(
        (tx) => moveRoomInTx(tx, {
          bookingId: b.id, newRoomId: fx.roomB.id,
          effectiveDate: addDays(day0, 50),
          reason: 'x', expectedVersion: b.version + 99, createdBy: 'e2e',
        }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  section('MOVE — same-room rejection');
  // ─────────────────────────────────────────────────────────────────────────
  {
    const b = await createBooking({
      num: 'M5', guestId: fx.g2.id, roomId: fx.roomA.id,
      checkIn: addDays(day0, 60), checkOut: addDays(day0, 62),
      status: 'confirmed',
    });
    await okThrows('MOVE to same room', 'SAME_ROOM', () =>
      prisma.$transaction(
        (tx) => moveRoomInTx(tx, {
          bookingId: b.id, newRoomId: fx.roomA.id,
          effectiveDate: addDays(day0, 60),
          reason: 'x', expectedVersion: b.version, createdBy: 'e2e',
        }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  section('MOVE — room-locked booking');
  // ─────────────────────────────────────────────────────────────────────────
  {
    const b = await createBooking({
      num: 'M6', guestId: fx.g2.id, roomId: fx.roomA.id,
      checkIn: addDays(day0, 70), checkOut: addDays(day0, 72),
      status: 'confirmed',
      roomLocked: true,
    });
    await okThrows('room-locked rejection', 'BOOKING_LOCKED', () =>
      prisma.$transaction(
        (tx) => moveRoomInTx(tx, {
          bookingId: b.id, newRoomId: fx.roomB.id,
          effectiveDate: addDays(day0, 70),
          reason: 'x', expectedVersion: b.version, createdBy: 'e2e',
        }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  section('listShuffleCandidates — excludes busy/current/wrong-type');
  // ─────────────────────────────────────────────────────────────────────────
  {
    const b = await createBooking({
      num: 'LC1', guestId: fx.g1.id, roomId: fx.roomA.id,
      checkIn: addDays(day0, 80), checkOut: addDays(day0, 82),
      status: 'confirmed',
    });
    // Occupy roomB on overlapping dates → should be excluded
    await createBooking({
      num: 'LC1B', guestId: fx.g2.id, roomId: fx.roomB.id,
      checkIn: addDays(day0, 81), checkOut: addDays(day0, 83),
      status: 'confirmed',
    });
    const cands = await listShuffleCandidates(prisma, b.id);
    const ids = cands.map(c => c.id);
    ok('roomA (current) excluded',   !ids.includes(fx.roomA.id));
    ok('roomB (busy) excluded',      !ids.includes(fx.roomB.id));
    ok('roomC (wrong type) excluded', !ids.includes(fx.roomC.id));
    ok('roomD (wrong type) excluded', !ids.includes(fx.roomD.id));
  }

  // ─────────────────────────────────────────────────────────────────────────
  section('listMoveCandidates — segment-aware, cross-type allowed');
  // ─────────────────────────────────────────────────────────────────────────
  {
    const b = await createBooking({
      num: 'LM1', guestId: fx.g1.id, roomId: fx.roomA.id,
      checkIn: addDays(day0, 90), checkOut: addDays(day0, 93),
      status: 'confirmed',
    });
    const cands = await listMoveCandidates(prisma, b.id);
    const ids = cands.map(c => c.id);
    ok('roomA (current) excluded', !ids.includes(fx.roomA.id));
    ok('roomB (free, same type) included', ids.includes(fx.roomB.id));
    ok('roomC (free, cross type) included', ids.includes(fx.roomC.id));
  }

  // ─────────────────────────────────────────────────────────────────────────
  section('SPLIT — happy path (rate change, same room)');
  // ─────────────────────────────────────────────────────────────────────────
  {
    const b = await createBooking({
      num: 'SP1', guestId: fx.g1.id, roomId: fx.roomA.id,
      checkIn: addDays(day0, 100), checkOut: addDays(day0, 105),
      status: 'confirmed', rate: 1000,
    });
    const seg = await prisma.bookingRoomSegment.findFirst({ where: { bookingId: b.id } });
    const res = await prisma.$transaction(
      (tx) => splitSegmentInTx(tx, {
        bookingId: b.id, segmentId: seg!.id,
        splitDate: addDays(day0, 102),
        newRate: 1500,
        reason: 'rate adjusted mid-stay', expectedVersion: b.version, createdBy: 'e2e',
      }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    ok('originalSegmentId returned', res.originalSegmentId === seg!.id);
    ok('newSegmentId differs', res.newSegmentId !== seg!.id);
    ok('nightsAfterSplit = 3', res.nightsAfterSplit === 3);
    ok('billingImpact = 500 × 3 = 1500', res.billingImpact === '1500');
    const segs = await prisma.bookingRoomSegment.findMany({
      where: { bookingId: b.id }, orderBy: { fromDate: 'asc' },
    });
    ok('2 segments after split', segs.length === 2);
    ok('seg[0] rate unchanged', segs[0].rate.toString() === '1000');
    ok('seg[1] rate = 1500', segs[1].rate.toString() === '1500');
    ok('both segments same room', segs[0].roomId === fx.roomA.id && segs[1].roomId === fx.roomA.id);
    const hist = await prisma.roomMoveHistory.findFirst({
      where: { bookingId: b.id, mode: 'SPLIT' },
    });
    ok('history mode=SPLIT', !!hist);
    ok('history billingImpact = 1500', hist?.billingImpact.toString() === '1500');
  }

  // ─────────────────────────────────────────────────────────────────────────
  section('SPLIT — room + rate change');
  // ─────────────────────────────────────────────────────────────────────────
  {
    const b = await createBooking({
      num: 'SP2', guestId: fx.g1.id, roomId: fx.roomA.id,
      checkIn: addDays(day0, 110), checkOut: addDays(day0, 114),
      status: 'confirmed', rate: 1000,
    });
    const seg = await prisma.bookingRoomSegment.findFirst({ where: { bookingId: b.id } });
    const res = await prisma.$transaction(
      (tx) => splitSegmentInTx(tx, {
        bookingId: b.id, segmentId: seg!.id,
        splitDate: addDays(day0, 112),
        newRoomId: fx.roomC.id,
        newRate: 2000,
        reason: 'upgrade mid-stay', expectedVersion: b.version, createdBy: 'e2e',
      }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    ok('newSegment roomId is C', res.newSegmentId !== seg!.id);
    const bAfter = await prisma.booking.findUnique({ where: { id: b.id } });
    ok('booking.roomId updated to latest (C)', bAfter?.roomId === fx.roomC.id);
    ok('version bumped', bAfter?.version === b.version + 1);
    const segs = await prisma.bookingRoomSegment.findMany({
      where: { bookingId: b.id }, orderBy: { fromDate: 'asc' },
    });
    ok('seg[0] still roomA', segs[0].roomId === fx.roomA.id);
    ok('seg[1] now roomC', segs[1].roomId === fx.roomC.id);
  }

  // ─────────────────────────────────────────────────────────────────────────
  section('SPLIT — rejects NO_CHANGE (same room + rate + type)');
  // ─────────────────────────────────────────────────────────────────────────
  {
    const b = await createBooking({
      num: 'SP3', guestId: fx.g1.id, roomId: fx.roomA.id,
      checkIn: addDays(day0, 120), checkOut: addDays(day0, 123),
      status: 'confirmed', rate: 1000,
    });
    const seg = await prisma.bookingRoomSegment.findFirst({ where: { bookingId: b.id } });
    await okThrows('no-op split', 'NO_CHANGE', () =>
      prisma.$transaction(
        (tx) => splitSegmentInTx(tx, {
          bookingId: b.id, segmentId: seg!.id,
          splitDate: addDays(day0, 121),
          newRate: 1000,  // same as current
          reason: 'x', expectedVersion: b.version, createdBy: 'e2e',
        }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  section('SPLIT — rejects out-of-range splitDate');
  // ─────────────────────────────────────────────────────────────────────────
  {
    const b = await createBooking({
      num: 'SP4', guestId: fx.g1.id, roomId: fx.roomA.id,
      checkIn: addDays(day0, 130), checkOut: addDays(day0, 133),
      status: 'confirmed', rate: 1000,
    });
    const seg = await prisma.bookingRoomSegment.findFirst({ where: { bookingId: b.id } });
    await okThrows('splitDate = fromDate', 'INVALID_SPLIT_DATE', () =>
      prisma.$transaction(
        (tx) => splitSegmentInTx(tx, {
          bookingId: b.id, segmentId: seg!.id,
          splitDate: addDays(day0, 130),  // == fromDate
          newRate: 2000,
          reason: 'x', expectedVersion: b.version, createdBy: 'e2e',
        }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  section('SPLIT then EXTEND — last segment.toDate tracks booking.checkOut');
  // ─────────────────────────────────────────────────────────────────────────
  //
  // Regression: before the fix, `/extend` updated booking.checkOut but left
  // the last BookingRoomSegment.toDate untouched. After a prior SPLIT, the
  // tape chart (segment-driven) rendered the stay as shorter than it was,
  // and the segment-based availability check let other bookings double-
  // book the room during the extension window.
  //
  // This test drives the same two transactions the API calls — splitSegmentInTx
  // then the same segment-sync logic `/extend` performs — and asserts that
  // the last segment's toDate matches the new checkOut after both operations.
  {
    const b = await createBooking({
      num: 'EXT1', guestId: fx.g1.id, roomId: fx.roomA.id,
      checkIn: addDays(day0, 140), checkOut: addDays(day0, 145),
      status: 'checked_in', rate: 1000,
    });
    const firstSeg = await prisma.bookingRoomSegment.findFirst({ where: { bookingId: b.id } });

    // Step 1: SPLIT at day +143 (new half = [143, 145) on roomB @ 1200)
    await prisma.$transaction(
      (tx) => splitSegmentInTx(tx, {
        bookingId: b.id, segmentId: firstSeg!.id,
        splitDate: addDays(day0, 143),
        newRoomId: fx.roomB.id, newRate: 1200,
        reason: 'mid-stay upgrade', expectedVersion: b.version, createdBy: 'e2e',
      }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    // Step 2: simulate `/extend` — push checkOut from day+145 → day+148 and
    // sync the LAST segment's toDate in the same transaction.
    const newCheckOut = addDays(day0, 148);
    await prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: b.id },
        data:  { checkOut: newCheckOut },
      });
      const last = await tx.bookingRoomSegment.findFirst({
        where: { bookingId: b.id }, orderBy: { fromDate: 'desc' },
      });
      await tx.bookingRoomSegment.update({
        where: { id: last!.id },
        data:  { toDate: newCheckOut },
      });
    });

    const segs = await prisma.bookingRoomSegment.findMany({
      where: { bookingId: b.id }, orderBy: { fromDate: 'asc' },
    });
    const bAfter = await prisma.booking.findUnique({ where: { id: b.id } });
    ok('2 segments after split+extend', segs.length === 2);
    ok('seg[1] (last) ends at new checkOut',
      segs[1].toDate.getTime() === newCheckOut.getTime());
    ok('booking.checkOut === last segment.toDate',
      bAfter!.checkOut.getTime() === segs[1].toDate.getTime());
  }

  // ─────────────────────────────────────────────────────────────────────────
  section('MOVE — sequential (A → B, stay, then B → C)');
  // ─────────────────────────────────────────────────────────────────────────
  //
  // Real-world: guest moves, stays a day, then wants to move again. The
  // booking must end up with three segments: A[checkIn, eff1), B[eff1, eff2),
  // C[eff2, checkOut).
  {
    const b = await createBooking({
      num: 'MV1', guestId: fx.g1.id, roomId: fx.roomA.id,
      checkIn: addDays(day0, 150), checkOut: addDays(day0, 156),
      status: 'checked_in', rate: 1000,
    });
    // First MOVE at day+152 → A, B
    const r1 = await prisma.$transaction(
      (tx) => moveRoomInTx(tx, {
        bookingId: b.id, newRoomId: fx.roomB.id,
        effectiveDate: addDays(day0, 152),
        reason: '1st move', expectedVersion: b.version, createdBy: 'e2e',
      }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    // Second MOVE at day+154 → A, B (shortened), D
    // (roomC is DLX, but we need a 3rd available room. roomD is DLX too.)
    const r2 = await prisma.$transaction(
      (tx) => moveRoomInTx(tx, {
        bookingId: b.id, newRoomId: fx.roomD.id,
        effectiveDate: addDays(day0, 154),
        reason: '2nd move', expectedVersion: r1.newVersion, createdBy: 'e2e',
      }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    ok('2nd MOVE succeeded', r2.splitApplied === true);
    const segs = await prisma.bookingRoomSegment.findMany({
      where: { bookingId: b.id }, orderBy: { fromDate: 'asc' },
    });
    ok('3 segments after two MOVEs', segs.length === 3);
    ok('seg[0] = roomA', segs[0].roomId === fx.roomA.id);
    ok('seg[1] = roomB', segs[1].roomId === fx.roomB.id);
    ok('seg[2] = roomD', segs[2].roomId === fx.roomD.id);
    const bAfter = await prisma.booking.findUnique({ where: { id: b.id } });
    ok('booking.roomId tracks latest (D)', bAfter?.roomId === fx.roomD.id);
  }

  // ─────────────────────────────────────────────────────────────────────────
  section('MOVE — scheduled future (confirmed booking, eff in future)');
  // ─────────────────────────────────────────────────────────────────────────
  //
  // Ops schedules a move that takes effect several days into the guest's
  // stay — they stay in the old room until then, then the segment splits.
  {
    const b = await createBooking({
      num: 'MV2', guestId: fx.g2.id, roomId: fx.roomA.id,
      checkIn: addDays(day0, 160), checkOut: addDays(day0, 165),
      status: 'confirmed', rate: 1000,
    });
    // Future-scheduled move: effective day+163 (2 days into the stay)
    await prisma.$transaction(
      (tx) => moveRoomInTx(tx, {
        bookingId: b.id, newRoomId: fx.roomB.id,
        effectiveDate: addDays(day0, 163),
        reason: 'scheduled future', expectedVersion: b.version, createdBy: 'e2e',
      }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    const segs = await prisma.bookingRoomSegment.findMany({
      where: { bookingId: b.id }, orderBy: { fromDate: 'asc' },
    });
    ok('2 segments after scheduled MOVE', segs.length === 2);
    ok('pre-move part stays in A', segs[0].roomId === fx.roomA.id);
    ok('pre-move part ends at eff', segs[0].toDate.getTime() === addDays(day0, 163).getTime());
    ok('post-move part in B', segs[1].roomId === fx.roomB.id);
  }

  // ─────────────────────────────────────────────────────────────────────────
  section('MOVE — composes with SPLIT (does NOT overwrite later segment)');
  // ─────────────────────────────────────────────────────────────────────────
  //
  // Regression: the old behaviour redirected ALL later segments to the new
  // room. If the operator had already SPLIT a future day onto room X, a
  // MOVE at an earlier date would silently overwrite X. The fix scopes MOVE
  // to activeSegment only.
  {
    const b = await createBooking({
      num: 'MV3', guestId: fx.g1.id, roomId: fx.roomA.id,
      checkIn: addDays(day0, 170), checkOut: addDays(day0, 175),
      status: 'confirmed', rate: 1000,
    });
    const firstSeg = await prisma.bookingRoomSegment.findFirst({ where: { bookingId: b.id } });
    // SPLIT: put days 173-175 on roomC at a different rate
    const r1 = await prisma.$transaction(
      (tx) => splitSegmentInTx(tx, {
        bookingId: b.id, segmentId: firstSeg!.id,
        splitDate: addDays(day0, 173),
        newRoomId: fx.roomC.id, newRate: 1500,
        reason: 'future upgrade', expectedVersion: b.version, createdBy: 'e2e',
      }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    // Now MOVE at eff=171 to roomB. This should ONLY touch the A segment
    // (days 170-173), NOT the future C segment (days 173-175).
    await prisma.$transaction(
      (tx) => moveRoomInTx(tx, {
        bookingId: b.id, newRoomId: fx.roomB.id,
        effectiveDate: addDays(day0, 171),
        reason: 'earlier move', expectedVersion: r1.newVersion, createdBy: 'e2e',
      }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    const segs = await prisma.bookingRoomSegment.findMany({
      where: { bookingId: b.id }, orderBy: { fromDate: 'asc' },
    });
    ok('3 segments after SPLIT + MOVE', segs.length === 3);
    ok('seg[0] A[170,171)', segs[0].roomId === fx.roomA.id);
    ok('seg[1] B[171,173)', segs[1].roomId === fx.roomB.id);
    ok('seg[2] C[173,175) preserved (NOT overwritten)', segs[2].roomId === fx.roomC.id);
    ok('seg[2] rate still 1500 (SPLIT rate preserved)', segs[2].rate.toString() === '1500');
  }

  // ─────────────────────────────────────────────────────────────────────────
  section('Segment-based overlap — post-MOVE availability on vacated room');
  // ─────────────────────────────────────────────────────────────────────────
  //
  // Regression (user report: "จองห้องไม่ได้ ทั้งๆที่ห้องว่าง"):
  //
  // Old Booking-based overlap kept rejecting a new booking on room A for the
  // post-move days, because booking.checkIn/checkOut still spanned the whole
  // stay. Fix: /api/bookings POST and /api/reservation/check-overlap now use
  // segment-based findFirst. Here we exercise the SAME query shape directly.
  {
    // Existing stay A[200,205), mid-stay MOVE at day 202 to B.
    // After MOVE: segments A[200,202), B[202,205).
    // → Room A must be available for a NEW booking in [202,205).
    // → Room A must still be BUSY for [200,202).
    // → Room B must be BUSY for [202,205).
    const b = await createBooking({
      num: 'OV1', guestId: fx.g1.id, roomId: fx.roomA.id,
      checkIn: addDays(day0, 200), checkOut: addDays(day0, 205),
      status: 'confirmed', rate: 1000,
    });
    await prisma.$transaction(
      (tx) => moveRoomInTx(tx, {
        bookingId: b.id, newRoomId: fx.roomB.id,
        effectiveDate: addDays(day0, 202),
        reason: 'vacate A mid-stay', expectedVersion: b.version, createdBy: 'e2e',
      }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    // Segment-aware overlap query — identical shape to /api/bookings POST
    // and /api/reservation/check-overlap GET.
    async function segBusy(roomId: string, ci: Date, co: Date) {
      return prisma.bookingRoomSegment.findFirst({
        where: {
          roomId,
          fromDate: { lt: co },
          toDate:   { gt: ci },
          booking:  { status: { in: ['confirmed', 'checked_in'] } },
        },
        select: { id: true },
      });
    }

    const roomAPostMove = await segBusy(fx.roomA.id, addDays(day0, 202), addDays(day0, 205));
    ok('room A free for [202,205) after MOVE', roomAPostMove === null);

    const roomAPreMove = await segBusy(fx.roomA.id, addDays(day0, 200), addDays(day0, 202));
    ok('room A still busy for [200,202) before MOVE', roomAPreMove !== null);

    const roomBPostMove = await segBusy(fx.roomB.id, addDays(day0, 202), addDays(day0, 205));
    ok('room B busy for [202,205) (destination)', roomBPostMove !== null);

    // Partial overlap at the boundary: [204,207) should still flag B busy (shares 204-205).
    const roomBBoundary = await segBusy(fx.roomB.id, addDays(day0, 204), addDays(day0, 207));
    ok('room B busy for boundary-overlap [204,207)', roomBBoundary !== null);

    // Adjacent, non-overlapping: [205,208) must be FREE on B.
    const roomBAdjacent = await segBusy(fx.roomB.id, addDays(day0, 205), addDays(day0, 208));
    ok('room B free for adjacent [205,208)', roomBAdjacent === null);
  }

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`${BOLD}Results:${RESET}  ${GREEN}${passed} passed${RESET}   ${failed > 0 ? RED : ''}${failed} failed${RESET}`);
  if (failures.length) {
    console.log(`\n${RED}Failed:${RESET}`);
    for (const f of failures) console.log(`  - ${f}`);
  }

  await cleanup();
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(`\n${RED}Unexpected error:${RESET}`, e);
  await cleanup().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
