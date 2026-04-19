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
