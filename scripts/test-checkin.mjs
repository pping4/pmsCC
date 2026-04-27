/**
 * Reproduce the check-in flow for BK-2026-0004 inline (without going through
 * the HTTP route) so we can see the actual error.
 *
 * Mirrors the relevant parts of api/checkin/route.ts step-by-step.
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const bookingNumber = process.argv[2] || 'BK-2026-0004';

const booking = await prisma.booking.findFirst({
  where: { bookingNumber },
  include: { room: true, guest: true, invoices: true },
});

if (!booking) { console.error('Booking not found'); process.exit(1); }

console.log('Booking:', booking.bookingNumber, booking.status, booking.bookingType);
console.log('  CheckIn:', booking.checkIn, 'CheckOut:', booking.checkOut, 'rate:', booking.rate);

const nights = Math.max(1, Math.ceil(
  (new Date(booking.checkOut).getTime() - new Date(booking.checkIn).getTime()) / (1000*60*60*24)
));
const stayAmount = Number(booking.rate) * nights;
console.log('  Nights:', nights, 'StayAmount:', stayAmount);

try {
  await prisma.$transaction(async (tx) => {
    // 1. Update booking status
    console.log('\n[1] Update status confirmed → checked_in');
    await tx.booking.update({
      where: { id: booking.id },
      data: { status: 'checked_in', actualCheckIn: new Date() },
    });

    // 2. Get folio
    console.log('[2] Get folio');
    const folio = await tx.folio.findUnique({ where: { bookingId: booking.id }, select: { id: true } });
    if (!folio) throw new Error('No folio found');
    console.log('    folioId:', folio.id);

    // 3. Check existing ROOM
    console.log('[3] Check existing ROOM charge');
    const existing = await tx.folioLineItem.findFirst({
      where: { folioId: folio.id, chargeType: 'ROOM', billingStatus: { not: 'VOIDED' } },
      select: { id: true },
    });
    console.log('    existing:', existing);

    // 4. Add nightly room charges
    if (!existing) {
      console.log('[4] Add nightly room charges');
      const start = new Date(booking.checkIn);
      start.setUTCHours(0,0,0,0);
      for (let i = 0; i < nights; i++) {
        const ns = new Date(start);
        ns.setUTCDate(ns.getUTCDate() + i);
        const ne = new Date(start);
        ne.setUTCDate(ne.getUTCDate() + i + 1);
        await tx.folioLineItem.create({
          data: {
            folioId: folio.id,
            chargeType: 'ROOM',
            description: `ค่าห้องพัก — ห้อง ${booking.room.number}`,
            amount: Number(booking.rate),
            quantity: 1,
            unitPrice: Number(booking.rate),
            taxType: 'no_tax',
            billingStatus: 'UNBILLED',
            serviceDate: ns,
            periodEnd: ne,
            referenceType: 'booking',
            referenceId: booking.id,
            createdBy: 'test',
          },
        });
        console.log(`    + night ${i+1}: ${ns.toISOString().slice(0,10)} → ${ne.toISOString().slice(0,10)}`);
      }
    }

    // ROLLBACK so we don't actually mutate
    throw new Error('TEST_ROLLBACK');
  });
} catch (e) {
  if (e.message === 'TEST_ROLLBACK') {
    console.log('\n✅ Transaction completed without errors (rolled back as designed)');
  } else {
    console.error('\n❌ Transaction FAILED:', e.message);
    console.error(e);
  }
}

await prisma.$disconnect();
