/**
 * Seed a booking with an outstanding balance + UNBILLED rows so we can
 * verify the new "รับชำระเงิน" button on /billing/folio.
 */

import { PrismaClient, Prisma } from '@prisma/client';
const p = new PrismaClient();

const admin = await p.user.findFirst({ where: { email: 'admin@pms.com' } });
const guest = await p.guest.findFirst();
const room  = await p.room.findFirst({ where: { status: 'available' } });
if (!admin || !guest || !room) { console.error('missing fixtures'); process.exit(1); }

const result = await p.$transaction(async (tx) => {
  // Numeric-only suffix — the booking-number generator's lex-desc query
  // can't tolerate letters in the tail (see invoice-number.service.ts).
  const num = String(Math.floor(Math.random() * 9000) + 1000).padStart(4, '0');
  const booking = await tx.booking.create({
    data: {
      bookingNumber: `BK-2026-${num}`, guestId: guest.id, roomId: room.id,
      bookingType: 'daily', status: 'checked_in', source: 'direct',
      checkIn: new Date('2026-05-15'), checkOut: new Date('2026-05-18'),
      rate: new Prisma.Decimal(1500),
    },
  });
  const folio = await tx.folio.create({
    data: {
      folioNumber: `FLO-2026-OUT-${num}`,
      bookingId: booking.id, guestId: guest.id,
      totalCharges: new Prisma.Decimal(4500), totalPayments: 0, balance: new Prisma.Decimal(4500),
    },
  });
  // 3 nightly UNBILLED rows -> nothing invoiced yet
  for (let i = 0; i < 3; i++) {
    const ds = new Date('2026-05-15'); ds.setUTCDate(15 + i);
    const de = new Date('2026-05-15'); de.setUTCDate(15 + i + 1);
    await tx.folioLineItem.create({
      data: {
        folioId: folio.id, chargeType: 'ROOM',
        description: `ค่าห้องพัก — ห้อง ${room.number}`,
        amount: new Prisma.Decimal(1500), quantity: 1, unitPrice: new Prisma.Decimal(1500),
        taxType: 'no_tax', billingStatus: 'UNBILLED',
        serviceDate: ds, periodEnd: de, createdBy: admin.id,
      },
    });
  }
  // Mark room occupied
  await tx.room.update({ where: { id: room.id }, data: { status: 'occupied', currentBookingId: booking.id } });
  return { bookingId: booking.id, bookingNumber: booking.bookingNumber, room: room.number };
});

console.log('Created booking with ฿4,500 outstanding (3 UNBILLED nights):');
console.log(`  ${result.bookingNumber}  ห้อง ${result.room}  bookingId=${result.bookingId}`);
await p.$disconnect();
