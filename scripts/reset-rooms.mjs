#!/usr/bin/env node
/**
 * reset-rooms.mjs
 *
 * After clear-test-data wipes bookings, room.status is left at whatever the
 * last (now-deleted) booking set it to -- often `occupied` or `checkout`,
 * with a dangling currentBookingId.  Anything trying to use those rooms
 * fails with "Invalid room transition: checkout → occupied" or similar.
 *
 * This script resets every room that has no live booking back to
 * `available` and clears its currentBookingId pointer.  Rooms that ARE
 * actively booked (status occupied or reserved AND a real bookingId in
 * currentBookingId) are left alone.
 *
 * Run after clear-test-data:
 *   node scripts/reset-rooms.mjs
 *
 * Idempotent.
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const rooms = await prisma.room.findMany({
  select: {
    id: true, number: true, status: true, currentBookingId: true,
  },
  orderBy: { number: 'asc' },
});

let resetCount = 0;
let okCount = 0;

for (const r of rooms) {
  let liveBooking = null;
  if (r.currentBookingId) {
    liveBooking = await prisma.booking.findUnique({
      where: { id: r.currentBookingId },
      select: { id: true, status: true },
    });
  }

  const stale = !liveBooking || liveBooking.status === 'checked_out' || liveBooking.status === 'cancelled';

  if (stale && r.status !== 'available') {
    console.log(`  ↻  room ${r.number.padEnd(4)}  ${r.status} → available  (stale ${liveBooking ? `[${liveBooking.status}]` : '(no booking)'})`);
    await prisma.room.update({
      where: { id: r.id },
      data:  { status: 'available', currentBookingId: null },
    });
    resetCount++;
  } else if (!stale) {
    okCount++;
  }
}

console.log(`\n🎉  Done. Reset ${resetCount} rooms, left ${okCount} actively-booked rooms alone.`);
await prisma.$disconnect();
