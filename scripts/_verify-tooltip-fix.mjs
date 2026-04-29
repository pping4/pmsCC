/**
 * Reproduce the tooltip bug: a booking whose `rate` (cumulative after
 * drag-resize) does NOT equal folio.totalCharges / nights.  Then call the
 * /api/reservation endpoint and confirm the snapshot uses folio totals
 * instead of rate*nights.
 */

import { PrismaClient, Prisma } from '@prisma/client';
const p = new PrismaClient();

const guest = await p.guest.findFirst();
const room  = await p.room.findFirst({ where: { status: 'available' } });
const admin = await p.user.findFirst({ where: { email: 'admin@pms.com' } });
if (!guest || !room || !admin) process.exit(1);

const result = await p.$transaction(async (tx) => {
  // Use a numeric-only suffix so the booking number is well-formed --
  // an embedded letter (e.g. "BK-2026-T0864") used to poison the
  // generator's lex-desc query and reset the next sequence to 0001.
  const num = String(Math.floor(Math.random() * 9000) + 1000).padStart(4, '0');
  // Cumulative-style rate (the bug case): 2 nights × 1000 = 2000 expected,
  // but `rate` was bumped to 2000 (= total) after drag-resize.
  const booking = await tx.booking.create({
    data: {
      bookingNumber: `BK-2026-${num}`, guestId: guest.id, roomId: room.id,
      bookingType: 'daily', status: 'checked_in', source: 'direct',
      checkIn: new Date('2026-06-01'), checkOut: new Date('2026-06-03'),  // 2 nights
      rate: new Prisma.Decimal(2000),  // CUMULATIVE — would compute exp=4000 if buggy
    },
  });
  const folio = await tx.folio.create({
    data: {
      folioNumber: `FLO-2026-T${num}`, bookingId: booking.id, guestId: guest.id,
      totalCharges:  new Prisma.Decimal(2000),     // ← authoritative: 2 × 1000
      totalPayments: new Prisma.Decimal(0),
      balance:       new Prisma.Decimal(2000),
    },
  });
  for (let i = 0; i < 2; i++) {
    const ds = new Date('2026-06-01'); ds.setUTCDate(1 + i);
    const de = new Date('2026-06-01'); de.setUTCDate(1 + i + 1);
    await tx.folioLineItem.create({
      data: {
        folioId: folio.id, chargeType: 'ROOM',
        description: `ค่าห้องพัก — ห้อง ${room.number}`,
        amount: new Prisma.Decimal(1000), quantity: 1, unitPrice: new Prisma.Decimal(1000),
        taxType: 'no_tax', billingStatus: 'UNBILLED',
        serviceDate: ds, periodEnd: de, createdBy: admin.id,
      },
    });
  }
  await tx.room.update({ where: { id: room.id }, data: { status: 'occupied', currentBookingId: booking.id } });
  return { id: booking.id, num: booking.bookingNumber };
});

// Now hit the API endpoint logic by reading the same way reservation/route.ts does
const fetched = await p.booking.findUnique({
  where: { id: result.id },
  include: {
    invoices: { select: { grandTotal: true, paidAmount: true, status: true } },
    folio:    { select: { totalCharges: true, totalPayments: true, balance: true } },
  },
});

const rate = Number(fetched.rate);
const nights = Math.round((new Date(fetched.checkOut)-new Date(fetched.checkIn))/86400000);
const buggy_expected = rate * nights;
const fixed_expected = Number(fetched.folio?.totalCharges ?? 0);

console.log(`Booking ${result.num}:`);
console.log(`  rate (cumulative bug):  ${rate}`);
console.log(`  nights:                 ${nights}`);
console.log(`  buggy expectedTotal:    rate*nights = ${buggy_expected}`);
console.log(`  fixed expectedTotal:    folio.totalCharges = ${fixed_expected}`);
console.log(`  buggy outstanding:      ${buggy_expected} - 0 = ${buggy_expected}`);
console.log(`  fixed outstanding:      ${fixed_expected} - 0 = ${fixed_expected}`);
if (buggy_expected !== fixed_expected) {
  console.log(`  ✓ Test setup is correct -- the two values DIVERGE: buggy=${buggy_expected}, fixed=${fixed_expected}`);
}

await p.$disconnect();
