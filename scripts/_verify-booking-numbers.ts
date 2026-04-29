/**
 * Regression test for the bug where a malformed booking number (letters in
 * the suffix) poisoned `nextSequence` and made every subsequent booking
 * collide with BK-2026-0001.
 *
 * 1. Insert a deliberately bad row "BK-2026-T0864" into the DB.
 * 2. Generate three booking numbers via the SAME service the API uses.
 * 3. Assert each is monotonically increasing AND skips the polluted row.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { generateBookingNumber } from '../src/services/invoice-number.service';

const p = new PrismaClient();

async function main() {
const guest = await p.guest.findFirst();
const room  = await p.room.findFirst({ where: { status: 'available' } });
if (!guest || !room) { console.error('missing fixtures'); process.exit(1); }

console.log('🧪  Booking number sequence regression test\n');

// Plant a malformed row that defeats lex-desc orderBy.
await p.booking.create({
  data: {
    bookingNumber: 'BK-2026-T0864', guestId: guest.id, roomId: room.id,
    bookingType: 'daily', status: 'confirmed', source: 'direct',
    checkIn: new Date('2026-09-01'), checkOut: new Date('2026-09-02'),
    rate: new Prisma.Decimal(1000),
  },
});
console.log('Planted poisoned row: BK-2026-T0864');

const expectedFloorIfBuggy = '0001'; // would be the buggy result
const actualFloorIfFixed   = '0001'; // correct (no other numeric rows yet)

// First gen: should be 0001 because no NUMERIC bookings exist.
const n1 = await p.$transaction((tx) => generateBookingNumber(tx));
console.log(`gen #1 → ${n1}`);

// Insert that one
await p.booking.create({
  data: {
    bookingNumber: n1, guestId: guest.id, roomId: room.id,
    bookingType: 'daily', status: 'confirmed', source: 'direct',
    checkIn: new Date('2026-09-03'), checkOut: new Date('2026-09-04'),
    rate: new Prisma.Decimal(1000),
  },
});

// Second gen: must NOT collide with the planted row, must be > n1
const n2 = await p.$transaction((tx) => generateBookingNumber(tx));
console.log(`gen #2 → ${n2}`);

await p.booking.create({
  data: {
    bookingNumber: n2, guestId: guest.id, roomId: room.id,
    bookingType: 'daily', status: 'confirmed', source: 'direct',
    checkIn: new Date('2026-09-05'), checkOut: new Date('2026-09-06'),
    rate: new Prisma.Decimal(1000),
  },
});

const n3 = await p.$transaction((tx) => generateBookingNumber(tx));
console.log(`gen #3 → ${n3}`);

const ok =
  n1 === 'BK-2026-0001' &&
  n2 === 'BK-2026-0002' &&
  n3 === 'BK-2026-0003';

console.log('');
console.log(ok ? '✅ PASS — sequence ignored the poisoned row and stayed monotonic'
                : '❌ FAIL — sequence is still broken');

// Cleanup
await p.booking.deleteMany({
  where: { bookingNumber: { in: ['BK-2026-T0864', n1, n2] } },
});
console.log('cleaned up planted + test rows');

await p.$disconnect();
process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
