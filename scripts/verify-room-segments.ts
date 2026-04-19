/**
 * Invariant check for BookingRoomSegment (Phase 1 foundation).
 *
 * Verifies for every non-cancelled booking:
 *   1. At least one segment exists
 *   2. Segments are contiguous + non-overlapping
 *   3. Segments' union exactly covers [checkIn, checkOut)
 *
 * Run: npx dotenv -e .env.local -- tsx scripts/verify-room-segments.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface Violation {
  bookingId: string;
  bookingNumber: string;
  reason: string;
}

async function main() {
  const bookings = await prisma.booking.findMany({
    where: { status: { not: 'cancelled' } },
    select: {
      id: true,
      bookingNumber: true,
      checkIn: true,
      checkOut: true,
      roomId: true,
      roomSegments: {
        orderBy: { fromDate: 'asc' },
        select: { id: true, roomId: true, fromDate: true, toDate: true },
      },
    },
  });

  const violations: Violation[] = [];

  for (const b of bookings) {
    const segs = b.roomSegments;
    if (segs.length === 0) {
      violations.push({ bookingId: b.id, bookingNumber: b.bookingNumber, reason: 'no segments' });
      continue;
    }

    // Contiguous + non-overlapping check
    for (let i = 1; i < segs.length; i++) {
      if (segs[i].fromDate.getTime() !== segs[i - 1].toDate.getTime()) {
        violations.push({
          bookingId: b.id,
          bookingNumber: b.bookingNumber,
          reason: `segment gap or overlap between #${i - 1} and #${i}`,
        });
      }
    }

    // Coverage check
    const firstFrom = segs[0].fromDate.getTime();
    const lastTo = segs[segs.length - 1].toDate.getTime();
    if (firstFrom !== b.checkIn.getTime()) {
      violations.push({
        bookingId: b.id,
        bookingNumber: b.bookingNumber,
        reason: `first segment fromDate (${segs[0].fromDate.toISOString().slice(0, 10)}) != checkIn (${b.checkIn.toISOString().slice(0, 10)})`,
      });
    }
    if (lastTo !== b.checkOut.getTime()) {
      violations.push({
        bookingId: b.id,
        bookingNumber: b.bookingNumber,
        reason: `last segment toDate (${segs[segs.length - 1].toDate.toISOString().slice(0, 10)}) != checkOut (${b.checkOut.toISOString().slice(0, 10)})`,
      });
    }
  }

  console.log(`Checked ${bookings.length} non-cancelled bookings`);
  if (violations.length === 0) {
    console.log('OK — all bookings have valid segments');
    process.exit(0);
  }

  console.error(`FAIL — ${violations.length} violation(s):`);
  for (const v of violations.slice(0, 50)) {
    console.error(`  - ${v.bookingNumber} (${v.bookingId}): ${v.reason}`);
  }
  if (violations.length > 50) {
    console.error(`  ... and ${violations.length - 50} more`);
  }
  process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
