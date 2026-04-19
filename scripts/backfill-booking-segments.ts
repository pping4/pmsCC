/**
 * One-shot backfill: create a BookingRoomSegment for every active booking
 * that has zero segments.
 *
 * Context
 * -------
 * BookingRoomSegment is the authoritative source of room-availability /
 * overlap queries in `src/services/roomChange.service.ts`
 * (`listShuffleCandidates`, `listMoveCandidates`, in-transaction overlap
 * checks for SHUFFLE and MOVE). Bookings created before segment creation
 * was wired into the booking-creation flow have **zero** segment rows —
 * which means:
 *
 *   1. They don't appear as "busy" when another booking checks
 *      availability via the segments table → silent double-booking risk.
 *   2. `shuffleRoomInTx` throws `MULTI_SEGMENT_NOT_SUPPORTED` for them
 *      (it requires exactly one segment). MOVE has a lazy backfill inline,
 *      but SHUFFLE does not.
 *
 * What this script does
 * ---------------------
 * Finds every Booking where `status NOT IN ('cancelled', 'checked_out')`
 * that has zero related `BookingRoomSegment` rows, and inserts a single
 * segment covering [checkIn, checkOut) in `booking.roomId`.
 *
 * Properties
 * ----------
 *  - Idempotent: re-running is a no-op. We re-check the segment count
 *    for each candidate inside the transaction before inserting, so even
 *    concurrent runs / a race with MOVE's lazy-backfill cannot produce
 *    duplicate segments.
 *  - Transactional: the whole pass runs inside one `$transaction` so an
 *    error mid-way rolls the batch back and leaves the DB consistent.
 *  - Reports counts on stdout.
 *
 * Run:
 *   npx dotenv -e .env.local -- tsx scripts/backfill-booking-segments.ts
 *
 * Safe to run against production once reviewed — writes only INSERT rows,
 * never mutates existing segments, bookings, or financial data.
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 1. Identify candidates (read-only query, outside the tx so we don't
  //    hold row locks while we think).
  const candidates = await prisma.booking.findMany({
    where: {
      status:       { notIn: ['cancelled', 'checked_out'] },
      roomSegments: { none: {} },
    },
    select: {
      id:            true,
      bookingNumber: true,
      roomId:        true,
      checkIn:       true,
      checkOut:      true,
      rate:          true,
      bookingType:   true,
    },
  });

  console.log(`Found ${candidates.length} booking(s) with zero segments`);

  if (candidates.length === 0) {
    console.log('OK — nothing to backfill');
    return;
  }

  // 2. Backfill inside a single transaction.
  //    - For each booking we re-check its segment count inside the tx
  //      (defence against races with MOVE's lazy-backfill or a concurrent
  //      run of this script). The [booking_id] index makes this cheap.
  //    - Sanity-guard dates: checkOut must be strictly after checkIn.
  const result = await prisma.$transaction(async (tx) => {
    let inserted = 0;
    let skipped  = 0;
    const skippedDetails: Array<{ bookingNumber: string; reason: string }> = [];

    for (const b of candidates) {
      // Race-safe re-check: another process (MOVE lazy-backfill, a second
      // run of this script) may have inserted a segment between the list
      // query and now.
      const existing = await tx.bookingRoomSegment.count({
        where: { bookingId: b.id },
      });
      if (existing > 0) {
        skipped++;
        skippedDetails.push({
          bookingNumber: b.bookingNumber,
          reason:        'segment already exists (race / already backfilled)',
        });
        continue;
      }

      // Defensive date validation — reject bookings with invalid ranges
      // instead of inserting a broken segment the invariant checker would
      // later flag.
      if (b.checkOut.getTime() <= b.checkIn.getTime()) {
        skipped++;
        skippedDetails.push({
          bookingNumber: b.bookingNumber,
          reason:        `invalid date range checkIn=${b.checkIn.toISOString()} checkOut=${b.checkOut.toISOString()}`,
        });
        continue;
      }

      await tx.bookingRoomSegment.create({
        data: {
          bookingId:   b.id,
          roomId:      b.roomId,
          fromDate:    b.checkIn,
          toDate:      b.checkOut,
          rate:        b.rate,
          bookingType: b.bookingType,
          createdBy:   'system-backfill',
        },
      });
      inserted++;
    }

    return { inserted, skipped, skippedDetails };
  }, {
    // Serializable isolation mirrors how shuffleRoomInTx / moveRoomInTx
    // run. Prevents overlapping inserts producing duplicate segments.
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    timeout:        60_000,
  });

  console.log(`Inserted: ${result.inserted}`);
  console.log(`Skipped:  ${result.skipped}`);
  if (result.skippedDetails.length > 0) {
    for (const d of result.skippedDetails.slice(0, 50)) {
      console.log(`  - ${d.bookingNumber}: ${d.reason}`);
    }
    if (result.skippedDetails.length > 50) {
      console.log(`  ... and ${result.skippedDetails.length - 50} more`);
    }
  }
  console.log('Done.');
}

main()
  .catch((e) => {
    console.error('Backfill failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
